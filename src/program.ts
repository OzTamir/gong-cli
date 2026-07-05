/**
 * Root program: global options, command registration, error handling, exit codes.
 */
import { Command, CommanderError, Option } from 'commander';

import type { CliContext } from './context.js';
import { GongClient } from './client.js';
import { resolveAuth } from './config.js';
import { CliError, EXIT, renderError } from './errors.js';
import { parseFields } from './output.js';
import type { OutputFlags, OutputFormat } from './output.js';
import { positiveInt } from './util.js';
import { registrars } from './commands/index.js';

export type GroupRegistrar = (program: Command, ctx: CliContext) => void;

export interface GlobalOpts extends OutputFlags {
  accessKey?: string;
  accessKeySecret?: string;
  bearerToken?: string;
  baseUrl?: string;
  output?: OutputFormat;
  fields?: string[];
  dryRun?: boolean;
  debug?: boolean;
  retry: boolean;
  timeout?: number;
  yes?: boolean;
}

export function globalOpts(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals<GlobalOpts>();
}

/** Output flags for the current invocation (used by both list and single runners). */
export function outputFlags(cmd: Command): OutputFlags {
  const globals = globalOpts(cmd);
  return { output: globals.output, fields: globals.fields };
}

/** Build the authenticated client for a command invocation. */
export function makeClient(cmd: Command, ctx: CliContext): GongClient {
  const globals = globalOpts(cmd);
  const auth = resolveAuth(ctx, globals);
  return new GongClient(ctx, auth, {
    retries: globals.retry === false ? 0 : undefined,
    timeoutMs: globals.timeout,
    dryRun: globals.dryRun,
    debug: globals.debug,
  });
}

function globalOptions(): Option[] {
  return [
    new Option('--access-key <key>', 'Gong API access key (global)'),
    new Option('--access-key-secret <secret>', 'Gong API access key secret (global)'),
    new Option('--bearer-token <token>', 'OAuth Bearer token; wins over key/secret (global)'),
    new Option('--base-url <url>', 'API base URL, default https://api.gong.io (global)'),
    new Option('-o, --output <format>', 'output format (global)').choices([
      'json',
      'jsonl',
      'table',
      'raw',
    ]),
    new Option('--fields <paths>', 'comma-separated dot-paths to project (global)').argParser(
      parseFields,
    ),
    new Option('--dry-run', 'print the HTTP request instead of sending it (global)'),
    new Option('--debug', 'request/response diagnostics on stderr, secrets redacted (global)'),
    new Option('--no-retry', 'disable automatic retry on HTTP 429 (global)'),
    new Option('--timeout <ms>', 'request timeout in milliseconds (global)').argParser(
      positiveInt('--timeout'),
    ),
    new Option('--yes', 'assume yes for confirmation prompts (global)'),
  ];
}

/**
 * Commander parses options where they appear; users expect global flags to work after the
 * subcommand (`gong calls list --dry-run`). Attach the shared options to every leaf.
 */
function attachGlobalsToLeaves(cmd: Command): void {
  if (cmd.commands.length === 0) {
    for (const option of globalOptions()) {
      cmd.addOption(option);
    }
    return;
  }
  for (const sub of cmd.commands) attachGlobalsToLeaves(sub as Command);
}

export function buildProgram(ctx: CliContext): Command {
  const program = new Command();
  program
    .name('gong')
    .description('Command-line client for the Gong API, built for humans and agents')
    .version(ctx.version, '-V, --version', 'print the gong-cli version')
    .exitOverride()
    .configureOutput({
      writeOut: (text) => ctx.stdout.write(text),
      writeErr: (text) => ctx.stderr.write(text),
    })
    .addHelpText(
      'after',
      '\nDocs: https://github.com/oztamir/gong-cli#readme\n' +
        'Gong API reference: https://gong.app.gong.io/settings/api/documentation',
    );

  for (const register of registrars) register(program, ctx);
  attachGlobalsToLeaves(program);
  return program;
}

/**
 * Entry point shared by the bin and the tests: parse, run, map every failure mode to
 * the documented exit codes, render errors per the machine-diagnostics contract.
 */
export async function runCli(argv: string[], ctx: CliContext): Promise<number> {
  const program = buildProgram(ctx);
  try {
    await program.parseAsync(argv);
    return EXIT.OK;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === 'commander.helpDisplayed' ||
        error.code === 'commander.help' ||
        error.code === 'commander.version'
      ) {
        return EXIT.OK;
      }
      // Commander already printed its prose message via configureOutput; add the
      // machine-readable line for non-TTY consumers.
      if (!ctx.stderr.isTTY) {
        ctx.stderr.write(
          renderError(
            new CliError(error.message.trim() || 'usage error', { exitCode: EXIT.USAGE }),
            false,
          ),
        );
      }
      return EXIT.USAGE;
    }
    if (error instanceof CliError) {
      ctx.stderr.write(renderError(error, ctx.stderr.isTTY));
      return error.exitCode;
    }
    const wrapped = new CliError(
      `Unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      { exitCode: EXIT.ERROR },
    );
    ctx.stderr.write(renderError(wrapped, ctx.stderr.isTTY));
    return EXIT.ERROR;
  }
}
