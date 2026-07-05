import { describe, expect, it } from 'vitest';

import { runCli, TEST_AUTH_HEADER } from './helpers.js';

const PROFILES = [
  {
    id: '3843152912968920037',
    name: 'Managers',
    description: 'Team managers',
    scoreCalls: true,
    callsAccess: { permissionLevel: 'managers-team', teamLeadIds: ['295738305212375930'] },
  },
  { id: '3843152912968920038', name: 'Reps', description: 'Sales reps', scoreCalls: false },
];

describe('gong permissions profiles list', () => {
  it('builds GET /v2/all-permission-profiles with workspaceId and auth, unwraps profiles', async () => {
    const run = await runCli(['permissions', 'profiles', 'list', '--workspace-id', 'w1'], {
      responses: [{ body: { requestId: 'r', profiles: PROFILES } }],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/all-permission-profiles');
    expect(url.searchParams.get('workspaceId')).toBe('w1');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(request?.bodyText).toBeUndefined();
    expect(JSON.parse(run.stdout)).toEqual(PROFILES);
  });

  it('requires --workspace-id with a usage error before any request', async () => {
    const run = await runCli(['permissions', 'profiles', 'list']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--workspace-id');
  });

  it('renders a table with curated columns by default on a TTY', async () => {
    const run = await runCli(['permissions', 'profiles', 'list', '--workspace-id', 'w1'], {
      responses: [{ body: { requestId: 'r', profiles: PROFILES } }],
      stdoutTTY: true,
    });
    expect(run.stdout.split('\n')[0]).toMatch(/^id\s+name\s+description$/);
    expect(run.stdout).toContain('Managers');
  });

  it('maps 404 to an empty result with exit 0', async () => {
    const run = await runCli(['permissions', 'profiles', 'list', '--workspace-id', 'w1'], {
      responses: [{ status: 404, body: { requestId: 'r', errors: ['No profiles found'] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    expect(run.stderr).toContain('No profiles found');
  });
});

describe('gong permissions profiles get', () => {
  it('builds GET /v2/permission-profile?profileId=… and unwraps the profile', async () => {
    const run = await runCli(['permissions', 'profiles', 'get', '3843152912968920037'], {
      responses: [{ body: { requestId: 'r', profile: PROFILES[0] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('GET');
    const url = new URL(run.requests[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/permission-profile');
    expect(url.searchParams.get('profileId')).toBe('3843152912968920037');
    expect(JSON.parse(run.stdout)).toEqual(PROFILES[0]);
  });

  it('maps 404 to exit code 4', async () => {
    const run = await runCli(['permissions', 'profiles', 'get', 'missing'], {
      responses: [{ status: 404, body: { requestId: 'r', errors: ['Profile not found'] } }],
    });
    expect(run.exitCode).toBe(4);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(404);
    expect(parsed.requestId).toBe('r');
  });
});

describe('gong permissions profiles create', () => {
  it('assembles the profile DTO from flags (scalars, booleans, JSON access scopes)', async () => {
    const run = await runCli(
      [
        'permissions',
        'profiles',
        'create',
        '--workspace-id',
        'w1',
        '--name',
        'Sales reps',
        '--description',
        'EMEA',
        '--score-calls',
        'true',
        '--deals-data-export',
        'false',
        '--export-calls-and-coaching-data-to-csv',
        'true',
        '--calls-access',
        '{"permissionLevel":"managers-team","teamLeadIds":["295738305212375930"]}',
        '--forecast-permissions',
        '{"forecastAccess":{"permissionLevel":"own"}}',
        '--library-folder-access',
        '{"permissionLevel":"specific-folders","libraryFolderIds":["384"]}',
      ],
      { responses: [{ body: { requestId: 'r', profile: { id: '999', name: 'Sales reps' } } }] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('POST');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/permission-profile');
    expect(url.searchParams.get('workspaceId')).toBe('w1');
    expect(request?.body).toEqual({
      name: 'Sales reps',
      description: 'EMEA',
      scoreCalls: true,
      dealsDataExport: false,
      exportCallsAndCoachingDataToCSV: true,
      callsAccess: { permissionLevel: 'managers-team', teamLeadIds: ['295738305212375930'] },
      forecastPermissions: { forecastAccess: { permissionLevel: 'own' } },
      libraryFolderAccess: { permissionLevel: 'specific-folders', libraryFolderIds: ['384'] },
    });
    expect(JSON.parse(run.stdout)).toEqual({ id: '999', name: 'Sales reps' });
  });

  it('requires at least one profile field before any request', async () => {
    const run = await runCli(['permissions', 'profiles', 'create', '--workspace-id', 'w1']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('requires profile fields');
  });

  it('rejects capability flag values other than true/false', async () => {
    const run = await runCli(
      ['permissions', 'profiles', 'create', '--workspace-id', 'w1', '--score-calls', 'yes'],
    );
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--score-calls');
  });
});

describe('gong permissions profiles update', () => {
  it('merges typed flags over --body and targets profileId as a query param', async () => {
    const run = await runCli(
      [
        'permissions',
        'profiles',
        'update',
        'p1',
        '--body',
        '{"name":"Old","description":"Keep me","scoreCalls":false,"libraryFolderAccess":{"permissionLevel":"all"}}',
        '--name',
        'New',
        '--score-calls',
        'true',
      ],
      { responses: [{ body: { requestId: 'r', profile: { id: 'p1', name: 'New' } } }] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('PUT');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/permission-profile');
    expect(url.searchParams.get('profileId')).toBe('p1');
    expect(request?.body).toEqual({
      name: 'New',
      description: 'Keep me',
      scoreCalls: true,
      libraryFolderAccess: { permissionLevel: 'all' },
    });
    expect(JSON.parse(run.stdout)).toEqual({ id: 'p1', name: 'New' });
  });

  it('requires fields to update before any request', async () => {
    const run = await runCli(['permissions', 'profiles', 'update', 'p1']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('requires fields to update');
  });
});

describe('gong permissions profiles users', () => {
  it('builds GET /v2/permission-profile/users?profileId=… and emits the users list', async () => {
    const users = [
      { id: '234599484848423', fullName: 'Jon', emailAddress: 'test@test.com' },
      { id: '234599484848424', fullName: 'Ana', emailAddress: 'ana@test.com' },
    ];
    const run = await runCli(['permissions', 'profiles', 'users', 'p1'], {
      responses: [{ body: { requestId: 'r', users } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('GET');
    const url = new URL(run.requests[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/permission-profile/users');
    expect(url.searchParams.get('profileId')).toBe('p1');
    expect(JSON.parse(run.stdout)).toEqual(users);
  });
});

describe('gong permissions call-access get', () => {
  it('reads via POST with filter.callIds from --call-ids (deduplicated CSV)', async () => {
    const accessList = [
      { callId: '7782342274025937895', users: [{ userId: '234599484848423' }] },
    ];
    const run = await runCli(
      ['permissions', 'call-access', 'get', '--call-ids', 'a,b,a'],
      { responses: [{ body: { requestId: 'r', callAccessList: accessList } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/calls/users-access');
    expect(run.requests[0]?.body).toEqual({ filter: { callIds: ['a', 'b'] } });
    expect(JSON.parse(run.stdout)).toEqual(accessList);
  });

  it('accepts the filter via --body', async () => {
    const run = await runCli(
      [
        'permissions',
        'call-access',
        'get',
        '--body',
        '{"filter":{"callIds":["7782342274025937895"]}}',
      ],
      { responses: [{ body: { requestId: 'r', callAccessList: [] } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual({ filter: { callIds: ['7782342274025937895'] } });
  });

  it('requires call IDs before any request', async () => {
    const run = await runCli(['permissions', 'call-access', 'get']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('requires call IDs');
  });
});

describe('gong permissions call-access grant', () => {
  it('builds PUT with callAccessList from --call-id/--user-ids (deduplicated CSV)', async () => {
    const run = await runCli(
      [
        'permissions',
        'call-access',
        'grant',
        '--call-id',
        '7782342274025937895',
        '--user-ids',
        'u1,u2,u1',
      ],
      { responses: [{ body: { requestId: 'r' } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('PUT');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/calls/users-access');
    expect(run.requests[0]?.body).toEqual({
      callAccessList: [{ callId: '7782342274025937895', userIds: ['u1', 'u2'] }],
    });
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'r' });
  });

  it('accepts a multi-call list via --access', async () => {
    const run = await runCli(
      [
        'permissions',
        'call-access',
        'grant',
        '--access',
        '[{"callId":"c1","userIds":["u1"]},{"callId":"c2","userIds":["u2"]}]',
      ],
      { responses: [{ body: { requestId: 'r' } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual({
      callAccessList: [
        { callId: 'c1', userIds: ['u1'] },
        { callId: 'c2', userIds: ['u2'] },
      ],
    });
  });

  it('requires --call-id and --user-ids together', async () => {
    const run = await runCli(['permissions', 'call-access', 'grant', '--call-id', 'c1']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--call-id and --user-ids');
  });

  it('rejects --access combined with --call-id', async () => {
    const run = await runCli(
      [
        'permissions',
        'call-access',
        'grant',
        '--access',
        '[{"callId":"c1","userIds":["u1"]}]',
        '--call-id',
        'c1',
      ],
    );
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
  });

  it('requires a call access list before any request', async () => {
    const run = await runCli(['permissions', 'call-access', 'grant']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('requires a call access list');
  });
});

describe('gong permissions call-access revoke', () => {
  const REVOKE = [
    'permissions',
    'call-access',
    'revoke',
    '--call-id',
    '7782342274025937895',
    '--user-ids',
    '234599484848423',
  ];

  it('refuses without --yes when stdin is not a TTY', async () => {
    const run = await runCli(REVOKE);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.error).toBe(true);
    expect(parsed.message).toContain('Refusing without confirmation');
    expect(parsed.hint).toContain('--yes');
  });

  it('sends DELETE with a JSON body when confirmed with --yes', async () => {
    const run = await runCli([...REVOKE, '--yes'], {
      responses: [{ body: { requestId: 'r' } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('DELETE');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/calls/users-access');
    expect(run.requests[0]?.headers['content-type']).toBe('application/json');
    expect(run.requests[0]?.body).toEqual({
      callAccessList: [{ callId: '7782342274025937895', userIds: ['234599484848423'] }],
    });
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'r' });
  });

  it('prompts on a TTY and proceeds on y', async () => {
    const run = await runCli(REVOKE, {
      stdinTTY: true,
      promptAnswers: ['y'],
      responses: [{ body: { requestId: 'r' } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.prompts).toHaveLength(1);
    expect(run.prompts[0]).toContain('Revoke API-granted user access to 1 call.');
    expect(run.requests).toHaveLength(1);
  });

  it('--dry-run prints the request without confirmation or network', async () => {
    const run = await runCli([...REVOKE, '--dry-run']);
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    expect(run.prompts).toHaveLength(0);
    const printed = JSON.parse(run.stdout) as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: unknown;
    };
    expect(printed.method).toBe('DELETE');
    expect(printed.url).toBe('https://api.gong.io/v2/calls/users-access');
    expect(printed.headers.authorization).toBe('Basic ***');
    expect(printed.body).toEqual({
      callAccessList: [{ callId: '7782342274025937895', userIds: ['234599484848423'] }],
    });
  });
});
