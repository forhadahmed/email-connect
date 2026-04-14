import { afterEach, describe, expect, it } from 'vitest';
import { EmailConnectHttpServer } from '../../src/server/index.js';

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
  };
}

describe('http server', () => {
  const servers: EmailConnectHttpServer[] = [];

  afterEach(async () => {
    while (servers.length) {
      const server = servers.pop();
      if (server) await server.close();
    }
  });

  it('creates mailboxes through the control plane and serves Gmail-compatible endpoints', async () => {
    const server = new EmailConnectHttpServer();
    servers.push(server);
    const { baseUrl, adminToken } = await server.listen();

    const created = await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        id: 'gmail-http',
        provider: 'gmail',
        primaryEmail: 'ops@example.com',
        backend: {
          hiddenLabelNames: ['MICROTMS'],
        },
      }),
    });
    expect(created.response.status).toBe(201);
    const accessToken = String(created.body.data.accessToken);

    await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes/gmail-http/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        providerMessageId: 'gmail-http-msg-1',
        subject: 'Control inserted',
        bodyText: 'Control inserted body',
        labels: ['MICROTMS'],
      }),
    });
    await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes/gmail-http/messages/gmail-http-msg-1/attachments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        providerAttachmentId: 'att-http-1',
        filename: 'proof.txt',
        mimeType: 'text/plain',
        contentText: 'hello',
      }),
    });

    const labels = await jsonFetch(`${baseUrl}/gmail/v1/users/me/labels`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(labels.body.data.labels.map((label: { name: string }) => label.name)).not.toContain('MICROTMS');

    const attachment = await fetch(`${baseUrl}/gmail/v1/users/me/messages/gmail-http-msg-1/attachments/att-http-1`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const attachmentBody = await attachment.json();
    expect(Buffer.from(String(attachmentBody.data.data), 'base64url').toString('utf8')).toBe('hello');
  });

  it('generates mailbox email from declarative control-plane templates and exposes Graph delta semantics', async () => {
    const server = new EmailConnectHttpServer();
    servers.push(server);
    const { baseUrl, adminToken } = await server.listen();

    const created = await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        id: 'graph-http',
        provider: 'graph',
        primaryEmail: 'dispatch@example.com',
      }),
    });
    const accessToken = String(created.body.data.accessToken);

    const generated = await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes/graph-http/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        count: 3,
        profile: 'bursty',
        seed: 9,
        templates: [
          { subject: 'Shipment ready', bodyText: 'Body one' },
          { subject: 'Carrier update', bodyText: 'Body two' },
        ],
      }),
    });
    expect(generated.response.status).toBe(201);
    expect(generated.body.data.messages).toHaveLength(3);

    const delta = await jsonFetch(`${baseUrl}/graph/v1.0/me/mailFolders/inbox/messages/delta`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(delta.response.status).toBe(200);
    const deltaLink = String(delta.body['@odata.deltaLink'] || '');
    expect(deltaLink).toContain('/graph/v1.0/me/mailFolders/inbox/messages/delta');

    const inbox = await jsonFetch(`${baseUrl}/graph/v1.0/me/mailFolders/inbox/messages?$top=1`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(inbox.response.status).toBe(200);
    expect(inbox.body.value).toHaveLength(1);
    expect(String(inbox.body['@odata.nextLink'] || '')).toContain('/graph/v1.0/me/mailFolders/inbox/messages');

    await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes/graph-http/backend`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        invalidDeltaBeforeRowId: 999,
      }),
    });

    const stale = await fetch(deltaLink, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(stale.status).toBe(410);
  });
});
