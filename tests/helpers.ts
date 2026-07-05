/**
 * Test harness: run the real command tree against fake HTTP, fake stdio, and a fake home.
 * No live API calls, ever.
 *
 * Usage:
 *   const run = await runCli(['calls', 'list', '--from', '2026-01-01', '--to', '2026-02-01'], {
 *     responses: [{ body: { requestId: 'r1', records: {...}, calls: [...] } }],
 *   });
 *   expect(run.exitCode).toBe(0);
 *   expect(run.requests[0].url).toBe('https://api.gong.io/v2/calls?...');
 */
import { runCli as programRunCli } from '../src/program.js';
import type { CliContext } from '../src/context.js';
import { parseLossless, stringifyLossless } from '../src/json.js';

export interface MockResponse {
  status?: number;
  /** Object bodies are stringified losslessly; string bodies are sent verbatim. */
  body?: unknown;
  headers?: Record<string, string>;
}

export interface CapturedMultipartEntry {
  kind: 'field' | 'file';
  value?: string;
  filename?: string;
  size?: number;
  contentType?: string;
}

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Raw request body text (JSON requests). */
  bodyText?: string;
  /** Lossless-parsed request body (JSON requests). */
  body?: unknown;
  /** Captured multipart entries, keyed by form field name. */
  multipart?: Record<string, CapturedMultipartEntry>;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  requests: CapturedRequest[];
  /** Arguments passed to ctx.sleep (429 retry waits). */
  sleeps: number[];
  /** Questions asked via ctx.prompt. */
  prompts: string[];
}

export interface RunOptions {
  /** Sequential responses; a function receives the captured request. Default: one 200 {}. */
  responses?: Array<MockResponse | ((request: CapturedRequest) => MockResponse)>;
  /** Environment; defaults provide test credentials. Pass null values to unset. */
  env?: Record<string, string | undefined>;
  stdoutTTY?: boolean;
  stderrTTY?: boolean;
  stdinTTY?: boolean;
  /** Data returned by ctx.readStdin() (--body-file -). */
  stdinData?: string;
  /** Sequential answers returned by ctx.prompt(). */
  promptAnswers?: string[];
  /** Blobs returned by ctx.openBlob, keyed by path. Missing path → error, like real fs. */
  blobs?: Record<string, Blob>;
}

export const TEST_ENV: Record<string, string> = {
  GONG_ACCESS_KEY: 'test-key',
  GONG_ACCESS_KEY_SECRET: 'test-secret',
};

/** Authorization header the default TEST_ENV credentials produce. */
export const TEST_AUTH_HEADER = `Basic ${Buffer.from('test-key:test-secret').toString('base64')}`;

async function captureRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<CapturedRequest> {
  const captured: CapturedRequest = {
    method: init.method ?? 'GET',
    url,
    headers: Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    ),
  };
  if (typeof init.body === 'string') {
    captured.bodyText = init.body;
    try {
      captured.body = parseLossless(init.body);
    } catch {
      /* non-JSON body text */
    }
  } else if (init.body instanceof FormData) {
    const multipart: Record<string, CapturedMultipartEntry> = {};
    for (const [name, value] of init.body.entries()) {
      if (typeof value === 'string') {
        multipart[name] = { kind: 'field', value };
      } else {
        multipart[name] = {
          kind: 'file',
          filename: value.name,
          size: value.size,
          contentType: value.type || undefined,
        };
      }
    }
    captured.multipart = multipart;
  }
  return captured;
}

export interface TestContextState {
  stdout: () => string;
  stderr: () => string;
  requests: CapturedRequest[];
  sleeps: number[];
  prompts: string[];
}

export function makeTestContext(options: RunOptions = {}): { ctx: CliContext; state: TestContextState } {
  let stdout = '';
  let stderr = '';
  const requests: CapturedRequest[] = [];
  const sleeps: number[] = [];
  const prompts: string[] = [];
  const promptAnswers = [...(options.promptAnswers ?? [])];
  const responses = [...(options.responses ?? [{ body: {} }])];

  const env: Record<string, string | undefined> = { ...TEST_ENV, ...options.env };

  const fakeFetch = (async (input: unknown, init: unknown = {}) => {
    const url = typeof input === 'string' ? input : String(input);
    const captured = await captureRequest(
      url,
      init as { method?: string; headers?: Record<string, string>; body?: unknown },
    );
    requests.push(captured);
    const next = responses.length > 1 ? responses.shift() : responses[0];
    const resolved = typeof next === 'function' ? next(captured) : (next ?? { body: {} });
    const status = resolved.status ?? 200;
    const bodyText =
      typeof resolved.body === 'string'
        ? resolved.body
        : stringifyLossless(resolved.body ?? {});
    return new Response(bodyText, {
      status,
      headers: { 'content-type': 'application/json', ...(resolved.headers ?? {}) },
    });
  }) as typeof fetch;

  const ctx: CliContext = {
    env,
    fetchImpl: fakeFetch,
    stdout: {
      write: (text) => {
        stdout += text;
      },
      isTTY: options.stdoutTTY ?? false,
    },
    stderr: {
      write: (text) => {
        stderr += text;
      },
      isTTY: options.stderrTTY ?? false,
    },
    stdinIsTTY: options.stdinTTY ?? false,
    readStdin: async () => options.stdinData ?? '',
    prompt: async (question) => {
      prompts.push(question);
      const answer = promptAnswers.shift();
      if (answer === undefined) {
        throw new Error('Test asked for a prompt answer but none were provided.');
      }
      return answer;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    openBlob: async (path) => {
      const blob = options.blobs?.[path];
      if (!blob) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return blob;
    },
    homedir: () => '/nonexistent-test-home',
    version: '0.0.0-test',
  };

  return {
    ctx,
    state: {
      stdout: () => stdout,
      stderr: () => stderr,
      requests,
      sleeps,
      prompts,
    },
  };
}

export async function runCli(argv: string[], options: RunOptions = {}): Promise<RunResult> {
  const { ctx, state } = makeTestContext(options);
  const exitCode = await programRunCli(['node', 'gong', ...argv], ctx);
  return {
    stdout: state.stdout(),
    stderr: state.stderr(),
    exitCode,
    requests: state.requests,
    sleeps: state.sleeps,
    prompts: state.prompts,
  };
}

/** Parse each stdout line as JSON (jsonl assertions). */
export function parseJsonLines(text: string): unknown[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}
