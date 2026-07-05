/**
 * `gong engagement` — legacy Engagement API: push content-viewed / content-shared /
 * custom-action events into Gong's activity timeline. Limited release, superseded by
 * `gong interactions create` (Digital Interactions).
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Engagement--Legacy---See--Digital-Interactions--
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { addBodyOptions, buildBody, hasPath } from '../body.js';
import type { BodyFlagMap } from '../body.js';
import { CliError, EXIT } from '../errors.js';
import { parseLossless } from '../json.js';
import { getPath } from '../output.js';
import { runSingle } from '../run.js';
import { expandDateTime } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

const LEGACY_NOTE =
  'Legacy, limited-release API (contact integration.requests@gong.io): superseded by\n' +
  "'gong interactions create'. Requires the api:engagement-data:write scope.\n" +
  'Duplicate events return HTTP 409 (already reported). The response integrationId is\n' +
  'an int64; output preserves it losslessly.';

/** Parse an inline JSON flag value (for structured fields like sharer or crmContext). */
function jsonFlag(flagName: string): (value: string) => unknown {
  return (value: string) => {
    try {
      return parseLossless(value);
    } catch {
      throw new CliError(`${flagName} must be valid JSON.`, { exitCode: EXIT.USAGE });
    }
  };
}

/**
 * Body fields the three legacy event schemas share. JSON-object flags (sharer) come
 * before their scalar leaves so leaf flags merge into the full structure.
 */
const SHARED_MAP: BodyFlagMap = {
  reportingSystem: { path: 'reportingSystem' },
  eventTimestamp: { path: 'eventTimestamp', transform: (v) => expandDateTime(String(v)) },
  eventId: { path: 'eventId' },
  contentId: { path: 'contentId' },
  contentUrl: { path: 'contentUrl' },
  contentTitle: { path: 'contentTitle' },
  actionName: { path: 'actionName' },
  shareId: { path: 'shareId' },
  sharer: { path: 'sharer' },
  sharerId: { path: 'sharer.id' },
  sharerEmail: { path: 'sharer.email' },
  sharerName: { path: 'sharer.name' },
  sharingMessageSubject: { path: 'sharingMessageSubject' },
  sharingMessageBody: { path: 'sharingMessageBody' },
  crmContext: { path: 'crmContext' },
  contentProperties: { path: 'contentProperties' },
  eventProperties: { path: 'eventProperties' },
  userAgent: { path: 'userAgent' },
  mobileAppId: { path: 'mobileAppId' },
  agentPlatform: { path: 'agentPlatform' },
  workspaceId: { path: 'workspaceId' },
  trackingId: { path: 'trackingId' },
  nonCompanyParticipants: { path: 'nonCompanyParticipants' },
  moreInfoUrl: { path: 'moreInfoUrl' },
};

/** Options shared by all three legacy engagement events. */
function addSharedEventOptions(cmd: Command, options: { contentRequired: boolean }): Command {
  const req = options.contentRequired ? '; required' : '';
  return cmd
    .option('--reporting-system <id>', 'unique identifier of the reporting system, identical across its events (maps to reportingSystem; required)')
    .option('--event-timestamp <datetime>', 'when the event happened, ISO-8601 or YYYY-MM-DD (maps to eventTimestamp; required)')
    .option('--event-id <id>', 'original event ID in the reporting system, used for dedup (maps to eventId)')
    .option('--content-id <id>', `content ID in the reporting system (maps to contentId${req})`)
    .option('--content-url <url>', `content URL accessed by the viewer (maps to contentUrl${req})`)
    .option('--content-title <title>', `human-readable content title (maps to contentTitle${req})`)
    .option('--share-id <id>', 'ID of the share action, when there can be more than one share per content (maps to shareId)')
    .option('--sharer <json>', 'the Gong user who shared the content, as JSON; sharer-* flags merge into it (maps to sharer)', jsonFlag('--sharer'))
    .option('--sharer-id <id>', 'the Gong user ID (maps to sharer.id)')
    .option('--sharer-email <email>', 'maps to sharer.email')
    .option('--sharer-name <name>', 'maps to sharer.name')
    .option('--sharing-message-subject <subject>', 'subject of the share email/message (maps to sharingMessageSubject)')
    .option('--sharing-message-body <body>', 'share message body; HTML is cleaned on display (maps to sharingMessageBody)')
    .option('--crm-context <json>', 'JSON array of {system,objects} external-system references (maps to crmContext)', jsonFlag('--crm-context'))
    .option('--content-properties <json>', 'JSON array of {name,value,dataType} content properties (maps to contentProperties)', jsonFlag('--content-properties'))
    .option('--event-properties <json>', 'JSON array of {name,value,dataType} event properties (maps to eventProperties)', jsonFlag('--event-properties'))
    .option('--user-agent <ua>', 'User-Agent header value for browser-based interaction (maps to userAgent)')
    .option('--mobile-app-id <id>', 'bundle identifier / package name for mobile-app interaction (maps to mobileAppId)')
    .option('--agent-platform <platform>', 'Windows|Linux|MacOS|iOS|Android (maps to agentPlatform)')
    .option('--workspace-id <id>', 'workspace to place the event in; default placement otherwise (maps to workspaceId)')
    .option('--tracking-id <id>', 'ID used for tracking the person who did the event (maps to trackingId)')
    .option('--non-company-participants <json>', 'JSON array of {email,name,title,context} people (maps to nonCompanyParticipants)', jsonFlag('--non-company-participants'))
    .option('--more-info-url <url>', 'maps to moreInfoUrl');
}

const REQUIRED_BASE_PATHS = ['reportingSystem', 'eventTimestamp'];
const REQUIRED_CONTENT_PATHS = [...REQUIRED_BASE_PATHS, 'contentId', 'contentUrl', 'contentTitle'];

function requireBodyPaths(commandName: string, body: unknown, requiredPaths: string[]): void {
  const missing = requiredPaths.filter((path) => !hasPath(body, path));
  if (body === undefined || missing.length > 0) {
    throw new CliError(
      `${commandName} is missing required fields: ${missing.join(', ') || requiredPaths.join(', ')}.`,
      {
        exitCode: EXIT.USAGE,
        hint: 'Provide them as flags (see --help) or in --body/--body-file.',
      },
    );
  }
}

export const registerEngagement: GroupRegistrar = (program, ctx) => {
  const engagement = program
    .command('engagement')
    .description(
      "report legacy engagement events (limited release; superseded by 'gong interactions create')",
    );

  // ---- gong engagement content-viewed — PUT /v2/customer-engagement/content/viewed -----
  const VIEWED_MAP: BodyFlagMap = {
    ...SHARED_MAP,
    viewActionTitle: { path: 'viewActionTitle' },
    viewInfoUrl: { path: 'viewInfoUrl' },
    viewer: { path: 'viewer' },
    viewerEmail: { path: 'viewer.email' },
    viewerName: { path: 'viewer.name' },
    viewerTitle: { path: 'viewer.title' },
    viewerContext: { path: 'viewer.context' },
  };

  const viewed = engagement
    .command('content-viewed')
    .description('report that an external participant viewed content (PUT /v2/customer-engagement/content/viewed)')
    .option('--view-action-title <title>', 'action name like "Document Viewed" (maps to viewActionTitle)')
    .option('--view-info-url <url>', 'link to a page with additional event details (maps to viewInfoUrl)')
    .option('--viewer <json>', 'the external person who viewed the content, as JSON; viewer-* flags merge into it (maps to viewer)', jsonFlag('--viewer'))
    .option('--viewer-email <email>', 'maps to viewer.email')
    .option('--viewer-name <name>', 'maps to viewer.name')
    .option('--viewer-title <title>', 'maps to viewer.title')
    .option('--viewer-context <json>', 'JSON array of {system,objects} CRM links for the viewer (maps to viewer.context)', jsonFlag('--viewer-context'))
    .option('--action-name <name>', 'maps to actionName (viewActionTitle is the documented field for this event)');
  addSharedEventOptions(viewed, { contentRequired: true });
  addBodyOptions(viewed);
  viewed
    .addHelpText(
      'after',
      `\n${LEGACY_NOTE}\nSend either --viewer or --tracking-id (anonymous), never both.\nAPI docs: ${DOCS}#put-/v2/customer-engagement/content/viewed\n\nExamples:\n  gong engagement content-viewed --reporting-system abc123 --event-timestamp 2026-07-01T10:00:00Z \\\n    --content-id doc_1 --content-url https://example.com/doc_1 --content-title 'Features & Spec V.1' \\\n    --viewer-email prospect@acme.com\n  gong engagement content-viewed --body '{"reportingSystem":"abc123","eventTimestamp":"2026-07-01T10:00:00Z","contentId":"doc_1","contentUrl":"https://example.com/doc_1","contentTitle":"Features & Spec V.1","trackingId":"anon-7"}'`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(viewed, ctx, VIEWED_MAP);
      requireBodyPaths('gong engagement content-viewed', body, REQUIRED_CONTENT_PATHS);
      const viewer = getPath(body, 'viewer');
      const trackingId = getPath(body, 'trackingId');
      if (viewer !== null && viewer !== undefined && trackingId !== null && trackingId !== undefined) {
        throw new CliError(
          'gong engagement content-viewed takes either --viewer or --tracking-id, not both.',
          {
            exitCode: EXIT.USAGE,
            hint: 'The API requires trackingId to be null when a viewer is sent (and vice versa).',
          },
        );
      }
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'PUT', path: '/v2/customer-engagement/content/viewed', body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong engagement content-shared — PUT /v2/customer-engagement/content/shared -----
  const SHARED_EVENT_MAP: BodyFlagMap = {
    ...SHARED_MAP,
    shareInfoUrl: { path: 'shareInfoUrl' },
    recipients: { path: 'recipients' },
  };

  const shared = engagement
    .command('content-shared')
    .description('report that a Gong user shared content with external participants (PUT /v2/customer-engagement/content/shared)')
    .option('--share-info-url <url>', 'link to a page with additional event details (maps to shareInfoUrl)')
    .option('--recipients <json>', 'JSON array of {name,email} recipients; email is required per recipient (maps to recipients)', jsonFlag('--recipients'))
    .option('--action-name <name>', 'action name like "Document Sent" or "Presentation Shared" (maps to actionName)');
  addSharedEventOptions(shared, { contentRequired: true });
  addBodyOptions(shared);
  shared
    .addHelpText(
      'after',
      `\n${LEGACY_NOTE}\nAPI docs: ${DOCS}#put-/v2/customer-engagement/content/shared\n\nExamples:\n  gong engagement content-shared --reporting-system abc123 --event-timestamp 2026-07-01T10:00:00Z \\\n    --content-id doc_1 --content-url https://example.com/doc_1 --content-title 'Features & Spec V.1' \\\n    --sharer-email rep@example.com --recipients '[{"name":"Jane","email":"jane@acme.com"}]'\n  gong engagement content-shared --body-file shared-event.json`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(shared, ctx, SHARED_EVENT_MAP);
      requireBodyPaths('gong engagement content-shared', body, REQUIRED_CONTENT_PATHS);
      const recipients = getPath(body, 'recipients');
      if (Array.isArray(recipients)) {
        const missingEmail = recipients.some((item) => {
          if (item === null || typeof item !== 'object' || Array.isArray(item)) return true;
          const email = (item as Record<string, unknown>).email;
          return typeof email !== 'string' || email.length === 0;
        });
        if (missingEmail) {
          throw new CliError('Every recipient must include an email address.', {
            exitCode: EXIT.USAGE,
            hint: 'The API requires an email per recipients[] entry.',
          });
        }
      }
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'PUT', path: '/v2/customer-engagement/content/shared', body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong engagement custom-action — PUT /v2/customer-engagement/action --------------
  const ACTION_MAP: BodyFlagMap = {
    ...SHARED_MAP,
    actionName: { path: 'actionName' },
    eventInfoUrl: { path: 'eventInfoUrl' },
    actor: { path: 'actor' },
    actorEmail: { path: 'actor.email' },
    actorName: { path: 'actor.name' },
    actorTitle: { path: 'actor.title' },
    actorContext: { path: 'actor.context' },
  };

  const action = engagement
    .command('custom-action')
    .description('report a custom engagement action by an external participant (PUT /v2/customer-engagement/action)')
    .option('--action-name <name>', 'action name like "Document Viewed" or "Presentation Opened" (maps to actionName)')
    .option('--event-info-url <url>', 'link to a page with additional event details (maps to eventInfoUrl)')
    .option('--actor <json>', 'the person who performed the action, as JSON; actor-* flags merge into it (maps to actor)', jsonFlag('--actor'))
    .option('--actor-email <email>', 'maps to actor.email')
    .option('--actor-name <name>', 'maps to actor.name')
    .option('--actor-title <title>', 'maps to actor.title')
    .option('--actor-context <json>', 'JSON array of {system,objects} CRM links for the actor (maps to actor.context)', jsonFlag('--actor-context'));
  addSharedEventOptions(action, { contentRequired: false });
  addBodyOptions(action);
  action
    .addHelpText(
      'after',
      `\n${LEGACY_NOTE}\nAPI docs: ${DOCS}#put-/v2/customer-engagement/action\n\nExamples:\n  gong engagement custom-action --reporting-system abc123 --event-timestamp 2026-07-01T10:00:00Z \\\n    --action-name 'Contract Signed' --content-id doc_1 --actor-email prospect@acme.com\n  gong engagement custom-action --body '{"reportingSystem":"abc123","eventTimestamp":"2026-07-01T10:00:00Z","actionName":"Contract Signed"}'`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(action, ctx, ACTION_MAP);
      requireBodyPaths('gong engagement custom-action', body, REQUIRED_BASE_PATHS);
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'PUT', path: '/v2/customer-engagement/action', body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });
};
