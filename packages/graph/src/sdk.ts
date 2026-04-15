import { EmailConnectEngine, decodeBase64ToBytes } from '@email-connect/core';
import { GraphService, parsePreferBodyContentType } from './service.js';

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

// The white-box client routes through Graph-like paths. Keeping those path
// patterns named makes the supported SDK surface obvious at a glance.
const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//i;
const GRAPH_MESSAGE_VALUE_PATH_PATTERN = /^\/me\/messages\/([^/]+)\/\$value$/;
const GRAPH_MESSAGE_PATH_PATTERN = /^\/me\/messages\/([^/]+)$/;
const GRAPH_ATTACHMENTS_PATH_PATTERN = /^\/me\/messages\/([^/]+)\/attachments$/;
const GRAPH_ATTACHMENT_VALUE_PATH_PATTERN = /^\/me\/messages\/([^/]+)\/attachments\/([^/]+)\/\$value$/;
const GRAPH_ATTACHMENT_PATH_PATTERN = /^\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/;
const GRAPH_CREATE_REPLY_PATH_PATTERN = /^\/me\/messages\/([^/]+)\/createReply$/;
const GRAPH_SEND_DRAFT_PATH_PATTERN = /^\/me\/messages\/([^/]+)\/send$/;
const GRAPH_MOVE_MESSAGE_PATH_PATTERN = /^\/me\/messages\/([^/]+)\/move$/;
const GRAPH_COPY_MESSAGE_PATH_PATTERN = /^\/me\/messages\/([^/]+)\/copy$/;
const GRAPH_CREATE_UPLOAD_SESSION_PATH_PATTERN = /^\/me\/messages\/([^/]+)\/attachments\/createUploadSession$/;
const REPLY_PREFIX_PATTERN = /^\s*re:/i;

/**
 * The white-box Graph client keeps the familiar `.api(...).get/post/patch`
 * shape so provider-specific test code can stay close to Microsoft client code.
 */
// Build a Graph-like path-driven client around the canonical Graph service.
// This is the main white-box bridge for consumers that already use Graph SDK
// style request builders in product code.
export function getOutlookGraphClientForMailbox(engine: EmailConnectEngine, mailboxId: string): { client: OutlookGraphClientLike } {
  const service = new GraphService(engine);
  const normalizePath = (path: string): string => {
    const stripGraphPrefix = (value: string): string =>
      value.startsWith('/graph/v1.0') ? value.slice('/graph/v1.0'.length) || '/' : value;

    if (ABSOLUTE_HTTP_URL_PATTERN.test(path)) {
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
    const bodyContentType = () => parsePreferBodyContentType(headers.prefer) || undefined;
    const request: GraphRequestLike = {
      header(name: string, value: string) {
        headers = { ...headers, [name.toLowerCase()]: value };
        return request;
      },
      // GET covers the read side of the Graph SDK-shaped surface: identity,
      // lists, delta, message reads, MIME reads, and attachment reads.
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
        const messageValueMatch = pathname.match(GRAPH_MESSAGE_VALUE_PATH_PATTERN);
        if (messageValueMatch) {
          const messageId = messageValueMatch[1];
          if (!messageId) throw new Error(`Unsupported Graph message $value path: ${path}`);
          return service.getMessageValue(mailboxId, decodeURIComponent(messageId));
        }
        const messageMatch = pathname.match(GRAPH_MESSAGE_PATH_PATTERN);
        if (messageMatch && !pathname.includes('/attachments/')) {
          const messageId = messageMatch[1];
          if (!messageId) throw new Error(`Unsupported Graph message path: ${path}`);
          return service.getMessage(mailboxId, decodeURIComponent(messageId), { bodyContentType: bodyContentType() });
        }
        const attachmentsMatch = pathname.match(GRAPH_ATTACHMENTS_PATH_PATTERN);
        if (attachmentsMatch) {
          const messageId = attachmentsMatch[1];
          if (!messageId) throw new Error(`Unsupported Graph attachments path: ${path}`);
          return service.listAttachmentsPage(mailboxId, decodeURIComponent(messageId), path, 'https://graph.microsoft.com');
        }
        const attachmentValueMatch = pathname.match(GRAPH_ATTACHMENT_VALUE_PATH_PATTERN);
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
        const attachmentMatch = pathname.match(GRAPH_ATTACHMENT_PATH_PATTERN);
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
      // POST covers compose/send actions plus move/copy/upload-session creation.
      async post(body?: unknown) {
        const createReplyMatch = pathname.match(GRAPH_CREATE_REPLY_PATH_PATTERN);
        if (createReplyMatch) {
          const messageId = createReplyMatch[1];
          if (!messageId) throw new Error(`Unsupported Graph createReply path: ${path}`);
          return service.createReplyDraft(mailboxId, decodeURIComponent(messageId));
        }
        const sendMatch = pathname.match(GRAPH_SEND_DRAFT_PATH_PATTERN);
        if (sendMatch) {
          const draftId = sendMatch[1];
          if (!draftId) throw new Error(`Unsupported Graph send path: ${path}`);
          return service.sendDraft(mailboxId, decodeURIComponent(draftId));
        }
        const moveMatch = pathname.match(GRAPH_MOVE_MESSAGE_PATH_PATTERN);
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
        const copyMatch = pathname.match(GRAPH_COPY_MESSAGE_PATH_PATTERN);
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
        const uploadMatch = pathname.match(GRAPH_CREATE_UPLOAD_SESSION_PATH_PATTERN);
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
      // PUT is only used for opaque upload-session URLs; normal Graph resources
      // continue to use post/patch/delete.
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
      // PATCH is intentionally draft-only because this harness does not pretend
      // to support arbitrary message mutation through Graph.
      async patch(body: Record<string, unknown>) {
        const draftMatch = pathname.match(GRAPH_MESSAGE_PATH_PATTERN);
        if (!draftMatch) {
          throw new Error(`Unsupported Graph PATCH path: ${path}`);
        }
        const draftId = draftMatch[1];
        if (!draftId) throw new Error(`Unsupported Graph draft path: ${path}`);
        return service.patchDraft(mailboxId, decodeURIComponent(draftId), body);
      },
      // DELETE resolves through GraphService so draft deletion and message
      // deletion share the same path as the HTTP facade.
      async delete() {
        const draftMatch = pathname.match(GRAPH_MESSAGE_PATH_PATTERN);
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

/**
 * Convenience helpers build on top of the client-shaped API for the flows
 * downstream systems tend to repeat: attachment download, reply drafting, and
 * direct draft creation.
 */
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
    ...(params.subject ? { subject: REPLY_PREFIX_PATTERN.test(params.subject) ? params.subject : `Re: ${params.subject}` } : {}),
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
