import { describe, expect, it } from 'vitest';

import { parseJsonLines, runCli, TEST_AUTH_HEADER } from './helpers.js';

/** One Gong stats page: records envelope + the operation's payload array under `key`. */
function statsPage(key: string, records: unknown[], cursor?: string, total = records.length) {
  return {
    body: {
      requestId: 'req-1',
      records: {
        totalRecords: total,
        currentPageSize: records.length,
        currentPageNumber: 0,
        ...(cursor ? { cursor } : {}),
      },
      [key]: records,
    },
  };
}

describe('gong stats activity aggregate', () => {
  it('builds POST /v2/stats/activity/aggregate from flags with auth', async () => {
    const user = {
      userId: '234599484848423',
      userEmailAddress: 'rep@example.com',
      userAggregateActivityStats: { callsAsHost: 3, callsAttended: 5 },
    };
    const run = await runCli(
      [
        'stats',
        'activity',
        'aggregate',
        '--from',
        '2026-06-01',
        '--to',
        '2026-07-01',
        '--user-ids',
        'u1,u2',
        '--created-from-date-time',
        '2026-06-01',
        '--created-to-date-time',
        '2026-06-15T12:00:00Z',
      ],
      { responses: [statsPage('usersAggregateActivityStats', [user])] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('https://api.gong.io/v2/stats/activity/aggregate');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    // fromDate/toDate are date-only and pass through untouched; the created* fields are
    // date-times, so bare dates expand to the UTC day boundary.
    expect(request?.body).toEqual({
      filter: {
        fromDate: '2026-06-01',
        toDate: '2026-07-01',
        createdFromDateTime: '2026-06-01T00:00:00Z',
        createdToDateTime: '2026-06-15T12:00:00Z',
        userIds: ['u1', 'u2'],
      },
    });
    expect(JSON.parse(run.stdout)).toEqual([user]);
  });

  it('accepts the canonical --from-date/--to-date names, unexpanded', async () => {
    const run = await runCli(
      ['stats', 'activity', 'aggregate', '--from-date', '2026-06-01', '--to-date', '2026-06-08'],
      { responses: [statsPage('usersAggregateActivityStats', [])] },
    );
    expect(run.requests[0]?.body).toEqual({
      filter: { fromDate: '2026-06-01', toDate: '2026-06-08' },
    });
  });

  it('requires filter.fromDate and filter.toDate before any request', async () => {
    const run = await runCli(['stats', 'activity', 'aggregate']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('filter.fromDate');
    expect(run.stderr).toContain('filter.toDate');
  });

  it('--all follows the body cursor; --limit truncates across pages', async () => {
    const page = (ids: string[], cursor?: string) =>
      statsPage('usersAggregateActivityStats', ids.map((userId) => ({ userId })), cursor, 3);
    const all = await runCli(
      [
        'stats',
        'activity',
        'aggregate',
        '--from',
        '2026-06-01',
        '--to',
        '2026-07-01',
        '--all',
        '-o',
        'jsonl',
      ],
      { responses: [page(['1', '2'], 'C2'), page(['3'])] },
    );
    expect(all.exitCode).toBe(0);
    expect(parseJsonLines(all.stdout)).toHaveLength(3);
    expect(all.requests).toHaveLength(2);
    expect(all.requests[1]?.body).toEqual({
      filter: { fromDate: '2026-06-01', toDate: '2026-07-01' },
      cursor: 'C2',
    });

    const limited = await runCli(
      ['stats', 'activity', 'aggregate', '--from', '2026-06-01', '--to', '2026-07-01', '--limit', '1'],
      { responses: [page(['1', '2'], 'C2')] },
    );
    expect(JSON.parse(limited.stdout)).toHaveLength(1);
    expect(limited.requests).toHaveLength(1);
    const meta = JSON.parse(limited.stderr.trim()) as Record<string, unknown>;
    expect(meta.gongCliMeta).toBe(true);
    expect(meta.nextCursor).toBe('C2');
  });

  it('merges typed flags over --body, arrays replaced wholesale', async () => {
    const run = await runCli(
      [
        'stats',
        'activity',
        'aggregate',
        '--body',
        '{"filter":{"fromDate":"2026-01-01","toDate":"2026-02-01","userIds":["x"]}}',
        '--user-ids',
        'y,z',
      ],
      { responses: [statsPage('usersAggregateActivityStats', [])] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual({
      filter: { fromDate: '2026-01-01', toDate: '2026-02-01', userIds: ['y', 'z'] },
    });
  });

  it('--dry-run prints the merged request without any network call', async () => {
    const run = await runCli(
      ['stats', 'activity', 'aggregate', '--from', '2026-06-01', '--to', '2026-07-01', '--dry-run'],
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    const printed = JSON.parse(run.stdout) as { method: string; url: string; body: unknown };
    expect(printed.method).toBe('POST');
    expect(printed.url).toBe('https://api.gong.io/v2/stats/activity/aggregate');
    expect(printed.body).toEqual({ filter: { fromDate: '2026-06-01', toDate: '2026-07-01' } });
  });
});

describe('gong stats activity by-period', () => {
  it('builds the aggregate-by-period request including aggregationPeriod', async () => {
    const user = {
      userId: 'u1',
      userEmailAddress: 'rep@example.com',
      userAggregateActivity: [
        { callsAsHost: 2, fromDate: '2026-01-01T00:00:00-08:00', toDate: '2026-01-06T00:00:00-08:00' },
      ],
    };
    const run = await runCli(
      [
        'stats',
        'activity',
        'by-period',
        '--from',
        '2026-01-01',
        '--to',
        '2026-04-01',
        '--aggregation-period',
        'WEEK',
      ],
      { responses: [statsPage('usersAggregateActivity', [user])] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/stats/activity/aggregate-by-period');
    expect(run.requests[0]?.body).toEqual({
      filter: { fromDate: '2026-01-01', toDate: '2026-04-01' },
      aggregationPeriod: 'WEEK',
    });
    expect(JSON.parse(run.stdout)).toEqual([user]);
  });

  it('requires aggregationPeriod alongside the date range', async () => {
    const run = await runCli(
      ['stats', 'activity', 'by-period', '--from', '2026-01-01', '--to', '2026-04-01'],
    );
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('aggregationPeriod');
  });
});

describe('gong stats activity day-by-day', () => {
  it('builds the day-by-day request and unwraps usersDetailedActivities', async () => {
    const run = await runCli(
      [
        'stats',
        'activity',
        'day-by-day',
        '--from',
        '2026-06-01',
        '--to',
        '2026-06-08',
        '--user-ids',
        '234599484848423',
        '-o',
        'jsonl',
      ],
      {
        responses: [
          statsPage('usersDetailedActivities', [
            {
              userId: '234599484848423',
              userEmailAddress: 'rep@example.com',
              userDailyActivityStats: [
                { callsAsHost: ['348056639626337006'], fromDate: '2026-06-01T00:00:00-08:00' },
              ],
            },
          ]),
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/stats/activity/day-by-day');
    expect(run.requests[0]?.body).toEqual({
      filter: {
        fromDate: '2026-06-01',
        toDate: '2026-06-08',
        userIds: ['234599484848423'],
      },
    });
    const lines = parseJsonLines(run.stdout) as Array<{ userId: string }>;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.userId).toBe('234599484848423');
  });
});

describe('gong stats activity scorecards', () => {
  it('sends {filter:{}} when no filter flags are given', async () => {
    const run = await runCli(['stats', 'activity', 'scorecards'], {
      responses: [statsPage('answeredScorecards', [])],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/stats/activity/scorecards');
    expect(run.requests[0]?.body).toEqual({ filter: {} });
    expect(JSON.parse(run.stdout)).toEqual([]);
  });

  it('assembles the scorecards filter from flags, dates unexpanded', async () => {
    const run = await runCli(
      [
        'stats',
        'activity',
        'scorecards',
        '--call-from-date',
        '2026-06-01',
        '--call-to-date',
        '2026-07-01',
        '--review-from-date',
        '2026-06-05',
        '--review-to-date',
        '2026-06-20',
        '--review-method',
        'BOTH',
        '--reviewed-user-ids',
        'u1,u2',
        '--scorecard-ids',
        '6843152929075440037',
      ],
      { responses: [statsPage('answeredScorecards', [])] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual({
      filter: {
        callFromDate: '2026-06-01',
        callToDate: '2026-07-01',
        reviewFromDate: '2026-06-05',
        reviewToDate: '2026-06-20',
        reviewMethod: 'BOTH',
        reviewedUserIds: ['u1', 'u2'],
        scorecardIds: ['6843152929075440037'],
      },
    });
  });

  it('aliases --from/--to to the call date range', async () => {
    const run = await runCli(
      ['stats', 'activity', 'scorecards', '--from', '2026-06-01', '--to', '2026-07-01'],
      { responses: [statsPage('answeredScorecards', [])] },
    );
    expect(run.requests[0]?.body).toEqual({
      filter: { callFromDate: '2026-06-01', callToDate: '2026-07-01' },
    });
  });

  it('preserves int64 scorecard/call IDs losslessly in output', async () => {
    const bodyText =
      '{"requestId":"r","records":{"totalRecords":1,"currentPageSize":1,"currentPageNumber":0},' +
      '"answeredScorecards":[{"answeredScorecardId":128282750979957790,' +
      '"scorecardId":6843152929075440037,"callId":7782342274025937895,' +
      '"scorecardName":"SDR Call Scorecard","reviewMethod":"MANUAL"}]}';
    const run = await runCli(['stats', 'activity', 'scorecards'], {
      responses: [{ body: bodyText }],
    });
    expect(run.exitCode).toBe(0);
    // These IDs exceed Number.MAX_SAFE_INTEGER; naive JSON parsing would corrupt them.
    expect(run.stdout).toContain('128282750979957790');
    expect(run.stdout).toContain('6843152929075440037');
    expect(run.stdout).toContain('7782342274025937895');
  });
});

describe('gong stats interaction', () => {
  it('builds POST /v2/stats/interaction and unwraps peopleInteractionStats', async () => {
    const person = {
      userId: 'u1',
      userEmailAddress: 'rep@example.com',
      personInteractionStats: [{ name: 'Interactivity', value: 9.23 }],
    };
    const run = await runCli(
      ['stats', 'interaction', '--from', '2026-06-01', '--to', '2026-07-01'],
      { responses: [statsPage('peopleInteractionStats', [person])] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/stats/interaction');
    expect(run.requests[0]?.body).toEqual({
      filter: { fromDate: '2026-06-01', toDate: '2026-07-01' },
    });
    expect(JSON.parse(run.stdout)).toEqual([person]);
  });

  it('maps 404 "no stats in period" to an empty result with exit 0', async () => {
    const run = await runCli(
      ['stats', 'interaction', '--from', '2026-06-01', '--to', '2026-07-01'],
      {
        responses: [
          {
            status: 404,
            body: { requestId: 'r', errors: ['No stats found for the specified period'] },
          },
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    expect(run.stderr).toContain('No stats found for the specified period');
  });

  it('renders a table by default on a TTY', async () => {
    const run = await runCli(
      ['stats', 'interaction', '--from', '2026-06-01', '--to', '2026-07-01'],
      {
        responses: [
          statsPage('peopleInteractionStats', [
            { userId: 'u1', userEmailAddress: 'rep@example.com', personInteractionStats: [] },
          ]),
        ],
        stdoutTTY: true,
      },
    );
    expect(run.stdout.split('\n')[0]).toMatch(/^userId\s+userEmailAddress$/);
    expect(run.stdout).toContain('rep@example.com');
  });
});
