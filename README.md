# gong-cli

A command-line client for the [Gong API](https://gong.app.gong.io/settings/api/documentation),
built for humans **and** agents. Every documented public Gong API operation is reachable;
output is pipe-friendly; errors and pagination are machine-readable.

```bash
npm install -g @oztamir/gong-cli    # or: npx @oztamir/gong-cli
gong auth check
gong calls list --from 2026-06-01 --to 2026-07-01
```

Requires Node.js >= 22.

## Authentication

Create an access key + secret on Gong's API settings page (technical administrators only),
then provide credentials via any of (highest precedence first):

| Source | How |
|---|---|
| Flags | `--access-key <key> --access-key-secret <secret>` (or `--bearer-token <token>`) |
| Environment | `GONG_ACCESS_KEY` + `GONG_ACCESS_KEY_SECRET` (or `GONG_BEARER_TOKEN`) |
| Config file | `gong config set access-key <key>` etc. → `~/.config/gong/config.json` |

Prefer env vars or the config file — secret-bearing flags end up in shell history.
A bearer token (from [Gong's OAuth flow](https://gong.app.gong.io/settings/api/documentation#overview))
wins over key+secret; OAuth apps must also set the `api_base_url_for_customer` they receive
as the base URL (`GONG_BASE_URL` or `gong config set base-url …`). `gong auth check`
verifies whatever is configured with one cheap API call.

## Commands

Every command maps to a documented Gong API operation (shown in its `--help`, which also
links to the relevant [Gong API docs](https://gong.app.gong.io/settings/api/documentation)
section — API semantics live there, not here).

| Group | Commands |
|---|---|
| `gong calls` | `list` · `get <id>` · `search` · `transcript` · `create` · `upload-media <id>` |
| `gong users` | `list` · `get <id>` · `history <id>` · `search` |
| `gong coaching` | `list` |
| `gong stats` | `activity aggregate` · `activity by-period` · `activity day-by-day` · `activity scorecards` · `interaction` |
| `gong crm` | `integrations get\|register\|delete` · `objects get\|upload` · `schema list\|upload` · `request-status <id>` |
| `gong flows` | `list` · `folders` · `steps` · `prospects list\|assign\|unassign\|bulk-assign\|bulk-assign-status <id>` |
| `gong permissions` | `profiles list\|get <id>\|create\|update <id>\|users <id>` · `call-access get\|grant\|revoke` |
| `gong library` | `folders` · `folder-calls` |
| `gong settings` | `scorecards` · `trackers` · `briefs` |
| `gong workspaces` | `list` |
| `gong outcomes` | `list` |
| `gong privacy` | `for-email <email>` · `for-phone <phone>` · `purge-email <email>` · `purge-phone <phone>` |
| `gong logs` | `list` |
| `gong meetings` | `create` · `update <id>` · `delete <id>` · `integration-status` (beta) |
| `gong tasks` | `list` · `update <id>` |
| `gong entities` | `ask` · `brief` (AI, consumes Gong credits) |
| `gong interactions` | `create` |
| `gong engagement` | `content-viewed` · `content-shared` · `custom-action` (legacy) |
| `gong integration-settings` | `set` |
| `gong auth` / `gong config` | `check` / `set\|get\|unset\|list\|path` |

## Output

`-o, --output <json|jsonl|table|raw>`. Lists render a table on a TTY and JSON when piped;
explicit `-o` always wins. `jsonl` streams one record per line. `raw` prints the exact
response body byte-for-byte. `--fields a.b,c` projects records to those dot-paths.

All formats preserve Gong's int64 IDs exactly (no JavaScript number corruption).

stdout is data only. Diagnostics go to stderr — as single-line JSON when stderr is piped:

```
{"gongCliMeta":true,"nextCursor":"…","totalRecords":263,"fetchedRecords":100,"pages":1}
{"error":true,"httpStatus":404,"requestId":"…","errors":["…"],"exitCode":4,"message":"…"}
```

Exit codes: `0` ok · `1` API/unexpected error · `2` usage · `3` auth · `4` not found ·
`5` rate-limited after retries.

## Pagination

Cursor-paginated commands fetch one page (~100 records) by default; the stderr meta line
carries the next cursor. `--all` follows cursors to the end, `--limit <n>` stops after n
records (crossing pages), `--cursor <c>` resumes. Aborted runs emit the resume cursor.

## Request bodies

Every documented API field has a flag (its help text names the mapped field). Body-taking
commands also accept `--body '<json>'` / `--body-file <path|->` with the full request body;
typed flags merge over it (objects deep-merge, arrays/scalars replace). `--dry-run` prints
the exact request without sending — works on every command.

```bash
gong calls search --from 2026-06-01 --to 2026-07-01 --parties --trackers -o jsonl --all
gong calls search --body-file query.json -o json
gong calls transcript --call-ids 7782342274025937895 --dry-run
```

Dates: ISO-8601 passes through; bare `YYYY-MM-DD` on date-time fields expands to UTC
midnight. Gong ranges are half-open: `from` inclusive, `to` exclusive.

## Safety and limits

- Destructive commands (`privacy purge-*`, `meetings delete`, `crm integrations delete`,
  `permissions call-access revoke`) prompt on a TTY and require `--yes` when piped.
  Purges are irreversible.
- Gong's default limits are 3 calls/sec and 10,000 calls/day; 429s are retried
  automatically honoring `Retry-After` (`--no-retry` disables).
- `flows`/`tasks` need a Gong Engage license; `meetings` endpoints are beta/limited
  release; `entities ask|brief` consume Gong credits.

## For agents

`SKILL.md` at the repo root is an [Agent Skill](https://agentskills.io) for this CLI —
install it with `npx skills add oztamir/gong-cli`.

## Development

```bash
npm install        # also builds (prepare)
npm test           # vitest, mocked HTTP only — never calls the live API
npm run typecheck
npm run build
npm link           # then: gong --help
```

Architecture, conventions, and how to keep the CLI in sync with Gong's API surface:
[docs/DESIGN.md](docs/DESIGN.md) and [docs/MAINTAINING.md](docs/MAINTAINING.md).

## License

MIT
