/**
 * `gong config` — manage the config file ($XDG_CONFIG_HOME/gong/config.json).
 */
import type { GroupRegistrar } from '../program.js';
import {
  CONFIG_KEYS,
  configFilePath,
  configKeyToProp,
  loadConfigFile,
  saveConfigFile,
} from '../config.js';
import { CliError, EXIT } from '../errors.js';

const SECRET_PROPS = new Set(['accessKeySecret', 'bearerToken']);

function mask(value: unknown): string {
  const text = String(value);
  return text.length > 4 ? `****${text.slice(-4)}` : '****';
}

export const registerConfig: GroupRegistrar = (program, ctx) => {
  const config = program
    .command('config')
    .description('manage gong-cli configuration (credentials, base URL)');

  config
    .command('set')
    .description(`set a config value; keys: ${CONFIG_KEYS.join(', ')}`)
    .argument('<key>', `one of: ${CONFIG_KEYS.join(', ')}`)
    .argument('<value>', 'the value to store')
    .action((key: string, value: string) => {
      const prop = configKeyToProp(key);
      const current = loadConfigFile(ctx);
      current[prop] = value;
      saveConfigFile(ctx, current);
      ctx.stderr.write(`Set ${key} in ${configFilePath(ctx)}\n`);
    });

  config
    .command('get')
    .description('print a config value (secrets are masked)')
    .argument('<key>', `one of: ${CONFIG_KEYS.join(', ')}`)
    .action((key: string) => {
      const prop = configKeyToProp(key);
      const current = loadConfigFile(ctx);
      const value = current[prop];
      if (value === undefined) {
        throw new CliError(`Config key '${key}' is not set.`, { exitCode: EXIT.ERROR });
      }
      ctx.stdout.write(`${SECRET_PROPS.has(String(prop)) ? mask(value) : String(value)}\n`);
    });

  config
    .command('unset')
    .description('remove a config value')
    .argument('<key>', `one of: ${CONFIG_KEYS.join(', ')}`)
    .action((key: string) => {
      const prop = configKeyToProp(key);
      const current = loadConfigFile(ctx);
      delete current[prop];
      saveConfigFile(ctx, current);
      ctx.stderr.write(`Unset ${key} in ${configFilePath(ctx)}\n`);
    });

  config
    .command('list')
    .description('print the whole config as JSON (secrets are masked)')
    .action(() => {
      const current = loadConfigFile(ctx);
      const masked: Record<string, unknown> = {};
      for (const [prop, value] of Object.entries(current)) {
        masked[prop] = SECRET_PROPS.has(prop) ? mask(value) : value;
      }
      ctx.stdout.write(JSON.stringify(masked, null, 2) + '\n');
    });

  config
    .command('path')
    .description('print the config file path')
    .action(() => {
      ctx.stdout.write(configFilePath(ctx) + '\n');
    });
};
