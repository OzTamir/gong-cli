/**
 * `gong outcomes` — call outcomes defined in the Gong Dialer setup.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Outcomes
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { resolveListFormat } from '../output.js';
import { runPaginatedList } from '../pagination.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

export const registerOutcomes: GroupRegistrar = (program, ctx) => {
  const outcomes = program.command('outcomes').description('call outcomes (Dialer)');

  // ---- gong outcomes list — GET /v2/call-outcomes --------------------------------------
  outcomes
    .command('list')
    .description('list the call outcomes defined in Gong (GET /v2/call-outcomes)')
    .addHelpText(
      'after',
      `\nCall outcomes categorize the result of a dialer call (e.g. "Connected",\n"No Answer") and are set in the Dialer setup page. Requires the\napi:call-outcomes:read scope. This endpoint takes no parameters and does\nnot paginate. API docs: ${DOCS}#get-/v2/call-outcomes\n\nExamples:\n  gong outcomes list\n  gong outcomes list -o jsonl --fields callOutcome,category`,
    )
    .action(async function (this: Command) {
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'GET', path: '/v2/call-outcomes' },
        cursorIn: 'query',
        recordsKey: 'outcomes',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['callOutcome', 'category', 'connectStatus', 'sentiment', 'displayOrder'],
        },
      });
    });
};
