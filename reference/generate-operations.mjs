#!/usr/bin/env node
/**
 * Regenerate operations.md from gong-openapi.json.
 * Usage: node reference/generate-operations.mjs [fetch-date]
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const fetchDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const spec = JSON.parse(fs.readFileSync(path.join(dir, 'gong-openapi.json'), 'utf8'));

const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head'];
const rows = [];
for (const [p, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!METHODS.includes(method)) continue;
    rows.push([op.tags?.[0] ?? '?', method.toUpperCase(), p, op.operationId ?? '']);
  }
}
rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]) || a[1].localeCompare(b[1]));

const lines = [
  '# Gong API operation inventory',
  '',
  `Generated from reference/gong-openapi.json (fetched ${fetchDate} from https://gong.app.gong.io/ajax/settings/api/documentation/specs). ${rows.length} operations.`,
  '',
  '| Tag | Method | Path | operationId |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.join(' | ')} |`),
  '',
];
fs.writeFileSync(path.join(dir, 'operations.md'), lines.join('\n'));
console.log(`operations.md: ${rows.length} operations`);
