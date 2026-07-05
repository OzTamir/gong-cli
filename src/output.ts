/**
 * Output rendering: json | jsonl | table | raw, --fields projection, and the
 * machine-diagnostics stderr contract (single-line JSON when stderr is not a TTY).
 */
import type { CliContext } from './context.js';
import { CliError, EXIT } from './errors.js';
import { stringifyLossless, valueToCell } from './json.js';

export const OUTPUT_FORMATS = ['json', 'jsonl', 'table', 'raw'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface OutputFlags {
  output?: OutputFormat;
  fields?: string[];
}

/** Lists: explicit -o wins; otherwise table on a TTY, json when piped. */
export function resolveListFormat(flags: OutputFlags, ctx: CliContext): OutputFormat {
  return flags.output ?? (ctx.stdout.isTTY ? 'table' : 'json');
}

/** Single objects: explicit -o wins; json otherwise (table has no natural single shape). */
export function resolveSingleFormat(flags: OutputFlags): OutputFormat {
  return flags.output ?? 'json';
}

export function parseFields(value: string): string[] {
  const fields = value
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
  if (fields.length === 0) {
    throw new CliError('--fields requires at least one dot-path', { exitCode: EXIT.USAGE });
  }
  return fields;
}

export function getPath(value: unknown, dotPath: string): unknown {
  let current: unknown = value;
  for (const segment of dotPath.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Project a record to a flat object keyed by the requested paths; missing → null. */
export function project(record: unknown, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = getPath(record, field);
    out[field] = value === undefined ? null : value;
  }
  return out;
}

export function renderTable(records: unknown[], columns: string[]): string {
  const rows = records.map((record) => columns.map((column) => valueToCell(getPath(record, column))));
  const widths = columns.map((column, i) =>
    Math.max(column.length, ...rows.map((row) => (row[i] ?? '').length)),
  );
  const renderRow = (cells: string[]): string =>
    cells
      .map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
      .join('  ')
      .trimEnd();
  const lines = [renderRow(columns), ...rows.map(renderRow)];
  return lines.join('\n') + '\n';
}

/** Default table columns when a command curates none / records are opaque. */
function fallbackColumns(records: unknown[]): string[] {
  const first = records[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    return Object.keys(first as Record<string, unknown>).slice(0, 8);
  }
  return ['value'];
}

export interface ListEmitterOptions {
  format: OutputFormat;
  fields?: string[];
  /** Curated default table columns (dot-paths). */
  columns?: string[];
}

export interface ListEmitter {
  page(records: unknown[], rawText: string): void;
  /** Flush accumulated output (json/table). Safe to call after an aborted run. */
  done(): void;
}

export function createListEmitter(ctx: CliContext, options: ListEmitterOptions): ListEmitter {
  const { format, fields } = options;
  const accumulated: unknown[] = [];

  return {
    page(records: unknown[], rawText: string): void {
      if (format === 'raw') {
        ctx.stdout.write(rawText.endsWith('\n') ? rawText : rawText + '\n');
        return;
      }
      const shaped = fields ? records.map((record) => project(record, fields)) : records;
      if (format === 'jsonl') {
        for (const record of shaped) ctx.stdout.write(stringifyLossless(record) + '\n');
        return;
      }
      accumulated.push(...shaped);
    },
    done(): void {
      if (format === 'json') {
        ctx.stdout.write(stringifyLossless(accumulated, 2) + '\n');
      } else if (format === 'table') {
        if (accumulated.length === 0) {
          return; // empty table renders nothing; the stderr note carries the story
        }
        const columns = fields ?? options.columns ?? fallbackColumns(accumulated);
        ctx.stdout.write(renderTable(accumulated, columns));
      }
    },
  };
}

export interface EmitSingleOptions {
  format: OutputFormat;
  fields?: string[];
  rawText: string;
}

export function emitSingle(ctx: CliContext, payload: unknown, options: EmitSingleOptions): void {
  const { format, fields } = options;
  if (format === 'raw') {
    ctx.stdout.write(options.rawText.endsWith('\n') ? options.rawText : options.rawText + '\n');
    return;
  }
  const shaped = fields ? project(payload, fields) : payload;
  if (format === 'jsonl') {
    ctx.stdout.write(stringifyLossless(shaped) + '\n');
    return;
  }
  if (format === 'table') {
    const record = shaped ?? {};
    const columns = fields ?? Object.keys((record as Record<string, unknown>) ?? {});
    ctx.stdout.write(renderTable([record], columns.length > 0 ? columns : ['value']));
    return;
  }
  ctx.stdout.write(stringifyLossless(shaped, 2) + '\n');
}

export interface MetaInfo {
  nextCursor?: string;
  totalRecords?: number | bigint;
  fetchedRecords: number;
  pages: number;
  aborted?: boolean;
  note?: string;
}

/** Pagination/status meta line: JSON when stderr is piped, prose on a TTY. */
export function emitMeta(ctx: CliContext, meta: MetaInfo): void {
  if (!ctx.stderr.isTTY) {
    ctx.stderr.write(
      stringifyLossless({
        gongCliMeta: true,
        ...(meta.nextCursor !== undefined ? { nextCursor: meta.nextCursor } : {}),
        ...(meta.totalRecords !== undefined ? { totalRecords: meta.totalRecords } : {}),
        fetchedRecords: meta.fetchedRecords,
        pages: meta.pages,
        ...(meta.aborted ? { aborted: true } : {}),
        ...(meta.note !== undefined ? { note: meta.note } : {}),
      }) + '\n',
    );
    return;
  }
  const parts: string[] = [];
  if (meta.aborted) parts.push('Run aborted before completion.');
  if (meta.note) parts.push(meta.note);
  parts.push(
    `Fetched ${meta.fetchedRecords} record${meta.fetchedRecords === 1 ? '' : 's'}` +
      (meta.totalRecords !== undefined ? ` of ${meta.totalRecords} total` : '') +
      ` (${meta.pages} page${meta.pages === 1 ? '' : 's'}).`,
  );
  if (meta.nextCursor) {
    parts.push(`More available: rerun with --cursor '${meta.nextCursor}' or use --all.`);
  }
  ctx.stderr.write(parts.join(' ') + '\n');
}
