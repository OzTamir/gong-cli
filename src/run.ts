/**
 * Runner for single-object (non-list) commands: request → unwrap → emit.
 */
import type { CliContext } from './context.js';
import type { GongClient, RequestSpec } from './client.js';
import { isDryRun } from './client.js';
import { emitSingle, getPath, resolveSingleFormat } from './output.js';
import type { OutputFlags } from './output.js';

export interface RunSingleArgs {
  ctx: CliContext;
  client: GongClient;
  spec: RequestSpec;
  flags: OutputFlags;
  /**
   * Dot-path of the payload inside the response envelope (e.g. 'call' for getCall).
   * Omit/null to emit the whole response body (small write-op envelopes).
   */
  unwrapKey?: string | null;
}

export async function runSingle(args: RunSingleArgs): Promise<void> {
  const result = await args.client.request(args.spec);
  if (isDryRun(result)) return;
  const payload =
    args.unwrapKey === undefined || args.unwrapKey === null
      ? result.body
      : (getPath(result.body, args.unwrapKey) ?? result.body);
  emitSingle(args.ctx, payload ?? null, {
    format: resolveSingleFormat(args.flags),
    fields: args.flags.fields,
    rawText: result.bodyText,
  });
}
