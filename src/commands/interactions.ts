/**
 * `gong interactions` — push Digital Interaction events (people interacting with digital
 * content: viewing documents, completing courses, visiting your site) into Gong.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Digital-Interactions
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { addBodyOptions, buildBody, hasPath } from '../body.js';
import type { BodyFlagMap } from '../body.js';
import { CliError, EXIT } from '../errors.js';
import { parseLossless } from '../json.js';
import { getPath } from '../output.js';
import { runSingle } from '../run.js';
import { csv, expandDateTime } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

/** Parse an inline JSON flag value (for structured fields like person or customFields). */
function jsonFlag(flagName: string): (value: string) => unknown {
  return (value: string) => {
    try {
      return parseLossless(value);
    } catch {
      throw new CliError(`${flagName} must be valid JSON.`, { exitCode: EXIT.USAGE });
    }
  };
}

/** Integer flag parser (int32 fields like numeric ranges; zero and negatives allowed). */
function intFlag(flagName: string): (value: string) => number {
  return (value: string) => {
    const n = Number(value);
    if (!Number.isInteger(n)) {
      throw new CliError(`${flagName} must be an integer, got '${value}'`, {
        exitCode: EXIT.USAGE,
      });
    }
    return n;
  };
}

export const registerInteractions: GroupRegistrar = (program, ctx) => {
  const interactions = program
    .command('interactions')
    .description('push digital interaction events into Gong (the modern engagement API)');

  // ---- gong interactions create — POST /v2/digital-interaction -------------------------
  // JSON-object flags (content, person) come before their scalar leaves so leaf flags
  // merge into — rather than get clobbered by — the full structure.
  const CREATE_MAP: BodyFlagMap = {
    eventId: { path: 'eventId' },
    timestamp: { path: 'timestamp', transform: (v) => expandDateTime(String(v)) },
    eventType: { path: 'eventType' },
    sourceSystemName: { path: 'sourceSystemName' },
    sessionId: { path: 'sessionId' },
    device: { path: 'device' },
    content: { path: 'content' },
    contentId: { path: 'content.contentId' },
    contentTitle: { path: 'content.contentTitle' },
    contentLabel: { path: 'content.contentLabel', transform: (v) => csv(String(v)) },
    contentUrl: { path: 'content.contentUrl' },
    contentAdditionalInfoUrl: { path: 'content.contentAdditionalInfoUrl' },
    numericValue: { path: 'content.numericContentDetails.value' },
    rangeFrom: { path: 'content.numericContentDetails.rangeFrom' },
    rangeTo: { path: 'content.numericContentDetails.rangeTo' },
    numericType: { path: 'content.numericContentDetails.numericType' },
    stepValue: { path: 'content.stepContentDetails.value' },
    availableSteps: { path: 'content.stepContentDetails.availableSteps', transform: (v) => csv(String(v)) },
    searchObjectName: { path: 'content.searchObjectDetails.name' },
    searchObjectType: { path: 'content.searchObjectDetails.objectType' },
    searchObjectDomain: { path: 'content.searchObjectDetails.domain' },
    searchObjectId: { path: 'content.searchObjectDetails.objectId' },
    searchObjectUrl: { path: 'content.searchObjectDetails.url' },
    contentCustomFields: { path: 'content.contentCustomFields' },
    person: { path: 'person' },
    personName: { path: 'person.name' },
    personEmail: { path: 'person.email' },
    personPhoneNumber: { path: 'person.phoneNumber' },
    personId: { path: 'person.personId' },
    personObjectType: { path: 'person.personBusinessContext.objectType' },
    personObjectId: { path: 'person.personBusinessContext.objectId' },
    personSystemName: { path: 'person.personBusinessContext.systemName' },
    country: { path: 'person.location.country' },
    state: { path: 'person.location.state' },
    region: { path: 'person.location.region' },
    city: { path: 'person.location.city' },
    companyId: { path: 'person.company.companyId' },
    companyName: { path: 'person.company.name' },
    companyDomain: { path: 'person.company.domain' },
    companyBusinessContexts: { path: 'person.company.companyBusinessContexts' },
    personCustomFields: { path: 'person.personCustomFields' },
    customFields: { path: 'customFields' },
    trackingId: { path: 'trackingId' },
  };

  const REQUIRED_CREATE_PATHS = ['eventId', 'timestamp', 'eventType', 'content.contentTitle'];

  const create = interactions
    .command('create')
    .description('post a digital interaction event (POST /v2/digital-interaction)')
    .option('--event-id <id>', "the provider's unique event ID, used for deduplication (maps to eventId; required)")
    .option('--timestamp <datetime>', 'when the event happened, ISO-8601 or YYYY-MM-DD (maps to timestamp; required)')
    .option('--event-type <type>', 'the type of event, e.g. "link clicked", "page viewed" (maps to eventType; required)')
    .option('--source-system-name <name>', 'IPaaS technology partner or integrating company name (maps to sourceSystemName)')
    .option('--session-id <id>', 'session identifier for tying related events together (maps to sessionId)')
    .option('--device <device>', 'MOBILE|PC (maps to device)')
    .option('--content <json>', 'the full content object as JSON; leaf flags below merge into it (maps to content; required)', jsonFlag('--content'))
    .option('--content-id <id>', "content's unique ID in the partner system (maps to content.contentId)")
    .option('--content-title <title>', 'the title of the content (maps to content.contentTitle; required)')
    .option('--content-label <labels>', 'comma-separated content tags (maps to content.contentLabel)')
    .option('--content-url <url>', 'URL of the content the person looked at (maps to content.contentUrl)')
    .option('--content-additional-info-url <url>', 'URL for additional details, e.g. analysis of the content viewed (maps to content.contentAdditionalInfoUrl)')
    .option('--numeric-value <n>', 'the numeric value for the content (maps to content.numericContentDetails.value)', intFlag('--numeric-value'))
    .option('--range-from <n>', 'lowest value the content can be given (maps to content.numericContentDetails.rangeFrom; required with any numericContentDetails)', intFlag('--range-from'))
    .option('--range-to <n>', 'highest value the content can be given (maps to content.numericContentDetails.rangeTo; required with any numericContentDetails)', intFlag('--range-to'))
    .option('--numeric-type <type>', 'PERCENTAGE|NPS|RATING|OTHER (maps to content.numericContentDetails.numericType)')
    .option('--step-value <step>', 'the current step in the process (maps to content.stepContentDetails.value)')
    .option('--available-steps <steps>', 'comma-separated list of all steps in the process (maps to content.stepContentDetails.availableSteps)')
    .option('--search-object-name <name>', 'entity the person searched for (maps to content.searchObjectDetails.name)')
    .option('--search-object-type <type>', 'VENDOR|PRODUCT|CATEGORY (maps to content.searchObjectDetails.objectType)')
    .option('--search-object-domain <domain>', 'domain of the searched entity (maps to content.searchObjectDetails.domain)')
    .option('--search-object-id <id>', 'entity ID in the partner system (maps to content.searchObjectDetails.objectId)')
    .option('--search-object-url <url>', 'entity URL in the partner system (maps to content.searchObjectDetails.url)')
    .option('--content-custom-fields <json>', 'JSON array of {name,value,dataType} custom fields (maps to content.contentCustomFields)', jsonFlag('--content-custom-fields'))
    .option('--person <json>', 'the full person object as JSON; person-* flags merge into it (maps to person)', jsonFlag('--person'))
    .option('--person-name <name>', 'maps to person.name')
    .option('--person-email <email>', 'email used for business context association (maps to person.email)')
    .option('--person-phone-number <phone>', 'phone number used for business context association (maps to person.phoneNumber)')
    .option('--person-id <id>', 'unique person ID in the partner system; mandatory for anonymous persons (maps to person.personId)')
    .option('--person-object-type <type>', 'CONTACT|LEAD (maps to person.personBusinessContext.objectType)')
    .option('--person-object-id <id>', 'object ID in the external system, e.g. the CRM (maps to person.personBusinessContext.objectId)')
    .option('--person-system-name <name>', 'name of the external system (maps to person.personBusinessContext.systemName)')
    .option('--country <country>', 'ISO 3166 country (maps to person.location.country)')
    .option('--state <state>', 'ISO 3166-2 state (maps to person.location.state)')
    .option('--region <region>', 'ISO 3166-2 region (maps to person.location.region)')
    .option('--city <city>', 'maps to person.location.city')
    .option('--company-id <id>', "company ID in the partner's source system (maps to person.company.companyId)")
    .option('--company-name <name>', 'maps to person.company.name')
    .option('--company-domain <domain>', 'company domain, e.g. acme.com; mandatory for anonymous persons (maps to person.company.domain)')
    .option('--company-business-contexts <json>', 'JSON array of {objectType:ACCOUNT|OPPORTUNITY,objectId,systemName} (maps to person.company.companyBusinessContexts)', jsonFlag('--company-business-contexts'))
    .option('--person-custom-fields <json>', 'JSON array of {name,value,dataType} custom fields (maps to person.personCustomFields)', jsonFlag('--person-custom-fields'))
    .option('--custom-fields <json>', 'JSON array of {name,value,dataType} event custom fields (maps to customFields)', jsonFlag('--custom-fields'))
    .option('--tracking-id <id>', 'anonymous tracking ID; mutually exclusive with person (maps to trackingId)');
  addBodyOptions(create);
  create
    .addHelpText(
      'after',
      `\nSend either person details or --tracking-id, never both. For an anonymous person\n(no name/email/phone/business context) --person-id and --company-domain become\nmandatory. Duplicate eventId values return HTTP 409 (already reported).\nRequires the api:digital-interactions:write scope.\nAPI docs: ${DOCS}#post-/v2/digital-interaction\n\nExamples:\n  gong interactions create --event-id evt-42 --timestamp 2026-07-01T10:00:00Z \\\n    --event-type "page viewed" --content-title "Pricing page" --content-url https://acme.com/pricing \\\n    --person-email jane@acme.com --company-domain acme.com\n  gong interactions create --body '{"eventId":"evt-42","timestamp":"2026-07-01T10:00:00Z","eventType":"page viewed","content":{"contentTitle":"Pricing page"},"trackingId":"anon-7"}'`,
    )
    .action(async function (this: Command) {
      const body = await buildBody(create, ctx, CREATE_MAP);
      const missing = REQUIRED_CREATE_PATHS.filter((path) => !hasPath(body, path));
      if (body === undefined || missing.length > 0) {
        throw new CliError(
          `gong interactions create is missing required fields: ${missing.join(', ') || REQUIRED_CREATE_PATHS.join(', ')}.`,
          {
            exitCode: EXIT.USAGE,
            hint: 'Provide them as flags (see --help) or in --body/--body-file.',
          },
        );
      }
      const person = getPath(body, 'person');
      const trackingId = getPath(body, 'trackingId');
      if (person !== null && person !== undefined && trackingId !== null && trackingId !== undefined) {
        throw new CliError(
          'gong interactions create takes either person details or --tracking-id, not both.',
          {
            exitCode: EXIT.USAGE,
            hint: 'The API requires person to be null when trackingId is sent (and vice versa).',
          },
        );
      }
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: { method: 'POST', path: '/v2/digital-interaction', body },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });
};
