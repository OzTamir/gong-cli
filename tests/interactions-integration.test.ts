/**
 * Lane tests: gong interactions create, gong engagement content-viewed|content-shared|
 * custom-action, gong integration-settings set. All five operations are body-only,
 * single-shot writes (no query/path params, no pagination, none destructive).
 */
import { describe, expect, it } from 'vitest';

import { runCli, TEST_AUTH_HEADER } from './helpers.js';

describe('gong interactions create', () => {
  it('builds POST /v2/digital-interaction from flags with auth', async () => {
    const run = await runCli(
      [
        'interactions',
        'create',
        '--event-id', 'evt-42',
        '--timestamp', '2026-07-01',
        '--event-type', 'page viewed',
        '--source-system-name', 'Partnerly',
        '--session-id', 'sess-1',
        '--device', 'PC',
        '--content-id', 'c-1',
        '--content-title', 'Pricing page',
        '--content-label', 'pricing,web',
        '--content-url', 'https://acme.example/pricing',
        '--content-additional-info-url', 'https://partner.example/analysis',
        '--numeric-value', '8',
        '--range-from', '0',
        '--range-to', '10',
        '--numeric-type', 'NPS',
        '--step-value', 'step2',
        '--available-steps', 'step1,step2,step3',
        '--search-object-name', 'Gong',
        '--search-object-type', 'VENDOR',
        '--search-object-domain', 'gong.io',
        '--search-object-id', 'ent-1',
        '--search-object-url', 'https://partner.example/ent-1',
        '--content-custom-fields', '[{"name":"pages","value":"12","dataType":"NUMBER"}]',
        '--person-name', 'Jane Doe',
        '--person-email', 'jane@acme.com',
        '--person-phone-number', '+14155550100',
        '--person-id', 'p-1',
        '--person-object-type', 'CONTACT',
        '--person-object-id', '0031',
        '--person-system-name', 'Salesforce',
        '--country', 'US',
        '--state', 'US-CA',
        '--region', 'US-CA',
        '--city', 'San Francisco',
        '--company-id', 'comp-1',
        '--company-name', 'Acme',
        '--company-domain', 'acme.com',
        '--company-business-contexts', '[{"objectType":"ACCOUNT","objectId":"a-1","systemName":"Salesforce"}]',
        '--person-custom-fields', '[{"name":"role","value":"buyer"}]',
        '--custom-fields', '[{"name":"campaign","value":"q3"}]',
      ],
      { responses: [{ body: { requestId: 'r-di' } }] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('https://api.gong.io/v2/digital-interaction');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(request?.body).toEqual({
      eventId: 'evt-42',
      timestamp: '2026-07-01T00:00:00Z',
      eventType: 'page viewed',
      sourceSystemName: 'Partnerly',
      sessionId: 'sess-1',
      device: 'PC',
      content: {
        contentId: 'c-1',
        contentTitle: 'Pricing page',
        contentLabel: ['pricing', 'web'],
        contentUrl: 'https://acme.example/pricing',
        contentAdditionalInfoUrl: 'https://partner.example/analysis',
        numericContentDetails: { value: 8, rangeFrom: 0, rangeTo: 10, numericType: 'NPS' },
        stepContentDetails: { value: 'step2', availableSteps: ['step1', 'step2', 'step3'] },
        searchObjectDetails: {
          name: 'Gong',
          objectType: 'VENDOR',
          domain: 'gong.io',
          objectId: 'ent-1',
          url: 'https://partner.example/ent-1',
        },
        contentCustomFields: [{ name: 'pages', value: '12', dataType: 'NUMBER' }],
      },
      person: {
        name: 'Jane Doe',
        email: 'jane@acme.com',
        phoneNumber: '+14155550100',
        personId: 'p-1',
        personBusinessContext: {
          objectType: 'CONTACT',
          objectId: '0031',
          systemName: 'Salesforce',
        },
        location: { country: 'US', state: 'US-CA', region: 'US-CA', city: 'San Francisco' },
        company: {
          companyId: 'comp-1',
          name: 'Acme',
          domain: 'acme.com',
          companyBusinessContexts: [
            { objectType: 'ACCOUNT', objectId: 'a-1', systemName: 'Salesforce' },
          ],
        },
        personCustomFields: [{ name: 'role', value: 'buyer' }],
      },
      customFields: [{ name: 'campaign', value: 'q3' }],
    });
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'r-di' });
  });

  it('validates required fields before any request', async () => {
    const run = await runCli(['interactions', 'create', '--source-system-name', 'Partnerly']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('eventId');
    expect(run.stderr).toContain('content.contentTitle');
  });

  it('rejects person details combined with --tracking-id', async () => {
    const run = await runCli([
      'interactions',
      'create',
      '--event-id', 'e-1',
      '--timestamp', '2026-07-01',
      '--event-type', 'page viewed',
      '--content-title', 'Pricing page',
      '--person-email', 'jane@acme.com',
      '--tracking-id', 'anon-7',
    ]);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('not both');
  });

  it('merges typed flags over --body, objects recursively', async () => {
    const run = await runCli(
      [
        'interactions',
        'create',
        '--body',
        '{"eventId":"evt-1","timestamp":"2026-07-01T00:00:00Z","eventType":"page viewed","content":{"contentTitle":"Old title","contentUrl":"https://acme.example/old"},"trackingId":"anon-1"}',
        '--content-title',
        'New title',
      ],
      { responses: [{ body: { requestId: 'r' } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual({
      eventId: 'evt-1',
      timestamp: '2026-07-01T00:00:00Z',
      eventType: 'page viewed',
      content: { contentTitle: 'New title', contentUrl: 'https://acme.example/old' },
      trackingId: 'anon-1',
    });
  });

  it('--dry-run prints the request without sending it', async () => {
    const run = await runCli([
      'interactions',
      'create',
      '--event-id', 'evt-1',
      '--timestamp', '2026-07-01T10:00:00Z',
      '--event-type', 'link clicked',
      '--content-title', 'Doc',
      '--dry-run',
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    const printed = JSON.parse(run.stdout) as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: unknown;
    };
    expect(printed.method).toBe('POST');
    expect(printed.url).toBe('https://api.gong.io/v2/digital-interaction');
    expect(printed.headers.authorization).toBe('Basic ***');
    expect(printed.body).toEqual({
      eventId: 'evt-1',
      timestamp: '2026-07-01T10:00:00Z',
      eventType: 'link clicked',
      content: { contentTitle: 'Doc' },
    });
  });

  it('maps 409 duplicate-event conflicts to exit 1 with API details', async () => {
    const run = await runCli(
      [
        'interactions',
        'create',
        '--event-id', 'evt-1',
        '--timestamp', '2026-07-01',
        '--event-type', 'page viewed',
        '--content-title', 'Doc',
      ],
      {
        responses: [
          {
            status: 409,
            body: { requestId: 'r9', errors: ['Event was already reported in the past'] },
          },
        ],
      },
    );
    expect(run.exitCode).toBe(1);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(409);
    expect(parsed.requestId).toBe('r9');
    expect(parsed.errors).toEqual(['Event was already reported in the past']);
  });
});

describe('gong engagement content-viewed', () => {
  it('builds PUT /v2/customer-engagement/content/viewed from flags with auth', async () => {
    const run = await runCli(
      [
        'engagement',
        'content-viewed',
        '--reporting-system', 'abc123',
        '--event-timestamp', '2026-02-17T02:30:00-08:00',
        '--event-id', 'ev-1',
        '--content-id', 'doc_1',
        '--content-url', 'https://example.com/doc_1',
        '--content-title', 'Features & Spec V.1',
        '--view-action-title', 'Document Viewed',
        '--share-id', 'sh-1',
        '--view-info-url', 'https://example.com/info',
        '--viewer-email', 'pat@acme.com',
        '--viewer-name', 'Pat',
        '--viewer-title', 'CTO',
        '--crm-context', '[{"system":"Salesforce","objects":[{"objectType":"Contact","objectId":"0013601230sV7grAAC"}]}]',
        '--content-properties', '[{"name":"pages","value":"3.14","dataType":"number"}]',
        '--event-properties', '[{"name":"source","value":"email","dataType":"string"}]',
        '--user-agent', 'Mozilla/5.0',
        '--mobile-app-id', 'com.acme.app',
        '--agent-platform', 'iOS',
        '--workspace-id', '623457276584334',
        '--more-info-url', 'https://example.com/more',
      ],
      { responses: [{ body: { requestId: 'r-v', integrationId: 123 } }] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('PUT');
    expect(request?.url).toBe('https://api.gong.io/v2/customer-engagement/content/viewed');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(request?.body).toEqual({
      reportingSystem: 'abc123',
      eventTimestamp: '2026-02-17T02:30:00-08:00',
      eventId: 'ev-1',
      contentId: 'doc_1',
      contentUrl: 'https://example.com/doc_1',
      contentTitle: 'Features & Spec V.1',
      viewActionTitle: 'Document Viewed',
      shareId: 'sh-1',
      viewInfoUrl: 'https://example.com/info',
      viewer: { email: 'pat@acme.com', name: 'Pat', title: 'CTO' },
      crmContext: [
        {
          system: 'Salesforce',
          objects: [{ objectType: 'Contact', objectId: '0013601230sV7grAAC' }],
        },
      ],
      contentProperties: [{ name: 'pages', value: '3.14', dataType: 'number' }],
      eventProperties: [{ name: 'source', value: 'email', dataType: 'string' }],
      userAgent: 'Mozilla/5.0',
      mobileAppId: 'com.acme.app',
      agentPlatform: 'iOS',
      workspaceId: '623457276584334',
      moreInfoUrl: 'https://example.com/more',
    });
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'r-v', integrationId: 123 });
  });

  it('requires reportingSystem, eventTimestamp and the content trio', async () => {
    const run = await runCli([
      'engagement',
      'content-viewed',
      '--reporting-system', 'abc123',
      '--event-timestamp', '2026-07-01',
    ]);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('contentId');
    expect(run.stderr).toContain('contentTitle');
  });

  it('rejects --viewer combined with --tracking-id', async () => {
    const run = await runCli([
      'engagement',
      'content-viewed',
      '--reporting-system', 'abc123',
      '--event-timestamp', '2026-07-01',
      '--content-id', 'doc_1',
      '--content-url', 'https://example.com/doc_1',
      '--content-title', 'Doc',
      '--viewer-email', 'pat@acme.com',
      '--tracking-id', 'anon-7',
    ]);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('not both');
  });
});

describe('gong engagement content-shared', () => {
  it('builds PUT /v2/customer-engagement/content/shared, expanding bare dates', async () => {
    const run = await runCli(
      [
        'engagement',
        'content-shared',
        '--reporting-system', 'abc123',
        '--event-timestamp', '2026-07-01',
        '--content-id', 'doc_1',
        '--content-url', 'https://example.com/doc_1',
        '--content-title', 'Features & Spec V.1',
        '--share-id', 'sh-1',
        '--share-info-url', 'https://example.com/share',
        '--sharing-message-subject', 'Take a look',
        '--sharing-message-body', 'Sharing the spec',
        '--sharer-id', '234599484848423',
        '--sharer-email', 'rep@example.com',
        '--sharer-name', 'Rep',
        '--recipients', '[{"name":"Jane","email":"jane@acme.com"}]',
        '--action-name', 'Document Sent',
      ],
      { responses: [{ body: { requestId: 'r-s', integrationId: 123 } }] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('PUT');
    expect(request?.url).toBe('https://api.gong.io/v2/customer-engagement/content/shared');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(request?.body).toEqual({
      reportingSystem: 'abc123',
      eventTimestamp: '2026-07-01T00:00:00Z',
      contentId: 'doc_1',
      contentUrl: 'https://example.com/doc_1',
      contentTitle: 'Features & Spec V.1',
      shareId: 'sh-1',
      shareInfoUrl: 'https://example.com/share',
      sharingMessageSubject: 'Take a look',
      sharingMessageBody: 'Sharing the spec',
      sharer: { id: '234599484848423', email: 'rep@example.com', name: 'Rep' },
      recipients: [{ name: 'Jane', email: 'jane@acme.com' }],
      actionName: 'Document Sent',
    });
  });

  it('rejects recipients without an email address', async () => {
    const run = await runCli([
      'engagement',
      'content-shared',
      '--reporting-system', 'abc123',
      '--event-timestamp', '2026-07-01',
      '--content-id', 'doc_1',
      '--content-url', 'https://example.com/doc_1',
      '--content-title', 'Doc',
      '--recipients', '[{"name":"Jane"}]',
    ]);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('email');
  });
});

describe('gong engagement custom-action', () => {
  it('builds PUT /v2/customer-engagement/action and preserves int64 integrationId', async () => {
    const run = await runCli(
      [
        'engagement',
        'custom-action',
        '--reporting-system', 'abc123',
        '--event-timestamp', '2026-02-17T02:30:00-08:00',
        '--action-name', 'Contract Signed',
        '--event-info-url', 'https://example.com/event',
        '--content-id', 'doc_1',
        '--actor-email', 'pat@acme.com',
        '--actor-name', 'Pat',
      ],
      {
        // integrationId exceeds Number.MAX_SAFE_INTEGER; output must stay lossless.
        responses: [{ body: '{"requestId":"r-a","integrationId":5517027188234205706}' }],
      },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('PUT');
    expect(request?.url).toBe('https://api.gong.io/v2/customer-engagement/action');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(request?.body).toEqual({
      reportingSystem: 'abc123',
      eventTimestamp: '2026-02-17T02:30:00-08:00',
      actionName: 'Contract Signed',
      eventInfoUrl: 'https://example.com/event',
      contentId: 'doc_1',
      actor: { email: 'pat@acme.com', name: 'Pat' },
    });
    expect(run.stdout).toContain('5517027188234205706');
  });

  it('requires reportingSystem and eventTimestamp', async () => {
    const run = await runCli(['engagement', 'custom-action', '--action-name', 'Signed']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('reportingSystem');
    expect(run.stderr).toContain('eventTimestamp');
  });
});

describe('gong integration-settings set', () => {
  it('builds POST /v2/integration-settings from the pair flags with auth', async () => {
    const run = await runCli(
      [
        'integration-settings',
        'set',
        '--integration-type', 'EMAIL_COMPOSER',
        '--allowed-origin', 'https://acme.partner.com',
      ],
      { responses: [{ body: { requestId: 'r-is', integrationId: 42 } }] },
    );
    expect(run.exitCode).toBe(0);
    const request = run.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('https://api.gong.io/v2/integration-settings');
    expect(request?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(request?.body).toEqual({
      integrationTypeSettings: [
        { integrationType: 'EMAIL_COMPOSER', allowedOrigin: 'https://acme.partner.com' },
      ],
    });
    expect(JSON.parse(run.stdout)).toEqual({ requestId: 'r-is', integrationId: 42 });
  });

  it('accepts a full list via --integration-type-settings', async () => {
    const run = await runCli(
      [
        'integration-settings',
        'set',
        '--integration-type-settings',
        '[{"integrationType":"EMAIL_COMPOSER","allowedOrigin":"https://a.partner.com"},{"integrationType":"DIALER","allowedOrigin":"https://dial.partner.com"}]',
      ],
      { responses: [{ body: { requestId: 'r' } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.body).toEqual({
      integrationTypeSettings: [
        { integrationType: 'EMAIL_COMPOSER', allowedOrigin: 'https://a.partner.com' },
        { integrationType: 'DIALER', allowedOrigin: 'https://dial.partner.com' },
      ],
    });
  });

  it('requires integrationTypeSettings before any request', async () => {
    const run = await runCli(['integration-settings', 'set']);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('integrationTypeSettings');
  });

  it('requires the pair flags together', async () => {
    const run = await runCli([
      'integration-settings',
      'set',
      '--integration-type', 'DIALER',
    ]);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('together');
  });

  it('rejects the pair flags combined with --integration-type-settings', async () => {
    const run = await runCli([
      'integration-settings',
      'set',
      '--integration-type', 'DIALER',
      '--allowed-origin', 'https://dial.partner.com',
      '--integration-type-settings', '[]',
    ]);
    expect(run.exitCode).toBe(2);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('not both');
  });

  it('maps 401 access-denied to exit 3', async () => {
    const run = await runCli(
      [
        'integration-settings',
        'set',
        '--integration-type', 'DIALER',
        '--allowed-origin', 'https://dial.partner.com',
      ],
      { responses: [{ status: 401, body: { requestId: 'r', errors: ['Access denied'] } }] },
    );
    expect(run.exitCode).toBe(3);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.httpStatus).toBe(401);
    expect(parsed.errors).toEqual(['Access denied']);
  });
});
