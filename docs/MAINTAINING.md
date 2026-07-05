# Maintaining gong-cli

How the code is organized, how to change it safely, and how to keep it in sync with
Gong's API. Read [DESIGN.md](DESIGN.md) first — it is the contract this codebase
implements (command grammar, flag naming, output/pagination/error conventions).

## Layout

```
src/
  index.ts          bin entry: Node version guard, then runCli
  program.ts        root command, global flags, exit-code mapping; attaches global
                    options to every leaf so they work after subcommands
  context.ts        CliContext — every process/OS touchpoint, injectable for tests
  config.ts         credential resolution (flags > env > config file)
  client.ts         GongClient: auth header, 429 retry, error mapping, multipart,
                    --dry-run, GET-with-body fallback (node:http) for /v2/crm/entities
  json.ts           lossless JSON (int64-safe) via JSON.parse source access + rawJSON
  output.ts         json/jsonl/table/raw renderers, --fields projection, stderr meta
  pagination.ts     runPaginatedList: cursor loop, --all/--limit/--cursor, 404-as-empty
  run.ts            runSingle: one-shot request → unwrap → emit
  body.ts           --body/--body-file + BodyFlagMap merge semantics
  util.ts           dates, csv, jsonFlag, confirmDestructive
  commands/         one file per command group; registered in commands/index.ts
tests/
  helpers.ts        runCli harness: real command tree, fake fetch/stdio/home
  core-*.test.ts    scaffold behavior (auth, client, output, pagination, config)
  <group>.test.ts   per-group request construction, pagination, output, errors
reference/
  gong-openapi.json vendored official spec (see reference/README.md for refresh steps)
  operations.md     generated inventory of all 67 documented operations
```

Command groups never import each other; each `commands/<group>.ts` exports one
`register<Group>` used by `commands/index.ts`. All HTTP goes through `GongClient`.

## Invariants to preserve

- **No live API calls in tests.** The harness injects a fake `fetch`; the one
  low-level-HTTP test spins a localhost server.
- **stdout is data only.** New diagnostics must go through `emitMeta`/`renderError` so
  the JSON-line stderr contract holds.
- **Lossless numbers.** Never `JSON.parse`/`JSON.stringify` an API payload directly;
  use `parseLossless`/`stringifyLossless` (`raw` output must stay byte-faithful).
- **Exit codes** are part of the interface (README table); map new failures through
  `CliError`.
- **Every documented API field stays exposable** — a flag (help text naming the mapped
  field) or `--body`. If Gong adds a field you don't want to flag-map, it must at least
  be settable via `--body`.

## Adding or changing a command

1. Find the operation in `reference/gong-openapi.json` (or `operations.md`).
2. Follow the exemplar: `src/commands/calls.ts` shows every pattern — GET list with
   query cursor, POST list with body cursor, single get with `unwrapKey`, body flags via
   `BodyFlagMap` + `buildBody`, required-field validation, multipart upload,
   destructive confirmation is in `privacy.ts`/`crm.ts`.
3. Respect the DESIGN.md grammar (bare-noun leaves for single-read sub-resources,
   verbs elsewhere) and flag naming (mechanical kebab-case + `--from`/`--to` aliases).
4. Add help: `maps to <field>` on every mapped flag, an API docs anchor, and an
   Examples section for body-taking commands.
5. Tests in `tests/<group>.test.ts`: assert exact method/URL/query/body and the auth
   header; cover pagination (`--all`, `--limit`) where present, one error mapping, the
   `--body` merge, and confirmation gating for destructive ops.
6. `npm run typecheck && npm test`, then update README's command table and SKILL.md if
   the surface changed.

## Keeping up with Gong's API

The vendored spec is the source of truth for coverage audits:

1. Re-download: `curl 'https://gong.app.gong.io/ajax/settings/api/documentation/specs?version=' -o reference/gong-openapi.json`
   then pretty-print (`python3 -m json.tool`). This is the spec behind Gong's own docs page.
2. Diff against the previous version; regenerate `reference/operations.md`
   (the generation snippet is in `reference/README.md`'s history — any script that walks
   `paths` and emits `tag | method | path | operationId` rows).
3. For each new/changed operation, walk its parameters and request-body schema and
   check the CLI exposes them (flags or `--body`). New operations get a command per the
   DESIGN.md grammar; removed ones get a deprecation note in help before deletion.
4. Watch for Gong's spec quirks — the machine spec sometimes disagrees with its own
   prose (e.g. `GET /v2/crm/entities` declares a query param the docs say is a body;
   params documented only in HTML descriptions). When in doubt, the prose wins; record
   the decision in DESIGN.md's "API quirks" section.

## Releasing

The package is publish-ready: `bin: gong`, `files` allowlist, `prepublishOnly` runs
typecheck + tests, `prepare` builds. To publish: bump `version`, `npm publish --access public`.
Verify locally first: `npm pack --dry-run` (tarball contents) and `npx . --help`.
