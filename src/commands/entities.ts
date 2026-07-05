/**
 * `gong entities` — AI answers and briefs about CRM entities (Accounts, Deals,
 * Contacts, Leads). Both operations consume Gong credits per call/email used and can
 * return HTTP 402 Payment Required when credits are exhausted.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Entities
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { CliError, EXIT } from '../errors.js';
import { runSingle } from '../run.js';
import { expandDateTime } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';
const CREDITS_NOTE =
  'Consumes Gong credits per call/email used; Gong returns HTTP 402 when credits are exhausted.';
const TIME_PERIODS =
  'LAST_7DAYS|LAST_30DAYS|LAST_90DAYS|LAST_90_DAYS_SINCE_LAST_ACTIVITY|LAST_YEAR_SINCE_LAST_ACTIVITY|LAST_YEAR|THIS_WEEK|THIS_MONTH|THIS_YEAR|THIS_QUARTER|CUSTOM_RANGE|ALL_CONVERSATIONS';

interface EntityQueryOpts {
  workspaceId?: string;
  crmEntityType?: string;
  crmEntityId?: string;
  timePeriod?: string;
  from?: string;
  to?: string;
  fromDateTime?: string;
  toDateTime?: string;
}

function addEntityQueryOptions(cmd: Command): Command {
  return cmd
    .option('--workspace-id <id>', 'workspace the associated calls/emails must belong to (maps to workspaceId; required)')
    .option('--crm-entity-type <type>', 'ACCOUNT|CONTACT|DEAL|LEAD (maps to crmEntityType; required)')
    .option('--crm-entity-id <id>', 'the CRM ID of the entity (maps to crmEntityId; required)')
    .option('--time-period <period>', `${TIME_PERIODS} (maps to timePeriod; required)`)
    .option('--from <datetime>', 'start of the CUSTOM_RANGE period, inclusive (maps to fromDateTime; ISO-8601 or YYYY-MM-DD; required when --time-period CUSTOM_RANGE)')
    .option('--to <datetime>', 'end of the CUSTOM_RANGE period, exclusive (maps to toDateTime; ISO-8601 or YYYY-MM-DD)')
    .option('--from-date-time <datetime>', 'canonical name for --from (maps to fromDateTime)')
    .option('--to-date-time <datetime>', 'canonical name for --to (maps to toDateTime)');
}

/** Validate the shared required query params; returns the resolved date range. */
function resolveEntityQuery(
  commandName: string,
  opts: EntityQueryOpts,
  extraMissing: string[],
): { fromDateTime?: string; toDateTime?: string } {
  const fromDateTime = opts.fromDateTime ?? opts.from;
  const toDateTime = opts.toDateTime ?? opts.to;
  const missing: string[] = [];
  if (!opts.workspaceId) missing.push('--workspace-id');
  if (!opts.crmEntityType) missing.push('--crm-entity-type');
  if (!opts.crmEntityId) missing.push('--crm-entity-id');
  if (!opts.timePeriod) missing.push('--time-period');
  missing.push(...extraMissing);
  if (missing.length > 0) {
    throw new CliError(`${commandName} requires ${missing.join(', ')}.`, {
      exitCode: EXIT.USAGE,
    });
  }
  if (opts.timePeriod === 'CUSTOM_RANGE' && fromDateTime === undefined) {
    throw new CliError(
      `${commandName} requires --from (maps to fromDateTime) when --time-period is CUSTOM_RANGE.`,
      { exitCode: EXIT.USAGE },
    );
  }
  return {
    fromDateTime: fromDateTime === undefined ? undefined : expandDateTime(fromDateTime),
    toDateTime: toDateTime === undefined ? undefined : expandDateTime(toDateTime),
  };
}

export const registerEntities: GroupRegistrar = (program, ctx) => {
  const entities = program
    .command('entities')
    .description('AI answers and briefs about CRM entities (ask, brief); consumes Gong credits');

  // ---- gong entities ask — GET /v2/entities/ask-entity ----------------------------------
  const ask = addEntityQueryOptions(
    entities
      .command('ask')
      .description('AI answer to a question about a CRM entity (GET /v2/entities/ask-entity; consumes Gong credits)'),
  ).option('--question <text>', 'the question to answer (maps to question; required)');
  ask
    .addHelpText(
      'after',
      `\n${CREDITS_NOTE}\nAt most 60 calls and 500 emails associated with the entity in the time period are used.\nAPI docs: ${DOCS}#get-/v2/entities/ask-entity\n\nExamples:\n  gong entities ask --workspace-id 1237998047883638784 --crm-entity-type ACCOUNT \\\n    --crm-entity-id 125260001VdfoWBAR --time-period LAST_30DAYS \\\n    --question 'What was the last activity on that account?'\n  gong entities ask --workspace-id 1237998047883638784 --crm-entity-type DEAL \\\n    --crm-entity-id 125260001VdfoWBAR --time-period CUSTOM_RANGE \\\n    --from 2026-01-01 --to 2026-07-01 --question 'What are the open blockers?'`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<EntityQueryOpts & { question?: string }>();
      const range = resolveEntityQuery(
        'gong entities ask',
        opts,
        opts.question ? [] : ['--question'],
      );
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/entities/ask-entity',
          query: {
            workspaceId: opts.workspaceId,
            crmEntityType: opts.crmEntityType,
            crmEntityId: opts.crmEntityId,
            timePeriod: opts.timePeriod,
            fromDateTime: range.fromDateTime,
            toDateTime: range.toDateTime,
            question: opts.question,
          },
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong entities brief — GET /v2/entities/get-brief ---------------------------------
  const brief = addEntityQueryOptions(
    entities
      .command('brief')
      .description('generate a configured AI brief for a CRM entity (GET /v2/entities/get-brief; consumes Gong credits)'),
  ).option('--brief-name <name>', 'name of the brief configured in Agent Studio > AI Briefer (maps to briefName; required)');
  brief
    .addHelpText(
      'after',
      `\n${CREDITS_NOTE}\nThe brief must be pre-configured in Gong Agent Studio > AI Briefer; --brief-name matches by name.\nAPI docs: ${DOCS}#get-/v2/entities/get-brief\n\nExamples:\n  gong entities brief --workspace-id 1237998047883638784 --brief-name 'Account overview' \\\n    --crm-entity-type ACCOUNT --crm-entity-id 125260001VdfoWBAR --time-period THIS_QUARTER\n  gong entities brief --workspace-id 1237998047883638784 --brief-name 'Deal risks' \\\n    --crm-entity-type DEAL --crm-entity-id 125260001VdfoWBAR --time-period CUSTOM_RANGE \\\n    --from 2026-01-01T00:00:00Z --to 2026-07-01T00:00:00Z`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<EntityQueryOpts & { briefName?: string }>();
      const range = resolveEntityQuery(
        'gong entities brief',
        opts,
        opts.briefName ? [] : ['--brief-name'],
      );
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/entities/get-brief',
          query: {
            workspaceId: opts.workspaceId,
            briefName: opts.briefName,
            crmEntityType: opts.crmEntityType,
            crmEntityId: opts.crmEntityId,
            timePeriod: opts.timePeriod,
            fromDateTime: range.fromDateTime,
            toDateTime: range.toDateTime,
          },
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });
};
