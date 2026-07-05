import { describe, expect, it } from 'vitest';

import { parseJsonLines, runCli, TEST_AUTH_HEADER } from './helpers.js';

function flowsPage(ids: string[], cursor?: string, total = ids.length) {
  return {
    body: {
      requestId: 'req-1',
      records: {
        totalRecords: total,
        currentPageSize: ids.length,
        currentPageNumber: 0,
        ...(cursor ? { cursor } : {}),
      },
      flows: ids.map((id) => ({
        id,
        name: `Flow ${id}`,
        folderId: 'fold-1',
        folderName: 'Outbound',
        visibility: 'Company',
        creationDate: '2026-01-01T00:00:00Z',
        exclusive: false,
      })),
    },
  };
}

describe('gong flows list', () => {
  it('builds GET /v2/flows with every query param and auth', async () => {
    const run = await runCli(
      [
        'flows',
        'list',
        '--flow-owner-email',
        'rep@example.com',
        '--workspace-id',
        'w1',
        '--folder-id',
        'fold-1',
        '--most-recently-assigned',
      ],
      { responses: [flowsPage(['1', '2'])] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/flows');
    expect(url.searchParams.get('flowOwnerEmail')).toBe('rep@example.com');
    expect(url.searchParams.get('workspaceId')).toBe('w1');
    expect(url.searchParams.get('folderId')).toBe('fold-1');
    expect(url.searchParams.get('mostRecentlyAssigned')).toBe('true');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    const parsed = JSON.parse(run.stdout) as Array<{ id: string }>;
    expect(parsed.map((flow) => flow.id)).toEqual(['1', '2']);
  });

  it('requires --flow-owner-email with a usage error before any request', async () => {
    const run = await runCli(['flows', 'list']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('flow-owner-email');
  });

  it('--all follows query cursors; --limit truncates across pages', async () => {
    const all = await runCli(
      ['flows', 'list', '--flow-owner-email', 'rep@example.com', '--all', '-o', 'jsonl'],
      { responses: [flowsPage(['1', '2'], 'C2', 3), flowsPage(['3'])] },
    );
    expect(all.exitCode).toBe(0);
    expect(parseJsonLines(all.stdout)).toHaveLength(3);
    expect(all.requests).toHaveLength(2);
    const secondUrl = new URL(all.requests[1]?.url ?? '');
    expect(secondUrl.searchParams.get('cursor')).toBe('C2');
    expect(secondUrl.searchParams.get('flowOwnerEmail')).toBe('rep@example.com');

    const limited = await runCli(
      ['flows', 'list', '--flow-owner-email', 'rep@example.com', '--limit', '1'],
      { responses: [flowsPage(['1', '2'], 'C2', 3)] },
    );
    expect(JSON.parse(limited.stdout)).toHaveLength(1);
    const meta = JSON.parse(limited.stderr.trim()) as Record<string, unknown>;
    expect(meta.gongCliMeta).toBe(true);
    expect(meta.nextCursor).toBe('C2');
  });

  it('maps 404 "no flows" to an empty result with exit 0', async () => {
    const run = await runCli(['flows', 'list', '--flow-owner-email', 'rep@example.com'], {
      responses: [{ status: 404, body: { requestId: 'r', errors: ['No flows found'] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    expect(run.stderr).toContain('No flows found');
  });

  it('renders the curated table by default on a TTY', async () => {
    const run = await runCli(['flows', 'list', '--flow-owner-email', 'rep@example.com'], {
      responses: [flowsPage(['1'])],
      stdoutTTY: true,
    });
    expect(run.stdout.split('\n')[0]).toMatch(
      /^id\s+name\s+visibility\s+folderName\s+creationDate$/,
    );
    expect(run.stdout).toContain('Flow 1');
  });
});

describe('gong flows folders', () => {
  it('builds GET /v2/flows/folders and unwraps the flows key (spec quirk)', async () => {
    const run = await runCli(
      [
        'flows',
        'folders',
        '--flow-folder-owner-email',
        'rep@example.com',
        '--parent-id',
        '1695493301223573465',
        '--workspace-id',
        'w1',
      ],
      { responses: [flowsPage(['fold-a'])] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.gong.io/v2/flows/folders');
    expect(url.searchParams.get('flowFolderOwnerEmail')).toBe('rep@example.com');
    expect(url.searchParams.get('parentId')).toBe('1695493301223573465');
    expect(url.searchParams.get('workspaceId')).toBe('w1');
    const parsed = JSON.parse(run.stdout) as Array<{ id: string }>;
    expect(parsed.map((record) => record.id)).toEqual(['fold-a']);
  });

  it('resumes from --cursor in the query string', async () => {
    const run = await runCli(
      ['flows', 'folders', '--flow-folder-owner-email', 'rep@example.com', '--cursor', 'ABC'],
      { responses: [flowsPage(['fold-a'])] },
    );
    expect(new URL(run.requests[0]?.url ?? '').searchParams.get('cursor')).toBe('ABC');
  });
});

describe('gong flows steps', () => {
  it('builds POST /v2/flows/steps with flowIds from --flow-ids', async () => {
    const run = await runCli(['flows', 'steps', '--flow-ids', 'a,b', '-o', 'jsonl'], {
      responses: [
        {
          body: {
            requestId: 'r',
            flows: [
              {
                id: 'a',
                name: 'Flow a',
                visibility: 'Company',
                steps: [{ id: 's1', stepOrder: 1, action: 'SEND_EMAIL', isReply: false }],
              },
              { id: 'b', name: 'Flow b', visibility: 'Shared', steps: [] },
            ],
          },
        },
      ],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/flows/steps');
    expect(run.requests[0]?.body).toEqual({ flowIds: ['a', 'b'] });
    const lines = parseJsonLines(run.stdout) as Array<{ id: string; steps: unknown[] }>;
    expect(lines.map((flow) => flow.id)).toEqual(['a', 'b']);
    expect(lines[0]?.steps).toHaveLength(1);
  });

  it('accepts flowIds via --body', async () => {
    const run = await runCli(['flows', 'steps', '--body', '{"flowIds":["x"]}'], {
      responses: [{ body: { requestId: 'r', flows: [] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual({ flowIds: ['x'] });
  });

  it('requires flow IDs with a usage error before any request', async () => {
    const run = await runCli(['flows', 'steps']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('flow IDs');
  });

  it('maps 404 "one or more flows not found" to exit code 4', async () => {
    const run = await runCli(['flows', 'steps', '--flow-ids', 'missing'], {
      responses: [
        { status: 404, body: { requestId: 'r', errors: ['One or more flows not found'] } },
      ],
    });
    expect(run.exitCode).toBe(4);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(404);
    expect(parsed.requestId).toBe('r');
  });
});

describe('gong flows prospects list', () => {
  const prospectsResponse = {
    body: {
      requestId: 'r',
      prospectsAssigned: [
        {
          flowId: 'f1',
          flowName: 'SDR Flow',
          crmProspectId: 'a5V1Q00A120DP4CVAW',
          flowInstanceId: 'i1',
          flowInstanceStatus: 'Running',
        },
      ],
    },
  };

  it('queries by CRM prospect IDs', async () => {
    const run = await runCli(
      ['flows', 'prospects', 'list', '--crm-prospects-ids', 'a5V1Q00A120DP4CVAW,crm2'],
      { responses: [prospectsResponse] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/flows/prospects');
    expect(run.requests[0]?.body).toEqual({
      crmProspectsIds: ['a5V1Q00A120DP4CVAW', 'crm2'],
    });
    const parsed = JSON.parse(run.stdout) as Array<{ flowInstanceId: string }>;
    expect(parsed[0]?.flowInstanceId).toBe('i1');
  });

  it('queries by flow instance IDs', async () => {
    const run = await runCli(
      ['flows', 'prospects', 'list', '--flow-instance-ids', 'i1,i2'],
      { responses: [prospectsResponse] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual({ flowInstanceIds: ['i1', 'i2'] });
  });

  it('requires one of the two ID modes before any request', async () => {
    const run = await runCli(['flows', 'prospects', 'list']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('CRM prospect IDs or flow instance IDs');
  });
});

describe('gong flows prospects assign', () => {
  const assignResponse = {
    body: {
      requestId: 'r',
      prospectsAssigned: [
        { flowId: 'f1', crmProspectId: 'crm1', flowInstanceId: 'i1', flowInstanceStatus: 'Pending' },
      ],
      prospectsNotAssigned: [
        { flowId: 'f1', crmProspectId: 'bad', errorCode: 'InvalidArgument', errorMessage: 'Invalid crmId <bad>' },
      ],
    },
  };

  it('assembles the full body from flags, including overrides', async () => {
    const run = await runCli(
      [
        'flows',
        'prospects',
        'assign',
        '--crm-prospects-ids',
        'crm1,crm2',
        '--flow-id',
        'f1',
        '--flow-instance-owner-email',
        'rep@example.com',
        '--steps',
        '[{"number":1,"subject":"Hello {{account_name}}"}]',
        '--flow-instance-variables',
        '[{"name":"recipient.first_name","value":"Mike"}]',
        '--cool-off-override',
        '--flow-instance-description',
        'Q3 push',
      ],
      { responses: [assignResponse] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/flows/prospects/assign');
    expect(run.requests[0]?.body).toEqual({
      crmProspectsIds: ['crm1', 'crm2'],
      flowId: 'f1',
      flowInstanceOwnerEmail: 'rep@example.com',
      overrides: {
        steps: [{ number: 1, subject: 'Hello {{account_name}}' }],
        flowInstanceVariables: [{ name: 'recipient.first_name', value: 'Mike' }],
        coolOffOverride: true,
      },
      flowInstanceDescription: 'Q3 push',
    });
    // Write op keeps the whole envelope so partial failures stay visible.
    expect(JSON.parse(run.stdout)).toMatchObject({
      requestId: 'r',
      prospectsNotAssigned: [{ crmProspectId: 'bad', errorCode: 'InvalidArgument' }],
    });
  });

  it('--legacy-cool-off-endpoint switches to the deprecated endpoint', async () => {
    const run = await runCli(
      [
        'flows',
        'prospects',
        'assign',
        '--crm-prospects-ids',
        'crm1',
        '--flow-id',
        'f1',
        '--flow-instance-owner-email',
        'rep@example.com',
        '--legacy-cool-off-endpoint',
      ],
      { responses: [assignResponse] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.url).toBe(
      'https://api.gong.io/v2/flows/prospects/assign/cool-off-override',
    );
    // The endpoint-selector flag never leaks into the request body.
    expect(run.requests[0]?.body).toEqual({
      crmProspectsIds: ['crm1'],
      flowId: 'f1',
      flowInstanceOwnerEmail: 'rep@example.com',
    });
  });

  it('merges typed flags over --body: arrays replace, objects merge recursively', async () => {
    const run = await runCli(
      [
        'flows',
        'prospects',
        'assign',
        '--body',
        '{"crmProspectsIds":["old"],"flowId":"f1","flowInstanceOwnerEmail":"rep@example.com","overrides":{"steps":[{"number":2}]}}',
        '--crm-prospects-ids',
        'new1,new2',
        '--cool-off-override',
      ],
      { responses: [assignResponse] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual({
      crmProspectsIds: ['new1', 'new2'],
      flowId: 'f1',
      flowInstanceOwnerEmail: 'rep@example.com',
      overrides: { steps: [{ number: 2 }], coolOffOverride: true },
    });
  });

  it('validates required fields before any request', async () => {
    const run = await runCli(['flows', 'prospects', 'assign', '--flow-id', 'f1']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('crmProspectsIds');
    expect(run.stderr).toContain('flowInstanceOwnerEmail');
  });

  it('--dry-run prints the merged request without sending it', async () => {
    const run = await runCli([
      'flows',
      'prospects',
      'assign',
      '--crm-prospects-ids',
      'crm1',
      '--flow-id',
      'f1',
      '--flow-instance-owner-email',
      'rep@example.com',
      '--dry-run',
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    const printed = JSON.parse(run.stdout) as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    };
    expect(printed.method).toBe('POST');
    expect(printed.url).toBe('https://api.gong.io/v2/flows/prospects/assign');
    expect(printed.headers.authorization).toBe('Basic ***');
    expect(printed.body).toEqual({
      crmProspectsIds: ['crm1'],
      flowId: 'f1',
      flowInstanceOwnerEmail: 'rep@example.com',
    });
  });
});

describe('gong flows prospects unassign', () => {
  const unassignResponse = {
    body: { requestId: 'r', unassignedFlowInstanceIds: ['i1', 'i2'] },
  };

  it('--crm-ids targets unassign-flows-by-crm-id with a single crmProspectId', async () => {
    const run = await runCli(
      [
        'flows',
        'prospects',
        'unassign',
        '--crm-ids',
        'a5V1Q00A120DP4CVAW',
        '--flow-id',
        'f1',
        '--unassigned-by-user-email',
        'manager@example.com',
      ],
      { responses: [unassignResponse] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe(
      'https://api.gong.io/v2/flows/prospects/unassign-flows-by-crm-id',
    );
    expect(run.requests[0]?.body).toEqual({
      crmProspectId: 'a5V1Q00A120DP4CVAW',
      flowId: 'f1',
      unassignedByUserEmail: 'manager@example.com',
    });
    expect(JSON.parse(run.stdout)).toEqual({
      requestId: 'r',
      unassignedFlowInstanceIds: ['i1', 'i2'],
    });
  });

  it('--instance-ids targets unassign-flows-by-instance-id with flowInstanceIds', async () => {
    const run = await runCli(
      ['flows', 'prospects', 'unassign', '--instance-ids', 'i1,i2'],
      { responses: [unassignResponse] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.url).toBe(
      'https://api.gong.io/v2/flows/prospects/unassign-flows-by-instance-id',
    );
    expect(run.requests[0]?.body).toEqual({ flowInstanceIds: ['i1', 'i2'] });
  });

  it('rejects both or neither ID mode with a usage error', async () => {
    const both = await runCli([
      'flows',
      'prospects',
      'unassign',
      '--crm-ids',
      'crm1',
      '--instance-ids',
      'i1',
    ]);
    expect(both.exitCode).toBe(2);
    expect(both.requests).toHaveLength(0);
    expect(both.stderr).toContain('exactly one of --crm-ids or --instance-ids');

    const neither = await runCli(['flows', 'prospects', 'unassign']);
    expect(neither.exitCode).toBe(2);
    expect(neither.requests).toHaveLength(0);
  });

  it('rejects multiple CRM IDs (the API takes one per request)', async () => {
    const run = await runCli(['flows', 'prospects', 'unassign', '--crm-ids', 'crm1,crm2']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('exactly one CRM prospect ID');
  });

  it('rejects --flow-id combined with --instance-ids', async () => {
    const run = await runCli([
      'flows',
      'prospects',
      'unassign',
      '--instance-ids',
      'i1',
      '--flow-id',
      'f1',
    ]);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('--flow-id applies only');
  });
});

describe('gong flows prospects bulk-assign', () => {
  it('submits the bulk assignment and returns the 202 envelope', async () => {
    const run = await runCli(
      [
        'flows',
        'prospects',
        'bulk-assign',
        '--flow-id',
        'f1',
        '--flow-instance-owner-email',
        'rep@example.com',
        '--prospects',
        '[{"firstName":"Jon","lastName":"Snow","email":"jon@example.com"}]',
      ],
      {
        responses: [
          {
            status: 202,
            body: {
              requestId: 'r',
              id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              status: 'PENDING',
              totalCount: 1,
              processedCount: 0,
              successCount: 0,
              failedCount: 0,
            },
          },
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('POST');
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/flows/prospects/bulk-assignments');
    expect(run.requests[0]?.body).toEqual({
      flowId: 'f1',
      flowInstanceOwnerEmail: 'rep@example.com',
      prospects: [{ firstName: 'Jon', lastName: 'Snow', email: 'jon@example.com' }],
    });
    expect(JSON.parse(run.stdout)).toMatchObject({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      status: 'PENDING',
    });
  });

  it('validates required fields before any request', async () => {
    const run = await runCli(['flows', 'prospects', 'bulk-assign', '--flow-id', 'f1']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('flowInstanceOwnerEmail');
    expect(run.stderr).toContain('prospects');
  });
});

describe('gong flows prospects bulk-assign-status', () => {
  it('builds the path from the ID and emits the status envelope', async () => {
    const run = await runCli(
      ['flows', 'prospects', 'bulk-assign-status', 'f47ac10b-58cc-4372-a567-0e02b2c3d479'],
      {
        responses: [
          {
            body: {
              requestId: 'r',
              id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              status: 'COMPLETED',
              totalCount: 1,
              processedCount: 1,
              successCount: 1,
              failedCount: 0,
              results: [
                {
                  prospect: { firstName: 'Jon', lastName: 'Snow' },
                  status: 'ASSIGNED',
                  crmId: 'crm1',
                  flowInstanceId: 'i1',
                },
              ],
            },
          },
        ],
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.method).toBe('GET');
    expect(run.requests[0]?.url).toBe(
      'https://api.gong.io/v2/flows/prospects/bulk-assignments/f47ac10b-58cc-4372-a567-0e02b2c3d479',
    );
    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'COMPLETED', successCount: 1 });
  });

  it('maps 404 to exit code 4', async () => {
    const run = await runCli(['flows', 'prospects', 'bulk-assign-status', 'missing'], {
      responses: [
        { status: 404, body: { requestId: 'r', errors: ['Bulk assignment not found'] } },
      ],
    });
    expect(run.exitCode).toBe(4);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(404);
    expect(parsed.requestId).toBe('r');
  });
});
