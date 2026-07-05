/**
 * `gong integration-settings` — configure integration settings for displaying company
 * data in iFrames, e.g. register dynamic origins as valid iFrame sources.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Integration-Settings
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { addBodyOptions, buildBody, hasPath, setPath } from '../body.js';
import type { BodyFlagMap } from '../body.js';
import { CliError, EXIT } from '../errors.js';
import { runSingle } from '../run.js';
import { jsonFlag } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

export const registerIntegrationSettings: GroupRegistrar = (program, ctx) => {
  const group = program
    .command('integration-settings')
    .description('configure integration settings for displaying company data in iFrames');

  // ---- gong integration-settings set — POST /v2/integration-settings -------------------
  const SET_MAP: BodyFlagMap = {
    integrationTypeSettings: { path: 'integrationTypeSettings' },
  };

  const set = group
    .command('set')
    .description('set dynamic iFrame origins for the company (POST /v2/integration-settings)')
    .option('--integration-type-settings <json>', 'JSON array of {integrationType,allowedOrigin} pairs (maps to integrationTypeSettings; required)', jsonFlag('--integration-type-settings'))
    .option('--integration-type <type>', 'EMAIL_COMPOSER|ACCOUNT_PAGES|DIALER; with --allowed-origin builds a single-entry list (maps to integrationTypeSettings[].integrationType)')
    .option('--allowed-origin <origin>', 'a valid origin usable as the iFrame source, e.g. https://acme.partner.com (maps to integrationTypeSettings[].allowedOrigin)');
  addBodyOptions(set);
  set
    .addHelpText(
      'after',
      `\nRequires the api:integration-settings:write scope. The response integrationId is\nan int64; output preserves it losslessly.\nAPI docs: ${DOCS}#post-/v2/integration-settings\n\nExamples:\n  gong integration-settings set --integration-type EMAIL_COMPOSER --allowed-origin https://acme.partner.com\n  gong integration-settings set --integration-type-settings '[{"integrationType":"EMAIL_COMPOSER","allowedOrigin":"https://acme.partner.com"},{"integrationType":"DIALER","allowedOrigin":"https://dial.partner.com"}]'`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ integrationType?: string; allowedOrigin?: string }>();
      const typedType = this.getOptionValueSource('integrationType') === 'cli';
      const typedOrigin = this.getOptionValueSource('allowedOrigin') === 'cli';
      const typedList = this.getOptionValueSource('integrationTypeSettings') === 'cli';

      if ((typedType || typedOrigin) && typedList) {
        throw new CliError(
          'Use --integration-type/--allowed-origin or --integration-type-settings, not both.',
          { exitCode: EXIT.USAGE },
        );
      }
      if (typedType !== typedOrigin) {
        throw new CliError('--integration-type and --allowed-origin must be given together.', {
          exitCode: EXIT.USAGE,
        });
      }

      const body = ((await buildBody(set, ctx, SET_MAP)) ?? {}) as Record<string, unknown>;
      if (typedType && typedOrigin) {
        // The pair flags build a single-entry list; like any typed flag, it replaces an
        // integrationTypeSettings array coming from --body wholesale.
        setPath(body, 'integrationTypeSettings', [
          { integrationType: opts.integrationType, allowedOrigin: opts.allowedOrigin },
        ]);
      }
      if (!hasPath(body, 'integrationTypeSettings')) {
        throw new CliError(
          'gong integration-settings set is missing required fields: integrationTypeSettings.',
          {
            exitCode: EXIT.USAGE,
            hint: 'Provide --integration-type with --allowed-origin, --integration-type-settings, or --body/--body-file.',
          },
        );
      }
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/integration-settings', body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });
};
