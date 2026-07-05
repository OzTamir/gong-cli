/** `gong crm` command group — full implementation lands with its lane (docs/DESIGN.md). */
import type { GroupRegistrar } from '../program.js';

export const registerCrm: GroupRegistrar = (program) => {
  program.command('crm').description('generic CRM integration: objects, schema, request status');
};
