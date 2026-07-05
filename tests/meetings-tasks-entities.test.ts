import { describe, expect, it } from 'vitest';

import { runCli, TEST_AUTH_HEADER } from './helpers.js';

// 20 digits — exceeds Number.MAX_SAFE_INTEGER; must pass through as a string.
const BIG_MEETING_ID = '17782342274025937895';

const MEETING_FLAGS = [
  '--start-time',
  '2026-07-10T10:00:00Z',
  '--end-time',
  '2026-07-10T11:00:00Z',
  '--invitees',
  '[{"email":"jon.snow@acme.com","displayName":"Jon Snow"}]',
  '--organizer-email',
  'host@acme.com',
];

describe('gong meetings create', () => {
  it('builds POST /v2/meetings from flags with auth and emits the envelope', async () => {
    const envelope = {
      requestId: 'r',
      meetingId: '7782342274025937895',
      meetingUrl: 'https://join.gong.io/acme/host?tkn=x',
      additionalInvitees: [{ email: 'assistant@gong.io', displayName: 'Gong Assistant' }],
    };
    const run = await runCli(
      [
        'meetings',
        'create',
        ...MEETING_FLAGS,
        '--title',
        'Kickoff',
        '--external-id',
        'EXT-1',
        '--provider',
        'zoom',
      ],
      { responses: [{ body: envelope }] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('https://api.gong.io/v2/meetings');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(request?.body).toEqual({
      startTime: '2026-07-10T10:00:00Z',
      endTime: '2026-07-10T11:00:00Z',
      invitees: [{ email: 'jon.snow@acme.com', displayName: 'Jon Snow' }],
      organizerEmail: 'host@acme.com',
      title: 'Kickoff',
      externalId: 'EXT-1',
      provider: 'zoom',
    });
    expect(JSON.parse(run.stdout)).toEqual(envelope);
  });

  it('expands YYYY-MM-DD via the --from/--to aliases onto startTime/endTime', async () => {
    const run = await runCli(
      [
        'meetings',
        'create',
        '--from',
        '2026-07-10',
        '--to',
        '2026-07-11',
        '--invitees',
        '[]',
        '--organizer-email',
        'host@acme.com',
      ],
      { responses: [{ body: { requestId: 'r', meetingId: '1' } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toMatchObject({
      startTime: '2026-07-10T00:00:00Z',
      endTime: '2026-07-11T00:00:00Z',
    });
  });

  it('validates required body fields before any request', async () => {
    const run = await runCli(['meetings', 'create', '--title', 'No essentials']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('startTime');
    expect(run.stderr).toContain('organizerEmail');
  });

  it('maps the limited-release 403 to exit code 3', async () => {
    const run = await runCli(['meetings', 'create', ...MEETING_FLAGS], {
      responses: [
        {
          status: 403,
          body: {
            requestId: 'r',
            errors: ['This API endpoint is in Limited release - contact your CSM'],
          },
        },
      ],
    });
    expect(run.exitCode).toBe(3);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(403);
    expect(parsed.requestId).toBe('r');
  });

  it('--dry-run prints the merged request without any network call', async () => {
    const run = await runCli(['meetings', 'create', ...MEETING_FLAGS, '--dry-run']);
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    const printed = JSON.parse(run.stdout) as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    };
    expect(printed.method).toBe('POST');
    expect(printed.url).toBe('https://api.gong.io/v2/meetings');
    expect(printed.headers.authorization).toBe('Basic ***');
    expect(printed.body).toEqual({
      startTime: '2026-07-10T10:00:00Z',
      endTime: '2026-07-10T11:00:00Z',
      invitees: [{ email: 'jon.snow@acme.com', displayName: 'Jon Snow' }],
      organizerEmail: 'host@acme.com',
    });
  });
});

describe('gong meetings update', () => {
  it('builds PUT /v2/meetings/{meetingId} passing the int64 id through as a string', async () => {
    const run = await runCli(['meetings', 'update', BIG_MEETING_ID, ...MEETING_FLAGS], {
      responses: [{ body: { requestId: 'r', meetingId: BIG_MEETING_ID } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('PUT');
    expect(run.requests[0]?.url).toBe(`https://api.gong.io/v2/meetings/${BIG_MEETING_ID}`);
    expect(run.requests[0]?.body).toEqual({
      startTime: '2026-07-10T10:00:00Z',
      endTime: '2026-07-10T11:00:00Z',
      invitees: [{ email: 'jon.snow@acme.com', displayName: 'Jon Snow' }],
      organizerEmail: 'host@acme.com',
    });
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'r', meetingId: BIG_MEETING_ID });
  });

  it('maps 404 (no meeting for that ID) to exit code 4', async () => {
    const run = await runCli(['meetings', 'update', '123', ...MEETING_FLAGS], {
      responses: [
        { status: 404, body: { requestId: 'r', errors: ['No meeting found'] } },
      ],
    });
    expect(run.exitCode).toBe(4);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(404);
  });
});

describe('gong meetings delete', () => {
  it('refuses without --yes when stdin is not a TTY (exit 2, no request)', async () => {
    const run = await runCli(['meetings', 'delete', '123', '--organizer-email', 'host@acme.com']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--yes');
  });

  it('with --yes sends DELETE with the JSON body the API requires', async () => {
    const run = await runCli(
      ['meetings', 'delete', BIG_MEETING_ID, '--organizer-email', 'host@acme.com', '--yes'],
      { responses: [{ body: { organizerEmail: 'host@acme.com' } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.prompts).toHaveLength(0);
    expect(run.requests[0]?.method).toBe('DELETE');
    expect(run.requests[0]?.url).toBe(`https://api.gong.io/v2/meetings/${BIG_MEETING_ID}`);
    expect(run.requests[0]?.body).toEqual({ organizerEmail: 'host@acme.com' });
    expect(run.requests[0]?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(run.stdout)).toEqual({ organizerEmail: 'host@acme.com' });
  });

  it('prompts on a TTY and proceeds on yes', async () => {
    const run = await runCli(
      ['meetings', 'delete', '123', '--organizer-email', 'host@acme.com'],
      {
        stdinTTY: true,
        promptAnswers: ['y'],
        responses: [{ body: { organizerEmail: 'host@acme.com' } }],
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.prompts).toHaveLength(1);
    expect(run.prompts[0]).toContain('Delete Gong meeting 123.');
    expect(run.requests).toHaveLength(1);
  });

  it('aborts on a TTY when the prompt is declined', async () => {
    const run = await runCli(['meetings', 'delete', '123'], {
      stdinTTY: true,
      promptAnswers: ['n'],
    });
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('Aborted');
  });
});

describe('gong meetings integration-status', () => {
  it('builds the emails body from CSV and emits the users list', async () => {
    const users = [
      {
        email: 'rep@acme.com',
        exists: true,
        valid: false,
        userFacingError: 'The Gong consent page is not enabled in your company.',
      },
      { email: 'ae@acme.com', exists: true, valid: true },
    ];
    const run = await runCli(
      ['meetings', 'integration-status', '--emails', 'rep@acme.com, ae@acme.com'],
      { responses: [{ body: { requestId: 'r', users } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/meetings/integration/status');
    expect(run.requests[0]?.body).toEqual({ emails: ['rep@acme.com', 'ae@acme.com'] });
    expect(JSON.parse(run.stdout)).toEqual(users);
  });
});

const TASK_FILTER_FLAGS = [
  '--user-id',
  '234599484848423',
  '--types',
  'MANUAL,FLOW',
  '--task-action',
  'CALL',
  '--status',
  'OPEN',
];

describe('gong tasks list', () => {
  it('builds POST /v2/tasks with the full required filter and auth', async () => {
    const run = await runCli(
      ['tasks', 'list', ...TASK_FILTER_FLAGS, '--workspace-id', '623457276584334'],
      {
        responses: [
          {
            body: {
              requestId: 'r',
              crmType: 'SALESFORCE',
              tasks: [
                {
                  id: 1234361284629351,
                  status: 'OPEN',
                  type: 'MANUAL',
                  dueDate: '2026-07-06T10:00:00Z',
                  title: 'Call Jon',
                },
              ],
            },
          },
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/tasks');
    expect(run.requests[0]?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(run.requests[0]?.body).toEqual({
      filter: {
        userId: '234599484848423',
        workspaceId: '623457276584334',
        types: ['MANUAL', 'FLOW'],
        taskAction: ['CALL'],
        status: ['OPEN'],
      },
    });
    expect(JSON.parse(run.stdout)).toEqual([
      {
        id: 1234361284629351,
        status: 'OPEN',
        type: 'MANUAL',
        dueDate: '2026-07-06T10:00:00Z',
        title: 'Call Jon',
      },
    ]);
  });

  it('requires all four filter fields with a usage error before any request', async () => {
    const run = await runCli(['tasks', 'list', '--user-id', 'u1']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('filter.types');
    expect(run.stderr).toContain('filter.taskAction');
    expect(run.stderr).toContain('filter.status');
  });

  it('merges typed flags over --body, arrays replaced wholesale', async () => {
    const run = await runCli(
      [
        'tasks',
        'list',
        '--body',
        '{"filter":{"userId":"u1","types":["FLOW"],"taskAction":["CALL"],"status":["OPEN"],"workspaceId":"w1"}}',
        '--status',
        'DONE,DISMISSED',
      ],
      { responses: [{ body: { requestId: 'r', tasks: [] } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual({
      filter: {
        userId: 'u1',
        types: ['FLOW'],
        taskAction: ['CALL'],
        status: ['DONE', 'DISMISSED'],
        workspaceId: 'w1',
      },
    });
  });

  it('has no pagination flags (POST /v2/tasks is unpaginated)', async () => {
    const run = await runCli(['tasks', 'list', ...TASK_FILTER_FLAGS, '--all']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain("unknown option '--all'");
  });

  it('maps 404 to an empty list with exit 0 and a stderr note', async () => {
    const run = await runCli(['tasks', 'list', ...TASK_FILTER_FLAGS], {
      responses: [{ status: 404, body: { requestId: 'r', errors: ['No tasks found'] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    expect(run.stderr).toContain('No tasks found');
  });

  it('renders the curated table columns by default on a TTY', async () => {
    const run = await runCli(['tasks', 'list', ...TASK_FILTER_FLAGS], {
      stdoutTTY: true,
      responses: [
        {
          body: {
            requestId: 'r',
            tasks: [{ id: 1, status: 'OPEN', type: 'MANUAL', dueDate: 'd', title: 'Call Jon' }],
          },
        },
      ],
    });
    expect(run.stdout.split('\n')[0]).toMatch(/^id\s+status\s+type\s+dueDate\s+title$/);
    expect(run.stdout).toContain('Call Jon');
  });
});

describe('gong tasks update', () => {
  it('builds PATCH /v2/tasks/{taskId} and unwraps the tasks array', async () => {
    const run = await runCli(
      [
        'tasks',
        'update',
        '1234361284629351',
        '--user-id',
        '234599484848423',
        '--status',
        'DONE',
        '--due-date',
        '2026-07-10',
        '--priority',
        'MEDIUM',
      ],
      {
        responses: [
          {
            body: {
              requestId: 'r',
              crmType: 'SALESFORCE',
              tasks: [{ id: 1234361284629351, status: 'DONE' }],
            },
          },
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('PATCH');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/tasks/1234361284629351');
    expect(run.requests[0]?.body).toEqual({
      userId: '234599484848423',
      status: 'DONE',
      dueDate: '2026-07-10T00:00:00Z',
      priority: 'MEDIUM',
    });
    expect(JSON.parse(run.stdout)).toEqual([{ id: 1234361284629351, status: 'DONE' }]);
  });

  it('requires userId with a usage error before any request', async () => {
    const run = await runCli(['tasks', 'update', '1', '--status', 'DONE']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('userId');
  });
});

const ASK_FLAGS = [
  '--workspace-id',
  '1237998047883638784',
  '--crm-entity-type',
  'ACCOUNT',
  '--crm-entity-id',
  '125260001VdfoWBAR',
  '--time-period',
  'CUSTOM_RANGE',
  '--from',
  '2026-01-01',
  '--to',
  '2026-06-30T23:59:59Z',
  '--question',
  'What was the last activity?',
];

describe('gong entities ask', () => {
  it('builds GET /v2/entities/ask-entity with every query param and auth', async () => {
    const answer = {
      requestId: 'r',
      numOfCallsSearched: 25,
      numOfEmailsSearched: 252,
      answer: [{ answerItems: ['Acme has questions about compliance.'] }],
    };
    const run = await runCli(['entities', 'ask', ...ASK_FLAGS], {
      responses: [{ body: answer }],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/entities/ask-entity');
    expect(url.searchParams.get('workspaceId')).toBe('1237998047883638784');
    expect(url.searchParams.get('crmEntityType')).toBe('ACCOUNT');
    expect(url.searchParams.get('crmEntityId')).toBe('125260001VdfoWBAR');
    expect(url.searchParams.get('timePeriod')).toBe('CUSTOM_RANGE');
    expect(url.searchParams.get('fromDateTime')).toBe('2026-01-01T00:00:00Z');
    expect(url.searchParams.get('toDateTime')).toBe('2026-06-30T23:59:59Z');
    expect(url.searchParams.get('question')).toBe('What was the last activity?');
    expect(JSON.parse(run.stdout)).toEqual(answer);
  });

  it('lists every missing required flag in one usage error', async () => {
    const run = await runCli(['entities', 'ask', '--question', 'hi']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--workspace-id');
    expect(run.stderr).toContain('--crm-entity-type');
    expect(run.stderr).toContain('--crm-entity-id');
    expect(run.stderr).toContain('--time-period');
  });

  it('maps 402 (Gong credits exhausted) to exit code 1', async () => {
    const run = await runCli(['entities', 'ask', ...ASK_FLAGS], {
      responses: [
        { status: 402, body: { requestId: 'r', errors: ['Insufficient Gong credits'] } },
      ],
    });
    expect(run.exitCode).toBe(1);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(402);
    expect(parsed.errors).toEqual(['Insufficient Gong credits']);
  });
});

describe('gong entities brief', () => {
  it('builds GET /v2/entities/get-brief; omitted dates stay out of the query', async () => {
    const brief = {
      requestId: 'r',
      numOfCallsSearched: 7,
      numOfEmailsSearched: 102,
      briefSections: [
        { title: 'Customer overview', sectionSummary: ['Acme…'], briefSectionType: 'Conversations' },
      ],
    };
    const run = await runCli(
      [
        'entities',
        'brief',
        '--workspace-id',
        '1237998047883638784',
        '--brief-name',
        'Account overview',
        '--crm-entity-type',
        'DEAL',
        '--crm-entity-id',
        '125260001VdfoWBAR',
        '--time-period',
        'LAST_30DAYS',
      ],
      { responses: [{ body: brief }] },
    );
    expect(run.exitCode).toBe(0);
    const url = new URL(run.requests[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/entities/get-brief');
    expect(url.searchParams.get('briefName')).toBe('Account overview');
    expect(url.searchParams.get('crmEntityType')).toBe('DEAL');
    expect(url.searchParams.get('timePeriod')).toBe('LAST_30DAYS');
    expect(url.searchParams.get('fromDateTime')).toBeNull();
    expect(url.searchParams.get('toDateTime')).toBeNull();
    expect(JSON.parse(run.stdout)).toEqual(brief);
  });

  it('requires --from when --time-period is CUSTOM_RANGE', async () => {
    const run = await runCli([
      'entities',
      'brief',
      '--workspace-id',
      'w1',
      '--brief-name',
      'B',
      '--crm-entity-type',
      'ACCOUNT',
      '--crm-entity-id',
      'c1',
      '--time-period',
      'CUSTOM_RANGE',
    ]);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('CUSTOM_RANGE');
  });
});
