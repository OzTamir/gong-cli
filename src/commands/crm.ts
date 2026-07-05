/**
 * `gong crm` — generic CRM integration: register/get/delete the integration, upload and
 * verify CRM objects, manage the object schema, and poll async request status.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--CRM
 */
import fs from 'node:fs';

import type { Command } from 'commander';
import { Option } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { addBodyOptions, buildBody, hasPath } from '../body.js';
import type { BodyFlagMap } from '../body.js';
import type { RequestSpec } from '../client.js';
import { isDryRun } from '../client.js';
import type { CliContext } from '../context.js';
import { CliError, EXIT } from '../errors.js';
import { parseLossless } from '../json.js';
import { createListEmitter, emitMeta, getPath, resolveListFormat } from '../output.js';
import { runPaginatedList } from '../pagination.js';
import { runSingle } from '../run.js';
import { confirmDestructive, csv } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

/** Curated table columns for schema-field records. */
const SCHEMA_COLUMNS = ['uniqueName', 'label', 'type', 'referenceTo', 'isDeleted', 'lastModified'];

/**
 * Read the schema-upload body: a bare JSON ARRAY of field objects. buildBody() only
 * accepts JSON objects, so this command reads --body/--body-file itself.
 */
async function readSchemaFields(cmd: Command, ctx: CliContext): Promise<unknown[]> {
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
  if (text === undefined) {
    throw new CliError(
      'gong crm schema upload requires the schema field list via --body or --body-file.',
      {
        exitCode: EXIT.USAGE,
        hint: `Pass a JSON array of field objects, e.g. --body '[{"uniqueName":"orderId","label":"ID","type":"ID"}]'.`,
      },
    );
  }
  let parsed: unknown;
  try {
    parsed = parseLossless(text);
  } catch {
    throw new CliError('Request body is not valid JSON.', { exitCode: EXIT.USAGE });
  }
  if (!Array.isArray(parsed)) {
    throw new CliError(
      'The schema upload body must be a JSON ARRAY of field objects (the request body is a bare array, not an object).',
      { exitCode: EXIT.USAGE },
    );
  }
  return parsed;
}

export const registerCrm: GroupRegistrar = (program, ctx) => {
  const crm = program
    .command('crm')
    .description('generic CRM integration: integration lifecycle, object data, schema, request status');

  // ======================================================================================
  // gong crm integrations …
  // ======================================================================================
  const integrations = crm
    .command('integrations')
    .description('the generic CRM integration — Gong supports one per company (get, register, delete)');

  // ---- gong crm integrations get — GET /v2/crm/integrations ----------------------------
  integrations
    .command('get')
    .description('get the registered generic CRM integration (GET /v2/crm/integrations)')
    .addHelpText(
      'after',
      `\nAt most one integration exists at a time, so the list holds zero or one entries.\nintegrationId is an int64 that can exceed JavaScript's safe-integer range; output\npreserves it losslessly — treat it as a string. API docs: ${DOCS}#get-/v2/crm/integrations\n\nExample:\n  gong crm integrations get`,
    )
    .action(async function (this: Command) {
      await runPaginatedList({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'GET', path: '/v2/crm/integrations' },
        cursorIn: 'query',
        recordsKey: 'integrations',
        flags: {},
        output: {
          format: resolveListFormat(outputFlags(this), ctx),
          fields: outputFlags(this).fields,
          columns: ['integrationId', 'name', 'ownerEmail'],
        },
      });
    });

  // ---- gong crm integrations register — PUT /v2/crm/integrations -----------------------
  const REGISTER_MAP: BodyFlagMap = {
    name: { path: 'name' },
    ownerEmail: { path: 'ownerEmail' },
  };

  const register = integrations
    .command('register')
    .description('register a generic CRM integration (PUT /v2/crm/integrations)')
    .option('--name <name>', 'the integration name, e.g. "ACME Sandbox" (maps to name; required)')
    .option('--owner-email <email>', 'email of the person responsible for the integration (maps to ownerEmail; required)');
  addBodyOptions(register);
  register
    .addHelpText(
      'after',
      `\nCreate-only: Gong supports a single CRM integration at a time, so this returns\n409 Conflict if one already exists (including native integrations such as\nSalesforce or HubSpot) — delete it first with 'gong crm integrations delete'.\nThe returned integrationId is an int64; output preserves it losslessly — store\nit as a string, never a 32/53-bit number. API docs: ${DOCS}#put-/v2/crm/integrations\n\nExamples:\n  gong crm integrations register --name "ACME Sandbox" --owner-email joe.doe@acme.com\n  gong crm integrations register --body '{"name":"ACME Sandbox","ownerEmail":"joe.doe@acme.com"}'`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(this, ctx, REGISTER_MAP);
      const missing = ['name', 'ownerEmail'].filter((path) => !hasPath(body, path));
      if (body === undefined || missing.length > 0) {
        throw new CliError(
          `gong crm integrations register is missing required fields: ${missing.join(', ') || 'name, ownerEmail'}.`,
          {
            exitCode: EXIT.USAGE,
            hint: 'Provide --name and --owner-email, or the full body via --body/--body-file.',
          },
        );
      }
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'PUT', path: '/v2/crm/integrations', body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong crm integrations delete — DELETE /v2/crm/integrations ----------------------
  integrations
    .command('delete')
    .description('delete the CRM integration and ALL its CRM objects (DELETE /v2/crm/integrations)')
    .requiredOption('--integration-id <id>', 'the integration to delete (maps to integrationId)')
    .requiredOption(
      '--client-request-id <id>',
      'your unique id for this request, used for polling and as an idempotency key — letters, numbers, dashes, underscores (maps to clientRequestId; 409 if reused)',
    )
    .addHelpText(
      'after',
      `\nAsynchronous: a 201 means the delete request was registered, not completed.\nDeleting the integration and all its associated objects (accounts, contacts,\ndeals, leads, users) can take up to 24 hours. Poll\n'gong crm request-status <clientRequestId> --integration-id <id>' until DONE.\nAPI docs: ${DOCS}#delete-/v2/crm/integrations\n\nExample:\n  gong crm integrations delete --integration-id 6286478263646 --client-request-id delete-1 --yes`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ integrationId: string; clientRequestId: string }>();
      await confirmDestructive(this, ctx, {
        description: `Delete CRM integration ${opts.integrationId} and all its associated CRM objects (accounts, contacts, deals, leads, users).`,
      });
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'DELETE',
          path: '/v2/crm/integrations',
          query: { integrationId: opts.integrationId, clientRequestId: opts.clientRequestId },
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ======================================================================================
  // gong crm objects …
  // ======================================================================================
  const objects = crm
    .command('objects')
    .description('CRM object data in Gong: get (upload verification), upload (LDJSON)');

  // ---- gong crm objects get — GET /v2/crm/entities (GET with a JSON body) --------------
  objects
    .command('get')
    .description('fetch uploaded CRM objects by id, for development-phase verification (GET /v2/crm/entities)')
    .requiredOption('--integration-id <id>', 'integration ID from registration (maps to integrationId)')
    .requiredOption('--object-type <type>', 'ACCOUNT|CONTACT|DEAL|LEAD, case-sensitive (maps to objectType)')
    .option(
      '--ids <ids>',
      'comma-separated CRM object ids, sent as the JSON request body (maps to objectsCrmIds; required)',
    )
    .option('--objects-crm-ids <ids>', 'canonical name for --ids (maps to objectsCrmIds)')
    .addHelpText(
      'after',
      `\nDevelopment-phase endpoint: use it to verify objects uploaded with\n'gong crm objects upload' were processed. Gong honors at most 100 ids per\nrequest — extra ids are silently ignored. The result maps each crm id to its\nfield map, or null when the object is not found. (Gong requires the id array as\nthe body of a GET request; the CLI handles that quirk.)\nAPI docs: ${DOCS}#get-/v2/crm/entities\n\nExamples:\n  gong crm objects get --integration-id 6286478263646 --object-type DEAL --ids 1234,8765\n  gong crm objects get --integration-id 6286478263646 --object-type ACCOUNT --objects-crm-ids 5ybyh6n6n65`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ integrationId: string; objectType: string; ids?: string; objectsCrmIds?: string }>();
      const ids = csv(opts.objectsCrmIds ?? opts.ids ?? '');
      if (ids.length === 0) {
        throw new CliError('gong crm objects get requires the CRM object ids via --ids.', {
          exitCode: EXIT.USAGE,
          hint: 'Pass up to 100 comma-separated ids, e.g. --ids 1234,8765.',
        });
      }
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/crm/entities',
          query: { integrationId: opts.integrationId, objectType: opts.objectType },
          body: ids,
          getWithBody: true,
        },
        flags: outputFlags(this),
        unwrapKey: 'crmObjectsMap',
      });
    });

  // ---- gong crm objects upload — POST /v2/crm/entities (multipart LDJSON) --------------
  objects
    .command('upload')
    .description('upload CRM objects from an LDJSON file (POST /v2/crm/entities)')
    .requiredOption('--integration-id <id>', 'integration ID from registration (maps to integrationId)')
    .requiredOption(
      '--object-type <type>',
      'ACCOUNT|CONTACT|DEAL|LEAD|BUSINESS_USER|STAGE, case-sensitive — a wider enum than the get/schema endpoints (maps to objectType)',
    )
    .requiredOption(
      '--client-request-id <id>',
      'your unique id for this upload, used for polling and as an idempotency key — letters, numbers, dashes, underscores (maps to clientRequestId; 409 if reused)',
    )
    .requiredOption(
      '--data-file <path>',
      'LDJSON file: one JSON object per line, a single entity type per file, up to 200MB (multipart field dataFile)',
    )
    .option('--content-type <type>', 'MIME type for the file part (default: inferred by Gong)')
    .addHelpText(
      'after',
      `\nAsynchronous: a 201 means the file was uploaded and is pending processing. Poll\n'gong crm request-status <clientRequestId> --integration-id <id>' until DONE or\nFAILED. Custom fields must exist in the schema first ('gong crm schema upload')\nor they are not displayed in Gong. API docs: ${DOCS}#post-/v2/crm/entities\n\nExample:\n  gong crm objects upload --integration-id 6286478263646 --object-type ACCOUNT \\\n    --client-request-id upload-42 --data-file ./accounts.ldjson`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{
        integrationId: string;
        objectType: string;
        clientRequestId: string;
        dataFile: string;
        contentType?: string;
      }>();
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'POST',
          path: '/v2/crm/entities',
          query: {
            integrationId: opts.integrationId,
            objectType: opts.objectType,
            clientRequestId: opts.clientRequestId,
          },
          multipart: { field: 'dataFile', path: opts.dataFile, contentType: opts.contentType },
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ======================================================================================
  // gong crm schema …
  // ======================================================================================
  const schema = crm
    .command('schema')
    .description('CRM object schema fields: list, upload (full replacement per object type)');

  // ---- gong crm schema list — GET /v2/crm/entity-schema --------------------------------
  schema
    .command('list')
    .description('list the schema fields of CRM object types (GET /v2/crm/entity-schema)')
    .requiredOption('--integration-id <id>', 'integration ID from registration (maps to integrationId)')
    .option(
      '--object-type <type>',
      'ACCOUNT|CONTACT|DEAL|LEAD, case-sensitive; omit to list every object type (maps to objectType)',
    )
    .addHelpText(
      'after',
      `\nWithout --object-type, fields of all object types are returned and each record\nis annotated with its objectType. API docs: ${DOCS}#get-/v2/crm/entity-schema\n\nExamples:\n  gong crm schema list --integration-id 6286478263646 --object-type ACCOUNT\n  gong crm schema list --integration-id 6286478263646 -o jsonl`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ integrationId: string; objectType?: string }>();
      const client = makeClient(this, ctx);
      const spec: RequestSpec = {
        method: 'GET',
        path: '/v2/crm/entity-schema',
        query: { integrationId: opts.integrationId, objectType: opts.objectType },
      };
      const output = {
        format: resolveListFormat(outputFlags(this), ctx),
        fields: outputFlags(this).fields,
        columns: opts.objectType ? SCHEMA_COLUMNS : ['objectType', ...SCHEMA_COLUMNS],
      };

      if (opts.objectType !== undefined) {
        await runPaginatedList({
          ctx,
          client,
          spec,
          cursorIn: 'query',
          recordsKey: `objectTypeToSelectedFields.${opts.objectType}`,
          flags: {},
          output,
        });
        return;
      }

      // No --object-type: the response maps every object type to its field list;
      // flatten to one list, annotating each record with its objectType.
      const result = await client.request({ ...spec, notFoundOk: true });
      if (isDryRun(result)) return;
      const emitter = createListEmitter(ctx, output);
      if (result.status === 404) {
        const api = (result.body ?? {}) as { errors?: unknown };
        emitter.done();
        emitMeta(ctx, {
          fetchedRecords: 0,
          pages: 0,
          note:
            Array.isArray(api.errors) && api.errors.length > 0
              ? api.errors.map(String).join('; ')
              : 'No records found.',
        });
        return;
      }
      const map = (getPath(result.body, 'objectTypeToSelectedFields') ?? {}) as Record<string, unknown>;
      const records: unknown[] = [];
      for (const [objectType, fields] of Object.entries(map)) {
        if (!Array.isArray(fields)) continue;
        for (const field of fields) {
          records.push({ objectType, ...(field as Record<string, unknown>) });
        }
      }
      emitter.page(records, result.bodyText);
      emitter.done();
    });

  // ---- gong crm schema upload — POST /v2/crm/entity-schema -----------------------------
  const schemaUpload = schema
    .command('upload')
    .description('replace the full schema of an object type (POST /v2/crm/entity-schema)')
    .requiredOption('--integration-id <id>', 'integration ID from registration (maps to integrationId)')
    .requiredOption('--object-type <type>', 'ACCOUNT|CONTACT|DEAL|LEAD, case-sensitive (maps to objectType)');
  schemaUpload.addOption(
    new Option(
      '--body <json>',
      'the full request body: a JSON ARRAY of schema field objects (not wrapped in an object)',
    ).conflicts('bodyFile'),
  );
  schemaUpload
    .option('--body-file <path>', "read the JSON array of schema field objects from a file, or '-' for stdin")
    .addHelpText(
      'after',
      `\nWARNING — full replacement, not a merge: every upload must include ALL fields\nyou want in the schema; fields you omit are dropped. Send a field with\n"isDeleted": true to delete it AND its data; changing a field's type recreates\nthe field and deletes the original field's data. Synchronous (no request-status\npolling). Each array item takes: uniqueName, label, type (required, one of\nDATE|DATETIME|NUMBER|PERCENT|CURRENCY|ID|URL|STRING|BOOLEAN|PHONENUMBER|\nEMAILADDRESS|PICKLIST|REFERENCE|STRINGARRAY), plus lastModified, isDeleted,\nreferenceTo (required for REFERENCE) and orderedValueList (required for\nPICKLIST). API docs: ${DOCS}#post-/v2/crm/entity-schema\n\nExamples:\n  gong crm schema upload --integration-id 6286478263646 --object-type ACCOUNT \\\n    --body '[{"uniqueName":"orderId","label":"ID","type":"ID"}]'\n  gong crm schema upload --integration-id 6286478263646 --object-type ACCOUNT --body-file schema.json`,
    )
    .action(async function (this: Command) {
      const opts = this.opts<{ integrationId: string; objectType: string }>();
      const fields = await readSchemaFields(this, ctx);
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'POST',
          path: '/v2/crm/entity-schema',
          query: { integrationId: opts.integrationId, objectType: opts.objectType },
          body: fields,
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ======================================================================================
  // gong crm request-status — GET /v2/crm/request-status
  // ======================================================================================
  crm
    .command('request-status')
    .description('status of an async CRM request — objects upload or integration delete (GET /v2/crm/request-status)')
    .argument('<id>', 'the clientRequestId passed to the asynchronous request (maps to clientRequestId)')
    .requiredOption('--integration-id <id>', 'integration ID from registration (maps to integrationId)')
    .addHelpText(
      'after',
      `\nstatus is one of PENDING, IN_PROGRESS, DONE, FAILED. On FAILED, errors[] lists\nup to 20 {line, description} parse errors (line 0 = general processing error):\nfix those lines and re-upload until DONE. API docs: ${DOCS}#get-/v2/crm/request-status\n\nExample:\n  gong crm request-status upload-42 --integration-id 6286478263646`,
    )
    .action(async function (this: Command, id: string) {
      const opts = this.opts<{ integrationId: string }>();
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/crm/request-status',
          query: { integrationId: opts.integrationId, clientRequestId: id },
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });
};
