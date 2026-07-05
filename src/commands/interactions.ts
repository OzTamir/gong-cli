/** `gong interactions` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerInteractions: GroupRegistrar = (program) => {
  program.command('interactions').description('digital interactions');
};
