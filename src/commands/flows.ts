/** `gong flows` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerFlows: GroupRegistrar = (program) => {
  program.command('flows').description('Gong Engage flows and prospect assignment');
};
