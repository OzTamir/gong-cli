/**
 * CliContext: every process/OS touchpoint the CLI uses, injectable so tests can run the
 * real command tree against fake HTTP, fake stdio, and a fake filesystem home.
 */
import { createRequire } from 'node:module';
import { openAsBlob } from 'node:fs';
import os from 'node:os';
import readline from 'node:readline/promises';

export interface OutStream {
  write(text: string): void;
  isTTY: boolean;
}

export interface CliContext {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  stdout: OutStream;
  stderr: OutStream;
  stdinIsTTY: boolean;
  /** Read all of stdin (for `--body-file -`). */
  readStdin(): Promise<string>;
  /** Ask an interactive question on the controlling terminal. */
  prompt(question: string): Promise<string>;
  sleep(ms: number): Promise<void>;
  /** Open a file as a Blob without buffering it in memory (multipart uploads). */
  openBlob(path: string): Promise<Blob>;
  homedir(): string;
  version: string;
}

export function packageVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json') as { version: string };
  return pkg.version;
}

export function createRealContext(): CliContext {
  return {
    env: process.env,
    fetchImpl: fetch,
    stdout: {
      write: (text) => void process.stdout.write(text),
      isTTY: process.stdout.isTTY === true,
    },
    stderr: {
      write: (text) => void process.stderr.write(text),
      isTTY: process.stderr.isTTY === true,
    },
    stdinIsTTY: process.stdin.isTTY === true,
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    },
    prompt: async (question) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    openBlob: (path) => openAsBlob(path),
    homedir: () => os.homedir(),
    version: packageVersion(),
  };
}
