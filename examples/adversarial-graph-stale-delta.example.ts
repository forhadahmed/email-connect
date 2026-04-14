import assert from 'node:assert/strict';
import { EmailConnectEngine, getOutlookGraphClientForMailbox } from '../src/index.js';

/**
 * Adversarial Graph RX example:
 * - simulate a stale saved delta token
 * - show the expected 410 / SyncStateInvalid failure
 * - show the recovery pattern of restarting from a fresh delta bootstrap
 */
const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'graph-delta-reset',
  provider: 'graph',
  primaryEmail: 'dispatch@example.com',
});
engine.appendMessage('graph-delta-reset', {
  providerMessageId: 'graph-msg-1',
  subject: 'Seed',
  bodyText: 'Seed body',
});

const { client } = getOutlookGraphClientForMailbox(engine, 'graph-delta-reset');
const bootstrap = await client.api('/me/mailFolders/inbox/messages/delta?$top=10').get();
const freshDeltaLink = String(bootstrap['@odata.deltaLink'] || '');
assert.match(freshDeltaLink, /\/me\/mailFolders\/inbox\/messages\/delta/);

engine.configureBackend('graph-delta-reset', {
  invalidDeltaBeforeRowId: 2,
});
engine.appendMessage('graph-delta-reset', {
  providerMessageId: 'graph-msg-2',
  subject: 'After bootstrap',
  bodyText: 'After body',
});

let sawInvalidDelta = false;
try {
  await client.api('/me/mailFolders/inbox/messages/delta?sinceRowId=1').get();
} catch (error) {
  assert.equal((error as { statusCode?: number }).statusCode, 410);
  assert.equal((error as { code?: string }).code, 'SyncStateInvalid');
  sawInvalidDelta = true;
}
assert.equal(sawInvalidDelta, true);

const restarted = await client.api('/me/mailFolders/inbox/messages/delta?$top=10').get();
assert.equal(restarted.value.length, 2);
