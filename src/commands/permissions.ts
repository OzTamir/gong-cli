/** `gong permissions` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerPermissions: GroupRegistrar = (program) => {
  program.command('permissions').description('permission profiles and call access');
};
