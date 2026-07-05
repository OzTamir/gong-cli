# gong-cli design

A TypeScript CLI for the [Gong Public API](https://gong.app.gong.io/settings/api/documentation),
built for people and agents working from the terminal and scripts. This document is the
source of truth for CLI structure and conventions; API semantics live in Gong's docs and in
`reference/gong-openapi.json`.

## Goals

- Every documented public Gong API operation reachable; every option each operation accepts exposable.
- Ergonomics over API mirroring: predictable nouns/verbs, sensible defaults, pipe-friendly output.
- Agent-friendly: JSON by default, JSONL streaming, `--body` escape hatches, `--dry-run`, clear exit codes.
- Zero-credential development: everything testable against mocked HTTP; never calls the live API in tests.

## Package

- npm name: `@oztamir/gong-cli` (unscoped `gong` and `gong-cli` are taken/squatted), bin: **`gong`**.
- Node >= 22 (Node 20 is EOL since 2026-04; 22 provides `JSON.parse` source access and
  `JSON.rawJSON`, which the lossless number handling below requires — verified locally).
  ESM, TypeScript strict. Built with `tsc` to `dist/`. `files` allowlist keeps `reference/`,
  `docs/`, and tests out of the tarball.
- Runtime dependency: `commander` only (native `fetch` for HTTP). Dev: `typescript`, `vitest`.

## Authentication

Per [Gong's auth docs](https://gong.app.gong.io/settings/api/documentation#overview): Basic
(`Base64(accessKey:accessKeySecret)`) or OAuth Bearer token.

Resolution precedence: **flags > environment > config file**.

| Source | Access key | Secret | Bearer | Base URL |
|---|---|---|---|---|
| Flag | `--access-key` | `--access-key-secret` | `--bearer-token` | `--base-url` |
| Env | `GONG_ACCESS_KEY` | `GONG_ACCESS_KEY_SECRET` | `GONG_BEARER_TOKEN` | `GONG_BASE_URL` |
| Config file | `accessKey` | `accessKeySecret` | `bearerToken` | `baseUrl` |

- Config file: `$XDG_CONFIG_HOME/gong/config.json` (default `~/.config/gong/config.json`),
  path overridable with `GONG_CONFIG`. Managed by `gong config set|get|unset|list|path`.
- If both bearer and key/secret resolve, bearer wins (documented).
- Default base URL `https://api.gong.io`; customers on dedicated cells override it (Gong shows
  your base URL on the API settings page). OAuth users must set the `api_base_url_for_customer`
  returned by Gong's token endpoint as `base-url`. Obtaining/refreshing OAuth tokens is a
  registered-app flow and out of CLI scope — the CLI accepts a ready Bearer token.
- `gong auth check` performs one cheap authenticated call (`GET /v2/workspaces`) to verify
  credentials and prints the resolved auth source.
- Missing credentials → actionable error (how to set each source) on stderr, exit code 3,
  without any HTTP call.

## HTTP client

- `User-Agent: gong-cli/<version>`.
- 429: honor `Retry-After`, retry up to 3 times (Gong default limits: 3 req/s, 10k/day).
  `--no-retry` disables.
- API errors (`{requestId, errors[]}`) surface on stderr per the machine-diagnostics
  contract below — prose on a TTY (`Gong API error (HTTP <status>): <errors> [requestId: <id>]`),
  a single JSON line otherwise.
- Exit codes: `0` ok · `1` API/unexpected error · `2` usage error · `3` auth (missing creds/401/403) ·
  `4` not found · `5` rate-limited after retries.
- `--dry-run` (global): print the would-be request (method, URL, headers with secrets redacted, body)
  as JSON to stdout and exit 0 — no network.
- `--debug` (global): request/response diagnostics on stderr, secrets redacted.

## Output

Global `-o, --output <json|jsonl|table|raw>`.

Default: `json` — except that **list commands render `table` when stdout is a TTY** (gh-style:
pipes and scripts never see a TTY, so they always get deterministic `json`; explicit `-o`
always wins).

- `json` — pretty JSON of the *unwrapped* payload (list commands emit the records array;
  empty list → `[]`).
- `jsonl` — one record per line (empty list → zero lines); streams page-by-page under
  `--all`, and a record is always written whole (never torn), so partial output from an
  aborted run is still valid JSONL.
- `table` — aligned columns; each list command has curated default columns; `--fields a.b,c`
  overrides (dot-paths). `--fields` also projects `json`/`jsonl`: output objects are flat,
  keyed by the requested path strings; a missing path yields `null` (stable shapes).
- `raw` — the exact response body **text as received** (no parse/re-serialize; byte-faithful).
  With `--all`, envelopes are emitted verbatim separated by one newline; Gong bodies are
  compact single-line JSON today, but consumers that cannot assume that should use a
  streaming parser.

**Lossless numbers everywhere**: several Gong payloads carry int64 IDs (`integrationId`,
scorecard/answered-scorecard/call IDs) that exceed `Number.MAX_SAFE_INTEGER`. All parsed
formats preserve them exactly — responses are parsed with `JSON.parse` source access
(out-of-safe-range integers become `BigInt`) and re-serialized via `JSON.rawJSON`, so
`json`/`jsonl`/`table` never corrupt an ID. (This is why the Node floor is 22.)

stdout carries data only; every diagnostic goes to stderr.

## Machine diagnostics (stderr contract)

When **stderr is not a TTY**, every diagnostic the CLI emits is a single-line JSON object
with a stable discriminator; when stderr is a TTY, the same information renders as prose.

- Pagination/meta: `{"gongCliMeta":true,"nextCursor":"...","totalRecords":263,"fetchedRecords":100,"pages":1}`
  — emitted after list output whenever more records remain, and on any aborted `--all`/
  `--limit` run (carrying the last good cursor), making every run resumable via `--cursor`.
- Errors: `{"error":true,"httpStatus":404,"requestId":"...","errors":["..."],"exitCode":4,"message":"<human text>"}`
  — also used for credential-missing (no `httpStatus`) and confirmation-refused cases.

Agents parse one line of JSON; humans read sentences. Both carry the same facts.

## Pagination

Gong paginates with an opaque `cursor` and a `records` envelope
(`totalRecords`, `currentPageSize`, `currentPageNumber`, `cursor`) — see
[Cursors](https://gong.app.gong.io/settings/api/documentation#overview). CLI convention for
every paginated command:

- Default: fetch one page; if more exist, the stderr meta line (see above) carries
  `totalRecords` and `nextCursor`.
- `--all`: follow cursors to the end (429-aware).
- `--limit <n>`: follow cursors until n records are collected, then stop (crosses pages —
  `--limit 500` really returns 500 even though Gong pages are ~100).
- `--cursor <c>`: resume from a cursor.
- If an `--all`/`--limit` run aborts mid-stream (429 retries exhausted, 5xx), records already
  emitted stay valid, and the stderr meta line carries the last successful cursor for resume.

Not everything that lists paginates: e.g. `POST /v2/tasks` and the permissions/CRM/library
groups return unpaginated payloads — pagination flags exist only on cursor-capable commands.

## Flag naming and dates

- **Canonical flag names are mechanical**: every API query/body field maps camelCase →
  kebab-case (`fromDateTime` → `--from-date-time`, `workspaceId` → `--workspace-id`),
  including nested body fields dot-flattened first (`filter.fromDateTime` →
  `--from-date-time`; collisions keep a parent prefix). Every such flag's help text states
  its API field path (e.g. "maps to `filter.fromDateTime`").
- **One curated alias set, applied uniformly**: the primary time-range of every command is
  also `--from` / `--to`, whatever the underlying field is called (`fromDateTime`,
  `fromDate`, `from`).
- **Date inputs**: full ISO-8601 passes through untouched. A bare `YYYY-MM-DD` on a
  date-time field expands to `T00:00:00Z` (UTC day boundary — with Gong's half-open
  `[from, to)` ranges, `--from 2026-07-01 --to 2026-07-05` covers those four full days).
  Date-only fields (e.g. stats `fromDate`) take `YYYY-MM-DD` as-is.
- Positional arguments are uniformly named `<id>`.

## Command tree

Nouns are plural resources. Leaves follow one rule: **a leaf that names a sub-resource whose
only operation is a read is a bare noun** (`library folders`, `settings trackers`,
`flows steps`); everything else is a verb — `list|get|create|update|delete` plus domain verbs
(`search`, `transcript`, `assign`...). If a leaf is a noun, it fetches. Complete
operation ↔ command mapping:

| Command | API operation |
|---|---|
| `gong calls list` | `GET /v2/calls` |
| `gong calls get <id>` | `GET /v2/calls/{id}` |
| `gong calls search` | `POST /v2/calls/extensive` |
| `gong calls transcript` | `POST /v2/calls/transcript` |
| `gong calls create` | `POST /v2/calls` |
| `gong calls upload-media <id>` | `PUT /v2/calls/{id}/media` |
| `gong users list` | `GET /v2/users` |
| `gong users get <id>` | `GET /v2/users/{id}` |
| `gong users history <id>` | `GET /v2/users/{id}/settings-history` |
| `gong users search` | `POST /v2/users/extensive` |
| `gong coaching list` | `GET /v2/coaching` |
| `gong stats activity aggregate` | `POST /v2/stats/activity/aggregate` |
| `gong stats activity by-period` | `POST /v2/stats/activity/aggregate-by-period` |
| `gong stats activity day-by-day` | `POST /v2/stats/activity/day-by-day` |
| `gong stats activity scorecards` | `POST /v2/stats/activity/scorecards` |
| `gong stats interaction` | `POST /v2/stats/interaction` |
| `gong library folders` | `GET /v2/library/folders` |
| `gong library folder-calls` | `GET /v2/library/folder-content` |
| `gong workspaces list` | `GET /v2/workspaces` |
| `gong settings scorecards` | `GET /v2/settings/scorecards` |
| `gong settings trackers` | `GET /v2/settings/trackers` |
| `gong settings briefs` | `GET /v2/settings/briefs` |
| `gong outcomes list` | `GET /v2/call-outcomes` |
| `gong crm integrations get` | `GET /v2/crm/integrations` |
| `gong crm integrations register` | `PUT /v2/crm/integrations` |
| `gong crm integrations delete` | `DELETE /v2/crm/integrations` |
| `gong crm objects get` | `GET /v2/crm/entities` |
| `gong crm objects upload` | `POST /v2/crm/entities` |
| `gong crm schema list` | `GET /v2/crm/entity-schema` |
| `gong crm schema upload` | `POST /v2/crm/entity-schema` |
| `gong crm request-status <id>` | `GET /v2/crm/request-status` |
| `gong flows list` | `GET /v2/flows` |
| `gong flows folders` | `GET /v2/flows/folders` |
| `gong flows steps` | `POST /v2/flows/steps` |
| `gong flows prospects list` | `POST /v2/flows/prospects` |
| `gong flows prospects assign` (incl. `--cool-off-override` body flag) | `POST /v2/flows/prospects/assign` |
| `gong flows prospects assign --legacy-cool-off-endpoint` | `POST /v2/flows/prospects/assign/cool-off-override` (deprecated by Gong) |
| `gong flows prospects unassign --crm-id ...` | `POST /v2/flows/prospects/unassign-flows-by-crm-id` |
| `gong flows prospects unassign --instance-id ...` | `POST /v2/flows/prospects/unassign-flows-by-instance-id` |
| `gong flows prospects bulk-assign` | `POST /v2/flows/prospects/bulk-assignments` |
| `gong flows prospects bulk-assign-status <id>` | `GET /v2/flows/prospects/bulk-assignments/{id}` |
| `gong permissions profiles list` | `GET /v2/all-permission-profiles` |
| `gong permissions profiles get <id>` | `GET /v2/permission-profile` |
| `gong permissions profiles create` | `POST /v2/permission-profile` |
| `gong permissions profiles update <id>` | `PUT /v2/permission-profile` |
| `gong permissions profiles users <id>` | `GET /v2/permission-profile/users` |
| `gong permissions call-access get` | `POST /v2/calls/users-access` |
| `gong permissions call-access grant` | `PUT /v2/calls/users-access` |
| `gong permissions call-access revoke` | `DELETE /v2/calls/users-access` |
| `gong privacy for-email <email>` | `GET /v2/data-privacy/data-for-email-address` |
| `gong privacy for-phone <phone>` | `GET /v2/data-privacy/data-for-phone-number` |
| `gong privacy purge-email <email>` | `POST /v2/data-privacy/erase-data-for-email-address` |
| `gong privacy purge-phone <phone>` | `POST /v2/data-privacy/erase-data-for-phone-number` |
| `gong logs list` | `GET /v2/logs` |
| `gong meetings create` | `POST /v2/meetings` |
| `gong meetings update <id>` | `PUT /v2/meetings/{meetingId}` |
| `gong meetings delete <id>` | `DELETE /v2/meetings/{meetingId}` |
| `gong meetings integration-status` | `POST /v2/meetings/integration/status` |
| `gong tasks list` | `POST /v2/tasks` |
| `gong tasks update <id>` | `PATCH /v2/tasks/{taskId}` |
| `gong entities ask` | `GET /v2/entities/ask-entity` |
| `gong entities brief` | `GET /v2/entities/get-brief` |
| `gong interactions create` | `POST /v2/digital-interaction` |
| `gong engagement content-viewed` | `PUT /v2/customer-engagement/content/viewed` |
| `gong engagement content-shared` | `PUT /v2/customer-engagement/content/shared` |
| `gong engagement custom-action` | `PUT /v2/customer-engagement/action` |
| `gong integration-settings set` | `POST /v2/integration-settings` |

Plus CLI-only commands: `gong config …`, `gong auth check`.

Destructive operations (`privacy purge-*`, `meetings delete`, `crm integrations delete`,
`permissions call-access revoke`) require `--yes` when stdin is not a TTY; without `--yes`,
non-TTY runs refuse with exit 2 and a machine-readable error line. On a TTY they prompt —
and the irreversible, no-status-endpoint purges (`privacy purge-*`) require re-typing the
target email/phone (gh-repo-delete pattern).

## Request bodies on complex POST endpoints

Two complementary mechanisms, both always available:

1. **First-class flags** for every documented body field (naming per "Flag naming and dates",
   e.g. `--from`, `--to`, `--workspace-id`, `--exposed-fields parties,content.trackers`).
   Repeatable/CSV flags for arrays.
2. **`--body <json>` / `--body-file <path|->`** — supply the full request body (stdin with `-`).

Merge semantics (exact):

- Only flags the user actually typed merge over `--body`; a command's own defaults apply only
  when *neither* a flag nor the body provides the field.
- Objects merge recursively; arrays and scalars from flags **replace** wholesale; `null`
  values inside `--body` are preserved.
- `--body`/`--body-file` on a command whose operation has no request body is a usage error
  (exit 2). Both flags appear in every body-taking command's `--help`.
- Every body-taking command's `--help` ends with an Examples section: one flags-form and one
  `--body`-form invocation.

This guarantees full option coverage even where flag mapping would be lossy, and gives agents a
direct JSON path. `--dry-run` prints the merged result for verification: a fixed-shape
`{"method","url","headers","body"}` object (secrets redacted), unaffected by `-o`/`--fields`;
with `--all` it prints the first request only (later cursors are unknowable offline).

## API quirks the CLI absorbs

Findings from the official spec that shape implementation (full operation details live in
`reference/gong-openapi.json` and Gong's docs):

- **GET with a JSON body**: `GET /v2/crm/entities` requires `objectsCrmIds` as a JSON array in
  the *request body* (per Gong's own description; the machine spec claims a query param) —
  `fetch` forbids GET bodies, so the client has a `node:https`-based escape hatch for this
  operation.
- **Async operations**: CRM object uploads and integration deletion return
  `clientRequestId`-keyed 201s polled via `gong crm request-status` (schema uploads are
  plain synchronous calls); flows bulk assignment returns 202 polled via
  `gong flows prospects bulk-assign-status`. Purges (`gong privacy purge-*`) are
  fire-and-forget with no status endpoint.
- **Uploads**: `calls upload-media` (binary, ≤1.5 GB) and `crm objects upload` (LDJSON,
  ≤200 MB) are multipart; files stream via `fs.openAsBlob` (never buffered whole).
- **404 means "no data in period" on list endpoints** (`/v2/logs`, `/v2/calls`,
  `/v2/calls/extensive`, `/v2/calls/transcript`, `/v2/users/extensive`,
  `/v2/stats/interaction`, library endpoints...). Uniform rule: *list* commands map 404 to
  an empty result with exit 0 plus a stderr note carrying the API's message; *get-by-id*
  commands keep 404 → exit 4.
- **Deprecated**: `flows prospects assign/cool-off-override` (superseded by the
  `overrides.coolOffOverride` body field) stays reachable behind an explicitly-named flag.
- **Beta/licensed surfaces**: Meetings endpoints are limited-release (403 until enabled);
  Engage flows/tasks need an Engage license; `entities ask|brief` consume Gong credits
  (can return 402). Command help says so.
- Cursor location differs by verb — query param on GETs, top-level body field on POSTs —
  the pagination helper handles both.

## Source layout

```
src/
  index.ts        bin entry (#!/usr/bin/env node)
  program.ts      root command, global options, group registration
  context.ts      CliContext: env, stdio, fetch — injectable for tests
  config.ts       credential/config resolution
  client.ts       GongClient: auth, retries, errors, dry-run
  output.ts       json/jsonl/table/raw renderers + --fields projection
  pagination.ts   cursor-following helpers
  commands/       one file per command group (owns its group end-to-end)
tests/
  helpers.ts      runCli(argv) harness with mocked fetch + captured stdio
  <group>.test.ts unit tests per group: request construction, pagination, output
```

Each command group registers itself via `register<Group>(program, ctx)`; groups never import
each other — enabling parallel implementation and isolated tests.

## SKILL.md

Single agent skill at the repo root (`SKILL.md`), per the Agent Skills spec — installable with
`npx skills add oztamir/gong-cli` (the skills CLI scans root SKILL.md; proven pattern for
single-skill CLI repos). Frontmatter: `name: gong-cli` (must match the repo directory name),
a trigger-rich `description`, `license`, `metadata`. Body: prerequisites (install + auth),
secret-safety rules, task-grouped command reference, output/pagination conventions.

## Testing strategy

No live API calls, ever. Tests drive the real `commander` program through `runCli(argv)` with an
injected fake `fetch` that records requests and returns canned Gong-shaped payloads (from the
official spec's examples). Each command asserts: exact method/URL/query, body JSON, auth header,
pagination behavior (`--all`, `--cursor`, `--limit`), output formats, and error/exit-code
mapping. The test context pins `isTTY` explicitly (default non-TTY), so both the table-on-TTY
default and the JSON-vs-prose stderr contract are covered.

Auth docs additionally warn that `--access-key-secret`/`--bearer-token` flags leak into shell
history and `ps` — prefer env vars or the config file.
