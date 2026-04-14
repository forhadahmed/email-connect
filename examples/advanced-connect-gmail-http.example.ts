import assert from 'node:assert/strict';
import { createGmailHttpServer } from '@email-connect/gmail';
import { encodeBase64Url } from './helpers.js';

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

const server = createGmailHttpServer();
const { baseUrl, adminToken } = await server.listen();

try {
  await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-email-connect-admin-token': adminToken,
    },
    body: JSON.stringify({
      id: 'gmail-http-advanced',
      provider: 'gmail',
      primaryEmail: 'incremental@example.com',
      auth: {
        refreshToken: null,
      },
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
      clientId: 'gmail-http-advanced-client',
      clientSecret: 'gmail-http-advanced-secret',
      redirectUris: ['https://app.example.test/oauth/google/callback'],
      defaultConsentMode: 'auto_approve',
    }),
  });

  // First grant only read access.
  const readAuthorize = await fetch(
    `${baseUrl}/o/oauth2/v2/auth?client_id=gmail-http-advanced-client&redirect_uri=${encodeURIComponent('https://app.example.test/oauth/google/callback')}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly')}&state=gmail-http-read&login_hint=${encodeURIComponent('incremental@example.com')}&access_type=online`,
    { redirect: 'manual' },
  );
  assert.equal(readAuthorize.status, 302);
  const readCode = new URL(String(readAuthorize.headers.get('location') || '')).searchParams.get('code');
  assert.ok(readCode);

  const readToken = await formFetch(`${baseUrl}/token`, {
    grant_type: 'authorization_code',
    client_id: 'gmail-http-advanced-client',
    client_secret: 'gmail-http-advanced-secret',
    redirect_uri: 'https://app.example.test/oauth/google/callback',
    code: readCode,
  });
  assert.equal(readToken.response.status, 200);
  assert.match(String(readToken.body.scope || ''), /gmail\.readonly/);

  const blockedSend = await fetch(`${baseUrl}/gmail/v1/users/me/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readToken.body.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodeBase64Url('From: incremental@example.com\r\nTo: shipper@example.com\r\n\r\nblocked'),
    }),
  });
  assert.equal(blockedSend.status, 401);

  // Google incremental consent keeps the existing read grant when
  // include_granted_scopes=true is present on the second authorization request.
  const upgradedAuthorize = await fetch(
    `${baseUrl}/o/oauth2/v2/auth?client_id=gmail-http-advanced-client&redirect_uri=${encodeURIComponent('https://app.example.test/oauth/google/callback')}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.send')}&state=gmail-http-send&login_hint=${encodeURIComponent('incremental@example.com')}&access_type=online&include_granted_scopes=true&prompt=consent`,
    { redirect: 'manual' },
  );
  assert.equal(upgradedAuthorize.status, 302);
  const upgradedCode = new URL(String(upgradedAuthorize.headers.get('location') || '')).searchParams.get('code');
  assert.ok(upgradedCode);

  const upgradedToken = await formFetch(`${baseUrl}/token`, {
    grant_type: 'authorization_code',
    client_id: 'gmail-http-advanced-client',
    client_secret: 'gmail-http-advanced-secret',
    redirect_uri: 'https://app.example.test/oauth/google/callback',
    code: upgradedCode,
  });
  assert.equal(upgradedToken.response.status, 200);
  assert.match(String(upgradedToken.body.scope || ''), /gmail\.readonly/);
  assert.match(String(upgradedToken.body.scope || ''), /gmail\.send/);

  const allowedSend = await jsonFetch(`${baseUrl}/gmail/v1/users/me/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${upgradedToken.body.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodeBase64Url('From: incremental@example.com\r\nTo: shipper@example.com\r\n\r\nallowed'),
    }),
  });
  assert.equal(allowedSend.response.status, 200);

  const labels = await jsonFetch(`${baseUrl}/gmail/v1/users/me/labels`, {
    headers: {
      Authorization: `Bearer ${upgradedToken.body.access_token}`,
    },
  });
  assert.equal(labels.response.status, 200);
} finally {
  await server.close();
}
