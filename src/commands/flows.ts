/**
 * `gong flows` — Gong Engage flows: list flows and folders, inspect flow steps, and
 * manage prospect ↔ flow assignment (assign, unassign, async bulk assignment).
 * All operations require a Gong Engage license.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Flows
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { addBodyOptions, buildBody, hasPath } from '../body.js';
import type { BodyFlagMap } from '../body.js';
import { CliError, EXIT } from '../errors.js';
import { resolveListFormat } from '../output.js';
import { addPaginationOptions, runPaginatedList } from '../pagination.js';
import type { PaginationFlags } from '../pagination.js';
import { runSingle } from '../run.js';
import { csv, jsonFlag } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

export const registerFlows: GroupRegistrar = (program, ctx) => {
  const flows = program
    .command('flows')
    .description('Gong Engage flows and prospect assignment (requires the Gong Engage license)')
    .addHelpText(
      'after',
      `\nAll flows commands require a Gong Engage license; without one the API returns 403.\nAPI docs: ${DOCS}#tag--Flows`,
    );

  // ---- gong flows list — GET /v2/flows -------------------------------------------------
  const list = flows
    .command('list')
    .description('list Engage flows visible to a user (GET /v2/flows)')
    .requiredOption(
      '--flow-owner-email <email>',
      'Gong user whose personal and shared flows to return, plus all company flows (maps to flowOwnerEmail; required)',
    )
    .option('--workspace-id <id>', 'only flows in this workspace (maps to workspaceId)')
    .option('--folder-id <id>', 'only flows in this folder (maps to folderId)')
    .option(
      '--most-recently-assigned',
      'only the flows most recently assigned by the user, capped at 20 (maps to mostRecentlyAssigned)',
    );
  addPaginationOptions(list);
  list
    .addHelpText(
      'after',
      `\nAPI docs: ${DOCS}#get-/v2/flows\n\nExamples:\n  gong flows list --flow-owner-email rep@example.com\n  gong flows list --flow-owner-email rep@example.com --most-recently-assigned -o jsonl`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{
        flowOwnerEmail: string;
        workspaceId?: string;
        folderId?: string;
        mostRecentlyAssigned?: boolean;
      }>();
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/flows',
          query: {
            flowOwnerEmail: opts.flowOwnerEmail,
            workspaceId: opts.workspaceId,
            folderId: opts.folderId,
            mostRecentlyAssigned: opts.mostRecentlyAssigned,
          },
        },
        cursorIn: 'query',
        recordsKey: 'flows',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['id', 'name', 'visibility', 'folderName', 'creationDate'],
        },
      });
    });

  // ---- gong flows folders — GET /v2/flows/folders --------------------------------------
  const folders = flows
    .command('folders')
    .description('list Engage flow folders visible to a user (GET /v2/flows/folders)')
    .requiredOption(
      '--flow-folder-owner-email <email>',
      'Gong user whose personal and shared flow folders to return, plus all company folders (maps to flowFolderOwnerEmail; required)',
    )
    .option(
      '--parent-id <id>',
      'only this folder and its child folders (maps to parentId; the spec declares it int64)',
    )
    .option('--workspace-id <id>', 'only folders in this workspace (maps to workspaceId)');
  addPaginationOptions(folders);
  folders
    .addHelpText(
      'after',
      `\nGong's spec declares the same flow-shaped payload as 'gong flows list': records\nare returned under the 'flows' key. API docs: ${DOCS}#get-/v2/flows/folders\n\nExamples:\n  gong flows folders --flow-folder-owner-email rep@example.com\n  gong flows folders --flow-folder-owner-email rep@example.com --parent-id 1695493301223573465`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{
        flowFolderOwnerEmail: string;
        parentId?: string;
        workspaceId?: string;
      }>();
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/flows/folders',
          query: {
            flowFolderOwnerEmail: opts.flowFolderOwnerEmail,
            parentId: opts.parentId,
            workspaceId: opts.workspaceId,
          },
        },
        cursorIn: 'query',
        // Spec quirk: the folders endpoint reuses FlowsResponse, so records live under
        // 'flows' (there is no folder-specific schema). See docs/DESIGN.md → API quirks.
        recordsKey: 'flows',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['id', 'name', 'visibility', 'creationDate'],
        },
      });
    });

  // ---- gong flows steps — POST /v2/flows/steps ------------------------------------------
  const STEPS_MAP: BodyFlagMap = {
    flowIds: { path: 'flowIds', transform: (v) => csv(String(v)) },
  };

  const steps = flows
    .command('steps')
    .description('flow details and steps for one or more Engage flows (POST /v2/flows/steps)')
    .option(
      '--flow-ids <ids>',
      'comma-separated Engage flow IDs, max 20 per request (maps to flowIds)',
    );
  addBodyOptions(steps);
  steps
    .addHelpText(
      'after',
      `\nStep order is 1-based and maps directly to overrides.steps[].number in\n'gong flows prospects assign'. Max 20 flow IDs per request; unknown IDs make the\nwhole request fail with 404. API docs: ${DOCS}#post-/v2/flows/steps\n\nExamples:\n  gong flows steps --flow-ids 1695493301223590792,1695493301223002764\n  gong flows steps --body '{"flowIds":["1695493301223590792"]}'`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(steps, ctx, STEPS_MAP);
      if (!hasPath(body, 'flowIds')) {
        throw new CliError('gong flows steps requires flow IDs.', {
          exitCode: EXIT.USAGE,
          hint: 'Pass --flow-ids id1,id2 or provide flowIds in --body/--body-file.',
        });
      }
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/flows/steps', body },
        cursorIn: 'body',
        recordsKey: 'flows',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['id', 'name', 'visibility', 'folderId', 'creationDate'],
        },
        // 404 here means "one or more flows not found" (bad input), not "no data".
        notFoundMeansEmpty: false,
      });
    });

  // ---- gong flows prospects ... ---------------------------------------------------------
  const prospects = flows
    .command('prospects')
    .description('prospect ↔ flow assignment: list, assign, unassign, bulk assignment');

  // ---- gong flows prospects list — POST /v2/flows/prospects ------------------------------
  const PROSPECTS_LIST_MAP: BodyFlagMap = {
    crmProspectsIds: { path: 'crmProspectsIds', transform: (v) => csv(String(v)) },
    flowInstanceIds: { path: 'flowInstanceIds', transform: (v) => csv(String(v)) },
  };

  const prospectsList = prospects
    .command('list')
    .description('list the flows assigned to prospects (POST /v2/flows/prospects)')
    .option(
      '--crm-prospects-ids <ids>',
      'comma-separated CRM prospect IDs; returns only open (Pending/Running/Paused) instances (maps to crmProspectsIds)',
    )
    .option(
      '--flow-instance-ids <ids>',
      'comma-separated flow instance IDs; returns all instances, including finished (maps to flowInstanceIds)',
    );
  addBodyOptions(prospectsList);
  prospectsList
    .addHelpText(
      'after',
      `\nQuery by CRM prospect IDs or by flow instance IDs (one of the two).\nAPI docs: ${DOCS}#post-/v2/flows/prospects\n\nExamples:\n  gong flows prospects list --crm-prospects-ids a5V1Q00A120DP4CVAW\n  gong flows prospects list --body '{"flowInstanceIds":["234599484848423"]}'`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(prospectsList, ctx, PROSPECTS_LIST_MAP);
      if (!hasPath(body, 'crmProspectsIds') && !hasPath(body, 'flowInstanceIds')) {
        throw new CliError(
          'gong flows prospects list requires CRM prospect IDs or flow instance IDs.',
          {
            exitCode: EXIT.USAGE,
            hint: 'Pass --crm-prospects-ids or --flow-instance-ids (or provide one in --body).',
          },
        );
      }
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/flows/prospects', body },
        cursorIn: 'body',
        recordsKey: 'prospectsAssigned',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: [
            'crmProspectId',
            'flowId',
            'flowName',
            'flowInstanceId',
            'flowInstanceStatus',
          ],
        },
      });
    });

  // ---- gong flows prospects assign — POST /v2/flows/prospects/assign ---------------------
  const ASSIGN_MAP: BodyFlagMap = {
    crmProspectsIds: { path: 'crmProspectsIds', transform: (v) => csv(String(v)) },
    flowId: { path: 'flowId' },
    flowInstanceOwnerEmail: { path: 'flowInstanceOwnerEmail' },
    steps: { path: 'overrides.steps' },
    flowInstanceVariables: { path: 'overrides.flowInstanceVariables' },
    coolOffOverride: { path: 'overrides.coolOffOverride' },
    flowInstanceDescription: { path: 'flowInstanceDescription' },
  };

  const REQUIRED_ASSIGN_PATHS = ['crmProspectsIds', 'flowId', 'flowInstanceOwnerEmail'];

  const assign = prospects
    .command('assign')
    .description('assign prospects (contacts or leads) to a flow (POST /v2/flows/prospects/assign)')
    .option(
      '--crm-prospects-ids <ids>',
      'comma-separated CRM IDs of the prospects to assign, max 100 per request (maps to crmProspectsIds; required)',
    )
    .option('--flow-id <id>', 'the Engage flow to assign the prospects to (maps to flowId; required)')
    .option(
      '--flow-instance-owner-email <email>',
      'Gong user who owns the flow to-dos (maps to flowInstanceOwnerEmail; required)',
    )
    .option(
      '--steps <json>',
      'JSON array of step overrides, e.g. [{"number":1,"subject":"...","body":"..."}] (beta; maps to overrides.steps)',
      jsonFlag('--steps'),
    )
    .option(
      '--flow-instance-variables <json>',
      'JSON array of variable overrides, e.g. [{"name":"recipient.first_name","value":"Mike"}] (beta; maps to overrides.flowInstanceVariables)',
      jsonFlag('--flow-instance-variables'),
    )
    .option(
      '--cool-off-override',
      'assign regardless of cool-off status (beta; maps to overrides.coolOffOverride)',
    )
    .option(
      '--flow-instance-description <text>',
      'description for the flow instance, HTML allowed (beta; maps to flowInstanceDescription)',
    )
    .option(
      '--legacy-cool-off-endpoint',
      'call the deprecated POST /v2/flows/prospects/assign/cool-off-override endpoint instead (Gong deprecated it; prefer --cool-off-override)',
    );
  addBodyOptions(assign);
  assign
    .addHelpText(
      'after',
      `\nUp to 100 prospects per request. Partial failures are reported in-band in the\nprospectsNotAssigned array of the response. API docs: ${DOCS}#post-/v2/flows/prospects/assign\n\nExamples:\n  gong flows prospects assign --flow-id 1695493301223590792 \\\n    --flow-instance-owner-email rep@example.com --crm-prospects-ids a5V1Q00A120DP4CVAW\n  gong flows prospects assign --body '{"flowId":"1695493301223590792","flowInstanceOwnerEmail":"rep@example.com","crmProspectsIds":["a5V1Q00A120DP4CVAW"],"overrides":{"coolOffOverride":true}}'`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(assign, ctx, ASSIGN_MAP);
      const missing = REQUIRED_ASSIGN_PATHS.filter((path) => !hasPath(body, path));
      if (body === undefined || missing.length > 0) {
        throw new CliError(
          `gong flows prospects assign is missing required fields: ${missing.join(', ') || REQUIRED_ASSIGN_PATHS.join(', ')}.`,
          {
            exitCode: EXIT.USAGE,
            hint: 'Provide them as flags (see --help) or in --body/--body-file.',
          },
        );
      }
      const legacy = this.opts<{ legacyCoolOffEndpoint?: boolean }>().legacyCoolOffEndpoint;
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'POST',
          path: legacy
            ? '/v2/flows/prospects/assign/cool-off-override'
            : '/v2/flows/prospects/assign',
          body,
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong flows prospects unassign — POST /v2/flows/prospects/unassign-flows-by-* -----
  const UNASSIGN_CRM_MAP: BodyFlagMap = {
    crmIds: { path: 'crmProspectId', transform: (v) => csv(String(v))[0] },
    flowId: { path: 'flowId' },
    unassignedByUserEmail: { path: 'unassignedByUserEmail' },
  };
  const UNASSIGN_INSTANCE_MAP: BodyFlagMap = {
    instanceIds: { path: 'flowInstanceIds', transform: (v) => csv(String(v)) },
    unassignedByUserEmail: { path: 'unassignedByUserEmail' },
  };

  const unassign = prospects
    .command('unassign')
    .description(
      'remove prospects from flows, by CRM prospect ID or by flow instance ID (POST /v2/flows/prospects/unassign-flows-by-crm-id | -instance-id)',
    )
    .option(
      '--crm-ids <id>',
      'CRM prospect ID to unassign — the by-crm-id endpoint accepts exactly one per request (maps to crmProspectId)',
    )
    .option(
      '--instance-ids <ids>',
      'comma-separated flow instance IDs to unassign, max 200 per request (maps to flowInstanceIds)',
    )
    .option(
      '--flow-id <id>',
      'remove the prospect from this flow only; omit to remove from ALL assigned flows (only with --crm-ids; maps to flowId)',
    )
    .option(
      '--unassigned-by-user-email <email>',
      'Gong user requesting the removal — not the prospect being removed (maps to unassignedByUserEmail)',
    );
  addBodyOptions(unassign);
  unassign
    .addHelpText(
      'after',
      `\nExactly one of --crm-ids or --instance-ids selects the endpoint. The response\nreports successes only (unassignedFlowInstanceIds): removals that failed are\nsilently omitted and those prospects stay assigned.\nAPI docs: ${DOCS}#post-/v2/flows/prospects/unassign-flows-by-crm-id\n          ${DOCS}#post-/v2/flows/prospects/unassign-flows-by-instance-id\n\nExamples:\n  gong flows prospects unassign --crm-ids a5V1Q00A120DP4CVAW --flow-id 1695493301223590792\n  gong flows prospects unassign --instance-ids 234599484848423,234599484848424\n  gong flows prospects unassign --crm-ids a5V1Q00A120DP4CVAW --body '{"unassignedByUserEmail":"manager@example.com"}'`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ crmIds?: string; instanceIds?: string; flowId?: string }>();
      const crmMode = opts.crmIds !== undefined;
      const instanceMode = opts.instanceIds !== undefined;
      if (crmMode === instanceMode) {
        throw new CliError(
          'gong flows prospects unassign requires exactly one of --crm-ids or --instance-ids.',
          {
            exitCode: EXIT.USAGE,
            hint: 'Use --crm-ids to unassign one prospect, or --instance-ids for flow instances.',
          },
        );
      }
      if (crmMode && csv(String(opts.crmIds)).length !== 1) {
        throw new CliError(
          'The unassign-by-CRM-ID endpoint accepts exactly one CRM prospect ID per request.',
          {
            exitCode: EXIT.USAGE,
            hint: 'Run the command once per prospect, or unassign by flow instance with --instance-ids.',
          },
        );
      }
      if (instanceMode && opts.flowId !== undefined) {
        throw new CliError('--flow-id applies only when unassigning with --crm-ids.', {
          exitCode: EXIT.USAGE,
        });
      }
      const body = await buildBody(
        unassign,
        ctx,
        crmMode ? UNASSIGN_CRM_MAP : UNASSIGN_INSTANCE_MAP,
      );
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'POST',
          path: crmMode
            ? '/v2/flows/prospects/unassign-flows-by-crm-id'
            : '/v2/flows/prospects/unassign-flows-by-instance-id',
          body,
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong flows prospects bulk-assign — POST /v2/flows/prospects/bulk-assignments -----
  const BULK_ASSIGN_MAP: BodyFlagMap = {
    flowId: { path: 'flowId' },
    flowInstanceOwnerEmail: { path: 'flowInstanceOwnerEmail' },
    prospects: { path: 'prospects' },
  };

  const REQUIRED_BULK_ASSIGN_PATHS = ['flowId', 'flowInstanceOwnerEmail', 'prospects'];

  const bulkAssign = prospects
    .command('bulk-assign')
    .description(
      'asynchronously submit a bulk assignment of prospects to a flow (POST /v2/flows/prospects/bulk-assignments)',
    )
    .option('--flow-id <id>', 'the Engage flow to assign the prospects to (maps to flowId; required)')
    .option(
      '--flow-instance-owner-email <email>',
      'Gong user who will own the flow instance (maps to flowInstanceOwnerEmail; required)',
    )
    .option(
      '--prospects <json>',
      'JSON array of prospects, max 50: [{"firstName","lastName","email","jobTitle","linkedInUrl","crmId","accountCrmId","companyName"}] (maps to prospects; required)',
      jsonFlag('--prospects'),
    );
  addBodyOptions(bulkAssign);
  bulkAssign
    .addHelpText(
      'after',
      `\nAsync: the API returns 202 Accepted with a bulk assignment id — poll\n'gong flows prospects bulk-assign-status <id>' for results. Up to 50 prospects per\nrequest; prospects without a crmId must include firstName and lastName.\nAPI docs: ${DOCS}#post-/v2/flows/prospects/bulk-assignments\n\nExamples:\n  gong flows prospects bulk-assign --flow-id 1695493301223590792 \\\n    --flow-instance-owner-email rep@example.com \\\n    --prospects '[{"firstName":"Jon","lastName":"Snow","email":"jon@example.com"}]'\n  gong flows prospects bulk-assign --body-file bulk.json`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(bulkAssign, ctx, BULK_ASSIGN_MAP);
      const missing = REQUIRED_BULK_ASSIGN_PATHS.filter((path) => !hasPath(body, path));
      if (body === undefined || missing.length > 0) {
        throw new CliError(
          `gong flows prospects bulk-assign is missing required fields: ${missing.join(', ') || REQUIRED_BULK_ASSIGN_PATHS.join(', ')}.`,
          {
            exitCode: EXIT.USAGE,
            hint: 'Provide them as flags (see --help) or in --body/--body-file.',
          },
        );
      }
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/flows/prospects/bulk-assignments', body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong flows prospects bulk-assign-status <id> — GET .../bulk-assignments/{id} -----
  prospects
    .command('bulk-assign-status')
    .description(
      'results of a bulk assignment of prospects to a flow (GET /v2/flows/prospects/bulk-assignments/{id})',
    )
    .argument('<id>', "bulk assignment ID returned by 'gong flows prospects bulk-assign'")
    .addHelpText(
      'after',
      `\nStatus is one of PENDING, IN_PROGRESS, COMPLETED, FAILED; per-prospect outcomes\nare in results[]. API docs: ${DOCS}#get-/v2/flows/prospects/bulk-assignments/-id-\n\nExample:\n  gong flows prospects bulk-assign-status f47ac10b-58cc-4372-a567-0e02b2c3d479`,
    )
    .action(async function (this: Command, id: string) {
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: `/v2/flows/prospects/bulk-assignments/${encodeURIComponent(id)}`,
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });
};
