/**
 * Lossless JSON handling.
 *
 * Several Gong payloads carry int64 IDs (integrationId, scorecard/call IDs) that exceed
 * Number.MAX_SAFE_INTEGER and would be silently corrupted by a plain JSON.parse →
 * JSON.stringify round-trip. We parse with JSON.parse source access (out-of-range integers
 * become BigInt) and re-serialize through JSON.rawJSON, both available since Node 22.
 */

type ReviverWithSource = (
  this: unknown,
  key: string,
  value: unknown,
  context?: { source?: string },
) => unknown;

const parseWithSource = JSON.parse as (text: string, reviver?: ReviverWithSource) => unknown;

const rawJSON: (text: string) => unknown = (
  JSON as unknown as { rawJSON: (text: string) => unknown }
).rawJSON;

const INTEGER_SOURCE = /^-?\d+$/;

export function parseLossless(text: string): unknown {
  return parseWithSource(text, function (_key, value, context) {
    if (
      typeof value === 'number' &&
      !Number.isSafeInteger(value) &&
      context?.source !== undefined &&
      INTEGER_SOURCE.test(context.source)
    ) {
      return BigInt(context.source);
    }
    return value;
  });
}

function losslessReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? rawJSON(value.toString()) : value;
}

export function stringifyLossless(value: unknown, indent?: number): string {
  return JSON.stringify(value, losslessReplacer, indent);
}

/** Render a JSON value as a single table cell / flat string. */
export function valueToCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return stringifyLossless(value);
}
