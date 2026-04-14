import assert from 'node:assert/strict';
import { createGraphEngine, getOutlookGraphClientForMailbox } from '@email-connect/graph';

/**
 * Basic Microsoft Graph RX example:
 * - inject one inbound inbox message
 * - list it via the Graph inbox route
 * - open the message details
 */
const engine = createGraphEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'graph-rx-basic',
  provider: 'graph',
  primaryEmail: 'dispatch@example.com',
});

engine.appendMessage('graph-rx-basic', {
  providerMessageId: 'graph-msg-1',
  subject: 'Shipment delayed',
  from: 'carrier@example.com',
  to: 'dispatch@example.com',
  bodyText: 'Truck will arrive one hour late.',
});

const { client } = getOutlookGraphClientForMailbox(engine, 'graph-rx-basic');
const listed = await client.api('/me/mailFolders/inbox/messages?$top=10').get();
assert.equal(listed.value.length, 1);

const opened = await client.api('/me/messages/graph-msg-1?$select=id,body,bodyPreview').get();
assert.match(String(opened.body?.content || ''), /one hour late/i);
