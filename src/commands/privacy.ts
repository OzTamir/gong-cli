/** `gong privacy` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerPrivacy: GroupRegistrar = (program) => {
  program.command('privacy').description('data privacy lookups and purges');
};
