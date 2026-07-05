import { describe, expect, it } from 'vitest';

import { GongClient } from '../src/client.js';
import type { ResolvedAuth } from '../src/config.js';
import { runPaginatedList } from '../src/pagination.js';
import { makeTestContext, parseJsonLines } from './helpers.js';
import type { RunOptions } from './helpers.js';

const AUTH: ResolvedAuth = {
  kind: 'basic',
  header: 'Basic x',
  baseUrl: 'https://api.gong.io',
  source: 'test',
};

function setup(options: RunOptions) {
  const { ctx, state } = makeTestContext(options);
  return { ctx, state, client: new GongClient(ctx, AUTH, {}) };
}

function page(ids: string[], cursor?: string, total = 5) {
  return {
    body: {
      requestId: 'r',
      records: {
        totalRecords: total,
        currentPageSize: ids.length,
        currentPageNumber: 0,
        ...(cursor ? { cursor } : {}),
      },
      calls: ids.map((id) => ({ id })),
    },
  };
}

describe('runPaginatedList', () => {
  it('default: one page + meta line with next cursor on stderr', async () => {
    const { ctx, state, client } = setup({ responses: [page(['a', 'b'], 'CUR2')] });
    await runPaginatedList({
      ctx,
      client,
      spec: { method: 'GET', path: '/v2/calls', query: { fromDateTime: 'x' } },
      cursorIn: 'query',
      recordsKey: 'calls',
      flags: {},
      output: { format: 'json' },
    });
    expect(JSON.parse(state.stdout())).toEqual([{ id: 'a' }, { id: 'b' }]);
    const meta = JSON.parse(state.stderr().trim()) as Record<string, unknown>;
    expect(meta.gongCliMeta).toBe(true);
    expect(meta.nextCursor).toBe('CUR2');
    expect(meta.totalRecords).toBe(5);
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]?.url).toContain('/v2/calls?fromDateTime=x');
    expect(state.requests[0]?.url).not.toContain('cursor');
  });

  it('--all follows query cursors to the end with identical other params', async () => {
    const { ctx, state, client } = setup({
      responses: [page(['a', 'b'], 'CUR2'), page(['c', 'd'], 'CUR3'), page(['e'])],
    });
    await runPaginatedList({
      ctx,
      client,
      spec: { method: 'GET', path: '/v2/calls', query: { fromDateTime: 'x' } },
      cursorIn: 'query',
      recordsKey: 'calls',
      flags: { all: true },
      output: { format: 'jsonl' },
    });
    expect(parseJsonLines(state.stdout())).toHaveLength(5);
    expect(state.requests).toHaveLength(3);
    expect(state.requests[1]?.url).toContain('cursor=CUR2');
    expect(state.requests[1]?.url).toContain('fromDateTime=x');
    expect(state.requests[2]?.url).toContain('cursor=CUR3');
    const meta = JSON.parse(state.stderr().trim()) as Record<string, unknown>;
    expect(meta.nextCursor).toBeUndefined();
    expect(meta.fetchedRecords).toBe(5);
    expect(meta.pages).toBe(3);
  });

  it('injects cursor as a top-level body field for POST endpoints', async () => {
    const { ctx, state, client } = setup({
      responses: [page(['a'], 'NEXT'), page(['b'])],
    });
    await runPaginatedList({
      ctx,
      client,
      spec: {
        method: 'POST',
        path: '/v2/calls/extensive',
        body: { filter: { fromDateTime: 'x' } },
      },
      cursorIn: 'body',
      recordsKey: 'calls',
      flags: { all: true },
      output: { format: 'json' },
    });
    expect(state.requests[0]?.body).toEqual({ filter: { fromDateTime: 'x' } });
    expect(state.requests[1]?.body).toEqual({ filter: { fromDateTime: 'x' }, cursor: 'NEXT' });
  });

  it('--limit crosses pages and truncates the final page', async () => {
    const { ctx, state, client } = setup({
      responses: [page(['a', 'b'], 'CUR2'), page(['c', 'd'], 'CUR3')],
    });
    await runPaginatedList({
      ctx,
      client,
      spec: { method: 'GET', path: '/v2/calls' },
      cursorIn: 'query',
      recordsKey: 'calls',
      flags: { limit: 3 },
      output: { format: 'json' },
    });
    expect(JSON.parse(state.stdout())).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(state.requests).toHaveLength(2);
    const meta = JSON.parse(state.stderr().trim()) as Record<string, unknown>;
    expect(meta.fetchedRecords).toBe(3);
    expect(meta.nextCursor).toBe('CUR3');
  });

  it('--cursor resumes from a given cursor', async () => {
    const { ctx, state, client } = setup({ responses: [page(['x'])] });
    await runPaginatedList({
      ctx,
      client,
      spec: { method: 'GET', path: '/v2/calls' },
      cursorIn: 'query',
      recordsKey: 'calls',
      flags: { cursor: 'RESUME' },
      output: { format: 'json' },
    });
    expect(state.requests[0]?.url).toContain('cursor=RESUME');
  });

  it('maps 404 to an empty result with exit-0 semantics and a note', async () => {
    const { ctx, state, client } = setup({
      responses: [
        { status: 404, body: { requestId: 'r', errors: ['No calls found for the specified period'] } },
      ],
    });
    await runPaginatedList({
      ctx,
      client,
      spec: { method: 'GET', path: '/v2/calls' },
      cursorIn: 'query',
      recordsKey: 'calls',
      flags: {},
      output: { format: 'json' },
    });
    expect(JSON.parse(state.stdout())).toEqual([]);
    const meta = JSON.parse(state.stderr().trim()) as Record<string, unknown>;
    expect(meta.note).toBe('No calls found for the specified period');
    expect(meta.fetchedRecords).toBe(0);
  });

  it('aborted --all run keeps emitted records valid and surfaces the resume cursor', async () => {
    const { ctx, state, client } = setup({
      responses: [
        page(['a', 'b'], 'CUR2'),
        { status: 500, body: { requestId: 'r', errors: ['server broke'] } },
      ],
    });
    await expect(
      runPaginatedList({
        ctx,
        client,
        spec: { method: 'GET', path: '/v2/calls' },
        cursorIn: 'query',
        recordsKey: 'calls',
        flags: { all: true },
        output: { format: 'jsonl' },
      }),
    ).rejects.toMatchObject({ exitCode: 1 });
    expect(parseJsonLines(state.stdout())).toEqual([{ id: 'a' }, { id: 'b' }]);
    const metaLine = state
      .stderr()
      .split('\n')
      .find((line) => line.includes('gongCliMeta'));
    const meta = JSON.parse(metaLine as string) as Record<string, unknown>;
    expect(meta.aborted).toBe(true);
    expect(meta.nextCursor).toBe('CUR2');
    expect(meta.fetchedRecords).toBe(2);
  });
});
