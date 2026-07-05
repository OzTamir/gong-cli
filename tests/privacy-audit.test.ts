import { describe, expect, it } from 'vitest';

import { parseJsonLines, runCli, TEST_AUTH_HEADER } from './helpers.js';

const EMAIL_REFERENCES = {
  requestId: 'req-privacy-1',
  emails: [
    {
      from: 'user@example.com',
      id: '223mjfaaqqjuegabiyrmpctvcwwl75oz',
      sentTime: '2026-06-01T10:00:00Z',
      mailbox: 'user@example.com',
      messageHash: 'l3z7w2s7oircdabnkwizmycm6g2uwznc',
    },
  ],
  calls: [{ id: '7782342274025937895', status: 'COMPLETED', externalSystems: [] }],
  meetings: [{ id: 'meet-1' }],
  customerData: [
    { system: 'Salesforce', objects: [{ id: '1', objectType: 'Contact', externalId: 'x-1' }] },
  ],
  customerEngagement: [{ eventType: 'contentViewed', timestamp: '2026-06-02T10:00:00Z' }],
};

function logsPage(eventTimes: string[], cursor?: string, total = eventTimes.length) {
  return {
    body: {
      requestId: 'req-logs-1',
      records: {
        totalRecords: total,
        currentPageSize: eventTimes.length,
        currentPageNumber: 0,
        ...(cursor ? { cursor } : {}),
      },
      logEntries: eventTimes.map((eventTime, i) => ({
        userId: `u-${i}`,
        userEmailAddress: 'viewer@example.com',
        userFullName: 'Jon Snow',
        eventTime,
        logRecord: { callId: `c-${i}` },
      })),
    },
  };
}

describe('gong privacy for-email', () => {
  it('builds GET /v2/data-privacy/data-for-email-address with the emailAddress query and auth', async () => {
    const run = await runCli(['privacy', 'for-email', 'user@example.com'], {
      responses: [{ body: EMAIL_REFERENCES }],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://api.gong.io/v2/data-privacy/data-for-email-address',
    );
    expect(url.searchParams.get('emailAddress')).toBe('user@example.com');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(request?.bodyText).toBeUndefined();
    // The whole unpaginated payload is emitted as-is.
    expect(JSON.parse(run.stdout)).toEqual(EMAIL_REFERENCES);
  });

  it('maps 404 to exit code 4 with the machine-readable error line', async () => {
    const run = await runCli(['privacy', 'for-email', 'nobody@example.com'], {
      responses: [{ status: 404, body: { requestId: 'r-404', errors: ['Not found'] } }],
    });
    expect(run.exitCode).toBe(4);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(404);
    expect(parsed.requestId).toBe('r-404');
  });
});

describe('gong privacy for-phone', () => {
  it('builds GET /v2/data-privacy/data-for-phone-number and URL-encodes the + sign', async () => {
    const references = {
      requestId: 'req-privacy-2',
      emails: [],
      calls: [{ id: '123', status: 'COMPLETED' }],
      meetings: [],
      customerData: [],
      suppliedPhoneNumber: '+1(425) 555-2671',
      matchingPhoneNumbers: ['+14255552671'],
      emailAddresses: ['user@example.com'],
    };
    const run = await runCli(['privacy', 'for-phone', '+1(425) 555-2671'], {
      responses: [{ body: references }],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://api.gong.io/v2/data-privacy/data-for-phone-number',
    );
    // The leading + must reach the wire as %2B, not a literal + (which decodes to a space).
    expect(request?.url).toContain('phoneNumber=%2B1%28425%29+555-2671');
    expect(url.searchParams.get('phoneNumber')).toBe('+1(425) 555-2671');
    expect(JSON.parse(run.stdout)).toEqual(references);
  });
});

describe('gong privacy purge-email', () => {
  it('refuses without --yes when stdin is not a TTY (exit 2, no request)', async () => {
    const run = await runCli(['privacy', 'purge-email', 'user@example.com']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.error).toBe(true);
    expect(parsed.message).toContain('user@example.com');
    expect(parsed.hint).toContain('--yes');
  });

  it('with --yes sends a body-less POST with the emailAddress query param', async () => {
    const run = await runCli(['privacy', 'purge-email', 'user@example.com', '--yes'], {
      responses: [{ body: { requestId: 'purge-req-1' } }],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('POST');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://api.gong.io/v2/data-privacy/erase-data-for-email-address',
    );
    expect(url.searchParams.get('emailAddress')).toBe('user@example.com');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    // The purge input travels in the query string; the POST carries no JSON body.
    expect(request?.bodyText).toBeUndefined();
    expect(request?.body).toBeUndefined();
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'purge-req-1' });
  });

  it('on a TTY requires re-typing the email address, then proceeds', async () => {
    const run = await runCli(['privacy', 'purge-email', 'user@example.com'], {
      stdinTTY: true,
      promptAnswers: ['user@example.com'],
      responses: [{ body: { requestId: 'purge-req-2' } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.prompts).toHaveLength(1);
    expect(run.prompts[0]).toContain("Type 'user@example.com' to confirm");
    expect(run.requests).toHaveLength(1);
  });

  it('aborts with exit 2 and no request when the typed confirmation does not match', async () => {
    const run = await runCli(['privacy', 'purge-email', 'user@example.com'], {
      stdinTTY: true,
      promptAnswers: ['other@example.com'],
    });
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('Confirmation did not match');
  });

  it('--dry-run prints the request without confirmation or network', async () => {
    const run = await runCli(['privacy', 'purge-email', 'user@example.com', '--dry-run']);
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    expect(run.prompts).toHaveLength(0);
    const printed = JSON.parse(run.stdout) as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: unknown;
    };
    expect(printed.method).toBe('POST');
    expect(printed.url).toBe(
      'https://api.gong.io/v2/data-privacy/erase-data-for-email-address?emailAddress=user%40example.com',
    );
    expect(printed.headers.authorization).toBe('Basic ***');
    expect(printed.body).toBeNull();
  });

  it('rejects --body: the operation has no request body (exit 2, no request)', async () => {
    const run = await runCli([
      'privacy',
      'purge-email',
      'user@example.com',
      '--body',
      '{"emailAddress":"other@example.com"}',
      '--yes',
    ]);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain("unknown option '--body'");
  });
});

describe('gong privacy purge-phone', () => {
  it('with --yes sends a body-less POST with the URL-encoded phoneNumber query param', async () => {
    const run = await runCli(['privacy', 'purge-phone', '+14255552671', '--yes'], {
      responses: [{ body: { requestId: 'purge-req-3' } }],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('POST');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://api.gong.io/v2/data-privacy/erase-data-for-phone-number',
    );
    expect(request?.url).toContain('phoneNumber=%2B14255552671');
    expect(url.searchParams.get('phoneNumber')).toBe('+14255552671');
    expect(request?.bodyText).toBeUndefined();
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'purge-req-3' });
  });

  it('refuses without --yes when stdin is not a TTY (exit 2, no request)', async () => {
    const run = await runCli(['privacy', 'purge-phone', '+14255552671']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('+14255552671');
  });
});

describe('gong logs list', () => {
  it('builds GET /v2/logs with logType, expanded dates, and auth', async () => {
    const run = await runCli(
      [
        'logs',
        'list',
        '--log-type',
        'AccessLog',
        '--from',
        '2026-06-01',
        '--to',
        '2026-07-01',
      ],
      { responses: [logsPage(['2026-06-15T10:00:00Z'])] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/logs');
    expect(url.searchParams.get('logType')).toBe('AccessLog');
    expect(url.searchParams.get('fromDateTime')).toBe('2026-06-01T00:00:00Z');
    expect(url.searchParams.get('toDateTime')).toBe('2026-07-01T00:00:00Z');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(JSON.parse(run.stdout)).toEqual([
      {
        userId: 'u-0',
        userEmailAddress: 'viewer@example.com',
        userFullName: 'Jon Snow',
        eventTime: '2026-06-15T10:00:00Z',
        logRecord: { callId: 'c-0' },
      },
    ]);
  });

  it('omits toDateTime when --to is not given and passes canonical ISO datetimes untouched', async () => {
    const run = await runCli(
      ['logs', 'list', '--log-type', 'UserCallPlay', '--from-date-time', '2026-06-01T05:30:00-07:00'],
      { responses: [logsPage(['2026-06-15T10:00:00Z'])] },
    );
    expect(run.exitCode).toBe(0);
    const url = new URL(run.requests[0]?.url ?? '');
    expect(url.searchParams.get('fromDateTime')).toBe('2026-06-01T05:30:00-07:00');
    expect(url.searchParams.has('toDateTime')).toBe(false);
  });

  it('requires --log-type before any request', async () => {
    const run = await runCli(['logs', 'list', '--from', '2026-06-01']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--log-type');
  });

  it('rejects a --log-type outside the documented enum', async () => {
    const run = await runCli(['logs', 'list', '--log-type', 'Bogus', '--from', '2026-06-01']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('AccessLog');
  });

  it('requires --from with a usage error before any request', async () => {
    const run = await runCli(['logs', 'list', '--log-type', 'AccessLog']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--from');
  });

  it('--all follows query cursors, keeping logType and fromDateTime on later pages', async () => {
    const run = await runCli(
      ['logs', 'list', '--log-type', 'AccessLog', '--from', '2026-06-01', '--all', '-o', 'jsonl'],
      {
        responses: [
          logsPage(['2026-06-15T10:00:00Z', '2026-06-16T10:00:00Z'], 'CURSOR-2', 3),
          logsPage(['2026-06-17T10:00:00Z']),
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    expect(parseJsonLines(run.stdout)).toHaveLength(3);
    expect(run.requests).toHaveLength(2);
    const second = new URL(run.requests[1]?.url ?? '');
    expect(second.searchParams.get('cursor')).toBe('CURSOR-2');
    expect(second.searchParams.get('logType')).toBe('AccessLog');
    expect(second.searchParams.get('fromDateTime')).toBe('2026-06-01T00:00:00Z');
  });

  it('--limit truncates and surfaces the next cursor in the stderr meta line', async () => {
    const run = await runCli(
      ['logs', 'list', '--log-type', 'AccessLog', '--from', '2026-06-01', '--limit', '1'],
      { responses: [logsPage(['2026-06-15T10:00:00Z', '2026-06-16T10:00:00Z'], 'CURSOR-2', 3)] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(1);
    expect(JSON.parse(run.stdout)).toHaveLength(1);
    const meta = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(meta.gongCliMeta).toBe(true);
    expect(meta.nextCursor).toBe('CURSOR-2');
    expect(meta.totalRecords).toBe(3);
  });

  it('maps 404 "no logs in period" to an empty result with exit 0', async () => {
    const run = await runCli(
      ['logs', 'list', '--log-type', 'ExternallySharedCallPlay', '--from', '2026-06-01'],
      {
        responses: [
          {
            status: 404,
            body: { requestId: 'r', errors: ['No logs found for the specified period'] },
          },
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    expect(run.stderr).toContain('No logs found for the specified period');
  });

  it('renders a table with the curated columns by default on a TTY', async () => {
    const run = await runCli(
      ['logs', 'list', '--log-type', 'AccessLog', '--from', '2026-06-01'],
      { responses: [logsPage(['2026-06-15T10:00:00Z'])], stdoutTTY: true },
    );
    expect(run.exitCode).toBe(0);
    expect(run.stdout.split('\n')[0]).toMatch(
      /^eventTime\s+userId\s+userEmailAddress\s+userFullName$/,
    );
    expect(run.stdout).toContain('Jon Snow');
  });
});
