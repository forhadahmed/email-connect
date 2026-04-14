import assert from 'node:assert/strict';
import {
  beginGraphAuthorization,
  approveGraphAuthorization,
  createGraphEngine,
  exchangeGraphAuthorizationCode,
  getOutlookGraphClientForMailbox,
  registerGraphOAuthClient,
} from '@email-connect/graph';

const engine = createGraphEngine({ baseTime: '2026-04-14T12:00:00.000Z' });

engine.createMailbox({
  id: 'graph-connect-basic',
  provider: 'graph',
  primaryEmail: 'dispatch@example.com',
  auth: {
    refreshToken: null,
  },
  messages: [
    {
      providerMessageId: 'graph-basic-msg-1',
      subject: 'Inbound dispatch',
      bodyText: 'A carrier replied with a status update.',
    },
  ],
});

registerGraphOAuthClient(engine, {
  clientId: 'graph-basic-client',
  clientSecret: 'graph-basic-secret',
  redirectUris: ['https://app.example.test/oauth/microsoft/callback'],
  defaultConsentMode: 'auto_approve',
});

const started = beginGraphAuthorization({
  engine,
  baseUrl: 'http://email-connect.test',
  clientId: 'graph-basic-client',
  redirectUri: 'https://app.example.test/oauth/microsoft/callback',
  capabilityMode: 'read',
  loginHint: 'dispatch@example.com',
  scopes: [
    'offline_access',
    'https://graph.microsoft.com/Mail.Read',
    'https://graph.microsoft.com/User.Read',
  ],
});

assert.match(started.authorizationUrl, /\/common\/oauth2\/v2\.0\/authorize/);

const approved = approveGraphAuthorization({
  engine,
  requestId: started.request.id,
});

const code = new URL(approved.redirectUrl).searchParams.get('code');
assert.ok(code, 'expected Graph auth redirect code');

const grant = exchangeGraphAuthorizationCode({
  engine,
  clientId: 'graph-basic-client',
  clientSecret: 'graph-basic-secret',
  redirectUri: 'https://app.example.test/oauth/microsoft/callback',
  code,
});

assert.ok(grant.accessToken, 'expected access token');
assert.ok(grant.refreshToken, 'expected refresh token because offline_access was granted');

const { client } = getOutlookGraphClientForMailbox(engine, 'graph-connect-basic');
const inbox = await client.api('/me/messages').get();
assert.equal(inbox.value.length, 1);
assert.equal(inbox.value[0].subject, 'Inbound dispatch');
