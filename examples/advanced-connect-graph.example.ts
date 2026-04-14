import assert from 'node:assert/strict';
import {
  beginGraphAuthorization,
  approveGraphAuthorization,
  createGraphEngine,
  exchangeGraphAuthorizationCode,
  getOutlookGraphClientForMailbox,
  refreshGraphAuthorization,
  registerGraphOAuthClient,
} from '@email-connect/graph';

const engine = createGraphEngine({ baseTime: '2026-04-14T12:00:00.000Z' });

engine.createMailbox({
  id: 'graph-connect-advanced',
  provider: 'graph',
  primaryEmail: 'dispatch@example.com',
  auth: {
    refreshToken: null,
  },
});

registerGraphOAuthClient(engine, {
  clientId: 'graph-advanced-client',
  clientSecret: 'graph-advanced-secret',
  redirectUris: ['https://app.example.test/oauth/microsoft/callback'],
  defaultConsentMode: 'auto_approve',
});

const readOnly = beginGraphAuthorization({
  engine,
  baseUrl: 'http://email-connect.test',
  clientId: 'graph-advanced-client',
  redirectUri: 'https://app.example.test/oauth/microsoft/callback',
  capabilityMode: 'read',
  loginHint: 'dispatch@example.com',
  scopes: [
    'offline_access',
    'https://graph.microsoft.com/Mail.Read',
    'https://graph.microsoft.com/User.Read',
  ],
});

const readApproved = approveGraphAuthorization({
  engine,
  requestId: readOnly.request.id,
});

const readCode = new URL(readApproved.redirectUrl).searchParams.get('code');
assert.ok(readCode);

const readGrant = exchangeGraphAuthorizationCode({
  engine,
  clientId: 'graph-advanced-client',
  clientSecret: 'graph-advanced-secret',
  redirectUri: 'https://app.example.test/oauth/microsoft/callback',
  code: readCode,
});

assert.throws(
  () => engine.connect.authorizeMailboxAccess('graph', readGrant.accessToken, 'graph.draft.create'),
  /does not permit/i,
);

const sendMode = beginGraphAuthorization({
  engine,
  baseUrl: 'http://email-connect.test',
  clientId: 'graph-advanced-client',
  redirectUri: 'https://app.example.test/oauth/microsoft/callback',
  capabilityMode: 'send',
  loginHint: 'dispatch@example.com',
});

const sendApproved = approveGraphAuthorization({
  engine,
  requestId: sendMode.request.id,
});

const sendCode = new URL(sendApproved.redirectUrl).searchParams.get('code');
assert.ok(sendCode);

const sendGrant = exchangeGraphAuthorizationCode({
  engine,
  clientId: 'graph-advanced-client',
  clientSecret: 'graph-advanced-secret',
  redirectUri: 'https://app.example.test/oauth/microsoft/callback',
  code: sendCode,
});

const { client } = getOutlookGraphClientForMailbox(engine, 'graph-connect-advanced');
const draft = await client.api('/me/messages').post({
  subject: 'Connected outbound',
  toRecipients: [{ emailAddress: { address: 'shipper@example.com' } }],
  body: { contentType: 'Text', content: 'Draft body' },
});
assert.ok(draft.id, 'expected a provider draft id after send-capability upgrade');

const rotated = refreshGraphAuthorization({
  engine,
  clientId: 'graph-advanced-client',
  clientSecret: 'graph-advanced-secret',
  refreshToken: String(sendGrant.refreshToken),
});

assert.ok(rotated.refreshToken);
assert.notEqual(rotated.refreshToken, sendGrant.refreshToken);
