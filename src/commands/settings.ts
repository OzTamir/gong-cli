/** `gong settings` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerSettings: GroupRegistrar = (program) => {
  program.command('settings').description('workspace settings: scorecards, trackers, AI briefs');
};
