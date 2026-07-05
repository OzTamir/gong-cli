<div align="center">
  <h1>gong-cli</h1>
  <p>
    <a href="https://www.npmjs.com/package/@oztamir/gong-cli">
      <img alt="npm package" src="https://img.shields.io/npm/v/%40oztamir%2Fgong-cli?logo=npm&label=npm&color=cb3837">
    </a>
  </p>
</div>

A command-line client for the [Gong API](https://gong.app.gong.io/settings/api/documentation).
Covers every documented API operation.

```bash
npm install -g @oztamir/gong-cli
gong auth check
gong calls list --from 2026-06-01 --to 2026-07-01
```

## Authentication

Create an access key and secret on Gong's API settings page, then use any of
(highest precedence first):

| Source | |
|---|---|
| Flags | `--access-key`, `--access-key-secret`, `--bearer-token` |
| Environment | `GONG_ACCESS_KEY`, `GONG_ACCESS_KEY_SECRET`, `GONG_BEARER_TOKEN` |
| Config file | `gong config set access-key <key>` → `~/.config/gong/config.json` |

`gong auth check` verifies credentials with a single API call. OAuth users pass their
token via `--bearer-token`/`GONG_BEARER_TOKEN` and set the base URL Gong issued them
(`GONG_BASE_URL` or `gong config set base-url`).

## Commands

```text
calls        list · get · search · transcript · create · upload-media
users        list · get · history · search
stats        activity aggregate|by-period|day-by-day|scorecards · interaction
crm          integrations · objects · schema · request-status
flows        list · folders · steps · prospects …
permissions  profiles … · call-access …
library      folders · folder-calls
settings     scorecards · trackers · briefs
privacy      for-email · for-phone · purge-email · purge-phone
meetings     create · update · delete · integration-status
tasks        list · update
entities     ask · brief
coaching · workspaces · outcomes · logs · interactions · engagement · integration-settings
auth check · config
```

Every command maps to one documented API operation; its `--help` shows the mapping,
every available flag, examples, and a link to the relevant section of Gong's API
reference. API semantics live in Gong's docs, not here.

## Scripting

- `-o json|jsonl|table|raw` — lists render a table on a TTY and JSON when piped;
  `raw` is the exact response body. `--fields a.b,c` projects records. Int64 IDs are
  preserved exactly in every format.
- stdout carries data only. When stderr is piped, diagnostics are single-line JSON:
  pagination meta (`{"gongCliMeta":true,"nextCursor":…}`) and errors
  (`{"error":true,"httpStatus":…,"requestId":…}`).
- Paginated commands fetch one page by default; `--all` follows cursors to the end,
  `--limit <n>` stops after n records, `--cursor <c>` resumes.
- Body-taking commands accept the full request body via `--body <json>` or
  `--body-file <path|->`; typed flags merge over it.
- `--dry-run` prints the request without sending it. `--yes` confirms destructive
  commands non-interactively; without it they refuse when stdin is not a TTY.
- Exit codes: `0` ok · `1` API error · `2` usage · `3` auth · `4` not found ·
  `5` rate-limited after retries. 429s are retried automatically per `Retry-After`.

## Agent skill

`SKILL.md` at the repo root is an [Agent Skill](https://agentskills.io) for this CLI:
`npx skills add oztamir/gong-cli`.

## Development

```bash
npm install && npm test    # vitest against mocked HTTP; never calls the live API
```

See [docs/DESIGN.md](docs/DESIGN.md) for CLI conventions and
[docs/MAINTAINING.md](docs/MAINTAINING.md) for architecture and how to track Gong API
changes.

## License

MIT
