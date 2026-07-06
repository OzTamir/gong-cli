import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from './helpers.js';

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gong-cli-test-'));
  configPath = path.join(dir, 'config.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const env = () => ({ GONG_CONFIG: configPath });

describe('gong config', () => {
  it('set + get + list round trip with secret masking', async () => {
    const set1 = await runCli(['config', 'set', 'access-key', 'AK123456'], { env: env() });
    expect(set1.exitCode).toBe(0);
    const set2 = await runCli(['config', 'set', 'access-key-secret', 'SECRET9876'], {
      env: env(),
    });
    expect(set2.exitCode).toBe(0);

    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, string>;
    expect(stored.accessKey).toBe('AK123456');
    expect(stored.accessKeySecret).toBe('SECRET9876');

    const get = await runCli(['config', 'get', 'access-key'], { env: env() });
    expect(get.stdout.trim()).toBe('AK123456');

    const getSecret = await runCli(['config', 'get', 'access-key-secret'], { env: env() });
    expect(getSecret.stdout.trim()).toBe('****9876');

    const list = await runCli(['config', 'list'], { env: env() });
    const listed = JSON.parse(list.stdout) as Record<string, string>;
    expect(listed.accessKey).toBe('AK123456');
    expect(listed.accessKeySecret).toBe('****9876');
  });

  it('config file credentials authenticate requests', async () => {
    await runCli(['config', 'set', 'access-key', 'cfg-key'], { env: env() });
    await runCli(['config', 'set', 'access-key-secret', 'cfg-secret'], { env: env() });
    const run = await runCli(['auth', 'check'], {
      env: { ...env(), GONG_ACCESS_KEY: undefined, GONG_ACCESS_KEY_SECRET: undefined },
      responses: [{ body: { requestId: 'r', workspaces: [] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from('cfg-key:cfg-secret').toString('base64')}`,
    );
    expect((JSON.parse(run.stdout) as Record<string, unknown>).authSource).toBe('config');
  });

  it('env beats config file', async () => {
    await runCli(['config', 'set', 'access-key', 'cfg-key'], { env: env() });
    await runCli(['config', 'set', 'access-key-secret', 'cfg-secret'], { env: env() });
    const run = await runCli(['auth', 'check'], {
      env: env(), // TEST_ENV creds remain
      responses: [{ body: { requestId: 'r', workspaces: [] } }],
    });
    expect((JSON.parse(run.stdout) as Record<string, unknown>).authSource).toBe('env');
  });

  it('unset removes a key', async () => {
    await runCli(['config', 'set', 'base-url', 'https://x.api.gong.io'], { env: env() });
    await runCli(['config', 'unset', 'base-url'], { env: env() });
    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(stored.baseUrl).toBeUndefined();
  });

  it('path prints the config path', async () => {
    const run = await runCli(['config', 'path'], { env: env() });
    expect(run.stdout.trim()).toBe(configPath);
  });

  it('rejects unknown keys with exit 2', async () => {
    const run = await runCli(['config', 'set', 'nope', 'x'], { env: env() });
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("Unknown config key 'nope'");
  });

  it('invalid config file JSON is a clear usage error', async () => {
    fs.writeFileSync(configPath, '{not json');
    const run = await runCli(['auth', 'check'], { env: env() });
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('not valid JSON');
  });

  it('--config routes reads and writes to the given file', async () => {
    const altPath = path.join(dir, 'alt.json');
    const set = await runCli(['config', 'set', 'access-key', 'alt-key', '--config', altPath]);
    expect(set.exitCode).toBe(0);
    expect((JSON.parse(fs.readFileSync(altPath, 'utf8')) as Record<string, string>).accessKey).toBe(
      'alt-key',
    );

    const shown = await runCli(['config', 'path', '--config', altPath]);
    expect(shown.stdout.trim()).toBe(altPath);
  });

  it('--config beats GONG_CONFIG and authenticates requests', async () => {
    const altPath = path.join(dir, 'alt.json');
    fs.writeFileSync(
      altPath,
      JSON.stringify({ accessKey: 'flag-key', accessKeySecret: 'flag-secret' }),
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify({ accessKey: 'env-key', accessKeySecret: 'env-secret' }),
    );
    const run = await runCli(['auth', 'check', '--config', altPath], {
      env: { ...env(), GONG_ACCESS_KEY: undefined, GONG_ACCESS_KEY_SECRET: undefined },
      responses: [{ body: { requestId: 'r', workspaces: [] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from('flag-key:flag-secret').toString('base64')}`,
    );
  });
});
