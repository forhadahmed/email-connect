import { afterEach, describe, expect, it } from 'vitest';
import { EmailConnectHttpServer } from '../../src/server.js';

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
    text,
  };
}

async function formFetch(url: string, body: Record<string, string>, init?: Omit<RequestInit, 'body' | 'method'> & { method?: string }) {
  return jsonFetch(url, {
    method: init?.method || 'POST',
    ...init,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(init?.headers || {}),
    },
    body: new URLSearchParams(body).toString(),
  });
}

describe('connect http server', () => {
  const servers: EmailConnectHttpServer[] = [];

  afterEach(async () => {
    while (servers.length) {
      const server = servers.pop();
      if (server) await server.close();
    }
  });

  it('renders Gmail consent when mailbox selection is ambiguous, then exchanges code and revokes via refresh token', async () => {
    const server = new EmailConnectHttpServer();
    servers.push(server);
    const { baseUrl, adminToken } = await server.listen();

    const createMailbox = async (id: string, primaryEmail: string) => {
      await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-email-connect-admin-token': adminToken,
        },
        body: JSON.stringify({
          id,
          provider: 'gmail',
          primaryEmail,
          auth: {
            refreshToken: null,
          },
        }),
      });
    };

    await createMailbox('gmail-a', 'ops-a@example.com');
    await createMailbox('gmail-b', 'ops-b@example.com');

    await jsonFetch(`${baseUrl}/__email-connect/v1/connect/clients`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        provider: 'gmail',
        clientId: 'gmail-http-client',
        clientSecret: 'gmail-http-secret',
        redirectUris: ['https://app.example.test/oauth/google/callback'],
        defaultConsentMode: 'auto_approve',
      }),
    });

    const authorize = await fetch(
      `${baseUrl}/o/oauth2/v2/auth?client_id=gmail-http-client&redirect_uri=${encodeURIComponent('https://app.example.test/oauth/google/callback')}&response_type=code&scope=${encodeURIComponent('openid email profile https://www.googleapis.com/auth/gmail.readonly')}&state=state-1&access_type=offline`,
      { redirect: 'manual' },
    );
    expect(authorize.status).toBe(200);
    const html = await authorize.text();
    expect(html).toContain('mailbox consent');

    const requests = await jsonFetch(`${baseUrl}/__email-connect/v1/connect/requests`, {
      headers: {
        'x-email-connect-admin-token': adminToken,
      },
    });
    const requestId = String(requests.body.data.at(-1).id);

    const approved = await fetch(`${baseUrl}/__email-connect/consent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        request_id: requestId,
        mailbox_id: 'gmail-a',
        decision: 'approve',
      }).toString(),
      redirect: 'manual',
    });
    expect(approved.status).toBe(302);
    const redirectUrl = String(approved.headers.get('location') || '');
    const code = new URL(redirectUrl).searchParams.get('code');
    expect(code).toBeTruthy();

    const token = await formFetch(`${baseUrl}/token`, {
      grant_type: 'authorization_code',
      client_id: 'gmail-http-client',
      client_secret: 'gmail-http-secret',
      redirect_uri: 'https://app.example.test/oauth/google/callback',
      code: String(code),
    });
    expect(token.response.status).toBe(200);
    expect(token.body.refresh_token).toBeTruthy();

    const userInfo = await jsonFetch(`${baseUrl}/openidconnect/v1/userinfo`, {
      headers: {
        Authorization: `Bearer ${token.body.access_token}`,
      },
    });
    expect(userInfo.body).toMatchObject({
      email: 'ops-a@example.com',
      sub: 'ops-a@example.com',
    });

    const revoke = await fetch(`${baseUrl}/revoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: String(token.body.refresh_token),
      }).toString(),
    });
    expect(revoke.status).toBe(200);

    const labels = await fetch(`${baseUrl}/gmail/v1/users/me/labels`, {
      headers: {
        Authorization: `Bearer ${token.body.access_token}`,
      },
    });
    expect(labels.status).toBe(401);
  });

  it('serves Graph auth-code and refresh flows, enforcing read-vs-send capability on mail endpoints', async () => {
    const server = new EmailConnectHttpServer();
    servers.push(server);
    const { baseUrl, adminToken } = await server.listen();

    await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        id: 'graph-http',
        provider: 'graph',
        primaryEmail: 'dispatch@example.com',
        auth: {
          refreshToken: null,
        },
        messages: [
          {
            providerMessageId: 'graph-msg-1',
            subject: 'Inbound',
            bodyText: 'Inbound body',
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
        clientId: 'graph-http-client',
        clientSecret: 'graph-http-secret',
        redirectUris: ['https://app.example.test/oauth/microsoft/callback'],
        defaultConsentMode: 'auto_approve',
      }),
    });

    const readAuthorize = await fetch(
      `${baseUrl}/common/oauth2/v2.0/authorize?client_id=graph-http-client&redirect_uri=${encodeURIComponent('https://app.example.test/oauth/microsoft/callback')}&response_type=code&scope=${encodeURIComponent('offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read')}&state=graph-read&login_hint=${encodeURIComponent('dispatch@example.com')}`,
      { redirect: 'manual' },
    );
    expect(readAuthorize.status).toBe(302);
    const readCode = new URL(String(readAuthorize.headers.get('location') || '')).searchParams.get('code');
    expect(readCode).toBeTruthy();

    const readToken = await formFetch(`${baseUrl}/common/oauth2/v2.0/token`, {
      grant_type: 'authorization_code',
      client_id: 'graph-http-client',
      client_secret: 'graph-http-secret',
      redirect_uri: 'https://app.example.test/oauth/microsoft/callback',
      code: String(readCode),
    });
    expect(readToken.response.status).toBe(200);

    const readMessages = await jsonFetch(`${baseUrl}/graph/v1.0/me/messages`, {
      headers: {
        Authorization: `Bearer ${readToken.body.access_token}`,
      },
    });
    expect(readMessages.response.status).toBe(200);
    expect(readMessages.body.value).toHaveLength(1);

    const readMime = await fetch(`${baseUrl}/graph/v1.0/me/messages/graph-msg-1/$value`, {
      headers: {
        Authorization: `Bearer ${readToken.body.access_token}`,
      },
    });
    expect(readMime.status).toBe(200);

    const blockedDraft = await fetch(`${baseUrl}/graph/v1.0/me/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readToken.body.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subject: 'Blocked',
        toRecipients: [{ emailAddress: { address: 'shipper@example.com' } }],
        body: { contentType: 'Text', content: 'Blocked body' },
      }),
    });
    expect(blockedDraft.status).toBe(401);

    const blockedSendMail = await fetch(`${baseUrl}/graph/v1.0/me/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readToken.body.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: 'Blocked sendMail',
          toRecipients: [{ emailAddress: { address: 'shipper@example.com' } }],
          body: { contentType: 'Text', content: 'Blocked sendMail body' },
        },
      }),
    });
    expect(blockedSendMail.status).toBe(401);

    const sendAuthorize = await fetch(
      `${baseUrl}/common/oauth2/v2.0/authorize?client_id=graph-http-client&redirect_uri=${encodeURIComponent('https://app.example.test/oauth/microsoft/callback')}&response_type=code&scope=${encodeURIComponent('offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send')}&state=graph-send&login_hint=${encodeURIComponent('dispatch@example.com')}&email_connect_mode=send`,
      { redirect: 'manual' },
    );
    expect(sendAuthorize.status).toBe(302);
    const sendCode = new URL(String(sendAuthorize.headers.get('location') || '')).searchParams.get('code');
    expect(sendCode).toBeTruthy();

    const sendToken = await formFetch(`${baseUrl}/common/oauth2/v2.0/token`, {
      grant_type: 'authorization_code',
      client_id: 'graph-http-client',
      client_secret: 'graph-http-secret',
      redirect_uri: 'https://app.example.test/oauth/microsoft/callback',
      code: String(sendCode),
    });
    expect(sendToken.response.status).toBe(200);

    const createdDraft = await jsonFetch(`${baseUrl}/graph/v1.0/me/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendToken.body.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subject: 'Allowed',
        toRecipients: [{ emailAddress: { address: 'shipper@example.com' } }],
        body: { contentType: 'Text', content: 'Allowed body' },
      }),
    });
    expect(createdDraft.response.status).toBe(200);
    expect(createdDraft.body.id).toBeTruthy();

    const uploadSession = await jsonFetch(`${baseUrl}/graph/v1.0/me/messages/${createdDraft.body.id}/attachments/createUploadSession`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendToken.body.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: 'file',
          name: 'send-scope.bin',
          size: 6,
        },
      }),
    });
    expect(uploadSession.response.status).toBe(201);

    const allowedSendMail = await fetch(`${baseUrl}/graph/v1.0/me/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendToken.body.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: 'Allowed sendMail',
          toRecipients: [{ emailAddress: { address: 'shipper@example.com' } }],
          body: { contentType: 'Text', content: 'Allowed sendMail body' },
        },
      }),
    });
    expect(allowedSendMail.status).toBe(202);

    const refreshed = await formFetch(`${baseUrl}/common/oauth2/v2.0/token`, {
      grant_type: 'refresh_token',
      client_id: 'graph-http-client',
      client_secret: 'graph-http-secret',
      refresh_token: String(sendToken.body.refresh_token),
    });
    expect(refreshed.response.status).toBe(200);
    expect(refreshed.body.refresh_token).toBeTruthy();
    expect(refreshed.body.refresh_token).not.toBe(sendToken.body.refresh_token);

    const staleRefresh = await fetch(`${baseUrl}/common/oauth2/v2.0/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: 'graph-http-client',
        client_secret: 'graph-http-secret',
        refresh_token: String(sendToken.body.refresh_token),
      }).toString(),
    });
    expect(staleRefresh.status).toBe(400);
    const staleBody = await staleRefresh.json();
    expect(staleBody.error).toBe('invalid_grant');
  });

  it('supports Gmail incremental consent over HTTP when include_granted_scopes=true', async () => {
    const server = new EmailConnectHttpServer();
    servers.push(server);
    const { baseUrl, adminToken } = await server.listen();

    await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        id: 'gmail-http-incremental',
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
        clientId: 'gmail-http-incremental-client',
        clientSecret: 'gmail-http-incremental-secret',
        redirectUris: ['https://app.example.test/oauth/google/callback'],
        defaultConsentMode: 'auto_approve',
      }),
    });

    const readAuthorize = await fetch(
      `${baseUrl}/o/oauth2/v2/auth?client_id=gmail-http-incremental-client&redirect_uri=${encodeURIComponent('https://app.example.test/oauth/google/callback')}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly')}&state=gmail-read&login_hint=${encodeURIComponent('incremental@example.com')}&access_type=online`,
      { redirect: 'manual' },
    );
    expect(readAuthorize.status).toBe(302);
    const readCode = new URL(String(readAuthorize.headers.get('location') || '')).searchParams.get('code');
    expect(readCode).toBeTruthy();

    const readToken = await formFetch(`${baseUrl}/token`, {
      grant_type: 'authorization_code',
      client_id: 'gmail-http-incremental-client',
      client_secret: 'gmail-http-incremental-secret',
      redirect_uri: 'https://app.example.test/oauth/google/callback',
      code: String(readCode),
    });
    expect(readToken.response.status).toBe(200);
    expect(String(readToken.body.scope || '')).toContain('gmail.readonly');

    const blockedSend = await fetch(`${baseUrl}/gmail/v1/users/me/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readToken.body.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        raw: Buffer.from('From: incremental@example.com\r\nTo: shipper@example.com\r\n\r\nblocked').toString('base64url'),
      }),
    });
    expect(blockedSend.status).toBe(401);

    const sendAuthorize = await fetch(
      `${baseUrl}/o/oauth2/v2/auth?client_id=gmail-http-incremental-client&redirect_uri=${encodeURIComponent('https://app.example.test/oauth/google/callback')}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.send')}&state=gmail-send&login_hint=${encodeURIComponent('incremental@example.com')}&access_type=online&include_granted_scopes=true&prompt=consent`,
      { redirect: 'manual' },
    );
    expect(sendAuthorize.status).toBe(302);
    const sendCode = new URL(String(sendAuthorize.headers.get('location') || '')).searchParams.get('code');
    expect(sendCode).toBeTruthy();

    const sendToken = await formFetch(`${baseUrl}/token`, {
      grant_type: 'authorization_code',
      client_id: 'gmail-http-incremental-client',
      client_secret: 'gmail-http-incremental-secret',
      redirect_uri: 'https://app.example.test/oauth/google/callback',
      code: String(sendCode),
    });
    expect(sendToken.response.status).toBe(200);
    expect(String(sendToken.body.scope || '')).toContain('gmail.readonly');
    expect(String(sendToken.body.scope || '')).toContain('gmail.send');

    const allowedSend = await jsonFetch(`${baseUrl}/gmail/v1/users/me/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendToken.body.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        raw: Buffer.from('From: incremental@example.com\r\nTo: shipper@example.com\r\n\r\nallowed').toString('base64url'),
      }),
    });
    expect(allowedSend.response.status).toBe(200);

    const labels = await jsonFetch(`${baseUrl}/gmail/v1/users/me/labels`, {
      headers: {
        Authorization: `Bearer ${sendToken.body.access_token}`,
      },
    });
    expect(labels.response.status).toBe(200);
  });

  it('enforces Gmail metadata-scope behavior for metadata reads versus body and attachment access', async () => {
    const server = new EmailConnectHttpServer();
    servers.push(server);
    const { baseUrl, adminToken } = await server.listen();

    await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        id: 'gmail-http-metadata',
        provider: 'gmail',
        primaryEmail: 'metadata@example.com',
        auth: {
          refreshToken: null,
        },
        messages: [
          {
            providerMessageId: 'gmail-metadata-msg',
            subject: 'Metadata only',
            bodyText: 'Body should be blocked',
            attachments: [
              {
                providerAttachmentId: 'gmail-metadata-att',
                filename: 'blocked.pdf',
                mimeType: 'application/pdf',
                contentBytes: 'blocked-pdf',
              },
            ],
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
        clientId: 'gmail-http-metadata-client',
        clientSecret: 'gmail-http-metadata-secret',
        redirectUris: ['https://app.example.test/oauth/google/callback'],
        defaultConsentMode: 'auto_approve',
      }),
    });

    const authorize = await fetch(
      `${baseUrl}/o/oauth2/v2/auth?client_id=gmail-http-metadata-client&redirect_uri=${encodeURIComponent('https://app.example.test/oauth/google/callback')}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.metadata')}&state=gmail-metadata&login_hint=${encodeURIComponent('metadata@example.com')}&access_type=online`,
      { redirect: 'manual' },
    );
    expect(authorize.status).toBe(302);
    const code = new URL(String(authorize.headers.get('location') || '')).searchParams.get('code');
    expect(code).toBeTruthy();

    const token = await formFetch(`${baseUrl}/token`, {
      grant_type: 'authorization_code',
      client_id: 'gmail-http-metadata-client',
      client_secret: 'gmail-http-metadata-secret',
      redirect_uri: 'https://app.example.test/oauth/google/callback',
      code: String(code),
    });
    expect(token.response.status).toBe(200);
    expect(String(token.body.scope || '')).toContain('gmail.metadata');

    const allowedMetadata = await jsonFetch(
      `${baseUrl}/gmail/v1/users/me/messages/gmail-metadata-msg?format=metadata&metadataHeaders=subject`,
      {
        headers: {
          Authorization: `Bearer ${token.body.access_token}`,
        },
      },
    );
    expect(allowedMetadata.response.status).toBe(200);
    expect(allowedMetadata.body.payload.headers).toEqual([{ name: 'Subject', value: 'Metadata only' }]);

    const blockedSearch = await fetch(`${baseUrl}/gmail/v1/users/me/messages?q=subject:Metadata`, {
      headers: {
        Authorization: `Bearer ${token.body.access_token}`,
      },
    });
    expect(blockedSearch.status).toBe(401);

    const blockedRaw = await fetch(`${baseUrl}/gmail/v1/users/me/messages/gmail-metadata-msg?format=raw`, {
      headers: {
        Authorization: `Bearer ${token.body.access_token}`,
      },
    });
    expect(blockedRaw.status).toBe(401);

    const blockedAttachment = await fetch(`${baseUrl}/gmail/v1/users/me/messages/gmail-metadata-msg/attachments/gmail-metadata-att`, {
      headers: {
        Authorization: `Bearer ${token.body.access_token}`,
      },
    });
    expect(blockedAttachment.status).toBe(401);
  });

  it('returns provider-shaped authorization denial details for Microsoft interactive consent', async () => {
    const server = new EmailConnectHttpServer();
    servers.push(server);
    const { baseUrl, adminToken } = await server.listen();

    await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        id: 'graph-http-denied',
        provider: 'graph',
        primaryEmail: 'deny@example.com',
        backend: {
          connect: {
            consentMode: 'interactive',
          },
        },
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
        provider: 'graph',
        clientId: 'graph-http-denied-client',
        clientSecret: 'graph-http-denied-secret',
        redirectUris: ['https://app.example.test/oauth/microsoft/callback'],
        defaultConsentMode: 'auto_approve',
      }),
    });

    const authorize = await fetch(
      `${baseUrl}/common/oauth2/v2.0/authorize?client_id=graph-http-denied-client&redirect_uri=${encodeURIComponent('https://app.example.test/oauth/microsoft/callback')}&response_type=code&scope=${encodeURIComponent('offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read')}&state=graph-denied&login_hint=${encodeURIComponent('deny@example.com')}`,
      { redirect: 'manual' },
    );
    expect(authorize.status).toBe(200);
    const html = await authorize.text();
    expect(html).toContain('Microsoft mailbox consent');

    const requests = await jsonFetch(`${baseUrl}/__email-connect/v1/connect/requests`, {
      headers: {
        'x-email-connect-admin-token': adminToken,
      },
    });
    const requestId = String(requests.body.data.at(-1).id);

    const denied = await fetch(`${baseUrl}/__email-connect/consent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        provider: 'graph',
        request_id: requestId,
        mailbox_id: 'graph-http-denied',
        decision: 'deny',
      }).toString(),
      redirect: 'manual',
    });
    expect(denied.status).toBe(302);

    const location = new URL(String(denied.headers.get('location') || ''));
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('error_description')).toBe('the user canceled the authentication');
    expect(location.searchParams.get('state')).toBe('graph-denied');
  });
});
