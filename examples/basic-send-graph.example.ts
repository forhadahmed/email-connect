import assert from 'node:assert/strict';
import {
  createOutlookDraft,
  createGraphEngine,
  sendOutlookReplyDraft,
} from '@email-connect/graph';

/**
 * Basic Microsoft Graph TX example:
 * - create a draft through the Graph helper
 * - send it
 * - inspect the harness outbox
 */
const engine = createGraphEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'graph-tx-basic',
  provider: 'graph',
  primaryEmail: 'dispatch@example.com',
});

const draft = await createOutlookDraft({
  engine,
  mailboxId: 'graph-tx-basic',
  to: 'carrier@example.com',
  subject: 'Tender request',
  bodyText: 'Can you cover this shipment?',
});
const sent = await sendOutlookReplyDraft({
  engine,
  mailboxId: 'graph-tx-basic',
  providerDraftId: draft.providerDraftId,
});
assert.equal(sent.providerMessageId, draft.providerDraftId);
const [outbound] = engine.listOutbox('graph-tx-basic');
assert.ok(outbound);
assert.equal(outbound.to, 'carrier@example.com');
assert.equal(outbound.subject, 'Tender request');
assert.equal(outbound.bodyText, 'Can you cover this shipment?');
assert.equal(outbound.providerMessageId, draft.providerDraftId);
