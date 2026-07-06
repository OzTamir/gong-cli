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

# or run without installing
npx @oztamir/gong-cli calls list --from 2026-06-01 --to 2026-07-01
```

## Examples

```bash
# calls from the last month, as a table
gong calls list --from 2026-06-01 --to 2026-07-01

# every June transcript, streamed as JSONL
gong calls transcript --from 2026-06-01 --to 2026-07-01 --all -o jsonl

# rich data for one call: participants, topics, trackers
gong calls search --call-ids 7782342274025937895 --parties --topics --trackers

# look up users, picking fields
gong users list -o json --fields id,emailAddress,firstName,lastName

# preview any request without sending it
gong stats activity aggregate --from 2026-06-01 --to 2026-06-30 --dry-run
```

## Agent skill

An [Agent Skill](https://agentskills.io) ships with this repo, teaching coding agents
the CLI's conventions and recipes. Install it for your agent with:

```bash
npx skills add oztamir/gong-cli
```

## Authentication

Create an access key and secret on Gong's API settings page, then use any of
(highest precedence first):

| Source | |
|---|---|
| Flags | `--access-key`, `--access-key-secret`, `--bearer-token` |
| Environment | `GONG_ACCESS_KEY`, `GONG_ACCESS_KEY_SECRET`, `GONG_BEARER_TOKEN` |
| Config file | `gong config set access-key <key>` → `~/.config/gong/config.json` |

The config file is plain JSON ([sample](docs/config.example.json)); point at an
alternative file with `--config <path>` or `GONG_CONFIG`. Use `bearerToken` instead of
the key pair for OAuth. `gong auth check` verifies credentials with a single API call. OAuth users pass their
token via `--bearer-token`/`GONG_BEARER_TOKEN` and set the base URL Gong issued them
(`GONG_BASE_URL` or `gong config set base-url`).

## Commands

| Group | Commands |
|---|---|
| `calls` | `list` · `get` · `search` · `transcript` · `create` · `upload-media` |
| `users` | `list` · `get` · `history` · `search` |
| `coaching` | `list` |
| `stats` | `activity aggregate` · `activity by-period` · `activity day-by-day` · `activity scorecards` · `interaction` |
| `crm` | `integrations get\|register\|delete` · `objects get\|upload` · `schema list\|upload` · `request-status` |
| `flows` | `list` · `folders` · `steps` · `prospects list\|assign\|unassign\|bulk-assign\|bulk-assign-status` |
| `permissions` | `profiles list\|get\|create\|update\|users` · `call-access get\|grant\|revoke` |
| `library` | `folders` · `folder-calls` |
| `settings` | `scorecards` · `trackers` · `briefs` |
| `workspaces` | `list` |
| `outcomes` | `list` |
| `privacy` | `for-email` · `for-phone` · `purge-email` · `purge-phone` |
| `logs` | `list` |
| `meetings` | `create` · `update` · `delete` · `integration-status` |
| `tasks` | `list` · `update` |
| `entities` | `ask` · `brief` |
| `interactions` | `create` |
| `engagement` | `content-viewed` · `content-shared` · `custom-action` |
| `integration-settings` | `set` |
| `auth` / `config` | `check` / `set` · `get` · `unset` · `list` · `path` |

Every command maps to one documented API operation; its `--help` shows the mapping,
every available flag, examples, and a link to the relevant section of Gong's API
reference. API semantics live in Gong's docs, not here.

## Documentation

| | |
|---|---|
| [docs/SCRIPTING.md](docs/SCRIPTING.md) | Output formats, machine-readable diagnostics, pagination, request bodies, exit codes |
| [docs/DESIGN.md](docs/DESIGN.md) | CLI conventions and design decisions |
| [docs/MAINTAINING.md](docs/MAINTAINING.md) | Architecture and tracking Gong API changes |
| [SKILL.md](SKILL.md) | Agent Skill for this CLI — `npx skills add oztamir/gong-cli` |

## Development

```bash
npm install && npm test    # vitest against mocked HTTP; never calls the live API
```

## License

MIT
