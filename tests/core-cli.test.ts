import { describe, expect, it } from 'vitest';

import { runCli, TEST_AUTH_HEADER } from './helpers.js';

describe('program basics', () => {
  it('prints help with all command groups and exits 0', async () => {
    const run = await runCli(['--help']);
    expect(run.exitCode).toBe(0);
    for (const group of [
      'calls',
      'users',
      'coaching',
      'stats',
      'crm',
      'flows',
      'permissions',
      'library',
      'settings',
      'workspaces',
      'outcomes',
      'privacy',
      'logs',
      'meetings',
      'tasks',
      'entities',
      'interactions',
      'engagement',
      'integration-settings',
      'auth',
      'config',
    ]) {
      expect(run.stdout).toContain(group);
    }
    expect(run.stdout).toContain('Gong API reference');
    expect(run.requests).toHaveLength(0);
  });

  it('prints the version and exits 0', async () => {
    const run = await runCli(['--version']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim()).toBe('0.0.0-test');
  });

  it('unknown command exits 2 with a machine-readable stderr line', async () => {
    const run = await runCli(['does-not-exist']);
    expect(run.exitCode).toBe(2);
    const jsonLine = run.stderr
      .split('\n')
      .find((line) => line.startsWith('{'));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine as string) as Record<string, unknown>;
    expect(parsed.error).toBe(true);
    expect(parsed.exitCode).toBe(2);
  });
});

describe('credential resolution', () => {
  it('fails with exit 3 and actionable hint when no credentials exist', async () => {
    const run = await runCli(['auth', 'check'], {
      env: { GONG_ACCESS_KEY: undefined, GONG_ACCESS_KEY_SECRET: undefined },
    });
    expect(run.exitCode).toBe(3);
    expect(run.requests).toHaveLength(0);
    const parsed = JSON.parse(run.stderr.trim()) as Record<string, unknown>;
    expect(parsed.error).toBe(true);
    expect(parsed.exitCode).toBe(3);
    expect(parsed.message).toContain('No Gong credentials');
    expect(String(parsed.hint)).toContain('GONG_ACCESS_KEY');
  });

  it('renders prose (not JSON) on a TTY stderr', async () => {
    const run = await runCli(['auth', 'check'], {
      env: { GONG_ACCESS_KEY: undefined, GONG_ACCESS_KEY_SECRET: undefined },
      stderrTTY: true,
    });
    expect(run.exitCode).toBe(3);
    expect(run.stderr).toContain('No Gong credentials found.');
    expect(run.stderr.trim().startsWith('{')).toBe(false);
  });

  it('sends Basic auth from env credentials', async () => {
    const run = await runCli(['auth', 'check'], {
      responses: [{ body: { requestId: 'r', workspaces: [{ id: '1' }, { id: '2' }] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.headers.authorization).toBe(TEST_AUTH_HEADER);
    expect(run.requests[0]?.url).toBe('https://api.gong.io/v2/workspaces');
    const summary = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(summary.ok).toBe(true);
    expect(summary.authKind).toBe('basic');
    expect(summary.authSource).toBe('env');
    expect(summary.workspaceCount).toBe(2);
  });

  it('prefers flags over env, and bearer over basic within a source', async () => {
    const run = await runCli(
      ['auth', 'check', '--bearer-token', 'flag-token'],
      { responses: [{ body: { requestId: 'r', workspaces: [] } }] },
    );
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.headers.authorization).toBe('Bearer flag-token');
    const summary = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(summary.authKind).toBe('bearer');
    expect(summary.authSource).toBe('flags');
  });

  it('uses GONG_BASE_URL for requests', async () => {
    const run = await runCli(['auth', 'check'], {
      env: { GONG_BASE_URL: 'https://us-12345.api.gong.io' },
      responses: [{ body: { requestId: 'r', workspaces: [] } }],
    });
    expect(run.exitCode).toBe(0);
    expect(run.requests[0]?.url).toBe('https://us-12345.api.gong.io/v2/workspaces');
  });

  it('incomplete key/secret pair fails with exit 3 before any request', async () => {
    const run = await runCli(['auth', 'check'], {
      env: { GONG_ACCESS_KEY_SECRET: undefined },
    });
    expect(run.exitCode).toBe(3);
    expect(run.requests).toHaveLength(0);
    expect(run.stderr).toContain('Incomplete Gong credentials');
  });
});

describe('--dry-run', () => {
  it('prints the request without sending it', async () => {
    const run = await runCli(['auth', 'check', '--dry-run']);
    expect(run.exitCode).toBe(0);
    expect(run.requests).toHaveLength(0);
    const printed = JSON.parse(run.stdout) as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: unknown;
    };
    expect(printed.method).toBe('GET');
    expect(printed.url).toBe('https://api.gong.io/v2/workspaces');
    expect(printed.headers.authorization).toBe('Basic ***');
    expect(printed.body).toBeNull();
  });
});
