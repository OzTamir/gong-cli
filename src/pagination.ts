/**
 * Cursor pagination per Gong's `records` envelope. Cursor location differs by verb:
 * query param on GETs, top-level body field on POSTs. See docs/DESIGN.md → Pagination.
 */
import type { Command } from 'commander';

import type { CliContext } from './context.js';
import type { GongClient, RequestSpec } from './client.js';
import { isDryRun } from './client.js';
import { CliError } from './errors.js';
import { getPath } from './output.js';
import type { OutputFormat } from './output.js';
import { createListEmitter, emitMeta } from './output.js';

export interface PaginationFlags {
  all?: boolean;
  limit?: number;
  cursor?: string;
}

export function addPaginationOptions(cmd: Command): Command {
  return cmd
    .option('--all', 'fetch every page (follows cursors to the end)')
    .option(
      '--limit <n>',
      'fetch records across pages until n records are collected',
      (value: string) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) {
          throw new CliError(`--limit must be a positive integer, got '${value}'`, {
            exitCode: 2,
          });
        }
        return n;
      },
    )
    .option('--cursor <cursor>', 'resume from a cursor returned by a previous run');
}

interface RecordsEnvelope {
  totalRecords?: number | bigint;
  cursor?: string;
}

export interface RunListArgs {
  ctx: CliContext;
  client: GongClient;
  spec: RequestSpec;
  /** Where the cursor is injected for this operation. */
  cursorIn: 'query' | 'body';
  /** Dot-path of the records array inside the response envelope (e.g. 'calls'). */
  recordsKey: string;
  flags: PaginationFlags;
  output: { format: OutputFormat; fields?: string[]; columns?: string[] };
  /** Treat 404 as "no data in period" (Gong list endpoints do this). Default true. */
  notFoundMeansEmpty?: boolean;
}

function withCursor(spec: RequestSpec, cursorIn: 'query' | 'body', cursor?: string): RequestSpec {
  if (cursor === undefined) return spec;
  if (cursorIn === 'query') {
    return { ...spec, query: { ...(spec.query ?? {}), cursor } };
  }
  const body = (spec.body ?? {}) as Record<string, unknown>;
  return { ...spec, body: { ...body, cursor } };
}

/**
 * Run a paginated list command end to end: fetch page(s), stream/accumulate output,
 * and emit the stderr meta line (next cursor, totals, abort/resume info).
 */
export async function runPaginatedList(args: RunListArgs): Promise<void> {
  const { ctx, client, flags } = args;
  const notFoundMeansEmpty = args.notFoundMeansEmpty ?? true;
  const emitter = createListEmitter(ctx, args.output);

  let cursor = flags.cursor;
  let fetched = 0;
  let pages = 0;
  let totalRecords: number | bigint | undefined;
  let nextCursor: string | undefined;
  let emptyNote: string | undefined;

  for (;;) {
    const spec = withCursor(
      { ...args.spec, notFoundOk: args.spec.notFoundOk ?? notFoundMeansEmpty },
      args.cursorIn,
      cursor,
    );

    let result;
    try {
      result = await client.request(spec);
    } catch (error) {
      // Mid-run failure: records already emitted stay valid; surface the cursor that
      // fetched the failing page so the run is resumable with --cursor.
      if (pages > 0) {
        emitter.done();
        emitMeta(ctx, {
          nextCursor: cursor,
          totalRecords,
          fetchedRecords: fetched,
          pages,
          aborted: true,
        });
      }
      throw error;
    }
    if (isDryRun(result)) return; // --dry-run prints the first request only

    if (result.status === 404) {
      const api = (result.body ?? {}) as { errors?: unknown };
      emptyNote = Array.isArray(api.errors) && api.errors.length > 0
        ? api.errors.map(String).join('; ')
        : 'No records found.';
      break;
    }

    pages++;
    const envelope = (getPath(result.body, 'records') ?? {}) as RecordsEnvelope;
    if (envelope.totalRecords !== undefined) totalRecords = envelope.totalRecords;

    let records = (getPath(result.body, args.recordsKey) as unknown[] | undefined) ?? [];
    if (!Array.isArray(records)) records = [records];

    const remaining =
      flags.limit !== undefined ? Math.max(0, flags.limit - fetched) : undefined;
    const emitRecords = remaining !== undefined ? records.slice(0, remaining) : records;
    fetched += emitRecords.length;
    emitter.page(emitRecords, result.bodyText);

    const pageCursor = typeof envelope.cursor === 'string' ? envelope.cursor : undefined;
    const reachedLimit = flags.limit !== undefined && fetched >= flags.limit;
    const wantMore = flags.all === true || (flags.limit !== undefined && !reachedLimit);

    if (pageCursor === undefined) break;
    if (!wantMore || reachedLimit) {
      nextCursor = pageCursor;
      break;
    }
    cursor = pageCursor;
  }

  emitter.done();
  if (nextCursor !== undefined || emptyNote !== undefined || pages > 1) {
    emitMeta(ctx, {
      nextCursor,
      totalRecords,
      fetchedRecords: fetched,
      pages,
      note: emptyNote,
    });
  }
}
