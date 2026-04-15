import assert from 'node:assert/strict';
import { createGraphEngine, getOutlookGraphClientForMailbox } from '@email-connect/graph';

/**
 * Advanced Microsoft Graph TX example:
 * - reply to an existing thread
 * - patch the draft with an HTML body
 * - attach a large file through an upload session
 * - send it and inspect the recorded outbound message
 */
const engine = createGraphEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'graph-tx-advanced',
  provider: 'graph',
  primaryEmail: 'dispatch@example.com',
});
engine.appendMessage('graph-tx-advanced', {
  providerMessageId: 'graph-parent',
  providerThreadId: 'graph-thread-advanced',
  messageId: '<graph-parent@email-connect.local>',
  subject: 'Can you confirm pickup?',
  from: 'broker@example.com',
  to: 'dispatch@example.com',
  bodyText: 'Please confirm pickup ETA.',
});

const { client } = getOutlookGraphClientForMailbox(engine, 'graph-tx-advanced');
const draft = await client.api('/me/messages/graph-parent/createReply').post({});
await client.api(`/me/messages/${draft.id}`).patch({
  subject: 'Re: Can you confirm pickup?',
  body: {
    contentType: 'HTML',
    content: '<p>Pickup confirmed for <strong>15:00</strong>.</p>',
  },
  toRecipients: [{ emailAddress: { address: 'broker@example.com' } }],
});

const uploadSession = await client.api(`/me/messages/${draft.id}/attachments/createUploadSession`).post({
  AttachmentItem: {
    attachmentType: 'file',
    name: 'confirmation.pdf',
    size: 8,
  },
});
await client
  .api(String(uploadSession.uploadUrl))
  .header('Content-Range', 'bytes 0-3/8')
  .put(Buffer.from('CONF'));
await client
  .api(String(uploadSession.uploadUrl))
  .header('Content-Range', 'bytes 4-7/8')
  .put(Buffer.from('IRMD'));

await client.api(`/me/messages/${draft.id}/send`).post({});

const [outbound] = engine.listOutbox('graph-tx-advanced');
assert.ok(outbound);
assert.equal(outbound.to, 'broker@example.com');
assert.equal(outbound.subject, 'Re: Can you confirm pickup?');
assert.equal(outbound.bodyHtml, '<p>Pickup confirmed for <strong>15:00</strong>.</p>');
assert.equal(outbound.providerThreadId, 'graph-thread-advanced');

const sentItems = await client.api('/me/messages?$top=20').get();
assert.ok(
  sentItems.value.some(
    (entry: { subject?: string; parentFolderId?: string }) =>
      entry.subject === 'Re: Can you confirm pickup?' && entry.parentFolderId === 'sentitems',
  ),
);
