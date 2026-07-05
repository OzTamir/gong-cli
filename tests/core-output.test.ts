import { describe, expect, it } from 'vitest';

import { parseLossless, stringifyLossless, valueToCell } from '../src/json.js';
import {
  createListEmitter,
  emitMeta,
  emitSingle,
  getPath,
  project,
  renderTable,
  resolveListFormat,
} from '../src/output.js';
import { makeTestContext } from './helpers.js';

describe('lossless JSON', () => {
  it('round-trips int64 IDs exactly', () => {
    const text = '{"scorecardId":6843152929075440037,"small":7,"f":1.5}';
    const parsed = parseLossless(text) as Record<string, unknown>;
    expect(parsed.scorecardId).toBe(BigInt('6843152929075440037'));
    expect(parsed.small).toBe(7);
    expect(parsed.f).toBe(1.5);
    expect(stringifyLossless(parsed)).toBe(text);
  });

  it('renders bigints as digits in cells', () => {
    expect(valueToCell(BigInt('6843152929075440037'))).toBe('6843152929075440037');
    expect(valueToCell(null)).toBe('');
    expect(valueToCell({ a: 1 })).toBe('{"a":1}');
  });
});

describe('projection', () => {
  it('projects dot-paths flat with null for missing', () => {
    const record = { metaData: { id: 'c1', title: 'Demo' }, parties: [{}] };
    expect(project(record, ['metaData.id', 'missing.path'])).toEqual({
      'metaData.id': 'c1',
      'missing.path': null,
    });
  });

  it('getPath walks nested objects', () => {
    expect(getPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
    expect(getPath(null, 'a')).toBeUndefined();
  });
});

describe('format resolution', () => {
  it('lists default to table on TTY, json when piped, explicit -o wins', () => {
    const tty = makeTestContext({ stdoutTTY: true }).ctx;
    const piped = makeTestContext({ stdoutTTY: false }).ctx;
    expect(resolveListFormat({}, tty)).toBe('table');
    expect(resolveListFormat({}, piped)).toBe('json');
    expect(resolveListFormat({ output: 'jsonl' }, tty)).toBe('jsonl');
  });
});

describe('list emitter', () => {
  it('json accumulates across pages and emits one array; empty → []', () => {
    const { ctx, state } = makeTestContext();
    const emitter = createListEmitter(ctx, { format: 'json' });
    emitter.page([{ id: 1 }], 'raw1');
    emitter.page([{ id: 2 }], 'raw2');
    emitter.done();
    expect(JSON.parse(state.stdout())).toEqual([{ id: 1 }, { id: 2 }]);

    const empty = makeTestContext();
    const emptyEmitter = createListEmitter(empty.ctx, { format: 'json' });
    emptyEmitter.done();
    expect(empty.state.stdout().trim()).toBe('[]');
  });

  it('jsonl streams one record per line, preserving int64', () => {
    const { ctx, state } = makeTestContext();
    const emitter = createListEmitter(ctx, { format: 'jsonl' });
    const record = parseLossless('{"id":9007199254740993}');
    emitter.page([record], 'raw');
    emitter.done();
    expect(state.stdout()).toBe('{"id":9007199254740993}\n');
  });

  it('raw emits the exact page text', () => {
    const { ctx, state } = makeTestContext();
    const emitter = createListEmitter(ctx, { format: 'raw' });
    emitter.page([], '{"requestId":"r","calls":[],"big":9007199254740993}');
    emitter.done();
    expect(state.stdout()).toBe('{"requestId":"r","calls":[],"big":9007199254740993}\n');
  });

  it('table renders curated columns and respects --fields', () => {
    const { ctx, state } = makeTestContext();
    const emitter = createListEmitter(ctx, {
      format: 'table',
      columns: ['metaData.id', 'metaData.title'],
    });
    emitter.page(
      [
        { metaData: { id: 'c1', title: 'Demo call' } },
        { metaData: { id: 'c2', title: 'Follow-up' } },
      ],
      'raw',
    );
    emitter.done();
    const lines = state.stdout().trimEnd().split('\n');
    expect(lines[0]).toMatch(/^metaData\.id\s+metaData\.title$/);
    expect(lines[1]).toMatch(/^c1\s+Demo call$/);
    expect(lines[2]).toMatch(/^c2\s+Follow-up$/);
  });
});

describe('single emitter', () => {
  it('json pretty-prints the unwrapped payload', () => {
    const { ctx, state } = makeTestContext();
    emitSingle(ctx, { id: 'u1' }, { format: 'json', rawText: 'ignored' });
    expect(state.stdout()).toBe('{\n  "id": "u1"\n}\n');
  });

  it('raw is byte-faithful', () => {
    const { ctx, state } = makeTestContext();
    emitSingle(ctx, { id: 'u1' }, { format: 'raw', rawText: '{"requestId":"r","user":{"id":"u1"}}' });
    expect(state.stdout()).toBe('{"requestId":"r","user":{"id":"u1"}}\n');
  });
});

describe('meta line', () => {
  it('is one JSON line when stderr is piped', () => {
    const { ctx, state } = makeTestContext({ stderrTTY: false });
    emitMeta(ctx, { nextCursor: 'abc', totalRecords: 263, fetchedRecords: 100, pages: 1 });
    const parsed = JSON.parse(state.stderr().trim()) as Record<string, unknown>;
    expect(parsed).toEqual({
      gongCliMeta: true,
      nextCursor: 'abc',
      totalRecords: 263,
      fetchedRecords: 100,
      pages: 1,
    });
  });

  it('is prose on a TTY', () => {
    const { ctx, state } = makeTestContext({ stderrTTY: true });
    emitMeta(ctx, { nextCursor: 'abc', totalRecords: 263, fetchedRecords: 100, pages: 1 });
    expect(state.stderr()).toContain('Fetched 100 records of 263 total');
    expect(state.stderr()).toContain("--cursor 'abc'");
  });
});
