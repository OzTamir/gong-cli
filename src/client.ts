/**
 * GongClient: one place for URL building, auth headers, retries, error mapping,
 * multipart uploads, the GET-with-body escape hatch, --dry-run and --debug.
 */
import http from 'node:http';
import https from 'node:https';

import type { CliContext } from './context.js';
import type { ResolvedAuth } from './config.js';
import { CliError, exitCodeForStatus, EXIT } from './errors.js';
import { parseLossless, stringifyLossless } from './json.js';

export type QueryValue = string | number | boolean | Array<string | number> | undefined;

export interface MultipartSpec {
  /** Form field name for the file part. */
  field: string;
  /** Path on disk; streamed via fs.openAsBlob, never buffered whole. */
  path: string;
  filename?: string;
  contentType?: string;
  /** Additional plain form fields. */
  fields?: Record<string, string | undefined>;
}

export interface RequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, QueryValue>;
  /** JSON body (may contain BigInt from lossless parsing). */
  body?: unknown;
  multipart?: MultipartSpec;
  /**
   * Gong's GET /v2/crm/entities requires a JSON body on a GET request. fetch() rejects
   * that, so the client falls back to a plain node:http(s) request when fetch throws.
   */
  getWithBody?: boolean;
  /** Return the 404 response instead of throwing (list commands: 404 = "no data"). */
  notFoundOk?: boolean;
}

export interface GongResponse {
  dryRun?: false;
  status: number;
  ok: boolean;
  bodyText: string;
  /** Lossless-parsed JSON body; undefined when the body is not valid JSON. */
  body: unknown;
  headers: Record<string, string>;
}

export interface DryRunResult {
  dryRun: true;
}

export type RequestResult = GongResponse | DryRunResult;

export function isDryRun(result: RequestResult): result is DryRunResult {
  return result.dryRun === true;
}

export interface ClientOptions {
  retries?: number;
  timeoutMs?: number;
  dryRun?: boolean;
  debug?: boolean;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRY_AFTER_S = 60;

export class GongClient {
  private readonly ctx: CliContext;
  private readonly auth: ResolvedAuth;
  private readonly retries: number;
  private readonly timeoutMs: number;
  private readonly dryRun: boolean;
  private readonly debug: boolean;

  constructor(ctx: CliContext, auth: ResolvedAuth, options: ClientOptions = {}) {
    this.ctx = ctx;
    this.auth = auth;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.dryRun = options.dryRun ?? false;
    this.debug = options.debug ?? false;
  }

  buildUrl(spec: RequestSpec): string {
    const url = new URL(this.auth.baseUrl.replace(/\/+$/, '') + spec.path);
    for (const [name, value] of Object.entries(spec.query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(name, String(item));
      } else {
        url.searchParams.append(name, String(value));
      }
    }
    return url.toString();
  }

  private baseHeaders(): Record<string, string> {
    return {
      authorization: this.auth.header,
      'user-agent': `gong-cli/${this.ctx.version}`,
    };
  }

  private redactedHeaders(headers: Record<string, string>): Record<string, string> {
    const out = { ...headers };
    if (out.authorization) {
      out.authorization = out.authorization.startsWith('Bearer') ? 'Bearer ***' : 'Basic ***';
    }
    return out;
  }

  async request(spec: RequestSpec): Promise<RequestResult> {
    const url = this.buildUrl(spec);
    const headers = this.baseHeaders();
    let bodyText: string | undefined;
    if (spec.body !== undefined) {
      headers['content-type'] = 'application/json';
      bodyText = stringifyLossless(spec.body);
    }

    if (this.dryRun) {
      const shape = {
        method: spec.method,
        url,
        headers: this.redactedHeaders(headers),
        body:
          spec.multipart !== undefined
            ? {
                multipart: {
                  [spec.multipart.field]: `@${spec.multipart.path}`,
                  ...(spec.multipart.fields ?? {}),
                },
              }
            : (spec.body ?? null),
      };
      this.ctx.stdout.write(stringifyLossless(shape, 2) + '\n');
      return { dryRun: true };
    }

    for (let attempt = 0; ; attempt++) {
      const response = await this.send(spec, url, headers, bodyText);
      if (response.status === 429 && attempt < this.retries) {
        const retryAfter = Number(response.headers['retry-after']);
        const waitS = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : attempt + 1;
        const waitMs = Math.min(waitS, MAX_RETRY_AFTER_S) * 1000;
        this.debugLog(`429 received, retrying in ${waitMs}ms (attempt ${attempt + 1}/${this.retries})`);
        await this.ctx.sleep(waitMs);
        continue;
      }
      if (!response.ok && !(response.status === 404 && spec.notFoundOk)) {
        throw this.toError(response);
      }
      return response;
    }
  }

  private async send(
    spec: RequestSpec,
    url: string,
    headers: Record<string, string>,
    bodyText: string | undefined,
  ): Promise<GongResponse> {
    const started = Date.now();
    this.debugLog(`→ ${spec.method} ${url}`);

    let body: string | FormData | undefined = bodyText;
    if (spec.multipart) {
      const form = new FormData();
      for (const [name, value] of Object.entries(spec.multipart.fields ?? {})) {
        if (value !== undefined) form.append(name, value);
      }
      const blob = await this.ctx.openBlob(spec.multipart.path);
      const filename = spec.multipart.filename ?? spec.multipart.path.split('/').pop() ?? 'file';
      const file = spec.multipart.contentType
        ? new File([blob], filename, { type: spec.multipart.contentType })
        : new File([blob], filename);
      form.append(spec.multipart.field, file);
      body = form;
      delete headers['content-type']; // fetch sets the multipart boundary itself
    }

    let response: GongResponse;
    try {
      const raw = await this.ctx.fetchImpl(url, {
        method: spec.method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await raw.text();
      response = {
        status: raw.status,
        ok: raw.ok,
        bodyText: text,
        body: tryParse(text),
        headers: headersToObject(raw.headers),
      };
    } catch (error) {
      if (spec.getWithBody && bodyText !== undefined && error instanceof TypeError) {
        // fetch refuses GET requests with a body; Gong requires one for GET /v2/crm/entities.
        response = await this.sendRaw(spec.method, url, headers, bodyText);
      } else if (isTimeoutError(error)) {
        throw new CliError(`Request timed out after ${this.timeoutMs}ms: ${spec.method} ${url}`, {
          exitCode: EXIT.ERROR,
        });
      } else {
        throw new CliError(
          `Network error calling ${spec.method} ${url}: ${error instanceof Error ? error.message : String(error)}`,
          { exitCode: EXIT.ERROR },
        );
      }
    }

    this.debugLog(`← ${response.status} (${Date.now() - started}ms)`);
    return response;
  }

  /** Minimal node:http(s) request for verbs fetch refuses (GET with body). */
  private sendRaw(
    method: string,
    url: string,
    headers: Record<string, string>,
    bodyText: string,
  ): Promise<GongResponse> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'http:' ? http : https;
      const req = transport.request(
        parsed,
        {
          method,
          headers: {
            ...headers,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(bodyText),
          },
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            const responseHeaders: Record<string, string> = {};
            for (const [name, value] of Object.entries(res.headers)) {
              if (typeof value === 'string') responseHeaders[name.toLowerCase()] = value;
            }
            resolve({
              status,
              ok: status >= 200 && status < 300,
              bodyText: text,
              body: tryParse(text),
              headers: responseHeaders,
            });
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`timed out after ${this.timeoutMs}ms`)));
      req.on('error', (error) =>
        reject(new CliError(`Network error calling ${method} ${url}: ${error.message}`)),
      );
      req.end(bodyText);
    });
  }

  private toError(response: GongResponse): CliError {
    const api = (response.body ?? {}) as { requestId?: string; errors?: unknown };
    const apiErrors = Array.isArray(api.errors) ? api.errors.map(String) : undefined;
    const detail = apiErrors?.length
      ? apiErrors.join('; ')
      : response.bodyText.slice(0, 300) || 'no error details';
    const exitCode =
      response.status === 429 ? EXIT.RATE_LIMITED : exitCodeForStatus(response.status);
    const message =
      response.status === 429
        ? `Gong API rate limit exceeded (HTTP 429) and retries exhausted: ${detail}`
        : `Gong API error (HTTP ${response.status}): ${detail}`;
    return new CliError(message, {
      exitCode,
      httpStatus: response.status,
      requestId: typeof api.requestId === 'string' ? api.requestId : undefined,
      apiErrors,
    });
  }

  private debugLog(message: string): void {
    if (this.debug) this.ctx.stderr.write(`[debug] ${message}\n`);
  }
}

function tryParse(text: string): unknown {
  if (!text) return undefined;
  try {
    return parseLossless(text);
  } catch {
    return undefined;
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}
