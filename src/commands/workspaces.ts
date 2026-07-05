/** `gong workspaces` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerWorkspaces: GroupRegistrar = (program) => {
  program.command('workspaces').description('company workspaces');
};
