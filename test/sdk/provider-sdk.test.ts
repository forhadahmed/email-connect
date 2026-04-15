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

  it('supports Gmail message formats, thread resources, watch state, and provider-native import/insert flows', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'gmail-fidelity',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
    });
    engine.appendMessage('gmail-fidelity', {
      providerMessageId: 'thread-msg-1',
      providerThreadId: 'thread-1',
      from: 'shipper@example.com',
      to: 'ops@example.com',
      subject: 'Thread root',
      bodyText: 'Plain body',
      bodyHtml: '<p>Plain body</p>',
      rawHeaders: {
        'X-Test-Header': 'root',
      },
      attachments: [
        {
          providerAttachmentId: 'thread-att-1',
          filename: 'root.pdf',
          mimeType: 'application/pdf',
          contentBytes: 'pdf-bytes',
        },
      ],
    });
    engine.appendMessage('gmail-fidelity', {
      providerMessageId: 'thread-msg-2',
      providerThreadId: 'thread-1',
      from: 'carrier@example.com',
      to: 'ops@example.com',
      subject: 'Re: Thread root',
      bodyText: 'Reply body',
    });

    const gmail = getGmailClientForMailbox(engine, 'gmail-fidelity');

    const listed = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['Label_SU5CT1g'],
    });
    expect(listed.data.resultSizeEstimate).toBe(2);
    expect(listed.data.messages).toEqual([
      { id: 'thread-msg-2', threadId: 'thread-1' },
      { id: 'thread-msg-1', threadId: 'thread-1' },
    ]);

    const minimal = await gmail.users.messages.get({
      userId: 'me',
      id: 'thread-msg-1',
      format: 'minimal',
    });
    expect(minimal.data.payload).toBeUndefined();
    expect(minimal.data.labelIds).toEqual(['Label_SU5CT1g']);

    const metadata = await gmail.users.messages.get({
      userId: 'me',
      id: 'thread-msg-1',
      format: 'metadata',
      metadataHeaders: ['subject', 'x-test-header'],
    });
    expect(metadata.data.payload?.headers).toEqual([
      { name: 'Subject', value: 'Thread root' },
      { name: 'X-Test-Header', value: 'root' },
    ]);
    expect(metadata.data.payload?.parts).toEqual([
      {
        filename: 'root.pdf',
        mimeType: 'application/pdf',
        body: {
          attachmentId: 'thread-att-1',
          size: 9,
        },
      },
    ]);

    const raw = await gmail.users.messages.get({
      userId: 'me',
      id: 'thread-msg-1',
      format: 'raw',
    });
    expect(Buffer.from(String(raw.data.raw || ''), 'base64url').toString('utf8')).toContain('Subject: Thread root');
    expect(Buffer.from(String(raw.data.raw || ''), 'base64url').toString('utf8')).toContain('filename="root.pdf"');

    const threads = await gmail.users.threads.list({
      userId: 'me',
    });
    expect(threads.data.threads).toEqual([
      expect.objectContaining({
        id: 'thread-1',
      }),
    ]);

    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: 'thread-1',
      format: 'metadata',
      metadataHeaders: ['subject'],
    });
    expect(thread.data.messages).toHaveLength(2);
    expect(thread.data.messages?.every((message) => message.payload?.headers?.length === 1)).toBe(true);

    const watch = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: 'projects/email-connect/topics/gmail-watch',
        labelIds: ['INBOX'],
      },
    });
    expect(Number(watch.data.expiration || '0')).toBeGreaterThan(Date.parse('2026-04-20T00:00:00.000Z'));
    expect(watch.data.historyId).toBeTruthy();

    const stopped = await gmail.users.stop({
      userId: 'me',
    });
    expect(stopped.data).toEqual({});

    const imported = await gmail.users.messages.import({
      userId: 'me',
      requestBody: {
        raw: encodeBase64Url(
          [
            'From: imported@example.com',
            'To: ops@example.com',
            'Date: Tue, 14 Apr 2026 09:00:00 +0000',
            'Message-ID: <imported@example.com>',
            'Subject: Imported mail',
            '',
            'Imported body',
          ].join('\r\n'),
        ),
        internalDateSource: 'dateHeader',
      },
    });
    expect(imported.data.internalDate).toBe(String(Date.parse('2026-04-14T09:00:00.000Z')));

    await gmail.users.messages.insert({
      userId: 'me',
      requestBody: {
        raw: encodeBase64Url(
          [
            'From: inserted@example.com',
            'To: ops@example.com',
            'Subject: Inserted and deleted',
            '',
            'Inserted body',
          ].join('\r\n'),
        ),
        deleted: true,
      },
    });
    const visibleAfterInsert = await gmail.users.messages.list({
      userId: 'me',
    });
    expect(visibleAfterInsert.data.resultSizeEstimate).toBe(3);
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

  it('supports Graph MIME reads, typed attachments, move/copy, direct sendMail, and upload sessions', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'graph-fidelity',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
    });
    engine.appendMessage('graph-fidelity', {
      providerMessageId: 'graph-fidelity-msg',
      providerThreadId: 'graph-fidelity-thread',
      messageId: '<graph-fidelity-msg@email-connect.local>',
      subject: 'Fidelity root',
      from: 'shipper@example.com',
      to: 'dispatch@example.com',
      bodyHtml: '<p>Root <strong>HTML</strong></p>',
      attachments: [
        {
          providerAttachmentId: 'graph-file-att',
          filename: 'ratecon.pdf',
          mimeType: 'application/pdf',
          contentBytes: 'pdf-binary',
        },
        {
          providerAttachmentId: 'graph-ref-att',
          filename: 'Rate con link.url',
          mimeType: 'application/octet-stream',
          contentBytes: '',
          attachmentType: 'reference',
          sourceUrl: 'https://files.example.test/ratecon.pdf',
        },
        {
          providerAttachmentId: 'graph-item-att',
          filename: 'forwarded.eml',
          mimeType: 'message/rfc822',
          contentBytes: '',
          attachmentType: 'item',
          embeddedMessage: {
            subject: 'Embedded update',
            from: 'broker@example.com',
            to: ['dispatch@example.com'],
            bodyText: 'Embedded body',
          },
        },
      ],
    });

    const { client } = getOutlookGraphClientForMailbox(engine, 'graph-fidelity');

    const opened = await client
      .api('/me/messages/graph-fidelity-msg?$select=id,body,parentFolderId')
      .header('Prefer', 'outlook.body-content-type="text"')
      .get();
    expect(opened.body.contentType).toBe('text');
    expect(opened.body.content).toContain('Root HTML');
    expect(opened.parentFolderId).toBe('inbox');

    const mime = await client.api('/me/messages/graph-fidelity-msg/$value').get();
    expect(Buffer.from(mime).toString('utf8')).toContain('Subject: Fidelity root');
    expect(Buffer.from(mime).toString('utf8')).toContain('filename="ratecon.pdf"');

    const referenceAttachment = await client.api('/me/messages/graph-fidelity-msg/attachments/graph-ref-att').get();
    expect(referenceAttachment['@odata.type']).toBe('#microsoft.graph.referenceAttachment');
    expect(referenceAttachment.sourceUrl).toBe('https://files.example.test/ratecon.pdf');

    const itemAttachment = await client.api('/me/messages/graph-fidelity-msg/attachments/graph-item-att').get();
    expect(itemAttachment['@odata.type']).toBe('#microsoft.graph.itemAttachment');
    expect(itemAttachment.item.subject).toBe('Embedded update');

    await expect(client.api('/me/messages/graph-fidelity-msg/attachments/graph-ref-att/$value').get()).rejects.toThrow(
      /\$value/i,
    );

    const moved = await client.api('/me/messages/graph-fidelity-msg/move').post({
      destinationId: 'archive',
    });
    expect(moved.parentFolderId).toBe('archive');

    const inboxAfterMove = await client.api('/me/mailFolders/inbox/messages?$top=10').get();
    expect(inboxAfterMove.value.find((entry: { id: string }) => entry.id === 'graph-fidelity-msg')).toBeUndefined();

    const copied = await client.api('/me/messages/graph-fidelity-msg/copy').post({
      destinationId: 'inbox',
    });
    expect(copied.parentFolderId).toBe('inbox');
    expect(copied.id).not.toBe('graph-fidelity-msg');

    const draft = await client.api('/me/messages').post({
      subject: 'Upload session draft',
      toRecipients: [{ emailAddress: { address: 'carrier@example.com' } }],
      body: { contentType: 'Text', content: 'Draft body' },
    });
    const uploadSession = await client.api(`/me/messages/${draft.id}/attachments/createUploadSession`).post({
      AttachmentItem: {
        attachmentType: 'file',
        name: 'large.bin',
        contentType: 'application/octet-stream',
        size: 10,
      },
    });
    expect(String(uploadSession.uploadUrl || '')).toContain('/__email-connect/upload/graph/');

    const uploadFirst = await client
      .api(String(uploadSession.uploadUrl))
      .header('Content-Range', 'bytes 0-4/10')
      .put(Buffer.from('12345'));
    expect(uploadFirst.nextExpectedRanges).toEqual(['5-']);

    const uploadDone = await client
      .api(String(uploadSession.uploadUrl))
      .header('Content-Range', 'bytes 5-9/10')
      .put(Buffer.from('67890'));
    expect(uploadDone.name).toBe('large.bin');
    expect(uploadDone.contentBytes).toBeTruthy();

    await client.api('/me/sendMail').post({
      message: {
        subject: 'JSON send',
        toRecipients: [{ emailAddress: { address: 'json@example.com' } }],
        body: { contentType: 'HTML', content: '<p>JSON body</p>' },
        attachments: [
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: 'json.txt',
            contentType: 'text/plain',
            contentBytes: Buffer.from('json attachment').toString('base64'),
          },
        ],
      },
      saveToSentItems: true,
    });

    await client.api('/me/sendMail').post(
      Buffer.from(
        [
          'To: mime@example.com',
          'Subject: MIME send',
          'MIME-Version: 1.0',
          'Content-Type: multipart/mixed; boundary="mime-boundary"',
          '',
          '--mime-boundary',
          'Content-Type: text/plain; charset="UTF-8"',
          '',
          'MIME plain body',
          '--mime-boundary',
          'Content-Type: text/plain; name="mime.txt"',
          'Content-Transfer-Encoding: base64',
          'Content-Disposition: attachment; filename="mime.txt"',
          '',
          Buffer.from('mime attachment').toString('base64'),
          '--mime-boundary--',
          '',
        ].join('\r\n'),
        'utf8',
      ).toString('base64'),
    );

    expect(engine.listOutbox('graph-fidelity')).toMatchObject([
      {
        subject: 'JSON send',
        bodyHtml: '<p>JSON body</p>',
      },
      {
        subject: 'MIME send',
        bodyText: 'MIME plain body',
      },
    ]);

    const allMessages = await client.api('/me/messages?$top=20').get();
    expect(allMessages.value.some((entry: { parentFolderId?: string; subject?: string }) => entry.subject === 'JSON send' && entry.parentFolderId === 'sentitems')).toBe(true);
    expect(allMessages.value.some((entry: { subject?: string }) => entry.subject === 'MIME send')).toBe(true);
  });

  it('rejects out-of-order Graph upload chunks so large-attachment tests catch bad resumptions', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'graph-upload-errors',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
    });

    const { client } = getOutlookGraphClientForMailbox(engine, 'graph-upload-errors');
    const draft = await client.api('/me/messages').post({
      subject: 'Bad upload',
      toRecipients: [{ emailAddress: { address: 'carrier@example.com' } }],
      body: { contentType: 'Text', content: 'Chunk me' },
    });
    const uploadSession = await client.api(`/me/messages/${draft.id}/attachments/createUploadSession`).post({
      AttachmentItem: {
        attachmentType: 'file',
        name: 'bad.bin',
        size: 6,
      },
    });

    await expect(
      client.api(String(uploadSession.uploadUrl)).header('Content-Range', 'bytes 2-5/6').put(Buffer.from('3456')),
    ).rejects.toThrow(/next expected range/i);
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
