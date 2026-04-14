import assert from 'node:assert/strict';
import {
  EmailConnectEngine,
  beginGmailAuthorization,
  approveGmailAuthorization,
  exchangeGmailAuthorizationCode,
  getGmailClientForMailbox,
  registerGmailOAuthClient,
} from '../src/index.js';

const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });

engine.createMailbox({
  id: 'gmail-connect-basic',
  provider: 'gmail',
  primaryEmail: 'ops@example.com',
  auth: {
    refreshToken: null,
  },
  messages: [
    {
      providerMessageId: 'gmail-basic-msg-1',
      subject: 'Inbound update',
      bodyText: 'Carrier says the trailer is loaded.',
    },
  ],
});

registerGmailOAuthClient(engine, {
  clientId: 'gmail-basic-client',
  clientSecret: 'gmail-basic-secret',
  redirectUris: ['https://app.example.test/oauth/google/callback'],
  defaultConsentMode: 'auto_approve',
});

const started = beginGmailAuthorization({
  engine,
  baseUrl: 'http://email-connect.test',
  clientId: 'gmail-basic-client',
  redirectUri: 'https://app.example.test/oauth/google/callback',
  prompt: 'consent',
  loginHint: 'ops@example.com',
  state: 'gmail-basic-state',
});

assert.match(started.authorizationUrl, /\/o\/oauth2\/v2\/auth/);

const approved = approveGmailAuthorization({
  engine,
  requestId: started.request.id,
});

const code = new URL(approved.redirectUrl).searchParams.get('code');
assert.ok(code, 'expected OAuth redirect to carry an auth code');

const grant = exchangeGmailAuthorizationCode({
  engine,
  clientId: 'gmail-basic-client',
  clientSecret: 'gmail-basic-secret',
  redirectUri: 'https://app.example.test/oauth/google/callback',
  code,
});

assert.ok(grant.accessToken, 'expected access token');
assert.ok(grant.refreshToken, 'expected refresh token on first offline Gmail consent');

const gmail = getGmailClientForMailbox(engine, 'gmail-connect-basic');
const profile = await gmail.users.getProfile({ userId: 'me' });
assert.equal(profile.data.emailAddress, 'ops@example.com');

const inbox = await gmail.users.messages.list({ userId: 'me', maxResults: 10 });
assert.equal(inbox.data.messages?.length, 1);
