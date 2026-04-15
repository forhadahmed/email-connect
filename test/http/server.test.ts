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
    expect(labels.body.labels.map((label: { name: string }) => label.name)).not.toContain('MICROTMS');

    const attachment = await fetch(`${baseUrl}/gmail/v1/users/me/messages/gmail-http-msg-1/attachments/att-http-1`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const attachmentBody = await attachment.json();
    expect(Buffer.from(String(attachmentBody.data), 'base64url').toString('utf8')).toBe('hello');
  });

  it('serves provider-shaped Gmail thread, format, watch, and import routes over HTTP', async () => {
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
        id: 'gmail-http-fidelity',
        provider: 'gmail',
        primaryEmail: 'ops@example.com',
      }),
    });
    const accessToken = String(created.body.data.accessToken);

    await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes/gmail-http-fidelity/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        providerMessageId: 'gmail-http-thread-1',
        providerThreadId: 'gmail-http-thread',
        subject: 'Thread root',
        from: 'shipper@example.com',
        bodyText: 'Root body',
      }),
    });
    await jsonFetch(`${baseUrl}/__email-connect/v1/mailboxes/gmail-http-fidelity/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-email-connect-admin-token': adminToken,
      },
      body: JSON.stringify({
        providerMessageId: 'gmail-http-thread-2',
        providerThreadId: 'gmail-http-thread',
        subject: 'Re: Thread root',
        from: 'carrier@example.com',
        bodyText: 'Reply body',
      }),
    });

    const metadata = await jsonFetch(
      `${baseUrl}/gmail/v1/users/me/messages/gmail-http-thread-1?format=metadata&metadataHeaders=subject`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    expect(metadata.response.status).toBe(200);
    expect(metadata.body.payload.headers).toEqual([{ name: 'Subject', value: 'Thread root' }]);
    expect(metadata.body.payload.parts).toBeUndefined();

    const threads = await jsonFetch(`${baseUrl}/gmail/v1/users/me/threads`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(threads.response.status).toBe(200);
    expect(threads.body.threads).toHaveLength(1);
    expect(threads.body.threads[0].id).toBe('gmail-http-thread');

    const thread = await jsonFetch(`${baseUrl}/gmail/v1/users/me/threads/gmail-http-thread?format=minimal`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(thread.response.status).toBe(200);
    expect(thread.body.messages).toHaveLength(2);
    expect(thread.body.messages[0].payload).toBeUndefined();

    const watch = await jsonFetch(`${baseUrl}/gmail/v1/users/me/watch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        topicName: 'projects/email-connect/topics/gmail-http',
      }),
    });
    expect(watch.response.status).toBe(200);
    expect(Number(watch.body.expiration || '0')).toBeGreaterThan(0);
    expect(watch.body.historyId).toBeTruthy();

    const stop = await jsonFetch(`${baseUrl}/gmail/v1/users/me/stop`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(stop.response.status).toBe(200);
    expect(stop.body).toEqual({});

    const imported = await jsonFetch(`${baseUrl}/gmail/v1/users/me/messages/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        raw: Buffer.from(
          ['From: imported@example.com', 'To: ops@example.com', 'Subject: Imported HTTP', '', 'Imported body'].join('\r\n'),
          'utf8',
        ).toString('base64url'),
      }),
    });
    expect(imported.response.status).toBe(200);
    expect(imported.body.id).toBeTruthy();
    expect(imported.body.labelIds).toEqual(['Label_SU5CT1g']);
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

  it('serves Graph provider routes for body preferences, MIME reads, move/copy, sendMail, and upload sessions', async () => {
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
        id: 'graph-http-fidelity',
        provider: 'graph',
        primaryEmail: 'dispatch@example.com',
        messages: [
          {
            providerMessageId: 'graph-http-msg-1',
            providerThreadId: 'graph-http-thread-1',
            subject: 'HTTP Graph root',
            from: 'shipper@example.com',
            to: 'dispatch@example.com',
            bodyHtml: '<p>HTTP <strong>HTML</strong></p>',
            attachments: [
              {
                providerAttachmentId: 'graph-http-ref',
                filename: 'link.url',
                mimeType: 'application/octet-stream',
                contentBytes: '',
                attachmentType: 'reference',
                sourceUrl: 'https://files.example.test/http-root.pdf',
              },
            ],
          },
        ],
      }),
    });
    const accessToken = String(created.body.data.accessToken);

    const preferred = await jsonFetch(`${baseUrl}/graph/v1.0/me/messages/graph-http-msg-1`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    });
    expect(preferred.response.status).toBe(200);
    expect(preferred.response.headers.get('preference-applied')).toBe('outlook.body-content-type="text"');
    expect(preferred.body.body.contentType).toBe('text');
    expect(preferred.body.body.content).toContain('HTTP HTML');

    const mime = await fetch(`${baseUrl}/graph/v1.0/me/messages/graph-http-msg-1/$value`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(mime.status).toBe(200);
    expect(mime.headers.get('content-type')).toContain('message/rfc822');
    expect(await mime.text()).toContain('Subject: HTTP Graph root');

    const moved = await jsonFetch(`${baseUrl}/graph/v1.0/me/messages/graph-http-msg-1/move`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        destinationId: 'archive',
      }),
    });
    expect(moved.response.status).toBe(201);
    expect(moved.body.parentFolderId).toBe('archive');

    const copied = await jsonFetch(`${baseUrl}/graph/v1.0/me/messages/graph-http-msg-1/copy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        destinationId: 'inbox',
      }),
    });
    expect(copied.response.status).toBe(201);
    expect(copied.body.parentFolderId).toBe('inbox');
    expect(copied.body.id).not.toBe('graph-http-msg-1');

    const draft = await jsonFetch(`${baseUrl}/graph/v1.0/me/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subject: 'Upload via HTTP',
        toRecipients: [{ emailAddress: { address: 'carrier@example.com' } }],
        body: { contentType: 'Text', content: 'Body' },
      }),
    });
    expect(draft.response.status).toBe(200);

    const uploadSession = await jsonFetch(`${baseUrl}/graph/v1.0/me/messages/${draft.body.id}/attachments/createUploadSession`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: 'file',
          name: 'http-large.bin',
          size: 8,
        },
      }),
    });
    expect(uploadSession.response.status).toBe(201);
    expect(String(uploadSession.body.uploadUrl || '')).toContain('/__email-connect/upload/graph/');

    const firstChunk = await fetch(String(uploadSession.body.uploadUrl), {
      method: 'PUT',
      headers: {
        'Content-Range': 'bytes 0-3/8',
      },
      body: Buffer.from('1234'),
    });
    expect(firstChunk.status).toBe(202);

    const secondChunk = await fetch(String(uploadSession.body.uploadUrl), {
      method: 'PUT',
      headers: {
        'Content-Range': 'bytes 4-7/8',
      },
      body: Buffer.from('5678'),
    });
    expect(secondChunk.status).toBe(201);
    const uploadedAttachment = await secondChunk.json();
    expect(uploadedAttachment.name).toBe('http-large.bin');
    expect(uploadedAttachment.contentBytes).toBeTruthy();

    const sent = await fetch(`${baseUrl}/graph/v1.0/me/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: 'HTTP send',
          toRecipients: [{ emailAddress: { address: 'json@example.com' } }],
          body: { contentType: 'HTML', content: '<p>HTTP send body</p>' },
        },
        saveToSentItems: true,
      }),
    });
    expect(sent.status).toBe(202);

    const sentMessages = await jsonFetch(`${baseUrl}/graph/v1.0/me/messages?$top=20`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(
      sentMessages.body.value.some(
        (entry: { subject?: string; parentFolderId?: string }) =>
          entry.subject === 'HTTP send' && entry.parentFolderId === 'sentitems',
      ),
    ).toBe(true);
  });
});
