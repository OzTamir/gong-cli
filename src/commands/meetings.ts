/**
 * `gong meetings` — Gong meetings (beta/limited release): create, update, delete,
 * integration status. All four endpoints return HTTP 403 until the Meetings API is
 * enabled for your account (contact your Gong CSM).
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Meetings--in-Beta-Phase-
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { addBodyOptions, buildBody, hasPath } from '../body.js';
import type { BodyFlagMap } from '../body.js';
import { CliError, EXIT } from '../errors.js';
import { resolveListFormat } from '../output.js';
import { runPaginatedList } from '../pagination.js';
import { runSingle } from '../run.js';
import { confirmDestructive, csv, expandDateTime, jsonFlag } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';
const BETA_NOTE =
  'Beta/limited release: Gong returns HTTP 403 until the Meetings API is enabled for your account (contact your CSM).';

// Shared body shape of POST /v2/meetings and PUT /v2/meetings/{meetingId}.
const MEETING_BODY_MAP: BodyFlagMap = {
  from: { path: 'startTime', transform: (v) => expandDateTime(String(v)) },
  to: { path: 'endTime', transform: (v) => expandDateTime(String(v)) },
  startTime: { path: 'startTime', transform: (v) => expandDateTime(String(v)) },
  endTime: { path: 'endTime', transform: (v) => expandDateTime(String(v)) },
  title: { path: 'title' },
  invitees: { path: 'invitees' },
  externalId: { path: 'externalId' },
  provider: { path: 'provider' },
  organizerEmail: { path: 'organizerEmail' },
};

const REQUIRED_MEETING_PATHS = ['startTime', 'endTime', 'invitees', 'organizerEmail'];

function addMeetingBodyFlags(cmd: Command): Command {
  return cmd
    .option('--start-time <datetime>', 'meeting start, ISO-8601 or YYYY-MM-DD (maps to startTime; required)')
    .option('--end-time <datetime>', 'meeting end, ISO-8601 or YYYY-MM-DD (maps to endTime; required)')
    .option('--from <datetime>', 'alias for --start-time (maps to startTime)')
    .option('--to <datetime>', 'alias for --end-time (maps to endTime)')
    .option('--title <title>', 'title of the event (maps to title)')
    .option(
      '--invitees <json>',
      'JSON array of invitees [{email, displayName, firstName, lastName}], excluding the organizer (maps to invitees; required)',
      jsonFlag('--invitees'),
    )
    .option('--external-id <id>', 'the meeting ID as formed on the external system (maps to externalId)')
    .option('--provider <provider>', "web conferencing provider, e.g. 'zoom'; omit to use the user's default (maps to provider)")
    .option('--organizer-email <email>', 'email of the Gong user who owns the meeting; the consent page follows their settings (maps to organizerEmail; required)');
}

function validateMeetingBody(commandName: string, body: unknown): void {
  const missing = REQUIRED_MEETING_PATHS.filter((path) => !hasPath(body, path));
  if (body === undefined || missing.length > 0) {
    throw new CliError(
      `${commandName} is missing required fields: ${missing.join(', ') || REQUIRED_MEETING_PATHS.join(', ')}.`,
      {
        exitCode: EXIT.USAGE,
        hint: 'Provide them as flags (see --help) or in --body/--body-file.',
      },
    );
  }
}

export const registerMeetings: GroupRegistrar = (program, ctx) => {
  const meetings = program
    .command('meetings')
    .description('Gong meetings, beta/limited release (create, update, delete, integration status)');

  // ---- gong meetings create — POST /v2/meetings ----------------------------------------
  const create = addMeetingBodyFlags(
    meetings
      .command('create')
      .description('create a Gong meeting (POST /v2/meetings; beta/limited release — 403 until enabled)'),
  );
  addBodyOptions(create);
  create
    .addHelpText(
      'after',
      `\n${BETA_NOTE}\nAdd the returned additionalInvitees (e.g. assistant@gong.io) to the calendar invitation\nso Gong can record the meeting. API docs: ${DOCS}#post-/v2/meetings\n\nExamples:\n  gong meetings create --start-time 2026-07-10T10:00:00Z --end-time 2026-07-10T11:00:00Z \\\n    --title Kickoff --organizer-email host@acme.com \\\n    --invitees '[{"email":"jon.snow@acme.com","displayName":"Jon Snow"}]'\n  gong meetings create --body-file meeting.json`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(create, ctx, MEETING_BODY_MAP);
      validateMeetingBody('gong meetings create', body);
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/meetings', body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong meetings update <id> — PUT /v2/meetings/{meetingId} ------------------------
  const update = addMeetingBodyFlags(
    meetings
      .command('update')
      .description('replace a Gong meeting (PUT /v2/meetings/{meetingId}; beta/limited release — 403 until enabled)')
      .argument('<id>', "Gong's meeting ID (up to 20 digits)"),
  );
  addBodyOptions(update);
  update
    .addHelpText(
      'after',
      `\n${BETA_NOTE}\nPUT replaces the meeting: resend all required fields even if unchanged.\nAPI docs: ${DOCS}#put-/v2/meetings/-meetingId-\n\nExamples:\n  gong meetings update 7782342274025937895 --start-time 2026-07-11T10:00:00Z \\\n    --end-time 2026-07-11T11:00:00Z --organizer-email host@acme.com \\\n    --invitees '[{"email":"jon.snow@acme.com"}]'\n  gong meetings update 7782342274025937895 --body-file meeting.json`,
    )
    .action(async function (this: Command, id: string) {
      const body = await buildBody(update, ctx, MEETING_BODY_MAP);
      validateMeetingBody('gong meetings update', body);
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'PUT', path: `/v2/meetings/${encodeURIComponent(id)}`, body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong meetings delete <id> — DELETE /v2/meetings/{meetingId} ---------------------
  const DELETE_MAP: BodyFlagMap = {
    organizerEmail: { path: 'organizerEmail' },
  };

  const del = meetings
    .command('delete')
    .description('delete a Gong meeting (DELETE /v2/meetings/{meetingId}; beta/limited release — 403 until enabled)')
    .argument('<id>', "Gong's meeting ID (up to 20 digits)")
    .option('--organizer-email <email>', 'email of the user who created the meeting; Gong matches the meeting against it (maps to organizerEmail)');
  addBodyOptions(del);
  del
    .addHelpText(
      'after',
      `\n${BETA_NOTE}\nThe API requires a JSON request body on this DELETE; 404 means no meeting matched the\nmeeting ID + organizer email. Destructive: prompts on a TTY, requires --yes otherwise.\nAPI docs: ${DOCS}#delete-/v2/meetings/-meetingId-\n\nExamples:\n  gong meetings delete 7782342274025937895 --organizer-email host@acme.com --yes\n  gong meetings delete 7782342274025937895 --body '{"organizerEmail":"host@acme.com"}' --yes`,
    )
    .action(async function (this: Command, id: string) {
      await confirmDestructive(this, ctx, { description: `Delete Gong meeting ${id}.` });
      const body = (await buildBody(del, ctx, DELETE_MAP)) ?? {};
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'DELETE', path: `/v2/meetings/${encodeURIComponent(id)}`, body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong meetings integration-status — POST /v2/meetings/integration/status ---------
  const STATUS_MAP: BodyFlagMap = {
    emails: { path: 'emails', transform: (v) => csv(String(v)) },
  };

  const status = meetings
    .command('integration-status')
    .description('validate per-user meeting integration readiness (POST /v2/meetings/integration/status; beta/limited release)')
    .option('--emails <emails>', 'comma-separated user emails to validate, max 100 (maps to emails)');
  addBodyOptions(status);
  status
    .addHelpText(
      'after',
      `\n${BETA_NOTE}\nUse before 'gong meetings create' to check each organizer (exists + valid); invalid users\ncarry userFacingError/fixUrl/helpUrl. Not paginated. API docs: ${DOCS}#post-/v2/meetings/integration/status\n\nExamples:\n  gong meetings integration-status --emails rep@acme.com,ae@acme.com\n  gong meetings integration-status --body '{"emails":["rep@acme.com"]}'`,
    )
    .action(async function (this: Command) {
      const body = (await buildBody(status, ctx, STATUS_MAP)) ?? {};
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/meetings/integration/status', body },
        cursorIn: 'body',
        recordsKey: 'users',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['email', 'exists', 'valid', 'userFacingError'],
        },
      });
    });
};
