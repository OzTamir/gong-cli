/**
 * Request-body assembly for complex POST/PUT endpoints.
 *
 * Two mechanisms, both always available (docs/DESIGN.md → Request bodies):
 *  1. first-class flags, each mapped to a body dot-path;
 *  2. --body <json> / --body-file <path|-> with the full body.
 *
 * Merge semantics: only flags the user actually typed merge over --body; objects merge
 * recursively (flags set leaf paths); arrays and scalars from flags replace wholesale;
 * null values inside --body are preserved. Command defaults apply only when neither a
 * flag nor the body provides the field.
 */
import fs from 'node:fs';

import type { Command } from 'commander';
import { Option } from 'commander';

import type { CliContext } from './context.js';
import { CliError, EXIT } from './errors.js';
import { parseLossless } from './json.js';

export function addBodyOptions(cmd: Command): Command {
  cmd.addOption(
    new Option('--body <json>', 'full request body as inline JSON (typed flags merge over it)')
      .conflicts('bodyFile'),
  );
  cmd.addOption(
    new Option('--body-file <path>', "read the request body from a file, or '-' for stdin"),
  );
  return cmd;
}

export interface BodyFieldSpec {
  /** Body location as a dot-path, e.g. 'filter.fromDateTime'. */
  path: string;
  /** Optional transform applied to the flag value before it is set. */
  transform?: (value: unknown) => unknown;
}

/** Maps commander option keys (camelCase) → body field specs. */
export type BodyFlagMap = Record<string, BodyFieldSpec>;

export function setPath(target: Record<string, unknown>, dotPath: string, value: unknown): void {
  const segments = dotPath.split('.');
  let current = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] as string;
    const existing = current[segment];
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1] as string] = value;
}

export function hasPath(target: unknown, dotPath: string): boolean {
  let current: unknown = target;
  for (const segment of dotPath.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return false;
    if (!(segment in (current as Record<string, unknown>))) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

async function readBodyFlag(cmd: Command, ctx: CliContext): Promise<unknown> {
  const opts = cmd.opts<{ body?: string; bodyFile?: string }>();
  let text: string | undefined;
  if (opts.body !== undefined) {
    text = opts.body;
  } else if (opts.bodyFile !== undefined) {
    if (opts.bodyFile === '-') {
      text = await ctx.readStdin();
    } else {
      try {
        text = fs.readFileSync(opts.bodyFile, 'utf8');
      } catch (error) {
        throw new CliError(
          `Cannot read --body-file ${opts.bodyFile}: ${error instanceof Error ? error.message : String(error)}`,
          { exitCode: EXIT.USAGE },
        );
      }
    }
  }
  if (text === undefined) return undefined;
  try {
    return parseLossless(text);
  } catch {
    throw new CliError('Request body is not valid JSON.', { exitCode: EXIT.USAGE });
  }
}

/**
 * Assemble the request body from --body/--body-file plus typed flags.
 * Returns undefined when nothing at all was provided (caller decides if that is valid).
 */
export async function buildBody(
  cmd: Command,
  ctx: CliContext,
  map: BodyFlagMap,
  options: { defaults?: Record<string, unknown> } = {},
): Promise<unknown> {
  const fromBodyFlag = await readBodyFlag(cmd, ctx);
  if (
    fromBodyFlag !== undefined &&
    (fromBodyFlag === null || typeof fromBodyFlag !== 'object' || Array.isArray(fromBodyFlag))
  ) {
    // Bodies are JSON objects for every Gong operation the flag route serves.
    throw new CliError('--body must be a JSON object.', { exitCode: EXIT.USAGE });
  }

  const body: Record<string, unknown> = { ...((fromBodyFlag as Record<string, unknown>) ?? {}) };
  let sawAnything = fromBodyFlag !== undefined;

  const opts = cmd.opts<Record<string, unknown>>();
  for (const [flagKey, field] of Object.entries(map)) {
    if (cmd.getOptionValueSource(flagKey) !== 'cli') continue;
    const value = opts[flagKey];
    if (value === undefined) continue;
    setPath(body, field.path, field.transform ? field.transform(value) : value);
    sawAnything = true;
  }

  for (const [path, value] of Object.entries(options.defaults ?? {})) {
    if (!hasPath(body, path)) {
      setPath(body, path, value);
      sawAnything = true;
    }
  }

  return sawAnything ? body : undefined;
}
