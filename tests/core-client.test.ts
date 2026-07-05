import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { GongClient } from '../src/client.js';
import type { ResolvedAuth } from '../src/config.js';
import { CliError } from '../src/errors.js';
import { makeTestContext } from './helpers.js';
import type { RunOptions } from './helpers.js';

const AUTH: ResolvedAuth = {
  kind: 'basic',
  header: 'Basic dGVzdDp0ZXN0',
  baseUrl: 'https://api.gong.io',
  source: 'test',
};

function client(options: RunOptions = {}, clientOptions = {}) {
  const { ctx, state } = makeTestContext(options);
  return { client: new GongClient(ctx, AUTH, clientOptions), state, ctx };
}

describe('GongClient', () => {
  it('serializes query params, arrays as repeated keys, skips undefined', async () => {
    const { client: c, state } = client({ responses: [{ body: { ok: 1 } }] });
    await c.request({
      method: 'GET',
      path: '/v2/calls',
      query: { fromDateTime: '2026-01-01T00:00:00Z', workspaceId: undefined, ids: ['a', 'b'] },
    });
    expect(state.requests[0]?.url).toBe(
      'https://api.gong.io/v2/calls?fromDateTime=2026-01-01T00%3A00%3A00Z&ids=a&ids=b',
    );
  });

  it('sends lossless JSON bodies with content-type', async () => {
    const { client: c, state } = client({ responses: [{ body: {} }] });
    await c.request({
      method: 'POST',
      path: '/v2/x',
      body: { big: BigInt('9007199254740993'), s: 'v' },
    });
    expect(state.requests[0]?.headers['content-type']).toBe('application/json');
    expect(state.requests[0]?.bodyText).toBe('{"big":9007199254740993,"s":"v"}');
  });

  it('retries 429 honoring Retry-After then succeeds', async () => {
    const { client: c, state } = client({
      responses: [
        { status: 429, headers: { 'retry-after': '7' }, body: { errors: ['slow down'] } },
        { status: 429, headers: { 'retry-after': '2' }, body: { errors: ['slow down'] } },
        { body: { fine: true } },
      ],
    });
    const result = await c.request({ method: 'GET', path: '/v2/users' });
    expect(state.requests).toHaveLength(3);
    expect(state.sleeps).toEqual([7000, 2000]);
    expect(result.dryRun).toBeUndefined();
  });

  it('maps exhausted 429 retries to exit code 5', async () => {
    const { client: c, state } = client({
      responses: [{ status: 429, headers: { 'retry-after': '1' }, body: { errors: ['limit'] } }],
    });
    const error = await c
      .request({ method: 'GET', path: '/v2/users' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(5);
    expect(state.requests).toHaveLength(4); // initial + 3 retries
  });

  it('--no-retry style (retries: 0) fails immediately on 429', async () => {
    const { client: c, state } = client(
      { responses: [{ status: 429, body: { errors: ['limit'] } }] },
      { retries: 0 },
    );
    await expect(c.request({ method: 'GET', path: '/v2/users' })).rejects.toMatchObject({
      exitCode: 5,
    });
    expect(state.requests).toHaveLength(1);
  });

  it.each([
    [401, 3],
    [403, 3],
    [404, 4],
    [400, 1],
    [500, 1],
  ])('maps HTTP %i to exit code %i with requestId and errors', async (status, exitCode) => {
    const { client: c } = client({
      responses: [{ status, body: { requestId: 'req-1', errors: ['boom'] } }],
    });
    const error = (await c
      .request({ method: 'GET', path: '/v2/users' })
      .then(() => null)
      .catch((e: unknown) => e)) as CliError;
    expect(error.exitCode).toBe(exitCode);
    expect(error.requestId).toBe('req-1');
    expect(error.apiErrors).toEqual(['boom']);
    expect(error.message).toContain(`HTTP ${status}`);
    expect(error.message).toContain('boom');
  });

  it('notFoundOk returns the 404 response instead of throwing', async () => {
    const { client: c } = client({
      responses: [{ status: 404, body: { requestId: 'r', errors: ['No logs found'] } }],
    });
    const result = await c.request({ method: 'GET', path: '/v2/logs', notFoundOk: true });
    expect(result.dryRun).toBeUndefined();
    if (!result.dryRun) expect(result.status).toBe(404);
  });

  it('sends multipart uploads with fields and streamed file', async () => {
    const blob = new Blob([Buffer.from('media-bytes')]);
    const { client: c, state } = client({
      responses: [{ status: 201, body: { requestId: 'r', callId: 'c1' } }],
      blobs: { '/tmp/audio.mp3': blob },
    });
    await c.request({
      method: 'PUT',
      path: '/v2/calls/123/media',
      multipart: { field: 'mediaFile', path: '/tmp/audio.mp3', fields: { note: 'x' } },
    });
    const captured = state.requests[0];
    expect(captured?.multipart?.mediaFile).toMatchObject({
      kind: 'file',
      filename: 'audio.mp3',
      size: 11,
    });
    expect(captured?.multipart?.note).toMatchObject({ kind: 'field', value: 'x' });
    expect(captured?.headers['content-type']).toBeUndefined(); // boundary set by fetch
  });

  it('dry-run prints the request shape and sends nothing', async () => {
    const { client: c, state } = client({}, { dryRun: true });
    const result = await c.request({
      method: 'POST',
      path: '/v2/calls/extensive',
      body: { filter: { fromDateTime: '2026-01-01T00:00:00Z' } },
    });
    expect(result.dryRun).toBe(true);
    expect(state.requests).toHaveLength(0);
    const printed = JSON.parse(state.stdout()) as Record<string, unknown>;
    expect(printed.method).toBe('POST');
    expect(printed.url).toBe('https://api.gong.io/v2/calls/extensive');
    expect((printed.headers as Record<string, string>).authorization).toBe('Basic ***');
    expect(printed.body).toEqual({ filter: { fromDateTime: '2026-01-01T00:00:00Z' } });
  });

  it('falls back to node:http for GET with a JSON body (fetch refuses those)', async () => {
    const received: Array<{ method?: string; url?: string; body: string }> = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received.push({
          method: req.method,
          url: req.url,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ requestId: 'r', crmObjects: [] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const { ctx } = makeTestContext();
      // Real fetch: throws TypeError for GET+body, which triggers the raw fallback.
      ctx.fetchImpl = fetch;
      const c = new GongClient(
        ctx,
        { ...AUTH, baseUrl: `http://127.0.0.1:${port}` },
        {},
      );
      const result = await c.request({
        method: 'GET',
        path: '/v2/crm/entities',
        query: { integrationId: '42', objectType: 'ACCOUNT' },
        body: ['crm-id-1', 'crm-id-2'],
        getWithBody: true,
      });
      expect(result.dryRun).toBeUndefined();
      if (!result.dryRun) expect(result.status).toBe(200);
      expect(received).toHaveLength(1);
      expect(received[0]?.method).toBe('GET');
      expect(received[0]?.url).toBe('/v2/crm/entities?integrationId=42&objectType=ACCOUNT');
      expect(received[0]?.body).toBe('["crm-id-1","crm-id-2"]');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
