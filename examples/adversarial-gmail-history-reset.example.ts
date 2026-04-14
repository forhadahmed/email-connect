import assert from 'node:assert/strict';
import { createGmailEngine, getGmailClientForMailbox } from '@email-connect/gmail';

/**
 * Adversarial Gmail RX example:
 * - simulate a stale saved history cursor
 * - show the expected provider failure
 * - show the recovery pattern of re-bootstrapping from profile historyId
 */
const engine = createGmailEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'gmail-history-reset',
  provider: 'gmail',
  primaryEmail: 'ops@example.com',
  backend: {
    historyResetBeforeRowId: 2,
  },
});

engine.appendMessage('gmail-history-reset', {
  providerMessageId: 'gmail-msg-1',
  subject: 'Old message',
  bodyText: 'Old body',
});
engine.appendMessage('gmail-history-reset', {
  providerMessageId: 'gmail-msg-2',
  subject: 'New message',
  bodyText: 'New body',
});

const gmail = getGmailClientForMailbox(engine, 'gmail-history-reset');

let sawExpiredCursor = false;
try {
  await gmail.users.history.list({
    userId: 'me',
    startHistoryId: '0',
  });
} catch (error) {
  assert.match(String(error), /startHistoryId expired/i);
  sawExpiredCursor = true;
}
assert.equal(sawExpiredCursor, true);

const profile = await gmail.users.getProfile({ userId: 'me' });
assert.equal(profile.data.historyId, '2');
