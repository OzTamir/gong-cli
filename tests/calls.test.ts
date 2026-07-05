import { describe, expect, it } from 'vitest';

import { parseJsonLines, runCli, TEST_AUTH_HEADER } from './helpers.js';

function callsPage(ids: string[], cursor?: string, total = ids.length) {
  return {
    body: {
      requestId: 'req-1',
      records: {
        totalRecords: total,
        currentPageSize: ids.length,
        currentPageNumber: 0,
        ...(cursor ? { cursor } : {}),
      },
      calls: ids.map((id) => ({ id, title: `Call ${id}`, started: '2026-06-15T10:00:00Z' })),
    },
  };
}

describe('gong calls list', () => {
  it('builds GET /v2/calls with expanded dates and auth', async () => {
    const run = await runCli(
      ['calls', 'list', '--from', '2026-06-01', '--to', '2026-07-01', '--workspace-id', 'w1'],
      { responses: [callsPage(['1', '2'])] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/calls');
    expect(url.searchParams.get('fromDateTime')).toBe('2026-06-01T00:00:00Z');
    expect(url.searchParams.get('toDateTime')).toBe('2026-07-01T00:00:00Z');
    expect(url.searchParams.get('workspaceId')).toBe('w1');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(JSON.parse(run.stdout)).toEqual([
      { id: '1', title: 'Call 1', started: '2026-06-15T10:00:00Z' },
      { id: '2', title: 'Call 2', started: '2026-06-15T10:00:00Z' },
    ]);
  });

  it('passes full ISO-8601 datetimes through untouched via canonical flags', async () => {
    const run = await runCli(
      [
        'calls',
        'list',
        '--from-date-time',
        '2026-06-01T05:30:00-07:00',
        '--to-date-time',
        '2026-06-02T00:00:00Z',
      ],
      { responses: [callsPage(['1'])] },
    );
    const url = new URL(run.requests[0]?.url ?? '');
    expect(url.searchParams.get('fromDateTime')).toBe('2026-06-01T05:30:00-07:00');
    expect(url.searchParams.get('toDateTime')).toBe('2026-06-02T00:00:00Z');
  });

  it('requires --from and --to with a usage error before any request', async () => {
    const run = await runCli(['calls', 'list', '--from', '2026-06-01']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--from and --to');
  });

  it('--all follows query cursors; --limit truncates across pages', async () => {
    const all = await runCli(
      ['calls', 'list', '--from', '2026-06-01', '--to', '2026-07-01', '--all', '-o', 'jsonl'],
      { responses: [callsPage(['1', '2'], 'C2', 3), callsPage(['3'])] },
    );
    expect(parseJsonLines(all.stdout)).toHaveLength(3);
    expect(all.requests).toHaveLength(2);
    expect(new URL(all.requests[1]?.url ?? '').searchParams.get('cursor')).toBe('C2');

    const limited = await runCli(
      ['calls', 'list', '--from', '2026-06-01', '--to', '2026-07-01', '--limit', '1'],
      { responses: [callsPage(['1', '2'], 'C2', 3)] },
    );
    expect(JSON.parse(limited.stdout)).toHaveLength(1);
    const meta = JSON.parse(limited.stderr.trim()) as Record<string, unknown>;
    expect(meta.gongCliMeta).toBe(true);
    expect(meta.nextCursor).toBe('C2');
  });

  it('renders a table by default on a TTY', async () => {
    const run = await runCli(['calls', 'list', '--from', '2026-06-01', '--to', '2026-07-01'], {
      responses: [callsPage(['1'])],
      stdoutTTY: true,
    });
    expect(run.stdout.split('\n')[0]).toMatch(/^id\s+started\s+duration\s+title\s+primaryUserId$/);
    expect(run.stdout).toContain('Call 1');
  });

  it('maps 404 "no calls in period" to an empty result with exit 0', async () => {
    const run = await runCli(['calls', 'list', '--from', '2026-06-01', '--to', '2026-07-01'], {
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
});

describe('gong calls get', () => {
  it('builds the path, unwraps the call payload', async () => {
    const run = await runCli(['calls', 'get', '7782342274025937895'], {
      responses: [
        { body: { requestId: 'r', call: { id: '7782342274025937895', title: 'Demo' } } },
      ],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('GET');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/calls/7782342274025937895');
    expect(JSON.parse(run.stdout)).toEqual({ id: '7782342274025937895', title: 'Demo' });
  });

  it('maps 404 to exit code 4', async () => {
    const run = await runCli(['calls', 'get', 'missing'], {
      responses: [{ status: 404, body: { requestId: 'r', errors: ['Call ID was not found'] } }],
    });
    expect(run.exitCode).toBe(4);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(404);
    expect(parsed.requestId).toBe('r');
  });
});

describe('gong calls search', () => {
  it('assembles filter and contentSelector from flags', async () => {
    const run = await runCli(
      [
        'calls',
        'search',
        '--from',
        '2026-06-01',
        '--to',
        '2026-07-01',
        '--call-ids',
        'a,b',
        '--primary-user-ids',
        'u1',
        '--context',
        'Extended',
        '--context-timing',
        'Now,TimeOfCall',
        '--parties',
        '--trackers',
        '--tracker-occurrences',
        '--media',
        '--questions',
      ],
      {
        responses: [
          { body: { requestId: 'r', records: { totalRecords: 0 }, calls: [] } },
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/calls/extensive');
    expect(run.requests[0]?.body).toEqual({
      filter: {
        fromDateTime: '2026-06-01T00:00:00Z',
        toDateTime: '2026-07-01T00:00:00Z',
        callIds: ['a', 'b'],
        primaryUserIds: ['u1'],
      },
      contentSelector: {
        context: 'Extended',
        contextTiming: ['Now', 'TimeOfCall'],
        exposedFields: {
          parties: true,
          content: { trackers: true, trackerOccurrences: true },
          interaction: { questions: true },
          media: true,
        },
      },
    });
  });

  it('sends {filter:{}} when no filter flags are given', async () => {
    const run = await runCli(['calls', 'search'], {
      responses: [{ body: { requestId: 'r', calls: [] } }],
    });
    expect(run.requests[0]?.body).toEqual({ filter: {} });
  });

  it('merges typed flags over --body, arrays replaced wholesale', async () => {
    const run = await runCli(
      [
        'calls',
        'search',
        '--body',
        '{"filter":{"callIds":["x"],"workspaceId":"w9"},"contentSelector":{"context":"None"}}',
        '--call-ids',
        'y,z',
      ],
      { responses: [{ body: { requestId: 'r', calls: [] } }] },
    );
    expect(run.requests[0]?.body).toEqual({
      filter: { callIds: ['y', 'z'], workspaceId: 'w9' },
      contentSelector: { context: 'None' },
    });
  });

  it('paginates with a top-level body cursor under --all', async () => {
    const pageOf = (ids: string[], cursor?: string) => ({
      body: {
        requestId: 'r',
        records: { totalRecords: 3, ...(cursor ? { cursor } : {}) },
        calls: ids.map((id) => ({ metaData: { id } })),
      },
    });
    const run = await runCli(
      ['calls', 'search', '--call-ids', 'a', '--all', '-o', 'jsonl'],
      { responses: [pageOf(['1', '2'], 'CURSOR-2'), pageOf(['3'])] },
    );
    expect(parseJsonLines(run.stdout)).toHaveLength(3);
    expect(run.requests[1]?.body).toEqual({
      filter: { callIds: ['a'] },
      cursor: 'CURSOR-2',
    });
  });
});

describe('gong calls transcript', () => {
  it('builds the transcript request and unwraps callTranscripts', async () => {
    const run = await runCli(
      ['calls', 'transcript', '--call-ids', '123', '-o', 'jsonl'],
      {
        responses: [
          {
            body: {
              requestId: 'r',
              records: { totalRecords: 1 },
              callTranscripts: [
                {
                  callId: '123',
                  transcript: [
                    {
                      speakerId: 's1',
                      topic: 'Pricing',
                      sentences: [{ start: 0, end: 100, text: 'Hello' }],
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
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/calls/transcript');
    expect(run.requests[0]?.body).toEqual({ filter: { callIds: ['123'] } });
    const lines = parseJsonLines(run.stdout) as Array<{ callId: string }>;
    expect(lines[0]?.callId).toBe('123');
  });
});

describe('gong calls create', () => {
  it('assembles the body from flags and returns the callId envelope', async () => {
    const run = await runCli(
      [
        'calls',
        'create',
        '--client-unique-id',
        'rec-42',
        '--actual-start',
        '2026-06-15T10:00:00Z',
        '--direction',
        'Outbound',
        '--primary-user',
        'u-9',
        '--parties',
        '[{"emailAddress":"rep@example.com","userId":"u-9"}]',
        '--title',
        'Intro call',
        '--duration',
        '360',
        '--task-id',
        't-1',
      ],
      { responses: [{ body: { requestId: 'r', callId: '999' } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/calls');
    expect(run.requests[0]?.body).toEqual({
      clientUniqueId: 'rec-42',
      actualStart: '2026-06-15T10:00:00Z',
      direction: 'Outbound',
      primaryUser: 'u-9',
      parties: [{ emailAddress: 'rep@example.com', userId: 'u-9' }],
      title: 'Intro call',
      duration: 360,
      flowContext: { taskId: 't-1' },
    });
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'r', callId: '999' });
  });

  it('validates required fields before any request', async () => {
    const run = await runCli(['calls', 'create', '--title', 'No essentials']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('clientUniqueId');
    expect(run.stderr).toContain('primaryUser');
  });

  it('accepts the full body via --body-file - (stdin)', async () => {
    const body = {
      clientUniqueId: 'rec-1',
      actualStart: '2026-06-15T10:00:00Z',
      direction: 'Inbound',
      primaryUser: 'u-1',
      parties: [{ userId: 'u-1' }],
    };
    const run = await runCli(['calls', 'create', '--body-file', '-'], {
      stdinData: JSON.stringify(body),
      responses: [{ body: { requestId: 'r', callId: '1' } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual(body);
  });
});

describe('gong calls upload-media', () => {
  it('uploads multipart media with the mediaFile field', async () => {
    const run = await runCli(
      ['calls', 'upload-media', '999', '--media', '/tmp/rec.mp3'],
      {
        responses: [
          { status: 201, body: { requestId: 'r', callId: '999', url: 'https://app.gong.io/call?id=999' } },
        ],
        blobs: { '/tmp/rec.mp3': new Blob([Buffer.from('abc')]) },
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('PUT');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/calls/999/media');
    expect(run.requests[0]?.multipart?.mediaFile).toMatchObject({
      kind: 'file',
      filename: 'rec.mp3',
      size: 3,
    });
    expect(JSON.parse(run.stdout)).toMatchObject({ callId: '999' });
  });

  it('--dry-run prints the multipart request without reading the file', async () => {
    const run = await runCli(
      ['calls', 'upload-media', '999', '--media', '/tmp/missing.mp3', '--dry-run'],
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    const printed = JSON.parse(run.stdout) as { method: string; url: string; body: unknown };
    expect(printed.method).toBe('PUT');
    expect(printed.url).toBe('https://api.gong.io/v2/calls/999/media');
    expect(printed.body).toEqual({ multipart: { mediaFile: '@/tmp/missing.mp3' } });
  });
});
