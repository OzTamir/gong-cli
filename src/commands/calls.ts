/** `gong calls` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerCalls: GroupRegistrar = (program) => {
  program.command('calls').description('work with Gong calls (list, get, search, transcripts, create, upload media)');
};
