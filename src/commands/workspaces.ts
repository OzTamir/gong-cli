/**
 * `gong workspaces` — company workspaces.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Settings
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { resolveListFormat } from '../output.js';
import { runPaginatedList } from '../pagination.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

export const registerWorkspaces: GroupRegistrar = (program, ctx) => {
  const workspaces = program.command('workspaces').description('company workspaces');

  // ---- gong workspaces list — GET /v2/workspaces ---------------------------------------
  workspaces
    .command('list')
    .description('list all company workspaces (GET /v2/workspaces)')
    .addHelpText(
      'after',
      `\nWorkspace IDs feed the --workspace-id filters of other commands. This\nendpoint takes no parameters and does not paginate.\nAPI docs: ${DOCS}#get-/v2/workspaces\n\nExamples:\n  gong workspaces list\n  gong workspaces list -o jsonl --fields id,name`,
    )
    .action(async function (this: Command) {
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'GET', path: '/v2/workspaces' },
        cursorIn: 'query',
        recordsKey: 'workspaces',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['id', 'name', 'description'],
        },
      });
    });
};
