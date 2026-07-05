/** `gong users` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerUsers: GroupRegistrar = (program) => {
  program.command('users').description('work with Gong users');
};
