/**
 * Credential and configuration resolution. Precedence: flags > environment > config file.
 * Config file: $GONG_CONFIG > $XDG_CONFIG_HOME/gong/config.json > ~/.config/gong/config.json.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { CliContext } from './context.js';
import { CliError, EXIT } from './errors.js';

export const DEFAULT_BASE_URL = 'https://api.gong.io';

export interface FileConfig {
  accessKey?: string;
  accessKeySecret?: string;
  bearerToken?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface AuthFlags {
  accessKey?: string;
  accessKeySecret?: string;
  bearerToken?: string;
  baseUrl?: string;
  /** Explicit config file path (--config); wins over GONG_CONFIG and the default. */
  config?: string;
}

export interface ResolvedAuth {
  kind: 'basic' | 'bearer';
  header: string;
  baseUrl: string;
  /** Where the winning credentials came from: 'flags' | 'env' | 'config' */
  source: string;
}

export const CONFIG_KEYS = ['access-key', 'access-key-secret', 'bearer-token', 'base-url'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

const KEY_TO_PROP: Record<ConfigKey, keyof FileConfig> = {
  'access-key': 'accessKey',
  'access-key-secret': 'accessKeySecret',
  'bearer-token': 'bearerToken',
  'base-url': 'baseUrl',
};

export function configKeyToProp(key: string): keyof FileConfig {
  if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
    throw new CliError(
      `Unknown config key '${key}'. Valid keys: ${CONFIG_KEYS.join(', ')}`,
      { exitCode: EXIT.USAGE },
    );
  }
  return KEY_TO_PROP[key as ConfigKey];
}

export function configFilePath(ctx: CliContext, override?: string): string {
  if (override) return override;
  if (ctx.env.GONG_CONFIG) return ctx.env.GONG_CONFIG;
  const configHome = ctx.env.XDG_CONFIG_HOME || path.join(ctx.homedir(), '.config');
  return path.join(configHome, 'gong', 'config.json');
}

export function loadConfigFile(ctx: CliContext, override?: string): FileConfig {
  const file = configFilePath(ctx, override);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as FileConfig;
  } catch {
    throw new CliError(`Config file ${file} is not valid JSON.`, {
      exitCode: EXIT.USAGE,
      hint: `Fix or remove it, or point GONG_CONFIG at another file.`,
    });
  }
}

export function saveConfigFile(ctx: CliContext, config: FileConfig, override?: string): void {
  const file = configFilePath(ctx, override);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

const MISSING_CREDENTIALS_HINT = [
  'Provide credentials one of these ways:',
  '  flags:  --access-key <key> --access-key-secret <secret>   (or --bearer-token <token>)',
  '  env:    GONG_ACCESS_KEY + GONG_ACCESS_KEY_SECRET           (or GONG_BEARER_TOKEN)',
  '  config: gong config set access-key <key> && gong config set access-key-secret <secret>',
  'Create keys in Gong: https://app.gong.io/company/api (technical administrators only).',
].join('\n');

/**
 * Resolve auth without mixing sources: the highest-precedence source that provides any
 * credential wins outright. Within a source, a bearer token wins over key+secret.
 */
export function resolveAuth(ctx: CliContext, flags: AuthFlags): ResolvedAuth {
  const file = loadConfigFile(ctx, flags.config);
  const baseUrl =
    flags.baseUrl ?? ctx.env.GONG_BASE_URL ?? (file.baseUrl || undefined) ?? DEFAULT_BASE_URL;

  const candidates: Array<{ source: string; bearer?: string; key?: string; secret?: string }> = [
    {
      source: 'flags',
      bearer: flags.bearerToken,
      key: flags.accessKey,
      secret: flags.accessKeySecret,
    },
    {
      source: 'env',
      bearer: ctx.env.GONG_BEARER_TOKEN,
      key: ctx.env.GONG_ACCESS_KEY,
      secret: ctx.env.GONG_ACCESS_KEY_SECRET,
    },
    {
      source: 'config',
      bearer: file.bearerToken,
      key: file.accessKey,
      secret: file.accessKeySecret,
    },
  ];

  for (const c of candidates) {
    if (c.bearer) {
      return { kind: 'bearer', header: `Bearer ${c.bearer}`, baseUrl, source: c.source };
    }
    if (c.key || c.secret) {
      if (!c.key || !c.secret) {
        throw new CliError(
          `Incomplete Gong credentials from ${c.source}: both the access key and the access key secret are required.`,
          { exitCode: EXIT.AUTH, hint: MISSING_CREDENTIALS_HINT },
        );
      }
      const token = Buffer.from(`${c.key}:${c.secret}`).toString('base64');
      return { kind: 'basic', header: `Basic ${token}`, baseUrl, source: c.source };
    }
  }

  throw new CliError('No Gong credentials found.', {
    exitCode: EXIT.AUTH,
    hint: MISSING_CREDENTIALS_HINT,
  });
}
