import assert from 'node:assert/strict';
import {
  createGraphEngine,
  downloadOutlookAttachment,
  getOutlookGraphClientForMailbox,
} from '@email-connect/graph';

/**
 * Insurance intake pipeline example:
 * - a claimant sends a first-notice-of-loss email with supporting documents
 * - the claims system opens the message through Microsoft Graph-like APIs
 * - the system inspects and downloads the attachments it needs for processing
 * - the original message is moved out of the live inbox after intake
 * - an acknowledgement is drafted, enriched with a generated checklist PDF,
 *   and sent back to the claimant
 */
const engine = createGraphEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'claims-intake',
  provider: 'graph',
  primaryEmail: 'claims@example.com',
  backend: {
    omitAttachmentContentBytesIds: ['vehicle-photo'],
  },
});

engine.appendMessage('claims-intake', {
  providerMessageId: 'claim-intake-001',
  providerThreadId: 'claim-thread-001',
  messageId: '<claim-intake-001@email-connect.local>',
  subject: 'Claim FNOL 24-1187',
  from: 'customer@example.net',
  to: 'claims@example.com',
  bodyText:
    'Policy 77-0192. Claim 24-1187. Please find the first notice of loss form and a vehicle photo attached.',
  attachments: [
    {
      providerAttachmentId: 'fnol-packet',
      filename: 'fnol-24-1187.pdf',
      mimeType: 'application/pdf',
      contentBytes: 'FNOL-PACKET',
    },
    {
      providerAttachmentId: 'vehicle-photo',
      filename: 'vehicle-damage.jpg',
      mimeType: 'image/jpeg',
      contentBytes: 'PHOTO-BYTES',
    },
  ],
});

const { client } = getOutlookGraphClientForMailbox(engine, 'claims-intake');

const inbox = await client.api('/me/mailFolders/inbox/messages?$top=10').get();
assert.equal(inbox.value.length, 1);
assert.equal(inbox.value[0].id, 'claim-intake-001');

const opened = await client
  .api('/me/messages/claim-intake-001?$select=id,subject,body,bodyPreview,internetMessageHeaders')
  .header('Prefer', 'outlook.body-content-type="text"')
  .get();
assert.equal(opened.subject, 'Claim FNOL 24-1187');
assert.match(String(opened.body?.content || ''), /Policy 77-0192/);
assert.match(String(opened.body?.content || ''), /Claim 24-1187/);

const attachments = await client.api('/me/messages/claim-intake-001/attachments').get();
assert.equal(attachments.value.length, 2);
assert.deepEqual(
  attachments.value.map((entry: { name: string }) => entry.name).sort(),
  ['fnol-24-1187.pdf', 'vehicle-damage.jpg'],
);

const intakePacket = await downloadOutlookAttachment({
  engine,
  mailboxId: 'claims-intake',
  providerMessageId: 'claim-intake-001',
  providerAttachmentId: 'fnol-packet',
});
assert.equal(Buffer.from(intakePacket).toString('utf8'), 'FNOL-PACKET');

const moved = await client.api('/me/messages/claim-intake-001/move').post({
  destinationId: 'claims-reviewed',
});
assert.equal(moved.parentFolderId, 'claims-reviewed');

const draft = await client.api('/me/messages/claim-intake-001/createReply').post({});
await client.api(`/me/messages/${draft.id}`).patch({
  subject: 'Re: Claim FNOL 24-1187',
  body: {
    contentType: 'HTML',
    content:
      '<p>We received claim <strong>24-1187</strong>.</p><p>Your packet is under review and an adjuster will follow up shortly.</p>',
  },
  toRecipients: [{ emailAddress: { address: 'customer@example.net' } }],
});

const uploadSession = await client.api(`/me/messages/${draft.id}/attachments/createUploadSession`).post({
  AttachmentItem: {
    attachmentType: 'file',
    name: 'claim-checklist.pdf',
    size: 15,
  },
});
await client
  .api(String(uploadSession.uploadUrl))
  .header('Content-Range', 'bytes 0-6/15')
  .put(Buffer.from('CHECKLI'));
await client
  .api(String(uploadSession.uploadUrl))
  .header('Content-Range', 'bytes 7-14/15')
  .put(Buffer.from('ST-PDF!!'));

await client.api(`/me/messages/${draft.id}/send`).post({});

const [outbound] = engine.listOutbox('claims-intake');
assert.ok(outbound);
assert.equal(outbound.to, 'customer@example.net');
assert.equal(outbound.subject, 'Re: Claim FNOL 24-1187');
assert.match(String(outbound.bodyHtml || ''), /claim <strong>24-1187<\/strong>/i);

const sentItems = await client.api('/me/messages?$top=20').get();
assert.ok(
  sentItems.value.some(
    (entry: { subject?: string; parentFolderId?: string }) =>
      entry.subject === 'Re: Claim FNOL 24-1187' && entry.parentFolderId === 'sentitems',
  ),
);
