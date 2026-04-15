import { EmailConnectEngine, decodeBase64ToBytes } from '@email-connect/core';
import { GraphService } from './service.js';

export type GraphRequestLike = {
  header(name: string, value: string): GraphRequestLike;
  get(): Promise<any>;
  post(body?: unknown): Promise<any>;
  put(body: Uint8Array | ArrayBuffer | Buffer | string): Promise<any>;
  patch(body: Record<string, unknown>): Promise<any>;
  delete(): Promise<void>;
};

export type OutlookGraphClientLike = {
  api(path: string): GraphRequestLike;
};

export function getOutlookGraphClientForMailbox(engine: EmailConnectEngine, mailboxId: string): { client: OutlookGraphClientLike } {
  const service = new GraphService(engine);
  const normalizePath = (path: string): string => {
    const stripGraphPrefix = (value: string): string =>
      value.startsWith('/graph/v1.0') ? value.slice('/graph/v1.0'.length) || '/' : value;

    if (/^https?:\/\//i.test(path)) {
      const url = new URL(path);
      return `${stripGraphPrefix(url.pathname)}${url.search}`;
    }
    return stripGraphPrefix(path);
  };

  const requestFactory = (rawPath: string): GraphRequestLike => {
    const path = normalizePath(rawPath);
    const parsedUrl = new URL(path, 'https://graph.microsoft.com/v1.0');
    const pathname = parsedUrl.pathname;
    let headers: Record<string, string> = {};
    const bodyContentType = () =>
      headers.prefer?.match(/outlook\.body-content-type\s*=\s*"?(text|html)"?/i)?.[1]?.toLowerCase() === 'text'
        ? 'text'
        : headers.prefer
            ?.match(/outlook\.body-content-type\s*=\s*"?(text|html)"?/i)?.[1]
            ?.toLowerCase() === 'html'
          ? 'html'
          : undefined;
    const request: GraphRequestLike = {
      header(name: string, value: string) {
        headers = { ...headers, [name.toLowerCase()]: value };
        return request;
      },
      async get() {
        if (pathname === '/me') return service.getMe(mailboxId);
        if (pathname === '/me/mailFolders/inbox/messages/delta') {
          return service.delta(mailboxId, path, 'https://graph.microsoft.com', { bodyContentType: bodyContentType() });
        }
        if (pathname === '/me/mailFolders/inbox/messages') {
          return service.listInboxMessages(mailboxId, path, 'https://graph.microsoft.com', { bodyContentType: bodyContentType() });
        }
        if (pathname === '/me/messages') {
          return service.listMessages(mailboxId, path, 'https://graph.microsoft.com', { bodyContentType: bodyContentType() });
        }
        const messageValueMatch = pathname.match(/^\/me\/messages\/([^/]+)\/\$value$/);
        if (messageValueMatch) {
          const messageId = messageValueMatch[1];
          if (!messageId) throw new Error(`Unsupported Graph message $value path: ${path}`);
          return service.getMessageValue(mailboxId, decodeURIComponent(messageId));
        }
        const messageMatch = pathname.match(/^\/me\/messages\/([^/]+)$/);
        if (messageMatch && !pathname.includes('/attachments/')) {
          const messageId = messageMatch[1];
          if (!messageId) throw new Error(`Unsupported Graph message path: ${path}`);
          return service.getMessage(mailboxId, decodeURIComponent(messageId), { bodyContentType: bodyContentType() });
        }
        const attachmentsMatch = pathname.match(/^\/me\/messages\/([^/]+)\/attachments$/);
        if (attachmentsMatch) {
          const messageId = attachmentsMatch[1];
          if (!messageId) throw new Error(`Unsupported Graph attachments path: ${path}`);
          return service.listAttachmentsPage(mailboxId, decodeURIComponent(messageId), path, 'https://graph.microsoft.com');
        }
        const attachmentValueMatch = pathname.match(/^\/me\/messages\/([^/]+)\/attachments\/([^/]+)\/\$value$/);
        if (attachmentValueMatch) {
          const messageId = attachmentValueMatch[1];
          const attachmentId = attachmentValueMatch[2];
          if (!messageId || !attachmentId) throw new Error(`Unsupported Graph attachment value path: ${path}`);
          return service.getAttachmentValue(
            mailboxId,
            decodeURIComponent(messageId),
            decodeURIComponent(attachmentId),
          );
        }
        const attachmentMatch = pathname.match(/^\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/);
        if (attachmentMatch) {
          const messageId = attachmentMatch[1];
          const attachmentId = attachmentMatch[2];
          if (!messageId || !attachmentId) throw new Error(`Unsupported Graph attachment path: ${path}`);
          return service.getAttachment(
            mailboxId,
            decodeURIComponent(messageId),
            decodeURIComponent(attachmentId),
            { bodyContentType: bodyContentType() },
          );
        }
        throw new Error(`Unsupported Graph GET path: ${path}; headers=${JSON.stringify(headers)}`);
      },
      async post(body?: unknown) {
        const createReplyMatch = pathname.match(/^\/me\/messages\/([^/]+)\/createReply$/);
        if (createReplyMatch) {
          const messageId = createReplyMatch[1];
          if (!messageId) throw new Error(`Unsupported Graph createReply path: ${path}`);
          return service.createReplyDraft(mailboxId, decodeURIComponent(messageId));
        }
        const sendMatch = pathname.match(/^\/me\/messages\/([^/]+)\/send$/);
        if (sendMatch) {
          const draftId = sendMatch[1];
          if (!draftId) throw new Error(`Unsupported Graph send path: ${path}`);
          return service.sendDraft(mailboxId, decodeURIComponent(draftId));
        }
        const moveMatch = pathname.match(/^\/me\/messages\/([^/]+)\/move$/);
        if (moveMatch) {
          const messageId = moveMatch[1];
          if (!messageId) throw new Error(`Unsupported Graph move path: ${path}`);
          return service.moveMessage(
            mailboxId,
            decodeURIComponent(messageId),
            String((body as Record<string, unknown> | undefined)?.destinationId || '').trim() || 'archive',
            { bodyContentType: bodyContentType() },
          );
        }
        const copyMatch = pathname.match(/^\/me\/messages\/([^/]+)\/copy$/);
        if (copyMatch) {
          const messageId = copyMatch[1];
          if (!messageId) throw new Error(`Unsupported Graph copy path: ${path}`);
          return service.copyMessage(
            mailboxId,
            decodeURIComponent(messageId),
            String((body as Record<string, unknown> | undefined)?.destinationId || '').trim() || 'archive',
            { bodyContentType: bodyContentType() },
          );
        }
        const uploadMatch = pathname.match(/^\/me\/messages\/([^/]+)\/attachments\/createUploadSession$/);
        if (uploadMatch) {
          const messageId = uploadMatch[1];
          if (!messageId) throw new Error(`Unsupported Graph upload-session path: ${path}`);
          return service.createAttachmentUploadSession(
            mailboxId,
            decodeURIComponent(messageId),
            (body || {}) as Record<string, unknown>,
            'https://graph.microsoft.com',
          );
        }
        if (pathname === '/me/sendMail') {
          await service.sendMail(mailboxId, body as Record<string, unknown> | string | Uint8Array | Buffer);
          return {};
        }
        if (pathname === '/me/messages') {
          return service.createDraft(mailboxId, (body || {}) as Record<string, unknown>);
        }
        throw new Error(`Unsupported Graph POST path: ${path}`);
      },
      async put(body: Uint8Array | ArrayBuffer | Buffer | string) {
        if (pathname.startsWith('/__email-connect/upload/graph/')) {
          const bytes =
            typeof body === 'string'
              ? new Uint8Array(Buffer.from(body))
              : body instanceof Uint8Array
                ? body
                : body instanceof ArrayBuffer
                  ? new Uint8Array(body)
                  : new Uint8Array(body);
          const outcome = await service.uploadAttachmentChunk(
            `${pathname}${parsedUrl.search}`,
            bytes,
            Object.fromEntries(Object.entries(headers)),
          );
          return outcome.body;
        }
        throw new Error(`Unsupported Graph PUT path: ${path}`);
      },
      async patch(body: Record<string, unknown>) {
        const draftMatch = pathname.match(/^\/me\/messages\/([^/]+)$/);
        if (!draftMatch) {
          throw new Error(`Unsupported Graph PATCH path: ${path}`);
        }
        const draftId = draftMatch[1];
        if (!draftId) throw new Error(`Unsupported Graph draft path: ${path}`);
        return service.patchDraft(mailboxId, decodeURIComponent(draftId), body);
      },
      async delete() {
        const draftMatch = pathname.match(/^\/me\/messages\/([^/]+)$/);
        if (!draftMatch?.[1]) {
          throw new Error(`Unsupported Graph DELETE path: ${path}`);
        }
        await service.deleteMessageResource(mailboxId, decodeURIComponent(draftMatch[1]));
      },
    };
    return request;
  };

  return {
    client: {
      api(path: string) {
        return requestFactory(path);
      },
    },
  };
}

export async function downloadOutlookAttachment(params: {
  engine: EmailConnectEngine;
  mailboxId: string;
  providerMessageId: string;
  providerAttachmentId: string;
}): Promise<Uint8Array> {
  const { client } = getOutlookGraphClientForMailbox(params.engine, params.mailboxId);
  const meta = await client.api(`/me/messages/${params.providerMessageId}/attachments/${params.providerAttachmentId}`).get();
  if (typeof meta?.contentBytes === 'string' && meta.contentBytes.length) {
    return decodeBase64ToBytes(meta.contentBytes);
  }
  const value = await client.api(`/me/messages/${params.providerMessageId}/attachments/${params.providerAttachmentId}/$value`).get();
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  throw new Error('Outlook attachment response missing inline and $value bytes');
}

export async function createOutlookReplyDraft(params: {
  engine: EmailConnectEngine;
  mailboxId: string;
  providerMessageId: string;
  subject?: string | null;
  bodyText: string;
}): Promise<{ providerDraftId: string; providerDraftMessageId: string; providerThreadId: string | null }> {
  const { client } = getOutlookGraphClientForMailbox(params.engine, params.mailboxId);
  const created = await client.api(`/me/messages/${params.providerMessageId}/createReply`).post({});
  const draftId = String(created.id || '');
  await client.api(`/me/messages/${draftId}`).patch({
    ...(params.subject ? { subject: /^\s*re:/i.test(params.subject) ? params.subject : `Re: ${params.subject}` } : {}),
    body: { contentType: 'Text', content: params.bodyText },
  });
  return {
    providerDraftId: draftId,
    providerDraftMessageId: draftId,
    providerThreadId: typeof created.conversationId === 'string' ? created.conversationId : null,
  };
}

export async function sendOutlookReplyDraft(params: {
  engine: EmailConnectEngine;
  mailboxId: string;
  providerDraftId: string;
}): Promise<{ providerMessageId: string | null; providerThreadId: string | null }> {
  const { client } = getOutlookGraphClientForMailbox(params.engine, params.mailboxId);
  const draft = await client.api(`/me/messages/${params.providerDraftId}?$select=id,conversationId`).get();
  await client.api(`/me/messages/${params.providerDraftId}/send`).post({});
  return {
    providerMessageId: typeof draft?.id === 'string' ? draft.id : params.providerDraftId,
    providerThreadId: typeof draft?.conversationId === 'string' ? draft.conversationId : null,
  };
}

export async function createOutlookDraft(params: {
  engine: EmailConnectEngine;
  mailboxId: string;
  to: string;
  subject?: string | null;
  bodyText: string;
}): Promise<{ providerDraftId: string; providerDraftMessageId: string; providerThreadId: string | null }> {
  const { client } = getOutlookGraphClientForMailbox(params.engine, params.mailboxId);
  const draft = await client.api('/me/messages').post({
    subject: String(params.subject || '').trim() || '(no subject)',
    toRecipients: [{ emailAddress: { address: params.to } }],
    body: { contentType: 'Text', content: params.bodyText },
  });
  return {
    providerDraftId: String(draft.id || ''),
    providerDraftMessageId: String(draft.id || ''),
    providerThreadId: typeof draft.conversationId === 'string' ? draft.conversationId : null,
  };
}
