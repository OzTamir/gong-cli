/**
 * `gong library` — Gong call library: public folders and the calls inside them.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Library
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { resolveListFormat } from '../output.js';
import { runPaginatedList } from '../pagination.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

export const registerLibrary: GroupRegistrar = (program, ctx) => {
  const library = program
    .command('library')
    .description('call library: public folders and the calls they contain');

  // ---- gong library folders — GET /v2/library/folders ----------------------------------
  library
    .command('folders')
    .description('list public library folders (GET /v2/library/folders)')
    .option('--workspace-id <id>', 'only folders in this workspace (maps to workspaceId)')
    .addHelpText(
      'after',
      `\nPrivate and archived folders are never returned. The hierarchy arrives flat:\nreconstruct the tree via parentFolderId (null = root folder). This endpoint\ndoes not paginate — the full list arrives in one response.\nAPI docs: ${DOCS}#get-/v2/library/folders\n\nExamples:\n  gong library folders\n  gong library folders --workspace-id 623457276584334 -o jsonl`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ workspaceId?: string }>();
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/library/folders',
          query: { workspaceId: opts.workspaceId },
        },
        cursorIn: 'query',
        recordsKey: 'folders',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['id', 'name', 'parentFolderId', 'updated'],
        },
      });
    });

  // ---- gong library folder-calls — GET /v2/library/folder-content ----------------------
  library
    .command('folder-calls')
    .description('list the calls in a library folder (GET /v2/library/folder-content)')
    .option(
      '--folder-id <id>',
      "Gong's numeric folder ID, from 'gong library folders' (maps to folderId)",
    )
    .addHelpText(
      'after',
      `\nOutputs the folder's calls. The folder's own metadata (id, name, createdBy,\nupdated) sits at the top level of the API envelope next to 'calls' — use\n-o raw to see the envelope verbatim. The spec marks folderId optional, but\nGong describes the endpoint as folder-scoped; pass --folder-id in practice.\nThis endpoint does not paginate.\nAPI docs: ${DOCS}#get-/v2/library/folder-content\n\nExamples:\n  gong library folder-calls --folder-id 3843152912968920037\n  gong library folder-calls --folder-id 3843152912968920037 -o jsonl`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ folderId?: string }>();
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/library/folder-content',
          query: { folderId: opts.folderId },
        },
        cursorIn: 'query',
        recordsKey: 'calls',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['id', 'title', 'note', 'addedBy', 'created'],
        },
      });
    });
};
