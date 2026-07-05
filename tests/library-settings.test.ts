import { describe, expect, it } from 'vitest';

import { parseJsonLines, runCli, TEST_AUTH_HEADER } from './helpers.js';

const FOLDERS = [
  { id: '1', name: 'Root', parentFolderId: null, createdBy: 'u1', updated: '2026-03-14T05:30:00Z' },
  { id: '2', name: 'Child', parentFolderId: '1', createdBy: 'u1', updated: '2026-03-15T05:30:00Z' },
];

describe('gong library folders', () => {
  it('builds GET /v2/library/folders with workspaceId, auth, and unwraps folders', async () => {
    const run = await runCli(['library', 'folders', '--workspace-id', 'w1'], {
      responses: [{ body: { requestId: 'r', folders: FOLDERS } }],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/library/folders');
    expect(url.searchParams.get('workspaceId')).toBe('w1');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(JSON.parse(run.stdout)).toEqual(FOLDERS);
  });

  it('omits workspaceId from the query when the flag is not passed', async () => {
    const run = await runCli(['library', 'folders'], {
      responses: [{ body: { requestId: 'r', folders: [] } }],
    });
    expect(run.exitCode).toBe(0);
    const url = new URL(run.requests[0]?.url ?? '');
    expect(url.searchParams.has('workspaceId')).toBe(false);
    expect(url.search).toBe('');
  });

  it('maps 404 "no folders found" to an empty list with exit 0', async () => {
    const run = await runCli(['library', 'folders'], {
      responses: [
        {
          status: 404,
          body: { requestId: 'r', errors: ['No folders found for the specified period'] },
        },
      ],
    });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    expect(run.stderr).toContain('No folders found for the specified period');
  });

  it('renders a table with curated columns by default on a TTY', async () => {
    const run = await runCli(['library', 'folders'], {
      responses: [{ body: { requestId: 'r', folders: FOLDERS } }],
      stdoutTTY: true,
    });
    expect(run.stdout.split('\n')[0]).toMatch(/^id\s+name\s+parentFolderId\s+updated$/);
    expect(run.stdout).toContain('Child');
  });

  it('fetches a single page even if the API ever returned a cursor (no pagination flags)', async () => {
    const run = await runCli(['library', 'folders'], {
      responses: [
        { body: { requestId: 'r', records: { totalRecords: 5, cursor: 'C1' }, folders: FOLDERS } },
      ],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(1);
    const meta = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(meta.gongCliMeta).toBe(true);
    expect(meta.nextCursor).toBe('C1');
  });

  it('rejects --all: this endpoint has no pagination', async () => {
    const run = await runCli(['library', 'folders', '--all']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain("unknown option '--all'");
  });
});

describe('gong library folder-calls', () => {
  const FOLDER_CONTENT = {
    requestId: 'r',
    id: '3843152912968920037',
    name: 'Sales Onboarding',
    createdBy: '234599484848423',
    updated: '2026-03-14T05:30:00Z',
    calls: [
      {
        id: '7782342274025937895',
        title: 'Example call',
        note: 'sample note',
        addedBy: '234599484848423',
        created: '2026-01-12T14:30:00Z',
        snippet: { fromSec: 21, toSec: 132 },
      },
    ],
  };

  it('builds GET /v2/library/folder-content with folderId and unwraps the calls array', async () => {
    const run = await runCli(
      ['library', 'folder-calls', '--folder-id', '3843152912968920037'],
      { responses: [{ body: FOLDER_CONTENT }] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/library/folder-content');
    expect(url.searchParams.get('folderId')).toBe('3843152912968920037');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(JSON.parse(run.stdout)).toEqual(FOLDER_CONTENT.calls);
  });

  it("keeps the whole envelope (folder metadata at top level) reachable via -o raw", async () => {
    const run = await runCli(
      ['library', 'folder-calls', '--folder-id', '3843152912968920037', '-o', 'raw'],
      { responses: [{ body: FOLDER_CONTENT }] },
    );
    expect(run.exitCode).toBe(0);
    const envelope = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(envelope.name).toBe('Sales Onboarding');
    expect(envelope.calls).toHaveLength(1);
  });

  it('allows omitting --folder-id (the spec marks folderId optional)', async () => {
    const run = await runCli(['library', 'folder-calls'], {
      responses: [{ body: { requestId: 'r', calls: [] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(new URL(run.requests[0]?.url ?? '').search).toBe('');
  });
});

describe('gong settings scorecards', () => {
  it('builds GET /v2/settings/scorecards and preserves int64 IDs losslessly', async () => {
    const run = await runCli(['settings', 'scorecards'], {
      responses: [
        {
          // Raw string body: scorecardId exceeds Number.MAX_SAFE_INTEGER on purpose.
          body:
            '{"requestId":"r","scorecards":[{"scorecardId":6843152929075440037,' +
            '"scorecardName":"SDR Call Scorecard","workspaceId":623457276584334,' +
            '"enabled":true,"reviewMethod":"MANUAL",' +
            '"questions":[{"questionId":43955224753211112,"questionType":"RANGE"}]}]}',
        },
      ],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('GET');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/settings/scorecards');
    expect(run.requests[0]?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(run.stdout).toContain('6843152929075440037');
    expect(run.stdout).toContain('43955224753211112');
    expect(run.stdout).toContain('SDR Call Scorecard');
  });

  it('rejects --body: this operation takes no request body', async () => {
    const run = await runCli(['settings', 'scorecards', '--body', '{}']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain("unknown option '--body'");
  });
});

describe('gong settings trackers', () => {
  it('builds GET /v2/settings/trackers with workspaceId and unwraps keywordTrackers', async () => {
    const trackers = [
      {
        trackerId: '6840000929075400007',
        trackerName: 'Competitors',
        workspaceId: '623457276584334',
        affiliation: 'NonCompany',
        languageKeywords: [{ language: 'mul', keywords: ['acme'], includeRelatedForms: true }],
      },
    ];
    const run = await runCli(['settings', 'trackers', '--workspace-id', '623457276584334'], {
      responses: [{ body: { requestId: 'r', keywordTrackers: trackers } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('GET');
    const url = new URL(run.requests[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/settings/trackers');
    expect(url.searchParams.get('workspaceId')).toBe('623457276584334');
    expect(run.requests[0]?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(JSON.parse(run.stdout)).toEqual(trackers);
  });
});

describe('gong settings briefs', () => {
  it('builds GET /v2/settings/briefs with workspaceId and unwraps briefs', async () => {
    const briefs = [
      {
        briefId: 'b1',
        briefName: 'Deal risk',
        workspaceId: '623457276584334',
        status: 'Published',
        creator: 'Jane Doe',
      },
    ];
    const run = await runCli(
      ['settings', 'briefs', '--workspace-id', '623457276584334', '-o', 'jsonl'],
      { responses: [{ body: { requestId: 'r', briefs } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('GET');
    const url = new URL(run.requests[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/settings/briefs');
    expect(url.searchParams.get('workspaceId')).toBe('623457276584334');
    expect(run.requests[0]?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(parseJsonLines(run.stdout)).toEqual(briefs);
  });

  it('maps 404 "workspace not found" to an empty list with exit 0', async () => {
    const run = await runCli(['settings', 'briefs', '--workspace-id', 'nope'], {
      responses: [{ status: 404, body: { requestId: 'r', errors: ['Workspace not found'] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    expect(run.stderr).toContain('Workspace not found');
  });

  it('marks the endpoint as BETA in --help', async () => {
    const run = await runCli(['settings', 'briefs', '--help']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('BETA');
    expect(run.stdout).toContain('maps to workspaceId');
  });
});

describe('gong workspaces list', () => {
  const WORKSPACES = [
    { id: '623457276584334', name: 'Some Workspace', description: 'This is one of our workspaces' },
  ];

  it('builds GET /v2/workspaces with auth and unwraps workspaces', async () => {
    const run = await runCli(['workspaces', 'list'], {
      responses: [{ body: { requestId: 'r', workspaces: WORKSPACES } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('GET');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/workspaces');
    expect(run.requests[0]?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(JSON.parse(run.stdout)).toEqual(WORKSPACES);
  });

  it('maps 403 access denied to exit code 3 with machine diagnostics', async () => {
    const run = await runCli(['workspaces', 'list'], {
      responses: [{ status: 403, body: { requestId: 'r-403', errors: ['Access denied'] } }],
    });
    expect(run.exitCode).toBe(3);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.error).toBe(true);
    expect(parsed.httpStatus).toBe(403);
    expect(parsed.requestId).toBe('r-403');
    expect(parsed.exitCode).toBe(3);
  });
});

describe('gong outcomes list', () => {
  const OUTCOMES = [
    {
      callOutcome: 'Connected',
      displayOrder: 1,
      connectStatus: 'CONNECTED',
      sentiment: 'POSITIVE',
      category: 'ANSWERED',
    },
    {
      callOutcome: 'No Answer',
      displayOrder: 2,
      connectStatus: 'NOT_CONNECTED',
      sentiment: 'NEUTRAL',
      category: 'NOT_ANSWERED',
    },
  ];

  it('builds GET /v2/call-outcomes with auth and unwraps outcomes', async () => {
    const run = await runCli(['outcomes', 'list', '-o', 'jsonl'], {
      responses: [{ body: { requestId: 'r', outcomes: OUTCOMES } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('GET');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/call-outcomes');
    expect(run.requests[0]?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(parseJsonLines(run.stdout)).toEqual(OUTCOMES);
  });

  it('--dry-run prints the would-be request and makes no HTTP call', async () => {
    const run = await runCli(['outcomes', 'list', '--dry-run']);
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    const printed = JSON.parse(run.stdout) as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: unknown;
    };
    expect(printed.method).toBe('GET');
    expect(printed.url).toBe('https://api.gong.io/v2/call-outcomes');
    expect(printed.headers.authorization).toBe('Basic ***');
    expect(printed.body).toBeNull();
  });
});
