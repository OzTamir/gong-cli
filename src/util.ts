/**
 * Small shared helpers: date expansion, CSV flags, destructive-op confirmation.
 */
import type { Command } from 'commander';

import type { CliContext } from './context.js';
import { CliError, EXIT } from './errors.js';
import { parseLossless } from './json.js';

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date-time inputs: full ISO-8601 passes through untouched; a bare YYYY-MM-DD expands
 * to the UTC day boundary (T00:00:00Z). See docs/DESIGN.md → Flag naming and dates.
 */
export function expandDateTime(value: string): string {
  return BARE_DATE.test(value) ? `${value}T00:00:00Z` : value;
}

/** Comma-separated flag values → trimmed non-empty array. */
export function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Repeatable-flag accumulator for commander: `.option(..., collect, [] as string[])`. */
export function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Parser for flags that take an inline JSON value (structured fields like parties). */
export function jsonFlag(flagName: string): (value: string) => unknown {
  return (value: string) => {
    try {
      return parseLossless(value);
    } catch {
      throw new CliError(`${flagName} must be valid JSON.`, { exitCode: EXIT.USAGE });
    }
  };
}

export function positiveInt(flagName: string): (value: string) => number {
  return (value: string) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new CliError(`${flagName} must be a positive integer, got '${value}'`, {
        exitCode: EXIT.USAGE,
      });
    }
    return n;
  };
}

export interface ConfirmOptions {
  /** One-line description of what is about to happen. */
  description: string;
  /**
   * For irreversible operations: the exact string the user must re-type to proceed
   * (e.g. the email address being purged).
   */
  requireTyped?: string;
}

/**
 * Gate a destructive operation. Non-TTY stdin requires --yes (global); without it the
 * command refuses with exit 2. On a TTY it prompts — and re-types the target for
 * irreversible operations.
 */
export async function confirmDestructive(
  cmd: Command,
  ctx: CliContext,
  options: ConfirmOptions,
): Promise<void> {
  const globals = cmd.optsWithGlobals<{ yes?: boolean; dryRun?: boolean }>();
  if (globals.yes || globals.dryRun) return;
  if (!ctx.stdinIsTTY) {
    throw new CliError(`Refusing without confirmation: ${options.description}`, {
      exitCode: EXIT.USAGE,
      hint: 'Pass --yes to confirm non-interactively.',
    });
  }
  if (options.requireTyped !== undefined) {
    const answer = await ctx.prompt(
      `${options.description}\nThis cannot be undone. Type '${options.requireTyped}' to confirm: `,
    );
    if (answer.trim() !== options.requireTyped) {
      throw new CliError('Confirmation did not match; aborting.', { exitCode: EXIT.USAGE });
    }
    return;
  }
  const answer = await ctx.prompt(`${options.description} Proceed? [y/N] `);
  if (!/^y(es)?$/i.test(answer.trim())) {
    throw new CliError('Aborted.', { exitCode: EXIT.USAGE });
  }
}
