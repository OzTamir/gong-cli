/**
 * `gong tasks` — Gong Engage tasks: list (filtered), update status/due date.
 * Requires an Engage license.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Tasks
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { addBodyOptions, buildBody, hasPath } from '../body.js';
import type { BodyFlagMap } from '../body.js';
import { CliError, EXIT } from '../errors.js';
import { resolveListFormat } from '../output.js';
import { runPaginatedList } from '../pagination.js';
import { runSingle } from '../run.js';
import { csv, expandDateTime } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

export const registerTasks: GroupRegistrar = (program, ctx) => {
  const tasks = program
    .command('tasks')
    .description('Gong Engage tasks (list, update); requires an Engage license');

  // ---- gong tasks list — POST /v2/tasks -------------------------------------------------
  const LIST_MAP: BodyFlagMap = {
    userId: { path: 'filter.userId' },
    workspaceId: { path: 'filter.workspaceId' },
    types: { path: 'filter.types', transform: (v) => csv(String(v)) },
    taskAction: { path: 'filter.taskAction', transform: (v) => csv(String(v)) },
    status: { path: 'filter.status', transform: (v) => csv(String(v)) },
  };

  const REQUIRED_FILTER_PATHS = [
    'filter.userId',
    'filter.types',
    'filter.taskAction',
    'filter.status',
  ];

  const list = tasks
    .command('list')
    .description("list a user's Engage tasks by filter (POST /v2/tasks)")
    .option('--user-id <id>', 'Gong user who owns the tasks (maps to filter.userId; required)')
    .option('--workspace-id <id>', 'workspace the tasks are in (maps to filter.workspaceId)')
    .option('--types <types>', 'comma-separated FLOW,MANUAL (maps to filter.types; required)')
    .option('--task-action <actions>', 'comma-separated task actions; valid: CALL (maps to filter.taskAction; required)')
    .option('--status <statuses>', 'comma-separated OPEN,DONE,DISMISSED (maps to filter.status; required)');
  addBodyOptions(list);
  list
    .addHelpText(
      'after',
      `\nNot paginated: Gong returns the full filtered list in one response — no --all/--limit/--cursor.\nAll four filter fields (userId, types, taskAction, status) are required by the API.\nAPI docs: ${DOCS}#post-/v2/tasks\n\nExamples:\n  gong tasks list --user-id 234599484848423 --types MANUAL --task-action CALL --status OPEN\n  gong tasks list --body '{"filter":{"userId":"234599484848423","types":["MANUAL"],"taskAction":["CALL"],"status":["OPEN"]}}'`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(list, ctx, LIST_MAP);
      const missing = REQUIRED_FILTER_PATHS.filter((path) => !hasPath(body, path));
      if (body === undefined || missing.length > 0) {
        throw new CliError(
          `gong tasks list is missing required filter fields: ${missing.join(', ') || REQUIRED_FILTER_PATHS.join(', ')}.`,
          {
            exitCode: EXIT.USAGE,
            hint: 'The API requires all of them — set --user-id, --types, --task-action and --status (or --body/--body-file).',
          },
        );
      }
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/tasks', body },
        cursorIn: 'body',
        recordsKey: 'tasks',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['id', 'status', 'type', 'dueDate', 'title'],
        },
      });
    });

  // ---- gong tasks update <id> — PATCH /v2/tasks/{taskId} --------------------------------
  const UPDATE_MAP: BodyFlagMap = {
    userId: { path: 'userId' },
    status: { path: 'status' },
    dueDate: { path: 'dueDate', transform: (v) => expandDateTime(String(v)) },
    priority: { path: 'priority' },
  };

  const update = tasks
    .command('update')
    .description('update the status, due date or priority of an Engage task (PATCH /v2/tasks/{taskId})')
    .argument('<id>', "Gong's task ID")
    .option('--user-id <id>', 'Gong user who owns the task (maps to userId; required)')
    .option('--status <status>', 'new status: OPEN|DONE|DISMISSED (maps to status)')
    .option('--due-date <datetime>', 'new due date-time, ISO-8601 or YYYY-MM-DD (maps to dueDate)')
    .option('--priority <priority>', "new priority, e.g. 'MEDIUM' (maps to priority)");
  addBodyOptions(update);
  update
    .addHelpText(
      'after',
      `\nThe API returns the updated task wrapped in a tasks array. API docs: ${DOCS}#patch-/v2/tasks/-taskId-\n\nExamples:\n  gong tasks update 1234361284629351 --user-id 234599484848423 --status DONE\n  gong tasks update 1234361284629351 --body '{"userId":"234599484848423","dueDate":"2026-07-10T09:00:00Z"}'`,
    )
    .action(async function (this: Command, id: string) {
      const body = await buildBody(update, ctx, UPDATE_MAP);
      if (body === undefined || !hasPath(body, 'userId')) {
        throw new CliError('gong tasks update is missing the required userId field.', {
          exitCode: EXIT.USAGE,
          hint: 'Pass --user-id (the Gong user who owns the task) or set userId in --body/--body-file.',
        });
      }
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'PATCH', path: `/v2/tasks/${encodeURIComponent(id)}`, body },
        flags: outputFlags(this),
        unwrapKey: 'tasks',
      });
    });
};
