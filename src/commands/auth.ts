/**
 * `gong auth check` — verify credentials with one cheap call (GET /v2/workspaces).
 */
import type { GroupRegistrar } from '../program.js';
import { resolveAuth } from '../config.js';
import { isDryRun } from '../client.js';
import { GongClient } from '../client.js';
import { getPath } from '../output.js';
import { globalOpts } from '../program.js';

export const registerAuth: GroupRegistrar = (program, ctx) => {
  const auth = program.command('auth').description('authentication helpers');

  auth
    .command('check')
    .description('verify Gong credentials with one cheap API call (GET /v2/workspaces)')
    .action(async function (this: import('commander').Command) {
      const globals = globalOpts(this);
      const resolved = resolveAuth(ctx, globals);
      const client = new GongClient(ctx, resolved, {
        retries: globals.retry === false ? 0 : undefined,
        timeoutMs: globals.timeout,
        dryRun: globals.dryRun,
        debug: globals.debug,
      });
      const result = await client.request({ method: 'GET', path: '/v2/workspaces' });
      if (isDryRun(result)) return;
      const workspaces = getPath(result.body, 'workspaces');
      const summary = {
        ok: true,
        authKind: resolved.kind,
        authSource: resolved.source,
        baseUrl: resolved.baseUrl,
        workspaceCount: Array.isArray(workspaces) ? workspaces.length : undefined,
      };
      ctx.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    });
};
