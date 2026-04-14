import assert from 'node:assert/strict';
import {
  EmailConnectEngine,
  downloadGmailAttachment,
  getGmailClientForMailbox,
} from '../src/index.js';

/**
 * Advanced Gmail RX example:
 * - threaded inbound mail
 * - attachment download
 * - history-based consumption instead of only message listing
 */
const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'gmail-rx-advanced',
  provider: 'gmail',
  primaryEmail: 'ops@example.com',
});

// Outside world: root message.
const root = engine.appendMessage('gmail-rx-advanced', {
  providerMessageId: 'gmail-thread-root',
  providerThreadId: 'gmail-thread-1',
  messageId: '<root@email-connect.local>',
  subject: 'Rate confirmation',
  from: 'broker@example.com',
  to: 'ops@example.com',
  bodyText: 'Please confirm the attached rate sheet.',
  attachments: [
    {
      providerAttachmentId: 'rate-sheet',
      filename: 'rate-sheet.pdf',
      mimeType: 'application/pdf',
      contentBytes: 'pdf!',
    },
  ],
});

// Outside world: reply in the same thread.
engine.appendMessage('gmail-rx-advanced', {
  providerMessageId: 'gmail-thread-reply',
  providerThreadId: root.providerThreadId,
  messageId: '<reply@email-connect.local>',
  inReplyTo: root.messageId,
  references: root.messageId,
  subject: 'Re: Rate confirmation',
  from: 'ops@example.com',
  to: 'broker@example.com',
  bodyText: 'Confirmed.',
});

const gmail = getGmailClientForMailbox(engine, 'gmail-rx-advanced');

// Inside world: start from a saved history checkpoint and process deltas.
const history = await gmail.users.history.list({
  userId: 'me',
  startHistoryId: '0',
  historyTypes: ['messageAdded'],
});
const addedIds = (history.data.history || [])
  .flatMap((entry) => entry.messagesAdded || [])
  .map((entry) => entry.message?.id)
  .filter((entry): entry is string => Boolean(entry));
assert.deepEqual(addedIds, ['gmail-thread-root', 'gmail-thread-reply']);

const openedRoot = await gmail.users.messages.get({
  userId: 'me',
  id: 'gmail-thread-root',
  format: 'full',
});
assert.equal(openedRoot.data.threadId, 'gmail-thread-1');

const attachment = await downloadGmailAttachment({
  engine,
  mailboxId: 'gmail-rx-advanced',
  providerMessageId: 'gmail-thread-root',
  providerAttachmentId: 'rate-sheet',
});
assert.equal(Buffer.from(attachment).toString('utf8'), 'pdf!');
