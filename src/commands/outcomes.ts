/** `gong outcomes` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerOutcomes: GroupRegistrar = (program) => {
  program.command('outcomes').description('call outcomes');
};
