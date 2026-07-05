/**
 * `gong permissions` — permission profiles (list, get, create, update, users) and
 * individual users' call access (get, grant, revoke).
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Permissions
 *
 * Lane quirks (see docs/DESIGN.md and the vendored spec):
 *  - No operation in this group paginates; list-shaped responses arrive whole.
 *  - `POST /v2/calls/users-access` is a *read* (filter travels in the body);
 *    PUT grants and DELETE revokes on the same path — DELETE carries a JSON body.
 *  - The PermissionProfileDTO is huge (44 boolean capability fields + nested access
 *    scopes); every scalar has a mechanical flag, nested scopes take JSON flags, and
 *    --body/--body-file always accepts the full DTO.
 */
import type { Command } from 'commander';
import { Option } from 'commander';

import type { CliContext } from '../context.js';
import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { addBodyOptions, buildBody, hasPath } from '../body.js';
import type { BodyFlagMap } from '../body.js';
import { CliError, EXIT } from '../errors.js';
import { resolveListFormat } from '../output.js';
import { runPaginatedList } from '../pagination.js';
import { runSingle } from '../run.js';
import { confirmDestructive, csv, jsonFlag } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

/** Like jsonFlag, but the value must be a JSON array. */
function jsonArrayFlag(flagName: string): (value: string) => unknown {
  const parse = jsonFlag(flagName);
  return (value: string) => {
    const parsed = parse(value);
    if (!Array.isArray(parsed)) {
      throw new CliError(`${flagName} must be a JSON array.`, { exitCode: EXIT.USAGE });
    }
    return parsed;
  };
}

/** Strict boolean flag values: the capability fields are tri-state (unset/true/false). */
function parseBool(flagName: string): (value: string) => boolean {
  return (value: string) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new CliError(`${flagName} must be 'true' or 'false', got '${value}'.`, {
      exitCode: EXIT.USAGE,
    });
  };
}

/** camelCase API field → kebab-case flag name (acronym-aware: ...ToCSV → ...-to-csv). */
function kebab(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** kebab-case flag name → the camelCase key commander stores it under. */
function camelize(flagName: string): string {
  return flagName.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/** Comma-separated IDs → deduplicated array (Gong declares uniqueItems on ID arrays). */
function uniqueCsv(value: string): string[] {
  return [...new Set(csv(value))];
}

// ---- PermissionProfileDTO (shared by profiles create/update) --------------------------
// All 44 boolean capability fields from the spec, in spec order.
const PROFILE_BOOLEAN_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['scoreCalls', 'user can score calls'],
  ['overrideScore', "user can override someone else's score"],
  ['downloadCallMedia', 'user can download call media'],
  ['shareCallsWithCustomers', 'user can share calls with customers'],
  ['manuallyScheduleAndUploadCalls', 'user can manually schedule and upload calls'],
  ['privateCalls', 'user can set their own calls as private'],
  ['deleteCalls', 'user can delete calls'],
  ['trimCalls', 'user can trim calls'],
  ['listenInCalls', 'user can listen in calls'],
  ['deleteEmails', 'user can delete emails'],
  ['callsAndSearch', 'user can view and search calls'],
  ['library', 'user can view library pages'],
  ['deals', 'user can view deals pages'],
  ['createEditAndDeleteDealsBoards', 'user can create/edit/delete deals boards'],
  ['dealsInlineEditing', 'user can perform inline editing of deals'],
  ['account', 'user can view account pages'],
  ['coaching', 'user can view coaching pages'],
  ['usage', 'user can view usage pages'],
  ['teamStats', 'user can view team stats page'],
  ['initiatives', 'user can view initiatives page'],
  ['market', 'user can view market page'],
  ['activity', 'user can view activity pages'],
  ['forecast', 'user can view forecast pages'],
  ['forecastManage', 'user can manage forecast boards and upload targets'],
  ['engageManageCompanyTemplates', 'user can manage company email templates'],
  ['engageManageCompanySequences', 'user can manage company sequences'],
  ['engageCreateAndManageRulesets', 'user can create and manage rulesets'],
  ['engageSnoozeFlowToDosForOthers', 'user can snooze flow to-dos for others'],
  ['engageAllowCrmFieldsViewChange', 'user can change crm fields view'],
  ['viewEngageAnalyticsActivity', 'user can view engage analytics activity page'],
  ['viewEngageAnalyticsPerformance', 'user can view engage analytics performance page'],
  ['viewEngageAnalyticsFlows', 'user can view engage analytics flows page'],
  ['manageGeneralBusinessSettings', 'user can manage general business settings'],
  ['manageScorecards', 'user can manage scorecards'],
  ['exportCallsAndCoachingDataToCSV', 'user can export calls and coaching metrics data to CSV'],
  ['crmDataInlineEditing', 'user can perform inline editing of crm data'],
  ['crmDataImport', 'user can perform import of crm data'],
  ['viewRevenueAnalytics', 'user can view dashboards page'],
  ['manageRevenueAnalytics', 'user can manage revenue analytics'],
  ['engageReassignFlowToDosToOthers', 'user can reassign flow to-dos to others'],
  ['engageAssignFlowToDosToOthers', 'user can assign flow to-dos to others'],
  ['dealsDataExport', 'user can export deals data'],
  ['aiBuilder', 'user can access AI Builder'],
  ['orchestrateCreateAndManagePlays', 'user can create and manage plays'],
];

// Nested access-scope objects: shape {permissionLevel, teamLeadIds} except
// libraryFolderAccess (permissionLevel + folder management booleans) and
// forecastPermissions (three nested scopes).
const PROFILE_ACCESS_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['callsAccess', 'calls access scope'],
  ['dealsAccess', 'deals access scope'],
  ['coachingAccess', 'coaching access scope'],
  ['insightsAccess', 'insights access scope'],
  ['usageAccess', 'usage access scope'],
  ['emailsAccess', 'emails access scope'],
];

const PROFILE_MAP: BodyFlagMap = {
  id: { path: 'id' },
  name: { path: 'name' },
  description: { path: 'description' },
  forecastPermissions: { path: 'forecastPermissions' },
  libraryFolderAccess: { path: 'libraryFolderAccess' },
};
for (const [field] of PROFILE_ACCESS_FIELDS) {
  PROFILE_MAP[field] = { path: field };
}
for (const [field] of PROFILE_BOOLEAN_FIELDS) {
  PROFILE_MAP[camelize(kebab(field))] = { path: field };
}

const ACCESS_SCOPE_HINT =
  'JSON {"permissionLevel","teamLeadIds"}; levels: all|managers-team|report-to-them|own|none';

/** All PermissionProfileDTO body flags + --body/--body-file. */
function addProfileBodyOptions(cmd: Command): Command {
  cmd
    .option('--name <name>', 'permission profile name (maps to name)')
    .option('--description <text>', 'permission profile description (maps to description)')
    .option(
      '--id <id>',
      'profile id inside the body — rarely needed: server-assigned on create, update targets the positional <id> (maps to id)',
    );
  for (const [field, what] of PROFILE_ACCESS_FIELDS) {
    cmd.option(`--${kebab(field)} <json>`, `${what}, ${ACCESS_SCOPE_HINT} (maps to ${field})`, jsonFlag(`--${kebab(field)}`));
  }
  cmd
    .option(
      '--forecast-permissions <json>',
      'JSON {"forecastAccess","forecastEditSubmissions","forecastEditTargets"}, each an access scope (maps to forecastPermissions)',
      jsonFlag('--forecast-permissions'),
    )
    .option(
      '--library-folder-access <json>',
      'JSON {"permissionLevel","libraryFolderIds","managePublicFolder","manageStreams","manageFolderCalls","shareFoldersAndStreams"}; levels: none|all|specific-folders (maps to libraryFolderAccess)',
      jsonFlag('--library-folder-access'),
    );
  for (const [field, what] of PROFILE_BOOLEAN_FIELDS) {
    const flag = kebab(field);
    cmd.option(`--${flag} <bool>`, `${what}; true|false (maps to ${field})`, parseBool(`--${flag}`));
  }
  addBodyOptions(cmd);
  return cmd;
}

const PROFILE_BODY_HELP =
  `\nThe request body is the full PermissionProfileDTO: every scalar field has a flag above;` +
  `\nnested access scopes take inline JSON flags. For anything beyond a handful of fields,` +
  `\npass the whole profile with --body/--body-file (typed flags merge over it).`;

// ---- callAccessList assembly (shared by call-access grant/revoke) ---------------------
const ACCESS_LIST_MAP: BodyFlagMap = {
  access: { path: 'callAccessList' },
};

function addAccessListOptions(cmd: Command): Command {
  cmd.addOption(
    new Option(
      '--access <json>',
      'JSON array of {"callId","userIds"} items (maps to callAccessList)',
    )
      .argParser(jsonArrayFlag('--access'))
      .conflicts(['callId', 'userIds']),
  );
  cmd
    .option(
      '--call-id <id>',
      'single-call convenience, with --user-ids (maps to callAccessList[0].callId)',
    )
    .option(
      '--user-ids <ids>',
      'comma-separated user IDs, with --call-id (maps to callAccessList[0].userIds)',
    );
  addBodyOptions(cmd);
  return cmd;
}

async function buildAccessListBody(
  cmd: Command,
  ctx: CliContext,
  commandName: string,
): Promise<Record<string, unknown>> {
  const body = ((await buildBody(cmd, ctx, ACCESS_LIST_MAP)) ?? {}) as Record<string, unknown>;
  const typedCallId = cmd.getOptionValueSource('callId') === 'cli';
  const typedUserIds = cmd.getOptionValueSource('userIds') === 'cli';
  if (typedCallId !== typedUserIds) {
    throw new CliError('--call-id and --user-ids must be provided together.', {
      exitCode: EXIT.USAGE,
    });
  }
  if (typedCallId) {
    const opts = cmd.opts<{ callId: string; userIds: string }>();
    body.callAccessList = [{ callId: opts.callId, userIds: uniqueCsv(opts.userIds) }];
  }
  if (!hasPath(body, 'callAccessList')) {
    throw new CliError(`${commandName} requires a call access list.`, {
      exitCode: EXIT.USAGE,
      hint: "Pass --call-id with --user-ids, --access '[{\"callId\":...,\"userIds\":[...]}]', or callAccessList via --body/--body-file.",
    });
  }
  return body;
}

function describeAccessList(body: Record<string, unknown>): string {
  const list = body.callAccessList;
  if (!Array.isArray(list)) return 'the calls in callAccessList';
  return `${list.length} call${list.length === 1 ? '' : 's'}`;
}

export const registerPermissions: GroupRegistrar = (program, ctx) => {
  const permissions = program
    .command('permissions')
    .description("permission profiles and individual users' call access");

  // ======================================================================================
  // gong permissions profiles ...
  // ======================================================================================
  const profiles = permissions
    .command('profiles')
    .description('company permission profiles (list, get, create, update, users)');

  // ---- gong permissions profiles list — GET /v2/all-permission-profiles ---------------
  profiles
    .command('list')
    .description('list all permission profiles in a workspace (GET /v2/all-permission-profiles)')
    .requiredOption(
      '--workspace-id <id>',
      "workspace whose profiles to list; see 'gong workspaces list' (maps to workspaceId; required)",
    )
    .addHelpText(
      'after',
      `\nNot paginated: all profiles return in one response, in alphabetical order of profile\nname. API docs: ${DOCS}#get-/v2/all-permission-profiles\n\nExamples:\n  gong permissions profiles list --workspace-id 623457276584334\n  gong permissions profiles list --workspace-id 623457276584334 -o jsonl`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ workspaceId: string }>();
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/all-permission-profiles',
          query: { workspaceId: opts.workspaceId },
        },
        cursorIn: 'query',
        recordsKey: 'profiles',
        flags: {}, // this endpoint never paginates
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['id', 'name', 'description'],
        },
      });
    });

  // ---- gong permissions profiles get <id> — GET /v2/permission-profile ----------------
  profiles
    .command('get')
    .description('retrieve one permission profile (GET /v2/permission-profile)')
    .argument('<id>', 'permission profile ID (maps to the profileId query parameter)')
    .addHelpText(
      'after',
      `\nAPI docs: ${DOCS}#get-/v2/permission-profile\n\nExample:\n  gong permissions profiles get 3843152912968920037`,
    )
    .action(async function (this: Command, id: string) {
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'GET', path: '/v2/permission-profile', query: { profileId: id } },
        flags: outputFlags(this),
        unwrapKey: 'profile',
      });
    });

  // ---- gong permissions profiles create — POST /v2/permission-profile -----------------
  const create = profiles
    .command('create')
    .description('create a permission profile in a workspace (POST /v2/permission-profile)')
    .requiredOption(
      '--workspace-id <id>',
      'workspace to create the profile in (maps to the workspaceId query parameter; required)',
    );
  addProfileBodyOptions(create);
  create
    .addHelpText(
      'after',
      `${PROFILE_BODY_HELP}\nThe API may return 422 for semantically invalid profiles. API docs: ${DOCS}#post-/v2/permission-profile\n\nExamples:\n  gong permissions profiles create --workspace-id 623457276584334 --name 'Sales reps' \\\n    --score-calls true --calls-access '{"permissionLevel":"own"}'\n  gong permissions profiles create --workspace-id 623457276584334 --body-file profile.json`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(create, ctx, PROFILE_MAP);
      if (body === undefined) {
        throw new CliError('gong permissions profiles create requires profile fields.', {
          exitCode: EXIT.USAGE,
          hint: 'Provide flags (e.g. --name) or the full profile via --body/--body-file.',
        });
      }
      const opts = this.opts<{ workspaceId: string }>();
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'POST',
          path: '/v2/permission-profile',
          query: { workspaceId: opts.workspaceId },
          body,
        },
        flags: outputFlags(this),
        unwrapKey: 'profile',
      });
    });

  // ---- gong permissions profiles update <id> — PUT /v2/permission-profile -------------
  const update = profiles
    .command('update')
    .description('update a permission profile (PUT /v2/permission-profile)')
    .argument('<id>', 'permission profile ID to update (maps to the profileId query parameter)');
  addProfileBodyOptions(update);
  update
    .addHelpText(
      'after',
      `${PROFILE_BODY_HELP}\nThe response is the entire profile after applying the changes. API docs: ${DOCS}#put-/v2/permission-profile\n\nExamples:\n  gong permissions profiles update 3843152912968920037 --description 'EMEA reps' --deals-data-export false\n  gong permissions profiles update 3843152912968920037 --body-file profile.json`,
    )
    .action(async function (this: Command, id: string) {
      const body = await buildBody(update, ctx, PROFILE_MAP);
      if (body === undefined) {
        throw new CliError('gong permissions profiles update requires fields to update.', {
          exitCode: EXIT.USAGE,
          hint: 'Provide flags (e.g. --name) or the full profile via --body/--body-file.',
        });
      }
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'PUT',
          path: '/v2/permission-profile',
          query: { profileId: id },
          body,
        },
        flags: outputFlags(this),
        unwrapKey: 'profile',
      });
    });

  // ---- gong permissions profiles users <id> — GET /v2/permission-profile/users --------
  profiles
    .command('users')
    .description('list users attached to a permission profile (GET /v2/permission-profile/users)')
    .argument('<id>', 'permission profile ID (maps to the profileId query parameter)')
    .addHelpText(
      'after',
      `\nNot paginated: all attached users return in one response. Bearer-token access requires\nthe api:users:read scope. API docs: ${DOCS}#get-/v2/permission-profile/users\n\nExample:\n  gong permissions profiles users 3843152912968920037`,
    )
    .action(async function (this: Command, id: string) {
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/permission-profile/users',
          query: { profileId: id },
        },
        cursorIn: 'query',
        recordsKey: 'users',
        flags: {}, // this endpoint never paginates
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['id', 'fullName', 'emailAddress'],
        },
      });
    });

  // ======================================================================================
  // gong permissions call-access ...
  // ======================================================================================
  const callAccess = permissions
    .command('call-access')
    .description("individual users' access to specific calls (get, grant, revoke)");

  // ---- gong permissions call-access get — POST /v2/calls/users-access -----------------
  const GET_ACCESS_MAP: BodyFlagMap = {
    callIds: { path: 'filter.callIds', transform: (value) => uniqueCsv(String(value)) },
  };

  const accessGet = callAccess
    .command('get')
    .description(
      'list users with individual API-granted access to calls (read via POST /v2/calls/users-access)',
    )
    .option(
      '--call-ids <ids>',
      'comma-separated call IDs to look up (maps to filter.callIds; required)',
    );
  addBodyOptions(accessGet);
  accessGet
    .addHelpText(
      'after',
      `\nCovers only access granted through this API — not sharing recipients or permission\nprofiles. Bearer-token access requires the api:call-user-access:read scope.\nAPI docs: ${DOCS}#post-/v2/calls/users-access\n\nExamples:\n  gong permissions call-access get --call-ids 7782342274025937895\n  gong permissions call-access get --body '{"filter":{"callIds":["7782342274025937895"]}}'`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(accessGet, ctx, GET_ACCESS_MAP);
      if (!hasPath(body, 'filter.callIds')) {
        throw new CliError('gong permissions call-access get requires call IDs.', {
          exitCode: EXIT.USAGE,
          hint: 'Pass --call-ids or provide filter.callIds via --body/--body-file.',
        });
      }
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/calls/users-access', body },
        cursorIn: 'body',
        recordsKey: 'callAccessList',
        flags: {}, // this endpoint never paginates
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['callId', 'users'],
        },
      });
    });

  // ---- gong permissions call-access grant — PUT /v2/calls/users-access ----------------
  const grant = callAccess
    .command('grant')
    .description('give individual users access to calls (PUT /v2/calls/users-access)');
  addAccessListOptions(grant);
  grant
    .addHelpText(
      'after',
      `\nGranting access a user already has is a no-op. Bearer-token access requires the\napi:call-user-access:write scope. API docs: ${DOCS}#put-/v2/calls/users-access\n\nExamples:\n  gong permissions call-access grant --call-id 7782342274025937895 --user-ids 234599484848423\n  gong permissions call-access grant --body '{"callAccessList":[{"callId":"778","userIds":["234"]}]}'`,
    )
    .action(async function (this: Command) {
      const body = await buildAccessListBody(this, ctx, 'gong permissions call-access grant');
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'PUT', path: '/v2/calls/users-access', body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong permissions call-access revoke — DELETE /v2/calls/users-access ------------
  const revoke = callAccess
    .command('revoke')
    .description(
      "remove users' API-granted access to calls (DELETE /v2/calls/users-access; destructive)",
    );
  addAccessListOptions(revoke);
  revoke
    .addHelpText(
      'after',
      `\nDestructive: prompts on a TTY, requires --yes otherwise. Only removes access previously\ngranted through this API; access from sharing or permission profiles is unaffected.\nBearer-token access requires the api:call-user-access:write scope.\nAPI docs: ${DOCS}#delete-/v2/calls/users-access\n\nExamples:\n  gong permissions call-access revoke --call-id 7782342274025937895 --user-ids 234599484848423 --yes\n  gong permissions call-access revoke --body '{"callAccessList":[{"callId":"778","userIds":["234"]}]}' --yes`,
    )
    .action(async function (this: Command) {
      const body = await buildAccessListBody(this, ctx, 'gong permissions call-access revoke');
      await confirmDestructive(this, ctx, {
        description: `Revoke API-granted user access to ${describeAccessList(body)}.`,
      });
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'DELETE', path: '/v2/calls/users-access', body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });
};
