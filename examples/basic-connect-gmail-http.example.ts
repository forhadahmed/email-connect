import assert from 'node:assert/strict';
import { EmailConnectHttpServer } from '../src/server/index.js';

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
  };
}

async function formFetch(url: string, body: Record<string, string>) {
  return jsonFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
}

const server = new EmailConnectHttpServer();
const { baseUrl, adminToken } = await server.listen();

try {
  await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-email-connect-admin-token': adminToken,
    },
    body: JSON.stringify({
      id: 'gmail-http-basic',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
      auth: {
        refreshToken: null,
      },
      messages: [
        {
          providerMessageId: 'gmail-http-basic-msg-1',
          subject: 'Inbound update',
          bodyText: 'Carrier says the trailer is loaded.',
        },
      ],
    }),
  });

  await jsonFetch(`${baseUrl}/__email-connect/v1/connect/clients`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-email-connect-admin-token': adminToken,
    },
    body: JSON.stringify({
      provider: 'gmail',
      clientId: 'gmail-http-basic-client',
      clientSecret: 'gmail-http-basic-secret',
      redirectUris: ['https://app.example.test/oauth/google/callback'],
      defaultConsentMode: 'auto_approve',
    }),
  });

  // Polyglot consumers can treat the harness exactly like a provider:
  // start at /authorize, follow the redirect, and then exchange the code.
  const authorize = await fetch(
    `${baseUrl}/o/oauth2/v2/auth?client_id=gmail-http-basic-client&redirect_uri=${encodeURIComponent('https://app.example.test/oauth/google/callback')}&response_type=code&scope=${encodeURIComponent('openid email profile https://www.googleapis.com/auth/gmail.readonly')}&state=gmail-http-basic&login_hint=${encodeURIComponent('ops@example.com')}&access_type=offline&prompt=consent`,
    { redirect: 'manual' },
  );
  assert.equal(authorize.status, 302);

  const redirectUrl = new URL(String(authorize.headers.get('location') || ''));
  const code = redirectUrl.searchParams.get('code');
  assert.ok(code, 'expected Google authorize redirect to include a code');

  const token = await formFetch(`${baseUrl}/token`, {
    grant_type: 'authorization_code',
    client_id: 'gmail-http-basic-client',
    client_secret: 'gmail-http-basic-secret',
    redirect_uri: 'https://app.example.test/oauth/google/callback',
    code,
  });
  assert.equal(token.response.status, 200);
  assert.ok(token.body.access_token);
  assert.ok(token.body.refresh_token);

  const userInfo = await jsonFetch(`${baseUrl}/openidconnect/v1/userinfo`, {
    headers: {
      Authorization: `Bearer ${token.body.access_token}`,
    },
  });
  assert.equal(userInfo.response.status, 200);
  assert.equal(userInfo.body.email, 'ops@example.com');

  const inbox = await jsonFetch(`${baseUrl}/gmail/v1/users/me/messages`, {
    headers: {
      Authorization: `Bearer ${token.body.access_token}`,
    },
  });
  assert.equal(inbox.response.status, 200);
  assert.equal(inbox.body.messages.length, 1);
} finally {
  await server.close();
}
