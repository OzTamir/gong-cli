/**
 * `gong calls` — Gong calls: list, get, search (extensive), transcripts, create,
 * upload media. API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Calls
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
import { csv, expandDateTime, jsonFlag } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

function addTimeRangeOptions(cmd: Command, target: string): Command {
  return cmd
    .option('--from <datetime>', `start of range, inclusive (maps to ${target}; ISO-8601 or YYYY-MM-DD)`)
    .option('--to <datetime>', `end of range, exclusive (maps to the matching to...; ISO-8601 or YYYY-MM-DD)`)
    .option('--from-date-time <datetime>', `canonical name for --from (maps to ${target})`)
    .option('--to-date-time <datetime>', `canonical name for --to`);
}

export const registerCalls: GroupRegistrar = (program, ctx) => {
  const calls = program
    .command('calls')
    .description('work with Gong calls (list, get, search, transcripts, create, upload media)');

  // ---- gong calls list — GET /v2/calls -------------------------------------------------
  const list = calls
    .command('list')
    .description('list calls in a date range (GET /v2/calls)')
    .option('--workspace-id <id>', 'only calls in this workspace (maps to workspaceId)');
  addTimeRangeOptions(list, 'fromDateTime');
  addPaginationOptions(list);
  list
    .addHelpText(
      'after',
      `\nThe API requires both --from and --to. API docs: ${DOCS}#get-/v2/calls\n\nExamples:\n  gong calls list --from 2026-06-01 --to 2026-07-01\n  gong calls list --from 2026-06-01T00:00:00Z --to 2026-06-08T00:00:00Z --all -o jsonl`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{
        from?: string;
        to?: string;
        fromDateTime?: string;
        toDateTime?: string;
        workspaceId?: string;
      }>();
      const fromDateTime = opts.fromDateTime ?? opts.from;
      const toDateTime = opts.toDateTime ?? opts.to;
      if (!fromDateTime || !toDateTime) {
        throw new CliError('gong calls list requires both --from and --to.', {
          exitCode: EXIT.USAGE,
        });
      }
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/calls',
          query: {
            fromDateTime: expandDateTime(fromDateTime),
            toDateTime: expandDateTime(toDateTime),
            workspaceId: opts.workspaceId,
          },
        },
        cursorIn: 'query',
        recordsKey: 'calls',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['id', 'started', 'duration', 'title', 'primaryUserId'],
        },
      });
    });

  // ---- gong calls get <id> — GET /v2/calls/{id} ----------------------------------------
  calls
    .command('get')
    .description('retrieve one call by ID (GET /v2/calls/{id})')
    .argument('<id>', "Gong's call ID")
    .addHelpText('after', `\nAPI docs: ${DOCS}#get-/v2/calls/-id-`)
    .action(async function (this: Command, id: string) {
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'GET', path: `/v2/calls/${encodeURIComponent(id)}` },
        flags: outputFlags(this),
        unwrapKey: 'call',
      });
    });

  // ---- gong calls search — POST /v2/calls/extensive ------------------------------------
  const SEARCH_MAP: BodyFlagMap = {
    from: { path: 'filter.fromDateTime', transform: (v) => expandDateTime(String(v)) },
    to: { path: 'filter.toDateTime', transform: (v) => expandDateTime(String(v)) },
    fromDateTime: { path: 'filter.fromDateTime', transform: (v) => expandDateTime(String(v)) },
    toDateTime: { path: 'filter.toDateTime', transform: (v) => expandDateTime(String(v)) },
    workspaceId: { path: 'filter.workspaceId' },
    callIds: { path: 'filter.callIds', transform: (v) => csv(String(v)) },
    primaryUserIds: { path: 'filter.primaryUserIds', transform: (v) => csv(String(v)) },
    context: { path: 'contentSelector.context' },
    contextTiming: { path: 'contentSelector.contextTiming', transform: (v) => csv(String(v)) },
    parties: { path: 'contentSelector.exposedFields.parties' },
    structure: { path: 'contentSelector.exposedFields.content.structure' },
    topics: { path: 'contentSelector.exposedFields.content.topics' },
    trackers: { path: 'contentSelector.exposedFields.content.trackers' },
    trackerOccurrences: { path: 'contentSelector.exposedFields.content.trackerOccurrences' },
    pointsOfInterest: { path: 'contentSelector.exposedFields.content.pointsOfInterest' },
    brief: { path: 'contentSelector.exposedFields.content.brief' },
    outline: { path: 'contentSelector.exposedFields.content.outline' },
    highlights: { path: 'contentSelector.exposedFields.content.highlights' },
    callOutcome: { path: 'contentSelector.exposedFields.content.callOutcome' },
    keyPoints: { path: 'contentSelector.exposedFields.content.keyPoints' },
    speakers: { path: 'contentSelector.exposedFields.interaction.speakers' },
    video: { path: 'contentSelector.exposedFields.interaction.video' },
    personInteractionStats: {
      path: 'contentSelector.exposedFields.interaction.personInteractionStats',
    },
    questions: { path: 'contentSelector.exposedFields.interaction.questions' },
    publicComments: { path: 'contentSelector.exposedFields.collaboration.publicComments' },
    media: { path: 'contentSelector.exposedFields.media' },
  };

  const search = calls
    .command('search')
    .description('detailed call data by filters (POST /v2/calls/extensive)')
    .option('--workspace-id <id>', 'maps to filter.workspaceId')
    .option('--call-ids <ids>', 'comma-separated call IDs (maps to filter.callIds)')
    .option('--primary-user-ids <ids>', 'comma-separated host user IDs (maps to filter.primaryUserIds)')
    .option('--context <mode>', 'None|Basic|Extended (maps to contentSelector.context)')
    .option('--context-timing <values>', 'Now,TimeOfCall; only with --context Extended (maps to contentSelector.contextTiming)')
    .option('--parties', 'include call parties (maps to contentSelector.exposedFields.parties)')
    .option('--structure', 'include call agenda (maps to ...content.structure)')
    .option('--topics', 'include topic durations (maps to ...content.topics)')
    .option('--trackers', 'include tracker data (maps to ...content.trackers)')
    .option('--tracker-occurrences', 'include tracker occurrence timing; requires --trackers (maps to ...content.trackerOccurrences)')
    .option('--points-of-interest', 'deprecated by Gong; no response field (maps to ...content.pointsOfInterest)')
    .option('--brief', 'include the spotlight call brief (maps to ...content.brief)')
    .option('--outline', 'include the call outline (maps to ...content.outline)')
    .option('--highlights', 'include call highlights (maps to ...content.highlights)')
    .option('--call-outcome', 'include the AI call outcome (maps to ...content.callOutcome)')
    .option('--key-points', 'include call key points (maps to ...content.keyPoints)')
    .option('--speakers', 'include per-speaker talk time (maps to ...interaction.speakers)')
    .option('--video', 'include video statistics (maps to ...interaction.video)')
    .option('--person-interaction-stats', 'include host interaction stats (maps to ...interaction.personInteractionStats)')
    .option('--questions', 'include question counts (maps to ...interaction.questions)')
    .option('--public-comments', 'include public comments (maps to ...collaboration.publicComments)')
    .option('--media', 'include audio/video URLs, valid 8h; needs api:calls:read:media-url scope (maps to ...exposedFields.media)');
  addTimeRangeOptions(search, 'filter.fromDateTime');
  addBodyOptions(search);
  addPaginationOptions(search);
  search
    .addHelpText(
      'after',
      `\nAPI docs: ${DOCS}#post-/v2/calls/extensive\n\nExamples:\n  gong calls search --from 2026-06-01 --to 2026-07-01 --parties --trackers\n  gong calls search --body '{"filter":{"callIds":["123"]},"contentSelector":{"exposedFields":{"parties":true}}}'`,
    )
    .action(async function (this: Command) {
      const body = (await buildBody(search, ctx, SEARCH_MAP, { defaults: { filter: {} } })) as
        | Record<string, unknown>
        | undefined;
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/calls/extensive', body: body ?? { filter: {} } },
        cursorIn: 'body',
        recordsKey: 'calls',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['metaData.id', 'metaData.started', 'metaData.duration', 'metaData.title'],
        },
      });
    });

  // ---- gong calls transcript — POST /v2/calls/transcript -------------------------------
  const TRANSCRIPT_MAP: BodyFlagMap = {
    from: { path: 'filter.fromDateTime', transform: (v) => expandDateTime(String(v)) },
    to: { path: 'filter.toDateTime', transform: (v) => expandDateTime(String(v)) },
    fromDateTime: { path: 'filter.fromDateTime', transform: (v) => expandDateTime(String(v)) },
    toDateTime: { path: 'filter.toDateTime', transform: (v) => expandDateTime(String(v)) },
    workspaceId: { path: 'filter.workspaceId' },
    callIds: { path: 'filter.callIds', transform: (v) => csv(String(v)) },
  };

  const transcript = calls
    .command('transcript')
    .description('retrieve call transcripts (POST /v2/calls/transcript)')
    .option('--workspace-id <id>', 'maps to filter.workspaceId')
    .option('--call-ids <ids>', 'comma-separated call IDs (maps to filter.callIds)');
  addTimeRangeOptions(transcript, 'filter.fromDateTime');
  addBodyOptions(transcript);
  addPaginationOptions(transcript);
  transcript
    .addHelpText(
      'after',
      `\nSpeaker names are not included: resolve transcript speakerId values against\nparties[].speakerId from 'gong calls search --parties'. API docs: ${DOCS}#post-/v2/calls/transcript\n\nExamples:\n  gong calls transcript --call-ids 7782342274025937895\n  gong calls transcript --from 2026-06-01 --to 2026-07-01 --all -o jsonl`,
    )
    .action(async function (this: Command) {
      const body = (await buildBody(transcript, ctx, TRANSCRIPT_MAP, {
        defaults: { filter: {} },
      })) as Record<string, unknown> | undefined;
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/calls/transcript', body: body ?? { filter: {} } },
        cursorIn: 'body',
        recordsKey: 'callTranscripts',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['callId'],
        },
      });
    });

  // ---- gong calls create — POST /v2/calls ----------------------------------------------
  const CREATE_MAP: BodyFlagMap = {
    clientUniqueId: { path: 'clientUniqueId' },
    title: { path: 'title' },
    purpose: { path: 'purpose' },
    scheduledStart: { path: 'scheduledStart', transform: (v) => expandDateTime(String(v)) },
    scheduledEnd: { path: 'scheduledEnd', transform: (v) => expandDateTime(String(v)) },
    actualStart: { path: 'actualStart', transform: (v) => expandDateTime(String(v)) },
    duration: { path: 'duration', transform: (v) => Number(v) },
    parties: { path: 'parties' },
    direction: { path: 'direction' },
    disposition: { path: 'disposition' },
    context: { path: 'context' },
    customData: { path: 'customData' },
    speakersTimeline: { path: 'speakersTimeline' },
    meetingUrl: { path: 'meetingUrl' },
    callProviderCode: { path: 'callProviderCode' },
    downloadMediaUrl: { path: 'downloadMediaUrl' },
    workspaceId: { path: 'workspaceId' },
    languageCode: { path: 'languageCode' },
    taskId: { path: 'flowContext.taskId' },
    primaryUser: { path: 'primaryUser' },
  };

  const REQUIRED_CREATE_PATHS = [
    'clientUniqueId',
    'actualStart',
    'parties',
    'direction',
    'primaryUser',
  ];

  const create = calls
    .command('create')
    .description('add a new call (POST /v2/calls); upload media afterwards or pass --download-media-url')
    .option('--client-unique-id <id>', 'dedup key from your recording system (maps to clientUniqueId; required)')
    .option('--actual-start <datetime>', 'when the call started, ISO-8601 (maps to actualStart; required)')
    .option('--direction <direction>', 'Inbound|Outbound|Conference|Unknown (maps to direction; required)')
    .option('--primary-user <userId>', 'Gong user ID of the host (maps to primaryUser; required)')
    .option('--parties <json>', 'JSON array of participants; must include the primary user (maps to parties; required)', jsonFlag('--parties'))
    .option('--title <title>', 'maps to title')
    .option('--purpose <purpose>', 'maps to purpose')
    .option('--scheduled-start <datetime>', 'maps to scheduledStart')
    .option('--scheduled-end <datetime>', 'maps to scheduledEnd')
    .option('--duration <seconds>', 'maps to duration')
    .option('--disposition <text>', 'maps to disposition')
    .option('--context <json>', 'JSON array of CRM/telephony references (maps to context)', jsonFlag('--context'))
    .option('--custom-data <text>', 'maps to customData')
    .option('--speakers-timeline <json>', 'who-spoke-when segments; mutually exclusive with parties[].mediaChannelId (maps to speakersTimeline)', jsonFlag('--speakers-timeline'))
    .option('--meeting-url <url>', 'maps to meetingUrl')
    .option('--call-provider-code <code>', 'provider code predefined by Gong (maps to callProviderCode)')
    .option('--download-media-url <url>', 'media URL for Gong to download (≤1.5GB); skip upload-media if set (maps to downloadMediaUrl)')
    .option('--workspace-id <id>', 'maps to workspaceId')
    .option('--language-code <code>', 'transcription language, e.g. en-US; omit to auto-detect (maps to languageCode)')
    .option('--task-id <id>', 'Engage task to associate (maps to flowContext.taskId)');
  addBodyOptions(create);
  create
    .addHelpText(
      'after',
      `\nAPI docs: ${DOCS}#post-/v2/calls\n\nExamples:\n  gong calls create --client-unique-id rec-42 --actual-start 2026-06-15T10:00:00Z \\\n    --direction Outbound --primary-user 234599484848423 \\\n    --parties '[{"emailAddress":"rep@example.com","userId":"234599484848423"}]'\n  gong calls create --body-file call.json`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(create, ctx, CREATE_MAP);
      const missing = REQUIRED_CREATE_PATHS.filter((path) => !hasPath(body, path));
      if (body === undefined || missing.length > 0) {
        throw new CliError(
          `gong calls create is missing required fields: ${missing.join(', ') || REQUIRED_CREATE_PATHS.join(', ')}.`,
          {
            exitCode: EXIT.USAGE,
            hint: 'Provide them as flags (see --help) or in --body/--body-file.',
          },
        );
      }
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/calls', body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong calls upload-media <id> — PUT /v2/calls/{id}/media -------------------------
  calls
    .command('upload-media')
    .description('upload the media file for a call created without downloadMediaUrl (PUT /v2/calls/{id}/media)')
    .argument('<id>', "callId returned by 'gong calls create'")
    .requiredOption('--media <path>', 'media file: WAV, MP3, MP4, MKV or FLAC, up to 1.5GB (multipart field mediaFile)')
    .option('--content-type <type>', 'MIME type for the file part (default: inferred by Gong)')
    .addHelpText(
      'after',
      `\nAPI docs: ${DOCS}#put-/v2/calls/-id-/media\n\nExample:\n  gong calls upload-media 7782342274025937895 --media ./recording.mp3`,
    )
    .action(async function (this: Command, id: string) {
      const opts = this.opts<{ media: string; contentType?: string }>();
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'PUT',
          path: `/v2/calls/${encodeURIComponent(id)}/media`,
          multipart: { field: 'mediaFile', path: opts.media, contentType: opts.contentType },
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });
};
