#!/usr/bin/env node
/**
 * gong — command-line client for the Gong API.
 */
const [major] = process.versions.node.split('.').map(Number);
if (major === undefined || major < 22) {
  process.stderr.write(
    `gong-cli requires Node.js >= 22 (found ${process.versions.node}).\n`,
  );
  process.exit(1);
}

const { createRealContext } = await import('./context.js');
const { runCli } = await import('./program.js');

process.exitCode = await runCli(process.argv, createRealContext());
