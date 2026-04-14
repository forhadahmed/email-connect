import assert from 'node:assert/strict';
import {
  EmailConnectEngine,
  downloadOutlookAttachment,
  getOutlookGraphClientForMailbox,
} from '../src/index.js';

/**
 * Advanced Microsoft Graph RX example:
 * - consume inbox changes via delta
 * - walk a threaded message
 * - download an attachment through the `$value` fallback path
 */
const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'graph-rx-advanced',
  provider: 'graph',
  primaryEmail: 'dispatch@example.com',
  backend: {
    omitAttachmentContentBytesIds: ['invoice-pdf'],
  },
});

const root = engine.appendMessage('graph-rx-advanced', {
  providerMessageId: 'graph-root',
  providerThreadId: 'graph-thread-1',
  messageId: '<graph-root@email-connect.local>',
  subject: 'Invoice attached',
  from: 'billing@example.com',
  to: 'dispatch@example.com',
  bodyText: 'Please see the invoice.',
  attachments: [
    {
      providerAttachmentId: 'invoice-pdf',
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      contentBytes: 'pdf!',
    },
  ],
});
engine.appendMessage('graph-rx-advanced', {
  providerMessageId: 'graph-reply',
  providerThreadId: root.providerThreadId,
  messageId: '<graph-reply@email-connect.local>',
  inReplyTo: root.messageId,
  references: root.messageId,
  subject: 'Re: Invoice attached',
  from: 'dispatch@example.com',
  to: 'billing@example.com',
  bodyText: 'Received.',
});

const { client } = getOutlookGraphClientForMailbox(engine, 'graph-rx-advanced');
const delta = await client.api('/me/mailFolders/inbox/messages/delta?$top=10').get();
assert.equal(delta.value.length, 2);

const opened = await client
  .api('/me/messages/graph-root?$select=id,body,bodyPreview,internetMessageHeaders')
  .header('Prefer', 'outlook.body-content-type="text"')
  .get();
assert.match(String(opened.body?.content || ''), /invoice/i);

const attachment = await downloadOutlookAttachment({
  engine,
  mailboxId: 'graph-rx-advanced',
  providerMessageId: 'graph-root',
  providerAttachmentId: 'invoice-pdf',
});
assert.equal(Buffer.from(attachment).toString('utf8'), 'pdf!');
