import { describe, expect, it } from 'vitest';

import { parseJsonLines, runCli, TEST_AUTH_HEADER } from './helpers.js';

function usersPage(ids: string[], cursor?: string, total = ids.length) {
  return {
    body: {
      requestId: 'req-1',
      records: {
        totalRecords: total,
        currentPageSize: ids.length,
        currentPageNumber: 0,
        ...(cursor ? { cursor } : {}),
      },
      users: ids.map((id) => ({
        id,
        emailAddress: `user${id}@example.com`,
        firstName: 'Jon',
        lastName: `Snow-${id}`,
        title: 'Enterprise Account Executive',
        active: true,
      })),
    },
  };
}

describe('gong users list', () => {
  it('builds GET /v2/users with auth; avatars excluded unless requested', async () => {
    const run = await runCli(['users', 'list'], { responses: [usersPage(['1', '2'])] });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/users');
    expect(url.searchParams.has('includeAvatars')).toBe(false);
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(JSON.parse(run.stdout)).toEqual([
      {
        id: '1',
        emailAddress: 'user1@example.com',
        firstName: 'Jon',
        lastName: 'Snow-1',
        title: 'Enterprise Account Executive',
        active: true,
      },
      {
        id: '2',
        emailAddress: 'user2@example.com',
        firstName: 'Jon',
        lastName: 'Snow-2',
        title: 'Enterprise Account Executive',
        active: true,
      },
    ]);
  });

  it('--include-avatars maps to the includeAvatars query param', async () => {
    const run = await runCli(['users', 'list', '--include-avatars'], {
      responses: [usersPage(['1'])],
    });
    const url = new URL(run.requests[0]?.url ?? '');
    expect(url.searchParams.get('includeAvatars')).toBe('true');
  });

  it('--all follows query cursors; --limit truncates across pages', async () => {
    const all = await runCli(['users', 'list', '--all', '-o', 'jsonl'], {
      responses: [usersPage(['1', '2'], 'C2', 3), usersPage(['3'])],
    });
    expect(parseJsonLines(all.stdout)).toHaveLength(3);
    expect(all.requests).toHaveLength(2);
    expect(new URL(all.requests[1]?.url ?? '').searchParams.get('cursor')).toBe('C2');

    const limited = await runCli(['users', 'list', '--limit', '1'], {
      responses: [usersPage(['1', '2'], 'C2', 3)],
    });
    expect(JSON.parse(limited.stdout)).toHaveLength(1);
    const meta = JSON.parse(limited.stderr.trim()) as Record<string, unknown>;
    expect(meta.gongCliMeta).toBe(true);
    expect(meta.nextCursor).toBe('C2');
  });

  it('renders a table by default on a TTY', async () => {
    const run = await runCli(['users', 'list'], {
      responses: [usersPage(['1'])],
      stdoutTTY: true,
    });
    expect(run.stdout.split('\n')[0]).toMatch(
      /^id\s+emailAddress\s+firstName\s+lastName\s+title\s+active$/,
    );
    expect(run.stdout).toContain('user1@example.com');
  });
});

describe('gong users get', () => {
  it('builds the path and unwraps the user payload', async () => {
    const run = await runCli(['users', 'get', '234599484848423'], {
      responses: [
        {
          body: {
            requestId: 'r',
            user: { id: '234599484848423', emailAddress: 'jon@example.com', active: true },
          },
        },
      ],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('GET');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/users/234599484848423');
    expect(JSON.parse(run.stdout)).toEqual({
      id: '234599484848423',
      emailAddress: 'jon@example.com',
      active: true,
    });
  });

  it('maps 404 to exit code 4', async () => {
    const run = await runCli(['users', 'get', 'missing'], {
      responses: [{ status: 404, body: { requestId: 'r', errors: ['User not found'] } }],
    });
    expect(run.exitCode).toBe(4);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(404);
    expect(parsed.requestId).toBe('r');
  });
});

describe('gong users history', () => {
  it('fetches the settings history and emits it as a list', async () => {
    const run = await runCli(['users', 'history', '234599484848423'], {
      responses: [
        {
          body: {
            requestId: 'r',
            userSettingsHistory: [
              { setting: 'emailsImported', value: true, time: '2026-01-10T08:00:00Z' },
              { setting: 'webConferencesRecorded', value: false, time: '2026-02-01T08:00:00Z' },
            ],
          },
        },
      ],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://api.gong.io/v2/users/234599484848423/settings-history',
    );
    expect(url.search).toBe('');
    expect(JSON.parse(run.stdout)).toEqual([
      { setting: 'emailsImported', value: true, time: '2026-01-10T08:00:00Z' },
      { setting: 'webConferencesRecorded', value: false, time: '2026-02-01T08:00:00Z' },
    ]);
  });

  it('keeps 404 as exit code 4 (user not found, not an empty period)', async () => {
    const run = await runCli(['users', 'history', 'missing'], {
      responses: [{ status: 404, body: { requestId: 'r', errors: ['User not found'] } }],
    });
    expect(run.exitCode).toBe(4);
    expect(run.stdout).toBe('');
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(404);
  });
});

describe('gong users search', () => {
  it('assembles the filter from flags', async () => {
    const run = await runCli(
      [
        'users',
        'search',
        '--from',
        '2026-06-01',
        '--to',
        '2026-07-01',
        '--user-ids',
        'a,b',
        '--include-avatars',
      ],
      { responses: [usersPage(['a', 'b'])] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/users/extensive');
    expect(run.requests[0]?.body).toEqual({
      filter: {
        createdFromDateTime: '2026-06-01T00:00:00Z',
        createdToDateTime: '2026-07-01T00:00:00Z',
        userIds: ['a', 'b'],
        includeAvatars: true,
      },
    });
  });

  it('passes full ISO-8601 datetimes through untouched via canonical flags', async () => {
    const run = await runCli(
      [
        'users',
        'search',
        '--created-from-date-time',
        '2026-06-01T05:30:00-07:00',
        '--created-to-date-time',
        '2026-06-02T00:00:00Z',
      ],
      { responses: [usersPage(['1'])] },
    );
    expect(run.requests[0]?.body).toEqual({
      filter: {
        createdFromDateTime: '2026-06-01T05:30:00-07:00',
        createdToDateTime: '2026-06-02T00:00:00Z',
      },
    });
  });

  it('sends {filter:{}} when no filter flags are given', async () => {
    const run = await runCli(['users', 'search'], {
      responses: [{ body: { requestId: 'r', users: [] } }],
    });
    expect(run.requests[0]?.body).toEqual({ filter: {} });
  });

  it('merges typed flags over --body, arrays replaced wholesale', async () => {
    const run = await runCli(
      [
        'users',
        'search',
        '--body',
        '{"filter":{"userIds":["x"],"includeAvatars":false}}',
        '--user-ids',
        'y,z',
      ],
      { responses: [{ body: { requestId: 'r', users: [] } }] },
    );
    expect(run.requests[0]?.body).toEqual({
      filter: { userIds: ['y', 'z'], includeAvatars: false },
    });
  });

  it('paginates with a top-level body cursor under --all', async () => {
    const run = await runCli(
      ['users', 'search', '--user-ids', 'a', '--all', '-o', 'jsonl'],
      { responses: [usersPage(['1', '2'], 'C2', 3), usersPage(['3'])] },
    );
    expect(parseJsonLines(run.stdout)).toHaveLength(3);
    expect(run.requests).toHaveLength(2);
    expect(run.requests[1]?.body).toEqual({
      filter: { userIds: ['a'] },
      cursor: 'C2',
    });
  });

  it('maps 404 "no users matched" to an empty result with exit 0', async () => {
    const run = await runCli(['users', 'search', '--user-ids', 'nobody'], {
      responses: [
        {
          status: 404,
          body: { requestId: 'r', errors: ['No calls found for the specified period'] },
        },
      ],
    });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    expect(run.stderr).toContain('No calls found for the specified period');
  });

  it('--dry-run prints the merged request with redacted auth and sends nothing', async () => {
    const run = await runCli(['users', 'search', '--user-ids', 'a', '--dry-run']);
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    const printed = JSON.parse(run.stdout) as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: unknown;
    };
    expect(printed.method).toBe('POST');
    expect(printed.url).toBe('https://api.gong.io/v2/users/extensive');
    expect(printed.headers.authorization).toBe('Basic ***');
    expect(printed.body).toEqual({ filter: { userIds: ['a'] } });
  });
});

describe('gong coaching list', () => {
  it('builds GET /v2/coaching with kebab-case query params, expanded dates and auth', async () => {
    const run = await runCli(
      [
        'coaching',
        'list',
        '--workspace-id',
        '623457723877',
        '--manager-id',
        '234599484848423',
        '--from',
        '2026-06-01',
        '--to',
        '2026-07-01T08:00:00Z',
      ],
      {
        responses: [
          {
            body: {
              requestId: 'r',
              coachingData: [
                {
                  manager: {
                    id: '234599484848423',
                    emailAddress: 'manager@example.com',
                    firstName: 'Arya',
                    lastName: 'Stark',
                    title: 'Sales Manager',
                  },
                  directReportsMetrics: [
                    {
                      report: { id: '563515258458745', emailAddress: 'rep@example.com' },
                      metrics: { callsReviewed: ['12'] },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/coaching');
    expect(url.searchParams.get('workspace-id')).toBe('623457723877');
    expect(url.searchParams.get('manager-id')).toBe('234599484848423');
    expect(url.searchParams.get('from')).toBe('2026-06-01T00:00:00Z');
    expect(url.searchParams.get('to')).toBe('2026-07-01T08:00:00Z');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    const records = JSON.parse(run.stdout) as Array<{ manager: { id: string } }>;
    expect(records).toHaveLength(1);
    expect(records[0]?.manager.id).toBe('234599484848423');
  });

  it('requires all four params with a usage error before any request', async () => {
    const run = await runCli(['coaching', 'list', '--from', '2026-06-01']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--workspace-id');
    expect(run.stderr).toContain('--manager-id');
    expect(run.stderr).toContain('--to');
  });
});
