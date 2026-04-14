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
      id: 'graph-http-basic',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
      auth: {
        refreshToken: null,
      },
      messages: [
        {
          providerMessageId: 'graph-http-basic-msg-1',
          subject: 'Inbound dispatch',
          bodyText: 'A carrier replied with a status update.',
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
      provider: 'graph',
      clientId: 'graph-http-basic-client',
      clientSecret: 'graph-http-basic-secret',
      redirectUris: ['https://app.example.test/oauth/microsoft/callback'],
      defaultConsentMode: 'auto_approve',
    }),
  });

  const authorize = await fetch(
    `${baseUrl}/common/oauth2/v2.0/authorize?client_id=graph-http-basic-client&redirect_uri=${encodeURIComponent('https://app.example.test/oauth/microsoft/callback')}&response_type=code&scope=${encodeURIComponent('offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read')}&state=graph-http-basic&login_hint=${encodeURIComponent('dispatch@example.com')}`,
    { redirect: 'manual' },
  );
  assert.equal(authorize.status, 302);

  const redirectUrl = new URL(String(authorize.headers.get('location') || ''));
  const code = redirectUrl.searchParams.get('code');
  assert.ok(code, 'expected Microsoft authorize redirect to include a code');

  const token = await formFetch(`${baseUrl}/common/oauth2/v2.0/token`, {
    grant_type: 'authorization_code',
    client_id: 'graph-http-basic-client',
    client_secret: 'graph-http-basic-secret',
    redirect_uri: 'https://app.example.test/oauth/microsoft/callback',
    code,
  });
  assert.equal(token.response.status, 200);
  assert.ok(token.body.access_token);
  assert.ok(token.body.refresh_token);

  const me = await jsonFetch(`${baseUrl}/graph/v1.0/me`, {
    headers: {
      Authorization: `Bearer ${token.body.access_token}`,
    },
  });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.mail, 'dispatch@example.com');

  const inbox = await jsonFetch(`${baseUrl}/graph/v1.0/me/messages`, {
    headers: {
      Authorization: `Bearer ${token.body.access_token}`,
    },
  });
  assert.equal(inbox.response.status, 200);
  assert.equal(inbox.body.value.length, 1);
} finally {
  await server.close();
}
