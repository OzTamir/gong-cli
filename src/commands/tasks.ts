/** `gong tasks` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerTasks: GroupRegistrar = (program) => {
  program.command('tasks').description('Gong Engage tasks');
};
