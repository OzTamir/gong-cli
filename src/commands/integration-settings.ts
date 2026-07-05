/** `gong integration-settings` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerIntegrationSettings: GroupRegistrar = (program) => {
  program.command('integration-settings').description('integration settings');
};
