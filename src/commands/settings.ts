/**
 * `gong settings` — company/workspace settings: scorecards, keyword trackers,
 * AI briefs. API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Settings
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { resolveListFormat } from '../output.js';
import { runPaginatedList } from '../pagination.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

export const registerSettings: GroupRegistrar = (program, ctx) => {
  const settings = program
    .command('settings')
    .description('workspace settings: scorecards, keyword trackers, AI briefs');

  // ---- gong settings scorecards — GET /v2/settings/scorecards --------------------------
  settings
    .command('scorecards')
    .description('list all scorecards, company-wide (GET /v2/settings/scorecards)')
    .addHelpText(
      'after',
      `\nScorecard, workspace, question and updater IDs are int64 numbers that can\nexceed JavaScript's safe-integer range; gong-cli preserves them losslessly.\nThis endpoint takes no filters and does not paginate.\nAPI docs: ${DOCS}#get-/v2/settings/scorecards\n\nExamples:\n  gong settings scorecards\n  gong settings scorecards -o jsonl --fields scorecardId,scorecardName,enabled`,
    )
    .action(async function (this: Command) {
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'GET', path: '/v2/settings/scorecards' },
        cursorIn: 'query',
        recordsKey: 'scorecards',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: [
            'scorecardId',
            'scorecardName',
            'workspaceId',
            'enabled',
            'reviewMethod',
            'updated',
          ],
        },
      });
    });

  // ---- gong settings trackers — GET /v2/settings/trackers ------------------------------
  settings
    .command('trackers')
    .description('list keyword tracker definitions (GET /v2/settings/trackers)')
    .option(
      '--workspace-id <id>',
      'only trackers in this workspace; omit for all workspaces (maps to workspaceId)',
    )
    .addHelpText(
      'after',
      `\nEach tracker's filterQuery value is JSON-inside-a-string (Gong's search\nfilter DSL) — parse it separately if you need its contents. creatorUserId\nand updaterUserId are null for built-in trackers. This endpoint does not\npaginate. API docs: ${DOCS}#get-/v2/settings/trackers\n\nExamples:\n  gong settings trackers\n  gong settings trackers --workspace-id 623457276584334 -o jsonl`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ workspaceId?: string }>();
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/settings/trackers',
          query: { workspaceId: opts.workspaceId },
        },
        cursorIn: 'query',
        recordsKey: 'keywordTrackers',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['trackerId', 'trackerName', 'workspaceId', 'affiliation', 'created'],
        },
      });
    });

  // ---- gong settings briefs — GET /v2/settings/briefs (BETA) ---------------------------
  settings
    .command('briefs')
    .description('list AI brief settings — BETA (GET /v2/settings/briefs)')
    .option(
      '--workspace-id <id>',
      'only briefs in this workspace; omit for all workspaces (maps to workspaceId)',
    )
    .addHelpText(
      'after',
      `\nBETA: Gong marks this endpoint as subject to change. Requires the\napi:ai-briefer:read authorization scope. This endpoint does not paginate.\nAPI docs: ${DOCS}#get-/v2/settings/briefs\n\nExamples:\n  gong settings briefs\n  gong settings briefs --workspace-id 623457276584334 -o jsonl`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ workspaceId?: string }>();
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/settings/briefs',
          query: { workspaceId: opts.workspaceId },
        },
        cursorIn: 'query',
        recordsKey: 'briefs',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['briefId', 'briefName', 'workspaceId', 'status', 'creator', 'updated'],
        },
      });
    });
};
