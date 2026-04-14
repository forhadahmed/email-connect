import assert from 'node:assert/strict';
import { EmailConnectEngine, getGmailClientForMailbox } from '../src/index.js';

/**
 * Basic Gmail RX example:
 * - the outside world injects one inbound message into the mailbox
 * - the inside world lists it and opens it through the Gmail facade
 */
const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'gmail-rx-basic',
  provider: 'gmail',
  primaryEmail: 'ops@example.com',
});

// Outside world: new mail lands in the inbox.
engine.appendMessage('gmail-rx-basic', {
  providerMessageId: 'gmail-msg-1',
  subject: 'Pickup update',
  from: 'carrier@example.com',
  to: 'ops@example.com',
  bodyText: 'Driver arriving at 14:30.',
});

// Inside world: the app uses the Gmail facade exactly as it would poll Gmail.
const gmail = getGmailClientForMailbox(engine, 'gmail-rx-basic');
const listed = await gmail.users.messages.list({ userId: 'me' });
assert.deepEqual(listed.data.messages, [{ id: 'gmail-msg-1' }]);

const opened = await gmail.users.messages.get({
  userId: 'me',
  id: 'gmail-msg-1',
  format: 'full',
});
assert.equal(opened.data.payload?.headers?.find((header) => header.name === 'Subject')?.value, 'Pickup update');
assert.ok(opened.data.payload?.parts?.find((part) => part.mimeType === 'text/plain')?.body?.data);
