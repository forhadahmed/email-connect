import { describe, expect, it } from 'vitest';
import {
  EmailConnectEngine,
  createGmailDraft,
  createOutlookReplyDraft,
  downloadGmailAttachment,
  downloadOutlookAttachment,
  getGmailClientForMailbox,
  getOutlookGraphClientForMailbox,
  sendGmailReplyDraft,
  sendOutlookReplyDraft,
} from '../../src/index.js';

function encodeBase64Url(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

describe('provider sdk surfaces', () => {
  it('exposes Gmail label ids separately, supports label drift, and returns rich history records', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'gmail-mailbox',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
      backend: {
        hiddenLabelNames: ['MICROTMS'],
        historyReplayMessageIds: ['msg-1'],
      },
    });
    const inserted = engine.appendMessage('gmail-mailbox', {
      providerMessageId: 'msg-1',
      subject: 'Inbound load',
      bodyText: 'Inbound load body',
      labels: ['MICROTMS'],
      attachments: [
        {
          providerAttachmentId: 'att-1',
          filename: 'pod.pdf',
          mimeType: 'application/pdf',
          contentBytes: 'pdf!',
        },
      ],
    });
    engine.updateMessage('gmail-mailbox', inserted.providerMessageId, {
      labels: ['MICROTMS', 'FOLLOW_UP'],
    });

    const gmail = getGmailClientForMailbox(engine, 'gmail-mailbox');
    const labels = await gmail.users.labels.list({ userId: 'me' });
    expect(labels.data.labels?.map((label) => label.name)).not.toContain('MICROTMS');

    const attachment = await downloadGmailAttachment({
      engine,
      mailboxId: 'gmail-mailbox',
      providerMessageId: 'msg-1',
      providerAttachmentId: 'att-1',
    });
    expect(Buffer.from(attachment).toString('utf8')).toBe('pdf!');

    engine.deleteMessage('gmail-mailbox', inserted.providerMessageId);

    const history = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: '0',
    });
    expect(history.data.history?.some((entry) => Array.isArray(entry.messagesAdded) && entry.messagesAdded.length === 1)).toBe(
      true,
    );
    expect(history.data.history?.some((entry) => Array.isArray(entry.labelsAdded) && entry.labelsAdded.length === 1)).toBe(
      true,
    );
    expect(history.data.history?.some((entry) => Array.isArray(entry.messagesDeleted) && entry.messagesDeleted.length === 1)).toBe(
      true,
    );

    const deletedOnly = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: '0',
      historyTypes: ['messageDeleted'],
    });
    expect(
      deletedOnly.data.history?.every(
        (entry) =>
          Array.isArray(entry.messagesDeleted) ||
          (!entry.messages && !entry.messagesAdded && !entry.labelsAdded && !entry.labelsRemoved),
      ),
    ).toBe(true);
  });

  it('creates and sends Gmail drafts through the SDK facade', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'gmail-drafts',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
    });

    const created = await createGmailDraft({
      engine,
      mailboxId: 'gmail-drafts',
      to: 'carrier@example.com',
      subject: 'Draft subject',
      bodyText: 'Draft body',
      threadId: 'gmail-thread-1',
    });
    expect(created.providerDraftId).toContain('gmail-draft');

    const sent = await sendGmailReplyDraft({
      engine,
      mailboxId: 'gmail-drafts',
      providerDraftId: created.providerDraftId,
    });
    expect(sent.providerMessageId).toBe(`gmail-sent-${created.providerDraftId}`);
    expect(engine.listOutbox('gmail-drafts')).toHaveLength(1);
  });

  it('serves Outlook attachment fallback, reply drafts, and opaque delta links through the SDK facade', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'graph-mailbox',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
      backend: {
        omitAttachmentContentBytesIds: ['att-value'],
      },
    });
    engine.appendMessage('graph-mailbox', {
      providerMessageId: 'graph-msg-1',
      providerThreadId: 'graph-thread-1',
      subject: 'Outlook inbound',
      from: 'shipper@example.com',
      bodyText: 'Outlook body',
      attachments: [
        {
          providerAttachmentId: 'att-value',
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          contentBytes: 'binary!',
        },
      ],
    });

    const bytes = await downloadOutlookAttachment({
      engine,
      mailboxId: 'graph-mailbox',
      providerMessageId: 'graph-msg-1',
      providerAttachmentId: 'att-value',
    });
    expect(Buffer.from(bytes).toString('utf8')).toBe('binary!');

    const created = await createOutlookReplyDraft({
      engine,
      mailboxId: 'graph-mailbox',
      providerMessageId: 'graph-msg-1',
      subject: 'Re: Outlook inbound',
      bodyText: 'Reply body',
    });
    const sent = await sendOutlookReplyDraft({
      engine,
      mailboxId: 'graph-mailbox',
      providerDraftId: created.providerDraftId,
    });
    expect(sent.providerMessageId).toBe(created.providerDraftId);

    const { client } = getOutlookGraphClientForMailbox(engine, 'graph-mailbox');
    const delta = await client.api('/me/mailFolders/inbox/messages/delta').get();
    expect(String(delta['@odata.deltaLink'] || '')).toContain('/graph/v1.0/me/mailFolders/inbox/messages/delta');
  });

  it('supports microtms-style Graph path shapes including inbox listing, attachment paging, and draft cleanup deletes', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'graph-microtms-shapes',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
      providerUserId: 'graph-user-1',
    });
    engine.appendMessage('graph-microtms-shapes', {
      providerMessageId: 'graph-msg-a',
      providerThreadId: 'thread-a',
      subject: 'A',
      bodyText: 'Body A',
      attachments: [
        {
          providerAttachmentId: 'att-a1',
          filename: 'a1.txt',
          mimeType: 'text/plain',
          contentBytes: 'a1',
        },
        {
          providerAttachmentId: 'att-a2',
          filename: 'a2.txt',
          mimeType: 'text/plain',
          contentBytes: 'a2',
        },
      ],
    });
    engine.appendMessage('graph-microtms-shapes', {
      providerMessageId: 'graph-msg-b',
      providerThreadId: 'thread-b',
      subject: 'B',
      bodyText: 'Body B',
    });

    const { client } = getOutlookGraphClientForMailbox(engine, 'graph-microtms-shapes');

    const me = await client.api('/me?$select=id,mail,userPrincipalName').get();
    expect(me).toMatchObject({
      id: 'graph-user-1',
      mail: 'dispatch@example.com',
      userPrincipalName: 'dispatch@example.com',
    });

    const inboxPage = await client
      .api('/me/mailFolders/inbox/messages?$top=1&$select=id,subject,from,toRecipients,receivedDateTime')
      .get();
    expect(inboxPage.value).toHaveLength(1);
    expect(String(inboxPage['@odata.nextLink'] || '')).toContain('/graph/v1.0/me/mailFolders/inbox/messages');

    const attachmentPage = await client
      .api('/me/messages/graph-msg-a/attachments?$top=1&$select=id,name,contentType,size')
      .get();
    expect(attachmentPage.value).toHaveLength(1);
    expect(String(attachmentPage['@odata.nextLink'] || '')).toContain('/graph/v1.0/me/messages/graph-msg-a/attachments');

    const attachmentPage2 = await client.api(String(attachmentPage['@odata.nextLink'])).get();
    expect(attachmentPage2.value).toHaveLength(1);

    const created = await createOutlookReplyDraft({
      engine,
      mailboxId: 'graph-microtms-shapes',
      providerMessageId: 'graph-msg-a',
      subject: 'Re: A',
      bodyText: 'cleanup me',
    });
    await client.api(`/me/messages/${created.providerDraftId}`).header('Prefer', 'IdType="ImmutableId"').delete();
    expect(engine.snapshotMailbox('graph-microtms-shapes').drafts).toHaveLength(0);
  });

  it('preserves HTML-capable compose flows for Gmail direct send and Outlook draft send', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'gmail-compose-html',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
    });
    engine.createMailbox({
      id: 'graph-compose-html',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
    });

    const gmail = getGmailClientForMailbox(engine, 'gmail-compose-html');
    const gmailRaw = [
      'To: carrier@example.com',
      'Subject: HTML update',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="mix-1"',
      '',
      '--mix-1',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Plain body',
      '--mix-1',
      'Content-Type: text/html; charset="UTF-8"',
      '',
      '<p>HTML body</p>',
      '--mix-1--',
      '',
    ].join('\r\n');
    const gmailSent = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodeBase64Url(gmailRaw),
        threadId: 'gmail-thread-html',
      },
    });
    expect(gmailSent.data.threadId).toBe('gmail-thread-html');
    expect(engine.listOutbox('gmail-compose-html')).toMatchObject([
      {
        bodyText: 'Plain body',
        bodyHtml: '<p>HTML body</p>',
        providerThreadId: 'gmail-thread-html',
      },
    ]);

    const { client } = getOutlookGraphClientForMailbox(engine, 'graph-compose-html');
    const graphDraft = await client.api('/me/messages').post({
      subject: 'HTML outbound',
      toRecipients: [{ emailAddress: { address: 'shipper@example.com' } }],
      body: { contentType: 'HTML', content: '<strong>Graph HTML</strong>' },
    });
    await client.api(`/me/messages/${graphDraft.id}/send`).post({});
    expect(engine.listOutbox('graph-compose-html')).toMatchObject([
      {
        bodyText: '',
        bodyHtml: '<strong>Graph HTML</strong>',
      },
    ]);
  });

  it('accepts microtms-style unprefixed operation names for failure injection', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'gmail-fault-alias',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
      backend: {
        transientFailureMode: '429',
        transientFailureOperations: ['history.list'],
        transientFailureHits: 1,
      },
    });
    engine.createMailbox({
      id: 'graph-fault-alias',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
      backend: {
        transientFailureMode: '429',
        transientFailureOperations: ['delta.get'],
        transientFailureHits: 1,
      },
    });

    const gmail = getGmailClientForMailbox(engine, 'gmail-fault-alias');
    await expect(
      gmail.users.history.list({
        userId: 'me',
        startHistoryId: '0',
      }),
    ).rejects.toThrow(/429/i);

    const { client } = getOutlookGraphClientForMailbox(engine, 'graph-fault-alias');
    await expect(client.api('/me/mailFolders/inbox/messages/delta').get()).rejects.toThrow(/429/i);
  });
});
