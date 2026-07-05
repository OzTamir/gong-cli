/** `gong coaching` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerCoaching: GroupRegistrar = (program) => {
  program.command('coaching').description('coaching metrics');
};
