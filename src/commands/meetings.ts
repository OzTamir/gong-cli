/** `gong meetings` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerMeetings: GroupRegistrar = (program) => {
  program.command('meetings').description('Gong meetings (beta)');
};
