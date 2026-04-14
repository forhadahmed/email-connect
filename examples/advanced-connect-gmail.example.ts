import assert from 'node:assert/strict';
import {
  beginGmailAuthorization,
  approveGmailAuthorization,
  createGmailEngine,
  exchangeGmailAuthorizationCode,
  registerGmailOAuthClient,
  revokeGmailAuthorization,
} from '@email-connect/gmail';

const engine = createGmailEngine({ baseTime: '2026-04-14T12:00:00.000Z' });

engine.createMailbox({
  id: 'gmail-connect-advanced',
  provider: 'gmail',
  primaryEmail: 'ops@example.com',
  auth: {
    refreshToken: null,
  },
});

registerGmailOAuthClient(engine, {
  clientId: 'gmail-advanced-client',
  clientSecret: 'gmail-advanced-secret',
  redirectUris: ['https://app.example.test/oauth/google/callback'],
  defaultConsentMode: 'auto_approve',
});

const first = beginGmailAuthorization({
  engine,
  baseUrl: 'http://email-connect.test',
  clientId: 'gmail-advanced-client',
  redirectUri: 'https://app.example.test/oauth/google/callback',
  prompt: 'consent',
  loginHint: 'ops@example.com',
});

const firstApproved = approveGmailAuthorization({
  engine,
  requestId: first.request.id,
});

const firstCode = new URL(firstApproved.redirectUrl).searchParams.get('code');
assert.ok(firstCode);

const firstGrant = exchangeGmailAuthorizationCode({
  engine,
  clientId: 'gmail-advanced-client',
  clientSecret: 'gmail-advanced-secret',
  redirectUri: 'https://app.example.test/oauth/google/callback',
  code: firstCode,
});

assert.ok(firstGrant.refreshToken, 'first offline consent should issue a refresh token');

const repeated = beginGmailAuthorization({
  engine,
  baseUrl: 'http://email-connect.test',
  clientId: 'gmail-advanced-client',
  redirectUri: 'https://app.example.test/oauth/google/callback',
  loginHint: 'ops@example.com',
});

const repeatedApproved = approveGmailAuthorization({
  engine,
  requestId: repeated.request.id,
});

const repeatedCode = new URL(repeatedApproved.redirectUrl).searchParams.get('code');
assert.ok(repeatedCode);

const repeatedGrant = exchangeGmailAuthorizationCode({
  engine,
  clientId: 'gmail-advanced-client',
  clientSecret: 'gmail-advanced-secret',
  redirectUri: 'https://app.example.test/oauth/google/callback',
  code: repeatedCode,
});

assert.equal(
  repeatedGrant.refreshToken,
  undefined,
  'repeat Gmail auth without prompt=consent should omit a new refresh token',
);

const revoked = revokeGmailAuthorization({
  engine,
  token: String(firstGrant.refreshToken),
});
assert.equal(revoked, true);

assert.throws(
  () => engine.connect.authorizeMailboxAccess('gmail', repeatedGrant.accessToken, 'gmail.messages.list'),
  /unknown mailbox access token/i,
);
