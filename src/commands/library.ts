/** `gong library` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerLibrary: GroupRegistrar = (program) => {
  program.command('library').description('call library folders');
};
