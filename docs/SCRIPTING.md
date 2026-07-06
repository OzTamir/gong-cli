# Using gong in scripts

Conventions that make `gong` predictable for shells, pipelines, and agents.

## Output formats

`-o, --output <json|jsonl|table|raw>` on every command.

- Lists render a **table on a TTY** and **JSON when piped**; an explicit `-o` always wins.
- `json` — pretty JSON of the unwrapped payload; list commands emit the records array
  (`[]` when empty).
- `jsonl` — one record per line; streams page-by-page under `--all`, and records are
  always written whole, so partial output from an aborted run is still valid JSONL.
- `table` — curated columns per command; override with `--fields`.
- `raw` — the exact response body as received, byte-for-byte, envelope included.
- `--fields a.b,c` projects records to flat objects keyed by those dot-paths; a missing
  path yields `null`.

Numbers are lossless in every format: Gong payloads carry int64 IDs larger than
JavaScript's safe-integer range, and `gong` preserves their exact digits.

## Machine-readable diagnostics

stdout carries data only. Diagnostics go to stderr — prose on a TTY, **single-line JSON
when piped**:

```json
{"gongCliMeta":true,"nextCursor":"eyJhb…","totalRecords":263,"fetchedRecords":100,"pages":1}
{"error":true,"httpStatus":404,"requestId":"4al018gzaztcr8nbukw","errors":["Call ID was not found"],"exitCode":4,"message":"Gong API error (HTTP 404): Call ID was not found"}
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | API or unexpected error |
| 2 | usage error (bad flags, refused confirmation) |
| 3 | authentication (missing credentials, 401/403) |
| 4 | not found (404 on a get-by-id) |
| 5 | rate-limited after retries |

List commands treat a "no data in period" 404 as an empty result with exit 0.

## Pagination

Cursor-paginated commands fetch one page (~100 records) by default; the stderr meta line
carries `nextCursor` when more exist.

- `--all` — follow cursors to the end.
- `--limit <n>` — collect n records across pages, then stop.
- `--cursor <c>` — resume from a cursor.

If an `--all`/`--limit` run aborts mid-stream, records already emitted stay valid and the
meta line carries the cursor to resume from.

## Request bodies

Every documented API field has a flag; each flag's help names the field it maps to.
Body-taking commands also accept the whole request body:

```bash
gong calls search --body '{"filter":{"callIds":["123"]}}'
gong calls search --body-file query.json      # or '-' for stdin
```

Typed flags merge over the provided body: objects merge recursively; arrays and scalars
from flags replace wholesale.

## Dry runs and confirmations

- `--dry-run` prints the exact request (method, URL, redacted headers, body) as JSON and
  sends nothing. Works on every command, including destructive ones.
- Destructive commands (`privacy purge-*`, `meetings delete`, `crm integrations delete`,
  `permissions call-access revoke`) prompt on a TTY; when stdin is piped they refuse with
  exit 2 unless `--yes` is passed. Purges are irreversible.

## Credentials in scripts

Prefer env vars (`GONG_ACCESS_KEY`/`GONG_ACCESS_KEY_SECRET`) or a config file over
secret-bearing flags, which leak into shell history. A script can pin its own config
file with `--config <path>` (or `GONG_CONFIG`) — see
[config.example.json](config.example.json) for the format.

## Rate limits and retries

Gong's default limits are 3 calls/sec and 10,000 calls/day, company-wide. On 429 the CLI
retries automatically (up to 3 times, honoring `Retry-After`); `--no-retry` disables.
`--timeout <ms>` bounds each request.

## Dates

Full ISO-8601 passes through unchanged. A bare `YYYY-MM-DD` on a date-time field expands
to UTC midnight. Gong ranges are half-open: `from` inclusive, `to` exclusive. Date-only
fields (e.g. stats `fromDate`) take `YYYY-MM-DD` as-is.
