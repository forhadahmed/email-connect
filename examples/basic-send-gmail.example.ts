import assert from 'node:assert/strict';
import {
  createGmailDraft,
  createGmailEngine,
  sendGmailReplyDraft,
} from '@email-connect/gmail';

/**
 * Basic Gmail TX example:
 * - the app creates a draft
 * - the app sends it
 * - the test asserts against the harness outbox
 */
const engine = createGmailEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'gmail-tx-basic',
  provider: 'gmail',
  primaryEmail: 'ops@example.com',
});

const draft = await createGmailDraft({
  engine,
  mailboxId: 'gmail-tx-basic',
  to: 'carrier@example.com',
  subject: 'Tender request',
  bodyText: 'Can you cover this load?',
  threadId: 'gmail-thread-1',
});
assert.equal(draft.providerThreadId, 'gmail-thread-1');

const sent = await sendGmailReplyDraft({
  engine,
  mailboxId: 'gmail-tx-basic',
  providerDraftId: draft.providerDraftId,
});
assert.equal(sent.providerThreadId, 'gmail-thread-1');
const [outbound] = engine.listOutbox('gmail-tx-basic');
assert.ok(outbound);
assert.equal(outbound.to, 'carrier@example.com');
assert.equal(outbound.subject, 'Tender request');
assert.equal(outbound.bodyText, 'Can you cover this load?');
assert.equal(outbound.providerThreadId, 'gmail-thread-1');
