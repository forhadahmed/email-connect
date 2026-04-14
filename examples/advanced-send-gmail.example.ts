import assert from 'node:assert/strict';
import { createGmailEngine, getGmailClientForMailbox } from '@email-connect/gmail';
import { buildMultipartAlternativeRawEmail, encodeBase64Url } from './helpers.js';

/**
 * Advanced Gmail TX example:
 * - reply/thread-aware send
 * - multipart text + HTML body
 * - inspect the outbound message recorded by the harness
 */
const engine = createGmailEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'gmail-tx-advanced',
  provider: 'gmail',
  primaryEmail: 'ops@example.com',
});

const gmail = getGmailClientForMailbox(engine, 'gmail-tx-advanced');
const raw = buildMultipartAlternativeRawEmail({
  to: 'broker@example.com',
  subject: 'Re: Rate confirmation',
  text: 'Plain text confirmation.',
  html: '<p><strong>HTML</strong> confirmation.</p>',
  inReplyToMessageId: '<root@email-connect.local>',
  referencesMessageId: '<root@email-connect.local>',
});

await gmail.users.messages.send({
  userId: 'me',
  requestBody: {
    raw: encodeBase64Url(raw),
    threadId: 'gmail-thread-advanced',
  },
});

const [outbound] = engine.listOutbox('gmail-tx-advanced');
assert.ok(outbound);
assert.equal(outbound.to, 'broker@example.com');
assert.equal(outbound.subject, 'Re: Rate confirmation');
assert.equal(outbound.bodyText, 'Plain text confirmation.');
assert.equal(outbound.bodyHtml, '<p><strong>HTML</strong> confirmation.</p>');
assert.equal(outbound.providerThreadId, 'gmail-thread-advanced');
