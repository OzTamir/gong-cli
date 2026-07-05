/** `gong entities` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerEntities: GroupRegistrar = (program) => {
  program.command('entities').description('AI queries about CRM entities (ask, brief)');
};
