/** `gong stats` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerStats: GroupRegistrar = (program) => {
  program.command('stats').description('user activity and interaction stats');
};
