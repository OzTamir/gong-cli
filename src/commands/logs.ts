/**
 * `gong logs` — Gong auditing logs: who accessed, played, and externally shared what.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Auditing
 */
import type { Command } from 'commander';
import { Option } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { CliError, EXIT } from '../errors.js';
import { resolveListFormat } from '../output.js';
import { addPaginationOptions, runPaginatedList } from '../pagination.js';
import type { PaginationFlags } from '../pagination.js';
import { expandDateTime } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

const LOG_TYPES = [
  'AccessLog',
  'UserActivityLog',
  'UserCallPlay',
  'ExternallySharedCallAccess',
  'ExternallySharedCallPlay',
];

export const registerLogs: GroupRegistrar = (program, ctx) => {
  const logs = program.command('logs').description('auditing logs by type and time range');

  // ---- gong logs list — GET /v2/logs ----------------------------------------------------
  const list = logs
    .command('list')
    .description('list log entries of one type in a time range (GET /v2/logs)')
    .addOption(
      new Option('--log-type <type>', 'type of logs requested (maps to logType; required)')
        .choices(LOG_TYPES)
        .makeOptionMandatory(true),
    )
    .option(
      '--from <datetime>',
      'start of range, inclusive (maps to fromDateTime; ISO-8601 or YYYY-MM-DD; required)',
    )
    .option(
      '--to <datetime>',
      'end of range; omit to read up to the latest recorded log (maps to toDateTime; ISO-8601 or YYYY-MM-DD)',
    )
    .option('--from-date-time <datetime>', 'canonical name for --from (maps to fromDateTime)')
    .option('--to-date-time <datetime>', 'canonical name for --to (maps to toDateTime)');
  addPaginationOptions(list);
  list
    .addHelpText(
      'after',
      `\nThe API requires --log-type and --from. A 404 from Gong means "no logs found for\nthe specified period" and yields an empty result with exit 0. Each entry's\nlogRecord fields vary by log type (treated as an opaque map). Page size is\nserver-controlled (~100). Requires the api:logs:read scope.\nAPI docs: ${DOCS}#get-/v2/logs\n\nExamples:\n  gong logs list --log-type AccessLog --from 2026-06-01 --to 2026-07-01\n  gong logs list --log-type UserActivityLog --from 2026-06-01 --all -o jsonl`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{
        logType: string;
        from?: string;
        to?: string;
        fromDateTime?: string;
        toDateTime?: string;
      }>();
      const fromDateTime = opts.fromDateTime ?? opts.from;
      const toDateTime = opts.toDateTime ?? opts.to;
      if (!fromDateTime) {
        throw new CliError('gong logs list requires --from (or --from-date-time).', {
          exitCode: EXIT.USAGE,
        });
      }
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/logs',
          query: {
            logType: opts.logType,
            fromDateTime: expandDateTime(fromDateTime),
            toDateTime: toDateTime === undefined ? undefined : expandDateTime(toDateTime),
          },
        },
        cursorIn: 'query',
        recordsKey: 'logEntries',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['eventTime', 'userId', 'userEmailAddress', 'userFullName'],
        },
      });
    });
};
