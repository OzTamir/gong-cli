/**
 * `gong stats` — user activity, answered-scorecard, and interaction statistics.
 * All five operations are JSON POSTs with body-cursor pagination and no query params.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Stats
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
import { csv, expandDateTime } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

/**
 * Shared activity filter: aggregate, by-period, day-by-day and interaction take the same
 * body shape. filter.fromDate/toDate are date-only (YYYY-MM-DD, sent as-is — never
 * expanded); filter.created*DateTime are date-times (bare dates expand to the UTC day
 * boundary). Canonical flags typed later in the map win over the --from/--to aliases.
 */
const ACTIVITY_FILTER_MAP: BodyFlagMap = {
  from: { path: 'filter.fromDate' },
  to: { path: 'filter.toDate' },
  fromDate: { path: 'filter.fromDate' },
  toDate: { path: 'filter.toDate' },
  createdFromDateTime: {
    path: 'filter.createdFromDateTime',
    transform: (v) => expandDateTime(String(v)),
  },
  createdToDateTime: {
    path: 'filter.createdToDateTime',
    transform: (v) => expandDateTime(String(v)),
  },
  userIds: { path: 'filter.userIds', transform: (v) => csv(String(v)) },
};

const ACTIVITY_REQUIRED_PATHS = ['filter.fromDate', 'filter.toDate'];

function addActivityFilterOptions(cmd: Command): Command {
  return cmd
    .option('--from <date>', 'start date, inclusive, YYYY-MM-DD in the company time zone (maps to filter.fromDate; required)')
    .option('--to <date>', 'end date, exclusive, YYYY-MM-DD, must not exceed today (maps to filter.toDate; required)')
    .option('--from-date <date>', 'canonical name for --from (maps to filter.fromDate)')
    .option('--to-date <date>', 'canonical name for --to (maps to filter.toDate)')
    .option('--created-from-date-time <datetime>', 'ISO-8601 or YYYY-MM-DD (maps to filter.createdFromDateTime)')
    .option('--created-to-date-time <datetime>', 'ISO-8601 or YYYY-MM-DD (maps to filter.createdToDateTime)')
    .option('--user-ids <ids>', 'comma-separated Gong user IDs; omit for all applicable users (maps to filter.userIds)');
}

/**
 * Usage error before any request when required body fields are missing — they may come
 * from typed flags or from --body/--body-file, so validate the assembled body.
 */
function requireBodyPaths(
  commandPath: string,
  body: unknown,
  required: string[],
): Record<string, unknown> {
  const missing = required.filter((path) => !hasPath(body, path));
  if (body === undefined || missing.length > 0) {
    throw new CliError(
      `${commandPath} is missing required fields: ${missing.join(', ') || required.join(', ')}.`,
      {
        exitCode: EXIT.USAGE,
        hint: 'Provide them as flags (see --help) or in --body/--body-file.',
      },
    );
  }
  return body as Record<string, unknown>;
}

export const registerStats: GroupRegistrar = (program, ctx) => {
  const stats = program
    .command('stats')
    .description('user activity, answered-scorecard, and interaction statistics');

  const activity = stats
    .command('activity')
    .description('team member activity statistics (aggregate, by-period, day-by-day, scorecards)');

  // ---- gong stats activity aggregate — POST /v2/stats/activity/aggregate --------------
  const aggregate = activity
    .command('aggregate')
    .description('aggregated activity counters per user for a date range (POST /v2/stats/activity/aggregate)');
  addActivityFilterOptions(aggregate);
  addBodyOptions(aggregate);
  addPaginationOptions(aggregate);
  aggregate
    .addHelpText(
      'after',
      `\nThe API requires both --from and --to (YYYY-MM-DD, company time zone; --to is\nexclusive). Bearer scope: api:stats:user-actions. API docs: ${DOCS}#post-/v2/stats/activity/aggregate\n\nExamples:\n  gong stats activity aggregate --from 2026-06-01 --to 2026-07-01\n  gong stats activity aggregate --body '{"filter":{"fromDate":"2026-06-01","toDate":"2026-07-01","userIds":["234599484848423"]}}'`,
    )
    .action(async function (this: Command) {
      const body = requireBodyPaths(
        'gong stats activity aggregate',
        await buildBody(aggregate, ctx, ACTIVITY_FILTER_MAP),
        ACTIVITY_REQUIRED_PATHS,
      );
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/stats/activity/aggregate', body },
        cursorIn: 'body',
        recordsKey: 'usersAggregateActivityStats',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: [
            'userId',
            'userEmailAddress',
            'userAggregateActivityStats.callsAsHost',
            'userAggregateActivityStats.callsAttended',
            'userAggregateActivityStats.callsGaveFeedback',
            'userAggregateActivityStats.callsScorecardsFilled',
          ],
        },
      });
    });

  // ---- gong stats activity by-period — POST /v2/stats/activity/aggregate-by-period ----
  const BY_PERIOD_MAP: BodyFlagMap = {
    ...ACTIVITY_FILTER_MAP,
    aggregationPeriod: { path: 'aggregationPeriod' },
  };

  const byPeriod = activity
    .command('by-period')
    .description('activity counters per user grouped by calendar period (POST /v2/stats/activity/aggregate-by-period)')
    .option('--aggregation-period <period>', 'DAY|WEEK|MONTH|QUARTER|YEAR; weeks start Monday (maps to aggregationPeriod; required)');
  addActivityFilterOptions(byPeriod);
  addBodyOptions(byPeriod);
  addPaginationOptions(byPeriod);
  byPeriod
    .addHelpText(
      'after',
      `\nThe API requires --from, --to and --aggregation-period. Bearer scope:\napi:stats:user-actions. API docs: ${DOCS}#post-/v2/stats/activity/aggregate-by-period\n\nExamples:\n  gong stats activity by-period --from 2026-01-01 --to 2026-04-01 --aggregation-period WEEK\n  gong stats activity by-period --body '{"filter":{"fromDate":"2026-01-01","toDate":"2026-04-01"},"aggregationPeriod":"MONTH"}'`,
    )
    .action(async function (this: Command) {
      const body = requireBodyPaths(
        'gong stats activity by-period',
        await buildBody(byPeriod, ctx, BY_PERIOD_MAP),
        [...ACTIVITY_REQUIRED_PATHS, 'aggregationPeriod'],
      );
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/stats/activity/aggregate-by-period', body },
        cursorIn: 'body',
        recordsKey: 'usersAggregateActivity',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['userId', 'userEmailAddress'],
        },
      });
    });

  // ---- gong stats activity day-by-day — POST /v2/stats/activity/day-by-day ------------
  const dayByDay = activity
    .command('day-by-day')
    .description('daily per-user activity as call-ID lists (POST /v2/stats/activity/day-by-day)');
  addActivityFilterOptions(dayByDay);
  addBodyOptions(dayByDay);
  addPaginationOptions(dayByDay);
  dayByDay
    .addHelpText(
      'after',
      `\nThe API requires both --from and --to. Each activity field in the response is a\nlist of call IDs, not a counter. Bearer scope: api:stats:user-actions:detailed.\nAPI docs: ${DOCS}#post-/v2/stats/activity/day-by-day\n\nExamples:\n  gong stats activity day-by-day --from 2026-06-01 --to 2026-06-08 --user-ids 234599484848423\n  gong stats activity day-by-day --body '{"filter":{"fromDate":"2026-06-01","toDate":"2026-06-08"}}' --all -o jsonl`,
    )
    .action(async function (this: Command) {
      const body = requireBodyPaths(
        'gong stats activity day-by-day',
        await buildBody(dayByDay, ctx, ACTIVITY_FILTER_MAP),
        ACTIVITY_REQUIRED_PATHS,
      );
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/stats/activity/day-by-day', body },
        cursorIn: 'body',
        recordsKey: 'usersDetailedActivities',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['userId', 'userEmailAddress'],
        },
      });
    });

  // ---- gong stats activity scorecards — POST /v2/stats/activity/scorecards ------------
  const SCORECARDS_MAP: BodyFlagMap = {
    from: { path: 'filter.callFromDate' },
    to: { path: 'filter.callToDate' },
    callFromDate: { path: 'filter.callFromDate' },
    callToDate: { path: 'filter.callToDate' },
    reviewFromDate: { path: 'filter.reviewFromDate' },
    reviewToDate: { path: 'filter.reviewToDate' },
    reviewMethod: { path: 'filter.reviewMethod' },
    reviewedUserIds: { path: 'filter.reviewedUserIds', transform: (v) => csv(String(v)) },
    scorecardIds: { path: 'filter.scorecardIds', transform: (v) => csv(String(v)) },
  };

  const scorecards = activity
    .command('scorecards')
    .description('answered scorecards by call/review date, scorecard or reviewed user (POST /v2/stats/activity/scorecards)')
    .option('--from <date>', 'alias for --call-from-date (maps to filter.callFromDate)')
    .option('--to <date>', 'alias for --call-to-date (maps to filter.callToDate)')
    .option('--call-from-date <date>', 'call date, inclusive, YYYY-MM-DD; defaults to the earliest recorded call (maps to filter.callFromDate)')
    .option('--call-to-date <date>', 'call date, exclusive, YYYY-MM-DD; defaults to the latest recorded call (maps to filter.callToDate)')
    .option('--review-from-date <date>', 'review date, inclusive, YYYY-MM-DD (maps to filter.reviewFromDate)')
    .option('--review-to-date <date>', 'review date, exclusive, YYYY-MM-DD (maps to filter.reviewToDate)')
    .option('--review-method <method>', 'AUTOMATIC|MANUAL|BOTH; API default is MANUAL — pass BOTH to get everything (maps to filter.reviewMethod)')
    .option('--reviewed-user-ids <ids>', 'comma-separated user IDs of reviewed team members (maps to filter.reviewedUserIds)')
    .option('--scorecard-ids <ids>', 'comma-separated scorecard IDs (maps to filter.scorecardIds)');
  addBodyOptions(scorecards);
  addPaginationOptions(scorecards);
  scorecards
    .addHelpText(
      'after',
      `\nAll filter fields are optional (no flags returns every manually answered\nscorecard). Bearer scope: api:stats:scorecards. API docs: ${DOCS}#post-/v2/stats/activity/scorecards\n\nExamples:\n  gong stats activity scorecards --from 2026-06-01 --to 2026-07-01 --review-method BOTH\n  gong stats activity scorecards --body '{"filter":{"scorecardIds":["6843152929075440037"]}}'`,
    )
    .action(async function (this: Command) {
      const body = (await buildBody(scorecards, ctx, SCORECARDS_MAP, {
        defaults: { filter: {} },
      })) as Record<string, unknown> | undefined;
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/stats/activity/scorecards', body: body ?? { filter: {} } },
        cursorIn: 'body',
        recordsKey: 'answeredScorecards',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: [
            'answeredScorecardId',
            'scorecardName',
            'callId',
            'reviewedUserId',
            'reviewMethod',
            'reviewTime',
          ],
        },
      });
    });

  // ---- gong stats interaction — POST /v2/stats/interaction ----------------------------
  const interaction = stats
    .command('interaction')
    .description('interaction stats per user for Whisper-enabled calls (POST /v2/stats/interaction)');
  addActivityFilterOptions(interaction);
  addBodyOptions(interaction);
  addPaginationOptions(interaction);
  interaction
    .addHelpText(
      'after',
      `\nThe API requires both --from and --to. Only calls with Gong Whisper turned on\nproduce stats. Bearer scope: api:stats:interaction. API docs: ${DOCS}#post-/v2/stats/interaction\n\nExamples:\n  gong stats interaction --from 2026-06-01 --to 2026-07-01\n  gong stats interaction --body '{"filter":{"fromDate":"2026-06-01","toDate":"2026-07-01","userIds":["234599484848423"]}}' --all -o jsonl`,
    )
    .action(async function (this: Command) {
      const body = requireBodyPaths(
        'gong stats interaction',
        await buildBody(interaction, ctx, ACTIVITY_FILTER_MAP),
        ACTIVITY_REQUIRED_PATHS,
      );
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/stats/interaction', body },
        cursorIn: 'body',
        recordsKey: 'peopleInteractionStats',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['userId', 'userEmailAddress'],
        },
      });
    });
};
