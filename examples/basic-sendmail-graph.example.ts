import assert from 'node:assert/strict';
import { createGraphEngine, getOutlookGraphClientForMailbox } from '@email-connect/graph';

/**
 * Basic Microsoft Graph `sendMail` example:
 * - issue a direct JSON `sendMail` call
 * - keep the sent copy in Sent Items
 * - inspect both the outbox record and the mailbox view
 */
const engine = createGraphEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'graph-sendmail-claims',
  provider: 'graph',
  primaryEmail: 'claims@example.com',
});

const { client } = getOutlookGraphClientForMailbox(engine, 'graph-sendmail-claims');
await client.api('/me/sendMail').post({
  message: {
    subject: 'Claim packet received',
    toRecipients: [{ emailAddress: { address: 'adjuster@example.com' } }],
    body: {
      contentType: 'HTML',
      content: '<p>The policyholder documents were received and queued for review.</p>',
    },
  },
  saveToSentItems: true,
});

const [outbound] = engine.listOutbox('graph-sendmail-claims');
assert.ok(outbound);
assert.equal(outbound.subject, 'Claim packet received');
assert.equal(outbound.bodyHtml, '<p>The policyholder documents were received and queued for review.</p>');

const sentItems = await client.api('/me/messages?$top=10').get();
assert.ok(
  sentItems.value.some(
    (entry: { subject?: string; parentFolderId?: string }) =>
      entry.subject === 'Claim packet received' && entry.parentFolderId === 'sentitems',
  ),
);
