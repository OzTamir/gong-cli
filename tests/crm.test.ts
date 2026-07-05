import { describe, expect, it } from 'vitest';

import { parseJsonLines, runCli, TEST_AUTH_HEADER } from './helpers.js';

// String bodies reach the fake fetch verbatim, so int64 IDs survive the mock intact.
const INTEGRATION_BODY =
  '{"requestId":"r","integrations":[{"integrationId":5517027188234205706,"ownerEmail":"joe.doe@acme.com","name":"ACME Sandbox"}]}';

describe('gong crm integrations get', () => {
  it('builds GET /v2/crm/integrations with auth and unwraps integrations losslessly', async () => {
    const run = await runCli(['crm', 'integrations', 'get'], {
      responses: [{ body: INTEGRATION_BODY }],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    expect(request?.url).toBe('https://api.gong.io/v2/crm/integrations');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(request?.bodyText).toBeUndefined();
    // int64 integrationId exceeds Number.MAX_SAFE_INTEGER; output must not corrupt it.
    expect(run.stdout).toContain('"integrationId": 5517027188234205706');
    expect(run.stdout).toContain('ACME Sandbox');
    expect(run.stdout.trimStart().startsWith('[')).toBe(true);
  });

  it('renders a table with curated columns on a TTY', async () => {
    const run = await runCli(['crm', 'integrations', 'get'], {
      responses: [{ body: INTEGRATION_BODY }],
      stdoutTTY: true,
    });
    expect(run.stdout.split('\n')[0]).toMatch(/^integrationId\s+name\s+ownerEmail$/);
    expect(run.stdout).toContain('5517027188234205706');
  });

  it('has no pagination flags (nothing in this lane paginates)', async () => {
    const run = await runCli(['crm', 'integrations', 'get', '--all']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--all');
  });
});

describe('gong crm integrations register', () => {
  it('builds the PUT body from flags and prints the envelope losslessly', async () => {
    const run = await runCli(
      ['crm', 'integrations', 'register', '--name', 'ACME Sandbox', '--owner-email', 'joe.doe@acme.com'],
      { responses: [{ body: '{"requestId":"r","integrationId":5517027188234205706}' }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('PUT');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/crm/integrations');
    expect(run.requests[0]?.body).toEqual({ name: 'ACME Sandbox', ownerEmail: 'joe.doe@acme.com' });
    expect(run.stdout).toContain('"integrationId": 5517027188234205706');
  });

  it('merges typed flags over --body', async () => {
    const run = await runCli(
      [
        'crm',
        'integrations',
        'register',
        '--body',
        '{"name":"Old Name","ownerEmail":"joe.doe@acme.com"}',
        '--name',
        'New Name',
      ],
      { responses: [{ body: { requestId: 'r', integrationId: 128 } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual({ name: 'New Name', ownerEmail: 'joe.doe@acme.com' });
  });

  it('requires name and ownerEmail before any request', async () => {
    const run = await runCli(['crm', 'integrations', 'register', '--name', 'Only Name']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('ownerEmail');
  });

  it('maps 409 (integration already exists) to exit 1 with machine diagnostics', async () => {
    const run = await runCli(
      ['crm', 'integrations', 'register', '--name', 'ACME', '--owner-email', 'joe.doe@acme.com'],
      {
        responses: [
          { status: 409, body: { requestId: 'r-409', errors: ['An active integration already exists'] } },
        ],
      },
    );
    expect(run.exitCode).toBe(1);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(409);
    expect(parsed.requestId).toBe('r-409');
    expect(parsed.errors).toEqual(['An active integration already exists']);
  });
});

describe('gong crm integrations delete', () => {
  const argv = [
    'crm',
    'integrations',
    'delete',
    '--integration-id',
    '6286478263646',
    '--client-request-id',
    'delete-1',
  ];

  it('sends DELETE with query params when confirmed via --yes', async () => {
    const run = await runCli([...argv, '--yes'], {
      responses: [{ status: 201, body: { requestId: 'r', clientRequestId: 'delete-1' } }],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('DELETE');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/crm/integrations');
    expect(url.searchParams.get('integrationId')).toBe('6286478263646');
    expect(url.searchParams.get('clientRequestId')).toBe('delete-1');
    expect(request?.bodyText).toBeUndefined();
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'r', clientRequestId: 'delete-1' });
  });

  it('refuses without --yes when stdin is not a TTY', async () => {
    const run = await runCli(argv);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.error).toBe(true);
    expect(parsed.exitCode).toBe(2);
    expect(String(parsed.hint)).toContain('--yes');
  });

  it('prompts on a TTY and proceeds on y', async () => {
    const run = await runCli(argv, {
      stdinTTY: true,
      promptAnswers: ['y'],
      responses: [{ status: 201, body: { requestId: 'r', clientRequestId: 'delete-1' } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.prompts[0]).toContain('Delete CRM integration 6286478263646');
    expect(run.requests).toHaveLength(1);
  });
});

describe('gong crm objects get', () => {
  it('sends the ids as the JSON body of a GET with query params', async () => {
    const run = await runCli(
      [
        'crm',
        'objects',
        'get',
        '--integration-id',
        '6286478263646',
        '--object-type',
        'DEAL',
        '--ids',
        '1234,8765',
      ],
      {
        responses: [
          {
            body: {
              requestId: 'r',
              crmObjectsMap: { '1234': { name: 'Deal one', stage: 'discovery' }, '8765': null },
            },
          },
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/crm/entities');
    expect(url.searchParams.get('integrationId')).toBe('6286478263646');
    expect(url.searchParams.get('objectType')).toBe('DEAL');
    expect(request?.body).toEqual(['1234', '8765']);
    expect(JSON.parse(run.stdout)).toEqual({
      '1234': { name: 'Deal one', stage: 'discovery' },
      '8765': null,
    });
  });

  it('accepts the canonical --objects-crm-ids alias', async () => {
    const run = await runCli(
      [
        'crm',
        'objects',
        'get',
        '--integration-id',
        '128',
        '--object-type',
        'ACCOUNT',
        '--objects-crm-ids',
        'a,b',
      ],
      { responses: [{ body: { requestId: 'r', crmObjectsMap: {} } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual(['a', 'b']);
  });

  it('requires --ids before any request', async () => {
    const run = await runCli(
      ['crm', 'objects', 'get', '--integration-id', '128', '--object-type', 'ACCOUNT'],
    );
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--ids');
  });
});

describe('gong crm objects upload', () => {
  const argv = [
    'crm',
    'objects',
    'upload',
    '--integration-id',
    '6286478263646',
    '--object-type',
    'ACCOUNT',
    '--client-request-id',
    'upload-42',
  ];

  it('uploads multipart LDJSON with the three required query params', async () => {
    const run = await runCli([...argv, '--data-file', '/tmp/accounts.ldjson'], {
      responses: [{ status: 201, body: { requestId: 'r', clientRequestId: 'upload-42' } }],
      blobs: { '/tmp/accounts.ldjson': new Blob([Buffer.from('{"objectId":"1"}\n')]) },
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('POST');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/crm/entities');
    expect(url.searchParams.get('integrationId')).toBe('6286478263646');
    expect(url.searchParams.get('objectType')).toBe('ACCOUNT');
    expect(url.searchParams.get('clientRequestId')).toBe('upload-42');
    expect(request?.multipart?.dataFile).toMatchObject({
      kind: 'file',
      filename: 'accounts.ldjson',
    });
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'r', clientRequestId: 'upload-42' });
  });

  it('--dry-run prints the request without touching the network or the file', async () => {
    const run = await runCli([...argv, '--data-file', '/tmp/missing.ldjson', '--dry-run']);
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    const printed = JSON.parse(run.stdout) as { method: string; url: string; body: unknown };
    expect(printed.method).toBe('POST');
    const url = new URL(printed.url);
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/crm/entities');
    expect(url.searchParams.get('clientRequestId')).toBe('upload-42');
    expect(printed.body).toEqual({ multipart: { dataFile: '@/tmp/missing.ldjson' } });
  });
});

describe('gong crm schema list', () => {
  it('unwraps the requested object type when --object-type is given', async () => {
    const run = await runCli(
      ['crm', 'schema', 'list', '--integration-id', '6286478263646', '--object-type', 'ACCOUNT'],
      {
        responses: [
          {
            body: {
              requestId: 'r',
              objectTypeToSelectedFields: {
                ACCOUNT: [
                  { uniqueName: 'category', label: 'Category', type: 'PICKLIST' },
                  { uniqueName: 'orderId', label: 'ID', type: 'ID' },
                ],
              },
            },
          },
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/crm/entity-schema');
    expect(url.searchParams.get('integrationId')).toBe('6286478263646');
    expect(url.searchParams.get('objectType')).toBe('ACCOUNT');
    expect(JSON.parse(run.stdout)).toEqual([
      { uniqueName: 'category', label: 'Category', type: 'PICKLIST' },
      { uniqueName: 'orderId', label: 'ID', type: 'ID' },
    ]);
  });

  it('flattens all object types with an objectType annotation when --object-type is omitted', async () => {
    const run = await runCli(
      ['crm', 'schema', 'list', '--integration-id', '128', '-o', 'jsonl'],
      {
        responses: [
          {
            body: {
              requestId: 'r',
              objectTypeToSelectedFields: {
                ACCOUNT: [{ uniqueName: 'category', label: 'Category', type: 'PICKLIST' }],
                DEAL: [{ uniqueName: 'orderId', label: 'ID', type: 'ID' }],
              },
            },
          },
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    const url = new URL(run.requests[0]?.url ?? '');
    expect(url.searchParams.get('integrationId')).toBe('128');
    expect(url.searchParams.has('objectType')).toBe(false);
    expect(parseJsonLines(run.stdout)).toEqual([
      { objectType: 'ACCOUNT', uniqueName: 'category', label: 'Category', type: 'PICKLIST' },
      { objectType: 'DEAL', uniqueName: 'orderId', label: 'ID', type: 'ID' },
    ]);
  });

  it('maps 404 to an empty list with exit 0', async () => {
    const run = await runCli(['crm', 'schema', 'list', '--integration-id', '128'], {
      responses: [{ status: 404, body: { requestId: 'r', errors: ['No schema found'] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    expect(run.stderr).toContain('No schema found');
  });
});

describe('gong crm schema upload', () => {
  const argv = ['crm', 'schema', 'upload', '--integration-id', '6286478263646', '--object-type', 'ACCOUNT'];
  const fields = [
    { uniqueName: 'orderId', label: 'ID', type: 'ID' },
    {
      uniqueName: 'category',
      label: 'Category',
      type: 'PICKLIST',
      orderedValueList: ['Analyst', 'Customer'],
    },
  ];

  it('POSTs the bare JSON array from --body with query params', async () => {
    const run = await runCli([...argv, '--body', JSON.stringify(fields)], {
      responses: [{ status: 201, body: { requestId: 'r' } }],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('POST');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/crm/entity-schema');
    expect(url.searchParams.get('integrationId')).toBe('6286478263646');
    expect(url.searchParams.get('objectType')).toBe('ACCOUNT');
    expect(request?.body).toEqual(fields);
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'r' });
  });

  it("reads the array from stdin via --body-file -", async () => {
    const run = await runCli([...argv, '--body-file', '-'], {
      stdinData: JSON.stringify(fields),
      responses: [{ status: 201, body: { requestId: 'r' } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual(fields);
  });

  it('rejects a non-array body before any request', async () => {
    const run = await runCli([...argv, '--body', '{"uniqueName":"orderId"}']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('JSON ARRAY');
  });

  it('requires a body before any request', async () => {
    const run = await runCli(argv);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--body');
  });
});

describe('gong crm request-status', () => {
  it('builds the query from the positional clientRequestId and --integration-id', async () => {
    const run = await runCli(['crm', 'request-status', 'upload-42', '--integration-id', '128'], {
      responses: [
        {
          body: {
            requestId: 'r',
            status: 'FAILED',
            errors: [{ line: 49, description: 'Mandatory field [objectId] is missing or empty' }],
            totalErrorCount: 3,
            totalSuccessCount: 97,
          },
        },
      ],
    });
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/crm/request-status');
    expect(url.searchParams.get('integrationId')).toBe('128');
    expect(url.searchParams.get('clientRequestId')).toBe('upload-42');
    expect(request?.bodyText).toBeUndefined();
    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'FAILED', totalErrorCount: 3 });
  });

  it('maps 404 to exit code 4', async () => {
    const run = await runCli(['crm', 'request-status', 'missing', '--integration-id', '128'], {
      responses: [{ status: 404, body: { requestId: 'r', errors: ['Request not found'] } }],
    });
    expect(run.exitCode).toBe(4);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(404);
    expect(parsed.requestId).toBe('r');
  });
});
