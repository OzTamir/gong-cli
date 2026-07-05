/**
 * Error model and exit codes.
 *
 * 0 ok · 1 API/unexpected error · 2 usage error · 3 auth (missing creds/401/403) ·
 * 4 not found · 5 rate-limited after retries. See docs/DESIGN.md.
 */

export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  RATE_LIMITED: 5,
} as const;

export interface CliErrorOptions {
  exitCode?: number;
  httpStatus?: number;
  requestId?: string;
  apiErrors?: string[];
  hint?: string;
}

export class CliError extends Error {
  readonly exitCode: number;
  readonly httpStatus?: number;
  readonly requestId?: string;
  readonly apiErrors?: string[];
  readonly hint?: string;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = options.exitCode ?? EXIT.ERROR;
    this.httpStatus = options.httpStatus;
    this.requestId = options.requestId;
    this.apiErrors = options.apiErrors;
    this.hint = options.hint;
  }
}

export function exitCodeForStatus(status: number): number {
  if (status === 401 || status === 403) return EXIT.AUTH;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 429) return EXIT.RATE_LIMITED;
  return EXIT.ERROR;
}

/**
 * Render an error for stderr: a single JSON line when stderr is not a TTY
 * (machine-diagnostics contract), prose otherwise.
 */
export function renderError(err: CliError, stderrIsTTY: boolean): string {
  if (!stderrIsTTY) {
    return (
      JSON.stringify({
        error: true,
        ...(err.httpStatus !== undefined ? { httpStatus: err.httpStatus } : {}),
        ...(err.requestId !== undefined ? { requestId: err.requestId } : {}),
        ...(err.apiErrors !== undefined ? { errors: err.apiErrors } : {}),
        exitCode: err.exitCode,
        message: err.message,
        ...(err.hint !== undefined ? { hint: err.hint } : {}),
      }) + '\n'
    );
  }
  let text = err.message;
  if (err.requestId) text += ` [requestId: ${err.requestId}]`;
  if (err.hint) text += `\n${err.hint}`;
  return text + '\n';
}
