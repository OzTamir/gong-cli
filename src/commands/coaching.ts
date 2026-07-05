/**
 * `gong coaching` — coaching metrics of a manager and their direct reports.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Coaching
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { CliError, EXIT } from '../errors.js';
import { resolveListFormat } from '../output.js';
import { runPaginatedList } from '../pagination.js';
import { expandDateTime } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

export const registerCoaching: GroupRegistrar = (program, ctx) => {
  const coaching = program
    .command('coaching')
    .description('coaching metrics for managers and their direct reports');

  // ---- gong coaching list — GET /v2/coaching --------------------------------------------
  // Note: this operation's query params are literally kebab-case in the API
  // (workspace-id, manager-id) and integers there — the CLI passes them through as given.
  coaching
    .command('list')
    .description('list all coaching metrics of a manager (GET /v2/coaching)')
    .option(
      '--workspace-id <id>',
      "workspace to fetch coaching metrics for (maps to query param 'workspace-id'; required)",
    )
    .option(
      '--manager-id <id>',
      "manager whose coaching metrics are listed (maps to query param 'manager-id'; required)",
    )
    .option(
      '--from <datetime>',
      "start of the association time window (maps to query param 'from'; ISO-8601 or YYYY-MM-DD; required)",
    )
    .option(
      '--to <datetime>',
      "end of the association time window (maps to query param 'to'; ISO-8601 or YYYY-MM-DD; required)",
    )
    .addHelpText(
      'after',
      `\nThe API requires all of --workspace-id, --manager-id, --from and --to.\nAPI docs: ${DOCS}#get-/v2/coaching\n\nExamples:\n  gong coaching list --workspace-id 623457723877 --manager-id 234599484848423 --from 2026-06-01 --to 2026-07-01\n  gong coaching list --workspace-id 623457723877 --manager-id 234599484848423 --from 2026-06-01 --to 2026-07-01 -o jsonl`,
    )
    .action(async function (this: Command) {
      const { workspaceId, managerId, from, to } = this.opts<{
        workspaceId?: string;
        managerId?: string;
        from?: string;
        to?: string;
      }>();
      if (
        workspaceId === undefined ||
        managerId === undefined ||
        from === undefined ||
        to === undefined
      ) {
        const missing = [
          workspaceId === undefined ? '--workspace-id' : undefined,
          managerId === undefined ? '--manager-id' : undefined,
          from === undefined ? '--from' : undefined,
          to === undefined ? '--to' : undefined,
        ].filter((flag): flag is string => flag !== undefined);
        throw new CliError(`gong coaching list requires ${missing.join(', ')}.`, {
          exitCode: EXIT.USAGE,
        });
      }
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/coaching',
          query: {
            'workspace-id': workspaceId,
            'manager-id': managerId,
            from: expandDateTime(from),
            to: expandDateTime(to),
          },
        },
        cursorIn: 'query',
        recordsKey: 'coachingData',
        flags: {}, // the API returns everything in one response — no pagination
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: [
            'manager.id',
            'manager.emailAddress',
            'manager.firstName',
            'manager.lastName',
            'manager.title',
          ],
        },
      });
    });
};
