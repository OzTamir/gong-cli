/**
 * `gong users` — Gong users: list, get, settings history, search (extensive).
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Users
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { addBodyOptions, buildBody } from '../body.js';
import type { BodyFlagMap } from '../body.js';
import { resolveListFormat } from '../output.js';
import { addPaginationOptions, runPaginatedList } from '../pagination.js';
import type { PaginationFlags } from '../pagination.js';
import { runSingle } from '../run.js';
import { csv, expandDateTime } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

/** Curated default table columns shared by both user list commands. */
const USER_COLUMNS = ['id', 'emailAddress', 'firstName', 'lastName', 'title', 'active'];

export const registerUsers: GroupRegistrar = (program, ctx) => {
  const users = program
    .command('users')
    .description('work with Gong users (list, get, settings history, search)');

  // ---- gong users list — GET /v2/users --------------------------------------------------
  const list = users
    .command('list')
    .description("list all of the company's users (GET /v2/users)")
    .option(
      '--include-avatars',
      'include synthetic avatar users (Gong CSMs/support accessing your instance; maps to includeAvatars)',
    );
  addPaginationOptions(list);
  list
    .addHelpText(
      'after',
      `\nAPI docs: ${DOCS}#get-/v2/users\n\nExamples:\n  gong users list\n  gong users list --include-avatars --all -o jsonl`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ includeAvatars?: boolean }>();
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/users',
          query: { includeAvatars: opts.includeAvatars },
        },
        cursorIn: 'query',
        recordsKey: 'users',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: USER_COLUMNS,
        },
      });
    });

  // ---- gong users get <id> — GET /v2/users/{id} -----------------------------------------
  users
    .command('get')
    .description('retrieve one user by ID (GET /v2/users/{id})')
    .argument('<id>', "Gong's user ID")
    .addHelpText('after', `\nAPI docs: ${DOCS}#get-/v2/users/-id-`)
    .action(async function (this: Command, id: string) {
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'GET', path: `/v2/users/${encodeURIComponent(id)}` },
        flags: outputFlags(this),
        unwrapKey: 'user',
      });
    });

  // ---- gong users history <id> — GET /v2/users/{id}/settings-history --------------------
  users
    .command('history')
    .description("retrieve a user's settings change history (GET /v2/users/{id}/settings-history)")
    .argument('<id>', "Gong's user ID")
    .addHelpText(
      'after',
      `\nOne record per setting change: setting (e.g. emailsImported), value, time.\nAPI docs: ${DOCS}#get-/v2/users/-id-/settings-history`,
    )
    .action(async function (this: Command, id: string) {
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'GET', path: `/v2/users/${encodeURIComponent(id)}/settings-history` },
        cursorIn: 'query',
        recordsKey: 'userSettingsHistory',
        flags: {}, // the API returns the full history in one response — no pagination
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['setting', 'value', 'time'],
        },
        // 404 here means "user not found" (keyed by id), not "no data in period".
        notFoundMeansEmpty: false,
      });
    });

  // ---- gong users search — POST /v2/users/extensive -------------------------------------
  const SEARCH_MAP: BodyFlagMap = {
    from: { path: 'filter.createdFromDateTime', transform: (v) => expandDateTime(String(v)) },
    to: { path: 'filter.createdToDateTime', transform: (v) => expandDateTime(String(v)) },
    createdFromDateTime: {
      path: 'filter.createdFromDateTime',
      transform: (v) => expandDateTime(String(v)),
    },
    createdToDateTime: {
      path: 'filter.createdToDateTime',
      transform: (v) => expandDateTime(String(v)),
    },
    includeAvatars: { path: 'filter.includeAvatars' },
    userIds: { path: 'filter.userIds', transform: (v) => csv(String(v)) },
  };

  const search = users
    .command('search')
    .description('list users by filter (POST /v2/users/extensive)')
    .option(
      '--from <datetime>',
      'created at or after, inclusive (maps to filter.createdFromDateTime; ISO-8601 or YYYY-MM-DD)',
    )
    .option(
      '--to <datetime>',
      'created before, exclusive (maps to filter.createdToDateTime; ISO-8601 or YYYY-MM-DD)',
    )
    .option(
      '--created-from-date-time <datetime>',
      'canonical name for --from (maps to filter.createdFromDateTime)',
    )
    .option(
      '--created-to-date-time <datetime>',
      'canonical name for --to (maps to filter.createdToDateTime)',
    )
    .option(
      '--include-avatars',
      'include synthetic avatar users (maps to filter.includeAvatars)',
    )
    .option('--user-ids <ids>', 'comma-separated Gong user IDs (maps to filter.userIds)');
  addBodyOptions(search);
  addPaginationOptions(search);
  search
    .addHelpText(
      'after',
      `\nAll filters are optional; with none, every user is returned.\nAPI docs: ${DOCS}#post-/v2/users/extensive\n\nExamples:\n  gong users search --from 2026-06-01 --to 2026-07-01 --user-ids 234599484848423\n  gong users search --body '{"filter":{"userIds":["234599484848423"],"includeAvatars":true}}'`,
    )
    .action(async function (this: Command) {
      const body = (await buildBody(search, ctx, SEARCH_MAP, { defaults: { filter: {} } })) as
        | Record<string, unknown>
        | undefined;
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/users/extensive', body: body ?? { filter: {} } },
        cursorIn: 'body',
        recordsKey: 'users',
        flags: this.opts<PaginationFlags>(),
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: USER_COLUMNS,
        },
      });
    });
};
