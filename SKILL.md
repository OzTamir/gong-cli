---
name: gong-cli
description: >-
  Work with the Gong API from the terminal using the `gong` CLI: list and search
  calls, download call transcripts, look up users and their stats, browse the call
  library, manage Engage flows and tasks, upload CRM data, run data-privacy lookups
  and purges, and reach every other documented Gong API operation. Use when the user
  wants anything from Gong — "pull a Gong call", "grab that transcript", "who spoke
  on the call", "sales call recording", "export Gong calls", "Gong stats/scorecards",
  "assign prospects to a flow", "purge this email from Gong" — or mentions the Gong
  API, gong-cli, or an app.gong.io call URL.
license: MIT
metadata:
  author: oztamir
  homepage: https://github.com/oztamir/gong-cli
---

# gong — Agent Skill Reference

`gong` is a CLI for the [Gong API](https://gong.app.gong.io/settings/api/documentation).
Every documented Gong API operation is reachable through it. This reference covers the
patterns agents need; `--help` on any command is authoritative and links to Gong's API docs.

## Prerequisites

The CLI must be installed (`gong --version`) — install with `npm install -g @oztamir/gong-cli`
or run via `npx @oztamir/gong-cli`.

Credentials must already be configured (any one of):

- env: `GONG_ACCESS_KEY` + `GONG_ACCESS_KEY_SECRET` (or `GONG_BEARER_TOKEN`)
- config file: `gong config set access-key …` / `access-key-secret …` (stored in `~/.config/gong/config.json`)
- flags: `--access-key`/`--access-key-secret`/`--bearer-token` (avoid: leaks into shell history)

Verify before doing real work:

```bash
gong auth check          # one cheap API call; exit 0 = credentials work, exit 3 = auth problem
```

If it fails with exit 3, ask the user to configure credentials — do not guess keys.
Companies on a dedicated Gong cell may also need `GONG_BASE_URL` (or `gong config set base-url …`).

### Secret safety (mandatory)

- Never print, cat, or echo `~/.config/gong/config.json`, `GONG_ACCESS_KEY_SECRET`, or bearer tokens.
- Never ask the user to paste credentials into chat; point them at `gong config set` or env vars.
- `gong config list`/`get` mask secrets — safe to run.

## Output contract (read this first)

- **Always pass `-o json` (or `-o jsonl`) in scripts and agent runs.** Without `-o`, list
  commands render a human table when stdout is a TTY.
- stdout carries only data. All diagnostics go to stderr; when stderr is piped they are
  **single-line JSON**:
  - pagination meta: `{"gongCliMeta":true,"nextCursor":"…","totalRecords":263,"fetchedRecords":100,"pages":1}`
  - errors: `{"error":true,"httpStatus":404,"requestId":"…","errors":["…"],"exitCode":4,"message":"…"}`
- Exit codes: `0` ok · `1` API/unexpected error · `2` usage error · `3` auth · `4` not found ·
  `5` rate-limited after retries.
- List commands emit the unwrapped records array (`[]` when empty; a "no data in period"
  404 from Gong is treated as an empty list, exit 0). `-o raw` prints the exact response
  body byte-for-byte (envelope included) — use it when int64 IDs must survive verbatim,
  though normal `json`/`jsonl` output is also lossless for big integers.
- `--fields a.b,c` projects records to flat objects keyed by those dot-paths (missing → null).

## Pagination

Cursor-paginated commands (calls/users/flows/logs lists, stats, transcripts) fetch **one page
(~100 records) by default** and put `nextCursor` in the stderr meta line.

```bash
gong calls list --from 2026-06-01 --to 2026-07-01 --all -o jsonl   # everything, streamed
gong calls list --from 2026-06-01 --to 2026-07-01 --limit 250      # first 250 across pages
gong calls list --from 2026-06-01 --to 2026-07-01 --cursor "$CUR"  # resume from meta line
```

If an `--all` run aborts mid-way, records already emitted are valid and the meta line
carries the cursor to resume from.

## Request bodies and escape hatches

- Every documented API field has a flag; flag help says which field it maps to
  (`--call-ids … "maps to filter.callIds"`).
- POST/PUT commands also accept the full request body: `--body '<json>'` or
  `--body-file <path|->`. Typed flags merge over the body (objects deep-merge; arrays and
  scalars from flags replace).
- `--dry-run` prints the exact request (method, URL, redacted headers, body) as JSON and
  sends nothing — use it to verify a request before running it for real.
- Dates: full ISO-8601 passes through; bare `YYYY-MM-DD` on date-time fields expands to UTC
  midnight. Gong ranges are `[from, to)` — from inclusive, to exclusive.

## Command map

```text
calls        list · get <id> · search · transcript · create · upload-media <id>
users        list · get <id> · history <id> · search
coaching     list
stats        activity aggregate|by-period|day-by-day|scorecards · interaction
crm          integrations get|register|delete · objects get|upload · schema list|upload · request-status <id>
flows        list · folders · steps · prospects list|assign|unassign|bulk-assign|bulk-assign-status <id>
permissions  profiles list|get|create|update|users <id> · call-access get|grant|revoke
library      folders · folder-calls
settings     scorecards · trackers · briefs
workspaces   list
outcomes     list
privacy      for-email <email> · for-phone <phone> · purge-email <email> · purge-phone <phone>
logs         list
meetings     create · update <id> · delete <id> · integration-status   (beta: 403 until enabled)
tasks        list · update <id>
entities     ask · brief                                               (AI; consumes Gong credits, 402 possible)
interactions create
engagement   content-viewed · content-shared · custom-action           (legacy)
integration-settings set
auth         check
config       set|get|unset|list|path
```

## Recipes

Recent calls with titles and hosts:

```bash
gong calls list --from 2026-06-28 --to 2026-07-05 -o json --fields id,title,started,primaryUserId
```

Full transcript of one call, with speaker identities (two steps — transcripts only carry
`speakerId`; names come from the parties of `calls search`):

```bash
gong calls search --call-ids 7782342274025937895 --parties -o json > call.json
gong calls transcript --call-ids 7782342274025937895 -o json > transcript.json
# join transcript[].speakerId against call.json parties[].speakerId
```

Rich call data (topics, trackers, brief, outline):

```bash
gong calls search --from 2026-06-01 --to 2026-07-01 --topics --trackers --brief --outline -o jsonl --all
```

Find a user and their activity stats:

```bash
gong users list -o json --fields id,emailAddress,firstName,lastName
gong stats activity aggregate --from 2026-06-01 --to 2026-06-30 --user-ids <id> -o json
```

Who said what about a topic — search calls, then filter transcripts by tracker occurrences:

```bash
gong settings trackers -o json            # find tracker IDs
gong calls search --from 2026-06-01 --to 2026-07-01 --trackers --tracker-occurrences -o jsonl
```

Upload a recorded call (two-step):

```bash
gong calls create --client-unique-id rec-42 --actual-start 2026-06-15T10:00:00Z \
  --direction Outbound --primary-user <gongUserId> \
  --parties '[{"emailAddress":"rep@example.com","userId":"<gongUserId>"}]' -o json
gong calls upload-media <returnedCallId> --media ./recording.mp3
```

## Cautions

- **Destructive commands** (`privacy purge-*`, `meetings delete`, `crm integrations delete`,
  `permissions call-access revoke`) prompt on a TTY and **refuse without `--yes` when piped**.
  Never pass `--yes` unless the user explicitly confirmed the destructive intent.
  `privacy purge-*` is irreversible and has no status endpoint.
- Rate limits: 3 calls/sec, 10k/day company-wide. 429s are retried automatically
  (honoring Retry-After); prefer `--all` streaming over rapid-fire single calls.
- `flows`/`tasks` need a Gong Engage license; `meetings` is beta (403 until enabled);
  `entities ask|brief` consume Gong credits (402 = out of credits).
- `calls search --media` URLs expire after 8 hours.
