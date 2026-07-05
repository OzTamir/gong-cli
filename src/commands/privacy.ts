/**
 * `gong privacy` — data-privacy lookups and purges: find every Gong element that
 * references an email address or phone number, or erase them entirely.
 * API semantics: https://gong.app.gong.io/settings/api/documentation#tag--Data-Privacy
 */
import type { Command } from 'commander';

import type { GroupRegistrar } from '../program.js';
import { makeClient, outputFlags } from '../program.js';
import { runSingle } from '../run.js';
import { confirmDestructive } from '../util.js';

const DOCS = 'https://gong.app.gong.io/settings/api/documentation';

const PHONE_FORMAT =
  "The phone number must start with a + (plus) sign followed by the country code; all\nother non-digits are ignored (e.g. '+14255552671', '+1-425-555-2671',\n'+1(425) 555-2671'). The CLI URL-encodes it for you.";

export const registerPrivacy: GroupRegistrar = (program, ctx) => {
  const privacy = program
    .command('privacy')
    .description('find and purge all references to an email address or phone number');

  // ---- gong privacy for-email <email> — GET /v2/data-privacy/data-for-email-address ----
  privacy
    .command('for-email')
    .description(
      'list every element referencing an email address (GET /v2/data-privacy/data-for-email-address)',
    )
    .argument('<email>', 'the email address to look up (maps to the emailAddress query parameter)')
    .addHelpText(
      'after',
      `\nReturns one unpaginated payload: emails, calls, meetings, customerData and\ncustomerEngagement arrays — everything comes back in a single response.\nRequires the api:data-privacy:read scope.\nAPI docs: ${DOCS}#get-/v2/data-privacy/data-for-email-address\n\nExamples:\n  gong privacy for-email user@example.com\n  gong privacy for-email user@example.com --fields calls,emails`,
    )
    .action(async function (this: Command, email: string) {
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/data-privacy/data-for-email-address',
          query: { emailAddress: email },
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong privacy for-phone <phone> — GET /v2/data-privacy/data-for-phone-number -----
  privacy
    .command('for-phone')
    .description(
      'list every element referencing a phone number (GET /v2/data-privacy/data-for-phone-number)',
    )
    .argument('<phone>', 'the phone number to look up (maps to the phoneNumber query parameter)')
    .addHelpText(
      'after',
      `\n${PHONE_FORMAT}\n\nReturns one unpaginated payload: emails, calls, meetings and customerData arrays\nplus suppliedPhoneNumber, matchingPhoneNumbers and emailAddresses.\nRequires the api:data-privacy:read scope.\nAPI docs: ${DOCS}#get-/v2/data-privacy/data-for-phone-number\n\nExamples:\n  gong privacy for-phone '+14255552671'\n  gong privacy for-phone '+1(425) 555-2671' --fields matchingPhoneNumbers,calls`,
    )
    .action(async function (this: Command, phone: string) {
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'GET',
          path: '/v2/data-privacy/data-for-phone-number',
          query: { phoneNumber: phone },
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong privacy purge-email <email> — POST /v2/data-privacy/erase-data-for-email-address
  privacy
    .command('purge-email')
    .description(
      'IRREVERSIBLE: erase an email address and everything referencing it (POST /v2/data-privacy/erase-data-for-email-address)',
    )
    .argument('<email>', 'the email address to purge (maps to the emailAddress query parameter)')
    .addHelpText(
      'after',
      `\nDeletes email messages sent to or from the address, calls where it appears (as a\nlead, contact, attendee or speaker), and leads/contacts with the address.\n\nThe purge is asynchronous and fire-and-forget: a 200 response only means Gong\naccepted the request (the body carries just a requestId), deletion may take\nseveral hours, and there is no status endpoint to poll — the requestId is only\nuseful with Gong support. A data-integrity guard may block abnormally large\ndeletions (contact help@gong.io if the purge fails). Delete the data from your\nCRM and email system first so it is not re-imported into Gong.\nRequires the api:data-privacy:delete scope.\n\nWithout --yes, non-interactive runs refuse (exit 2); on a TTY you must re-type\nthe email address to confirm.\nAPI docs: ${DOCS}#post-/v2/data-privacy/erase-data-for-email-address\n\nExamples:\n  gong privacy purge-email user@example.com\n  gong privacy purge-email user@example.com --yes`,
    )
    .action(async function (this: Command, email: string) {
      await confirmDestructive(this, ctx, {
        description: `Purge every Gong reference to email address '${email}' (calls, email messages, leads/contacts); deletion is asynchronous and may take hours.`,
        requireTyped: email,
      });
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'POST',
          path: '/v2/data-privacy/erase-data-for-email-address',
          query: { emailAddress: email },
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });

  // ---- gong privacy purge-phone <phone> — POST /v2/data-privacy/erase-data-for-phone-number
  privacy
    .command('purge-phone')
    .description(
      'IRREVERSIBLE: erase a phone number and everything referencing it (POST /v2/data-privacy/erase-data-for-phone-number)',
    )
    .argument('<phone>', 'the phone number to purge (maps to the phoneNumber query parameter)')
    .addHelpText(
      'after',
      `\n${PHONE_FORMAT}\n\nDeletes leads/contacts whose phone or mobile phone number matches, email messages\nsent to or from them, and calls where they appear.\n\nThe purge is asynchronous and fire-and-forget: a 200 response only means Gong\naccepted the request (the body carries just a requestId), deletion may take\nseveral hours, and there is no status endpoint to poll — the requestId is only\nuseful with Gong support. A data-integrity guard may block abnormally large\ndeletions (contact help@gong.io if the purge fails). Delete the data from your\nCRM and email system first so it is not re-imported into Gong.\nRequires the api:data-privacy:delete scope.\n\nWithout --yes, non-interactive runs refuse (exit 2); on a TTY you must re-type\nthe phone number to confirm.\nAPI docs: ${DOCS}#post-/v2/data-privacy/erase-data-for-phone-number\n\nExamples:\n  gong privacy purge-phone '+14255552671'\n  gong privacy purge-phone '+14255552671' --yes`,
    )
    .action(async function (this: Command, phone: string) {
      await confirmDestructive(this, ctx, {
        description: `Purge every Gong reference to phone number '${phone}' (calls, email messages, leads/contacts); deletion is asynchronous and may take hours.`,
        requireTyped: phone,
      });
      await runSingle({
        ctx,
        client: makeClient(this, ctx),
        spec: {
          method: 'POST',
          path: '/v2/data-privacy/erase-data-for-phone-number',
          query: { phoneNumber: phone },
        },
        flags: outputFlags(this),
        unwrapKey: null,
      });
    });
};
