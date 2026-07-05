# API reference materials

- `gong-openapi.json` — the official Gong Public API OpenAPI 3.0.1 spec, pretty-printed.
  Fetched 2026-07-05 from `https://gong.app.gong.io/ajax/settings/api/documentation/specs?version=`
  (the spec backing Gong's own docs at <https://gong.app.gong.io/settings/api/documentation>).
- `operations.md` — generated inventory of all 67 documented operations, used for CLI coverage audits.

To refresh: re-download the spec from the URL above, pretty-print with `python3 -m json.tool`,
regenerate `operations.md`, and diff against the CLI command surface (see docs/MAINTAINING.md).

These files are reference material only — they are not shipped in the npm package.
