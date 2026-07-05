/** `gong engagement` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerEngagement: GroupRegistrar = (program) => {
  program.command('engagement').description('legacy engagement events (superseded by digital interactions)');
};
