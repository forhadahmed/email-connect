import {
  ConflictError,
  EmailConnectEngine,
  NotFoundError,
  encodeBytesBase64,
  parseRawEmailBase64,
  renderRawEmail,
} from '@email-connect/core';
import type { AttachmentSeed, MailboxAttachment, MailboxChange, MailboxDraft, MailboxMessage, MailboxRecord } from '@email-connect/core';

function parseUrl(path: string, origin = 'https://graph.microsoft.com/v1.0'): URL {
  return new URL(path, origin);
}

function parseTop(url: URL, fallback: number): number {
  const top = Number.parseInt(String(url.searchParams.get('$top') || ''), 10);
  return Number.isFinite(top) && top > 0 ? top : fallback;
}

function parseOffset(url: URL): number {
  const offset = Number.parseInt(String(url.searchParams.get('offset') || '0'), 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

function receivedAfterFromFilter(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/receivedDateTime ge ([^ )]+)/);
  if (!match) return null;
  const candidate = String(match[1] || '').trim().replace(/^'|'$/g, '');
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function encodeQueryUrl(baseUrl: string, path: string, params: Record<string, string | number | null | undefined>): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function encodeOpaqueToken(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeOpaqueToken<T extends Record<string, unknown>>(token: string | null): T | null {
  if (!token) return null;
  try {
    return JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function messageAddress(address: string | null) {
  if (!address) return undefined;
  return {
    emailAddress: {
      address,
    },
  };
}

function normalizeRecipientList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => (entry as { emailAddress?: { address?: string } })?.emailAddress?.address)
        .filter((entry): entry is string => Boolean(entry))
    : [];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toHtmlBody(bodyText: string): string {
  if (!bodyText) return '';
  return `<html><body><pre>${escapeHtml(bodyText)}</pre></body></html>`;
}

function bodyContentPreference(value: string | null | undefined): 'text' | 'html' {
  const normalized = String(value || '').toLowerCase();
  return normalized === 'text' ? 'text' : 'html';
}

function parsePreferBodyContentType(headerValue: string | null | undefined): 'text' | 'html' | null {
  // Graph uses `Prefer: outlook.body-content-type="..."` to negotiate the
  // body payload shape. Parse it once here so HTTP routes and white-box helpers
  // stay aligned on the same rule.
  if (!headerValue) return null;
  const match = String(headerValue).match(/outlook\.body-content-type\s*=\s*"?(text|html)"?/i);
  return match?.[1] ? bodyContentPreference(match[1]) : null;
}

function parseGraphBody(payload: unknown): { bodyText: string; bodyHtml: string | null } {
  const body = payload && typeof payload === 'object' ? (payload as { content?: unknown; contentType?: unknown }) : null;
  const content = typeof body?.content === 'string' ? body.content : '';
  const contentType = String(body?.contentType || 'Text').toLowerCase();
  if (contentType === 'html') {
    return {
      // Keep compose-time shape faithful to what the caller submitted. When
      // consumers later ask Graph for `Prefer: outlook.body-content-type="text"`
      // we derive plain text from HTML at read time instead of mutating the
      // stored draft/message body here.
      bodyText: '',
      bodyHtml: content || null,
    };
  }
  return {
    bodyText: content,
    bodyHtml: null,
  };
}

function graphBodyValue(bodyText: string | null, bodyHtml: string | null, preference: 'text' | 'html') {
  if (preference === 'text') {
    return {
      contentType: 'text',
      content: bodyText || (bodyHtml ? stripHtml(bodyHtml) : ''),
    };
  }
  return {
    contentType: 'html',
    content: bodyHtml || toHtmlBody(bodyText || ''),
  };
}

function attachmentTypeName(attachment: MailboxAttachment): string {
  if (attachment.attachmentType === 'reference') return '#microsoft.graph.referenceAttachment';
  if (attachment.attachmentType === 'item') return '#microsoft.graph.itemAttachment';
  return '#microsoft.graph.fileAttachment';
}

function buildEmbeddedMessage(attachment: MailboxAttachment, preference: 'text' | 'html') {
  if (!attachment.embeddedMessage) return undefined;
  return {
    '@odata.type': '#microsoft.graph.message',
    subject: attachment.embeddedMessage.subject || undefined,
    from: messageAddress(attachment.embeddedMessage.from),
    toRecipients: attachment.embeddedMessage.to
      ? attachment.embeddedMessage.to
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => messageAddress(value))
      : [],
    receivedDateTime: attachment.embeddedMessage.receivedAt || undefined,
    bodyPreview:
      attachment.embeddedMessage.bodyText ||
      (attachment.embeddedMessage.bodyHtml ? stripHtml(attachment.embeddedMessage.bodyHtml) : undefined),
    body: graphBodyValue(
      attachment.embeddedMessage.bodyText,
      attachment.embeddedMessage.bodyHtml,
      preference,
    ),
  };
}

function graphAttachmentResource(
  attachment: MailboxAttachment,
  options?: { inlineContent?: boolean | undefined; bodyContentType?: 'text' | 'html' | undefined },
) {
  // Convert core attachments into the richer Graph attachment families at the
  // edge. That keeps core storage provider-neutral while Graph callers still
  // see `fileAttachment`, `itemAttachment`, or `referenceAttachment`.
  const preference = options?.bodyContentType || 'html';
  const base = {
    '@odata.type': attachmentTypeName(attachment),
    id: attachment.providerAttachmentId,
    name: attachment.filename,
    contentType: attachment.mimeType,
    size: attachment.sizeBytes == null ? undefined : attachment.sizeBytes,
    ...(attachment.isInline ? { isInline: true } : {}),
    ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
    ...(attachment.contentLocation ? { contentLocation: attachment.contentLocation } : {}),
  };
  if (attachment.attachmentType === 'reference') {
    return {
      ...base,
      sourceUrl: attachment.sourceUrl || undefined,
    };
  }
  if (attachment.attachmentType === 'item') {
    return {
      ...base,
      item: buildEmbeddedMessage(attachment, preference),
    };
  }
  return {
    ...base,
    ...(options?.inlineContent ? { contentBytes: encodeBytesBase64(attachment.contentBytes) } : {}),
  };
}

type GraphContainer =
  | {
      kind: 'message';
      parentFolderId: string;
      message: MailboxMessage;
    }
  | {
      kind: 'draft';
      parentFolderId: 'drafts';
      draft: MailboxDraft;
    };

type GraphFolderEvent = {
  cursor: number;
  providerMessageId: string;
  folderId: string;
  kind: 'added_to_folder' | 'removed_from_folder';
};

type GraphUploadSessionRecord = {
  sessionId: string;
  mailboxId: string;
  providerMessageId: string;
  targetKind: 'message' | 'draft';
  name: string;
  mimeType: string;
  size: number;
  isInline: boolean;
  contentId: string | null;
  contentLocation: string | null;
  uploadedBytes: Uint8Array;
  nextExpectedStart: number;
  uploadUrl: string;
  expiresAt: string;
};

type GraphMailboxRuntime = {
  folderByMessageId: Map<string, string>;
  folderEvents: GraphFolderEvent[];
  lastCursor: number;
};

type GraphEngineRuntime = {
  mailboxes: Map<string, GraphMailboxRuntime>;
  uploadSessions: Map<string, GraphUploadSessionRecord>;
};

type GraphBodyOptions = {
  bodyContentType?: 'text' | 'html' | undefined;
};

const graphRuntimeByEngine = new WeakMap<EmailConnectEngine, GraphEngineRuntime>();

function graphEngineRuntime(engine: EmailConnectEngine): GraphEngineRuntime {
  let runtime = graphRuntimeByEngine.get(engine);
  if (!runtime) {
    runtime = {
      mailboxes: new Map(),
      uploadSessions: new Map(),
    };
    graphRuntimeByEngine.set(engine, runtime);
  }
  return runtime;
}

function graphMailboxRuntime(engine: EmailConnectEngine, mailbox: MailboxRecord): GraphMailboxRuntime {
  // Graph-only mailbox state such as folder placement and opaque delta/upload
  // cursors stays here rather than leaking into core. Core owns canonical mail
  // entities; provider packages own provider-specific runtime semantics.
  const runtime = graphEngineRuntime(engine);
  let mailboxRuntime = runtime.mailboxes.get(mailbox.id);
  if (!mailboxRuntime) {
    mailboxRuntime = {
      folderByMessageId: new Map(),
      folderEvents: [],
      lastCursor: 0,
    };
    runtime.mailboxes.set(mailbox.id, mailboxRuntime);
  }
  for (const message of engine.listAllMessages(mailbox)) {
    if (!mailboxRuntime.folderByMessageId.has(message.providerMessageId)) {
      mailboxRuntime.folderByMessageId.set(message.providerMessageId, 'inbox');
    }
    mailboxRuntime.lastCursor = Math.max(mailboxRuntime.lastCursor, message.rowId);
  }
  for (const change of engine.listChanges(mailbox)) {
    mailboxRuntime.lastCursor = Math.max(mailboxRuntime.lastCursor, change.rowId);
  }
  return mailboxRuntime;
}

function nextMailboxCursor(engine: EmailConnectEngine, mailbox: MailboxRecord): number {
  const runtime = graphMailboxRuntime(engine, mailbox);
  runtime.lastCursor += 1;
  return runtime.lastCursor;
}

function folderForMessage(engine: EmailConnectEngine, mailbox: MailboxRecord, providerMessageId: string): string {
  return graphMailboxRuntime(engine, mailbox).folderByMessageId.get(providerMessageId) || 'inbox';
}

function recordFolderEvent(
  engine: EmailConnectEngine,
  mailbox: MailboxRecord,
  providerMessageId: string,
  folderId: string,
  kind: GraphFolderEvent['kind'],
): void {
  const runtime = graphMailboxRuntime(engine, mailbox);
  runtime.folderEvents.push({
    cursor: nextMailboxCursor(engine, mailbox),
    providerMessageId,
    folderId,
    kind,
  });
}

function setFolder(
  engine: EmailConnectEngine,
  mailbox: MailboxRecord,
  providerMessageId: string,
  folderId: string,
): void {
  const runtime = graphMailboxRuntime(engine, mailbox);
  const previousFolderId = runtime.folderByMessageId.get(providerMessageId) || 'inbox';
  if (previousFolderId === folderId) return;
  runtime.folderByMessageId.set(providerMessageId, folderId);
  recordFolderEvent(engine, mailbox, providerMessageId, previousFolderId, 'removed_from_folder');
  recordFolderEvent(engine, mailbox, providerMessageId, folderId, 'added_to_folder');
}

function buildInternetHeaders(message: MailboxMessage) {
  return [
    ...(message.messageId ? [{ name: 'Message-ID', value: message.messageId }] : []),
    ...(message.inReplyTo ? [{ name: 'In-Reply-To', value: message.inReplyTo }] : []),
    ...(message.references ? [{ name: 'References', value: message.references }] : []),
    ...Object.entries(message.rawHeaders || {}).map(([name, value]) => ({
      name,
      value,
    })),
  ];
}

function messageToResource(
  message: MailboxMessage,
  options: GraphBodyOptions & { parentFolderId: string },
) {
  // Keep the Graph message projection centralized so list/get/delta/move/copy
  // all return the same resource shape, including body preference handling and
  // folder placement.
  const preference = options.bodyContentType || 'html';
  const body = graphBodyValue(message.bodyText, message.bodyHtml, preference);
  return {
    id: message.providerMessageId,
    subject: message.subject || undefined,
    from: messageAddress(message.from),
    toRecipients: message.to
      ? message.to
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => messageAddress(value))
      : [],
    receivedDateTime: message.receivedAt || undefined,
    internetMessageId: message.messageId || undefined,
    bodyPreview: message.snippet || body.content || undefined,
    body,
    uniqueBody: body,
    conversationId: message.providerThreadId || undefined,
    categories: message.labels.length ? [...message.labels] : undefined,
    hasAttachments: message.attachments.length > 0,
    internetMessageHeaders: buildInternetHeaders(message),
    parentFolderId: options.parentFolderId,
    isDraft: false,
  };
}

function draftToResource(draft: MailboxDraft, options?: GraphBodyOptions) {
  const preference = options?.bodyContentType || 'html';
  const body = graphBodyValue(draft.bodyText, draft.bodyHtml, preference);
  return {
    id: draft.providerDraftId,
    subject: draft.subject || undefined,
    toRecipients: draft.to
      ? draft.to
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => messageAddress(value))
      : [],
    body,
    uniqueBody: body,
    bodyPreview: draft.bodyText || (draft.bodyHtml ? stripHtml(draft.bodyHtml) : undefined),
    conversationId: draft.providerThreadId || undefined,
    parentFolderId: 'drafts',
    hasAttachments: draft.attachments.length > 0,
    isDraft: true,
    internetMessageHeaders: [],
  };
}

function resolveContainer(engine: EmailConnectEngine, mailbox: MailboxRecord, providerMessageId: string): GraphContainer {
  // Graph routes address drafts and messages through overlapping path shapes.
  // Resolve that overlap in one place so message, MIME, attachment, and send
  // operations all agree on what a provider id refers to.
  const draft = engine.getDraft(mailbox.id, providerMessageId);
  if (draft) {
    return {
      kind: 'draft',
      parentFolderId: 'drafts',
      draft,
    };
  }
  const message = engine.listAllMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
  if (!message) {
    throw new NotFoundError(`Mock Graph message not found (${providerMessageId})`);
  }
  return {
    kind: 'message',
    parentFolderId: folderForMessage(engine, mailbox, providerMessageId),
    message,
  };
}

function containerAttachments(container: GraphContainer): MailboxAttachment[] {
  return container.kind === 'draft' ? container.draft.attachments : container.message.attachments;
}

function attachmentFromContainer(container: GraphContainer, attachmentId: string): MailboxAttachment {
  const attachment = containerAttachments(container).find((entry) => entry.providerAttachmentId === attachmentId);
  if (!attachment) {
    throw new NotFoundError(`Mock Graph attachment not found (${attachmentId})`);
  }
  return attachment;
}

function draftPatchFromBody(body: Record<string, unknown>): {
  to?: string[];
  subject?: string;
  bodyText?: string;
  bodyHtml?: string | null;
} {
  const toRecipients = normalizeRecipientList(body.toRecipients);
  const normalizedBody = body.body == null ? null : parseGraphBody(body.body);
  return {
    ...(toRecipients.length ? { to: toRecipients } : {}),
    ...(typeof body.subject === 'string' ? { subject: body.subject } : {}),
    ...(normalizedBody
      ? {
          bodyText: normalizedBody.bodyText,
          bodyHtml: normalizedBody.bodyHtml,
        }
      : {}),
  };
}

function graphAttachmentSeed(entry: unknown): AttachmentSeed | null {
  // Normalize Graph request payloads into provider-neutral attachment seeds so
  // white-box seeding and black-box HTTP mutation share the same downstream
  // storage path.
  if (!entry || typeof entry !== 'object') return null;
  const body = entry as Record<string, unknown>;
  const type = String(body['@odata.type'] || body.attachmentType || '').toLowerCase();
  if (type.includes('reference')) {
    return {
      filename: String(body.name || 'reference.url'),
      mimeType: String(body.contentType || 'application/octet-stream'),
      contentBytes: '',
      attachmentType: 'reference',
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
    };
  }
  if (type.includes('item')) {
    const item = body.item && typeof body.item === 'object' ? (body.item as Record<string, unknown>) : null;
    const itemBody = parseGraphBody(item?.body);
    return {
      filename: String(body.name || 'attached-message.eml'),
      mimeType: 'message/rfc822',
      contentBytes: '',
      attachmentType: 'item',
      embeddedMessage: item
        ? {
            subject: typeof item.subject === 'string' ? item.subject : null,
            from:
              typeof (item.from as { emailAddress?: { address?: string } } | undefined)?.emailAddress?.address === 'string'
                ? (item.from as { emailAddress: { address: string } }).emailAddress.address
                : null,
            to: normalizeRecipientList(item.toRecipients),
            bodyText: itemBody.bodyText || null,
            bodyHtml: itemBody.bodyHtml,
            receivedAt: typeof item.receivedDateTime === 'string' ? item.receivedDateTime : null,
          }
        : null,
      sizeBytes: typeof body.size === 'number' ? body.size : 0,
    };
  }
  return {
    filename: String(body.name || 'attachment.bin'),
    mimeType: String(body.contentType || 'application/octet-stream'),
    contentBytes: typeof body.contentBytes === 'string' ? Buffer.from(body.contentBytes, 'base64') : '',
    attachmentType: 'file',
    sizeBytes: typeof body.size === 'number' ? body.size : null,
    isInline: Boolean(body.isInline),
    contentId: typeof body.contentId === 'string' ? body.contentId : null,
    contentLocation: typeof body.contentLocation === 'string' ? body.contentLocation : null,
  };
}

function parseSendMailRequest(body: Record<string, unknown>): {
  saveToSentItems: boolean;
  message: {
    to: string[];
    subject: string | null;
    bodyText: string;
    bodyHtml: string | null;
    attachments: AttachmentSeed[];
  };
} {
  // `/me/sendMail` accepts a nested Graph message resource rather than the core
  // seed format. Parse it here so JSON send and MIME send converge on the same
  // canonical send behavior.
  const message = body.message && typeof body.message === 'object' ? (body.message as Record<string, unknown>) : body;
  return {
    saveToSentItems: body.saveToSentItems == null ? true : Boolean(body.saveToSentItems),
    message: {
      to: normalizeRecipientList(message.toRecipients),
      subject: typeof message.subject === 'string' ? message.subject : null,
      ...parseGraphBody(message.body),
      attachments: Array.isArray(message.attachments)
        ? message.attachments
            .map((entry) => graphAttachmentSeed(entry))
            .filter((entry): entry is AttachmentSeed => Boolean(entry))
        : [],
    },
  };
}

function parsedFileAttachmentSeed(attachment: {
  filename: string;
  mimeType: string;
  contentBytes: Uint8Array;
  isInline?: boolean;
  contentId?: string | null;
}): AttachmentSeed {
  return {
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    contentBytes: attachment.contentBytes,
    attachmentType: 'file',
    ...(attachment.isInline ? { isInline: true } : {}),
    ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
  };
}

function mailboxAttachmentToSeed(attachment: MailboxAttachment): AttachmentSeed {
  return {
    providerAttachmentId: attachment.providerAttachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    contentBytes: attachment.contentBytes,
    ...(attachment.sizeBytes != null ? { sizeBytes: attachment.sizeBytes } : {}),
    attachmentType: attachment.attachmentType,
    ...(attachment.isInline ? { isInline: true } : {}),
    ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
    ...(attachment.contentLocation ? { contentLocation: attachment.contentLocation } : {}),
    ...(attachment.sourceUrl ? { sourceUrl: attachment.sourceUrl } : {}),
    ...(attachment.embeddedMessage ? { embeddedMessage: attachment.embeddedMessage } : {}),
  };
}

export class GraphService {
  // GraphService owns Microsoft-specific mail-plane semantics. Core stores the
  // canonical mailbox state; this layer projects it into Graph resources,
  // delta feeds, folder movement, MIME views, and upload-session behavior.
  constructor(private readonly engine: EmailConnectEngine) {}

  async getMe(mailboxId: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.me.get');
    return {
      id: mailbox.providerUserId,
      mail: mailbox.primaryEmail,
      userPrincipalName: mailbox.primaryEmail,
    };
  }

  async listMessages(
    mailboxId: string,
    path: string,
    baseUrl: string,
    options?: GraphBodyOptions,
  ) {
    // `/me/messages` spans the mailbox, not just inbox. Folder placement still
    // matters because Graph surfaces parent folder ids on each returned item.
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.messages.list');
    const url = parseUrl(path, baseUrl);
    const top = parseTop(url, 50);
    const offset = parseOffset(url);
    const receivedAfter = url.searchParams.get('receivedAfter') || receivedAfterFromFilter(url.searchParams.get('$filter'));
    const rows = this.engine
      .listVisibleMessages(mailbox)
      .filter((message) => !receivedAfter || (message.receivedAt != null && message.receivedAt >= receivedAfter))
      .sort((left, right) => {
        const a = left.receivedAt || '';
        const b = right.receivedAt || '';
        if (a === b) return right.rowId - left.rowId;
        return b.localeCompare(a);
      });
    const page = rows.slice(offset, offset + top);
    return {
      value: page.map((message) =>
        messageToResource(message, {
          bodyContentType: options?.bodyContentType,
          parentFolderId: folderForMessage(this.engine, mailbox, message.providerMessageId),
        }),
      ),
      '@odata.nextLink':
        rows.length > offset + page.length
          ? encodeQueryUrl(baseUrl, '/graph/v1.0/me/messages', {
              offset: offset + page.length,
              '$top': top,
              receivedAfter,
            })
          : undefined,
    };
  }

  async listInboxMessages(
    mailboxId: string,
    path: string,
    baseUrl: string,
    options?: GraphBodyOptions,
  ) {
    // Inbox listing is a projection over the shared mailbox state plus the
    // Graph-owned folder runtime. That separation is why move/copy can affect
    // inbox reads without rewriting canonical messages.
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.inbox.messages.list');
    const url = parseUrl(path, baseUrl);
    const top = parseTop(url, 50);
    const offset = parseOffset(url);
    const receivedAfter = url.searchParams.get('receivedAfter') || receivedAfterFromFilter(url.searchParams.get('$filter'));
    const rows = this.engine
      .listVisibleMessages(mailbox)
      .filter((message) => folderForMessage(this.engine, mailbox, message.providerMessageId) === 'inbox')
      .filter((message) => !receivedAfter || (message.receivedAt != null && message.receivedAt >= receivedAfter))
      .sort((left, right) => {
        const a = left.receivedAt || '';
        const b = right.receivedAt || '';
        if (a === b) return right.rowId - left.rowId;
        return b.localeCompare(a);
      });
    const page = rows.slice(offset, offset + top);
    return {
      value: page.map((message) =>
        messageToResource(message, {
          bodyContentType: options?.bodyContentType,
          parentFolderId: 'inbox',
        }),
      ),
      '@odata.nextLink':
        rows.length > offset + page.length
          ? encodeQueryUrl(baseUrl, '/graph/v1.0/me/mailFolders/inbox/messages', {
              offset: offset + page.length,
              '$top': top,
              receivedAfter,
            })
          : undefined,
    };
  }

  async delta(
    mailboxId: string,
    path: string,
    baseUrl: string,
    options?: GraphBodyOptions,
  ) {
    // Delta links are intentionally opaque to consumers. The mock keeps enough
    // state to preserve ordering and stale-token behavior without exposing the
    // internal cursor format as part of the product contract.
    const mailbox = this.engine.requireMailbox(mailboxId);
    const runtime = graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.delta.get');
    const url = parseUrl(path, baseUrl);
    const top = parseTop(url, 50);
    const receivedAfter = url.searchParams.get('receivedAfter') || receivedAfterFromFilter(url.searchParams.get('$filter'));
    const skipToken = decodeOpaqueToken<{ cursor: number; offset: number; top: number; receivedAfter?: string | null }>(
      url.searchParams.get('$skiptoken'),
    );
    const deltaToken = decodeOpaqueToken<{ cursor: number; top: number }>(url.searchParams.get('$deltatoken'));
    const cursor =
      skipToken?.cursor ??
      deltaToken?.cursor ??
      (Number.parseInt(String(url.searchParams.get('sinceRowId') || '0'), 10) || 0);
    const offset = skipToken?.offset ?? parseOffset(url);
    const effectiveReceivedAfter = skipToken?.receivedAfter ?? receivedAfter;

    if (mailbox.backend.invalidDeltaBeforeRowId && cursor > 0 && cursor < mailbox.backend.invalidDeltaBeforeRowId) {
      const error = new Error('Sync state is invalid or stale');
      Object.assign(error, {
        statusCode: 410,
        code: 'SyncStateInvalid',
        body: {
          error: {
            code: 'SyncStateInvalid',
            message: 'The supplied delta token is invalid or stale.',
          },
        },
      });
      throw error;
    }

    const messagesById = new Map(this.engine.listAllMessages(mailbox).map((message) => [message.providerMessageId, message]));
    const engineEvents = this.engine.listChanges(mailbox).map((change) => ({
      cursor: change.rowId,
      item: this.deltaItemForChange(mailbox, change, messagesById.get(change.providerMessageId), options?.bodyContentType),
    }));
    const folderEvents = runtime.folderEvents
      .filter((event) => event.folderId === 'inbox')
      .map((event) => ({
        cursor: event.cursor,
        item:
          event.kind === 'removed_from_folder'
            ? {
                id: event.providerMessageId,
                '@removed': {
                  reason: 'changed',
                },
              }
            : this.deltaItemForFolderAdd(mailbox, event.providerMessageId, options?.bodyContentType),
      }));

    const events = [...engineEvents, ...folderEvents]
      .filter((event) => event.cursor > cursor)
      .filter((event) => {
        if (!effectiveReceivedAfter) return true;
        const message = messagesById.get(event.item?.id || '');
        return message?.receivedAt != null && message.receivedAt >= effectiveReceivedAfter;
      })
      .sort((left, right) => left.cursor - right.cursor)
      .filter((event) => event.item != null);

    const page = events.slice(offset, offset + top);
    const latestCursor = Math.max(
      ...this.engine.listChanges(mailbox).map((change) => change.rowId),
      ...runtime.folderEvents.map((event) => event.cursor),
      0,
    );
    return {
      value: page.map((event) => event.item),
      '@odata.nextLink':
        events.length > offset + page.length
          ? encodeQueryUrl(baseUrl, '/graph/v1.0/me/mailFolders/inbox/messages/delta', {
              '$skiptoken': encodeOpaqueToken({
                cursor,
                offset: offset + page.length,
                top,
                ...(effectiveReceivedAfter ? { receivedAfter: effectiveReceivedAfter } : {}),
              }),
            })
          : undefined,
      '@odata.deltaLink':
        events.length > offset + page.length
          ? undefined
          : encodeQueryUrl(baseUrl, '/graph/v1.0/me/mailFolders/inbox/messages/delta', {
              '$deltatoken': encodeOpaqueToken({
                cursor: latestCursor,
                top,
              }),
            }),
    };
  }

  async getMessage(mailboxId: string, providerMessageId: string, options?: GraphBodyOptions) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.get');
    const container = resolveContainer(this.engine, mailbox, providerMessageId);
    return container.kind === 'draft'
      ? draftToResource(container.draft, options)
      : messageToResource(container.message, {
          bodyContentType: options?.bodyContentType,
          parentFolderId: container.parentFolderId,
        });
  }

  async getMessageValue(mailboxId: string, providerMessageId: string): Promise<Uint8Array> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.value');
    const container = resolveContainer(this.engine, mailbox, providerMessageId);
    // `$value` is Graph's raw MIME view. Re-render from canonical state instead
    // of storing serialized MIME blobs so later mutations and seeds keep a
    // single source of truth.
    const mime = container.kind === 'draft'
      ? renderRawEmail({
          to: container.draft.to,
          subject: container.draft.subject,
          bodyText: container.draft.bodyText,
          bodyHtml: container.draft.bodyHtml,
          attachments: container.draft.attachments
            .filter((attachment) => attachment.attachmentType === 'file')
            .map((attachment) => ({
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              contentBytes: attachment.contentBytes,
              isInline: attachment.isInline,
              contentId: attachment.contentId,
            })),
        })
      : renderRawEmail({
          from: container.message.from,
          to: container.message.to,
          subject: container.message.subject,
          date: container.message.receivedAt,
          messageId: container.message.messageId,
          inReplyTo: container.message.inReplyTo,
          references: container.message.references,
          bodyText: container.message.bodyText,
          bodyHtml: container.message.bodyHtml,
          headers: container.message.rawHeaders,
          attachments: container.message.attachments
            .filter((attachment) => attachment.attachmentType === 'file')
            .map((attachment) => ({
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              contentBytes: attachment.contentBytes,
              isInline: attachment.isInline,
              contentId: attachment.contentId,
            })),
        });
    return new Uint8Array(Buffer.from(mime, 'utf8'));
  }

  async listAttachmentsPage(mailboxId: string, providerMessageId: string, path: string, baseUrl: string) {
    // Attachment listing paginates over the resolved container so drafts and
    // sent/received messages share one attachment surface.
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.attachments.list');
    const container = resolveContainer(this.engine, mailbox, providerMessageId);
    const attachments = containerAttachments(container);
    const url = parseUrl(path, baseUrl);
    const top = parseTop(url, 100);
    const offset = parseOffset(url);
    const page = attachments.slice(offset, offset + top);
    return {
      value: page.map((attachment) => graphAttachmentResource(attachment)),
      '@odata.nextLink':
        attachments.length > offset + page.length
          ? encodeQueryUrl(baseUrl, `/graph/v1.0/me/messages/${encodeURIComponent(providerMessageId)}/attachments`, {
              offset: offset + page.length,
              '$top': top,
            })
          : undefined,
    };
  }

  async getAttachment(mailboxId: string, providerMessageId: string, attachmentId: string, options?: GraphBodyOptions) {
    // Graph sometimes omits `contentBytes` on attachment reads. Preserve that
    // backend-config seam because real clients often have fallback logic for
    // `$value` downloads.
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.attachment.get');
    const container = resolveContainer(this.engine, mailbox, providerMessageId);
    const attachment = attachmentFromContainer(container, attachmentId);
    const omitSet = new Set(mailbox.backend.omitAttachmentContentBytesIds || []);
    return graphAttachmentResource(attachment, {
      inlineContent: attachment.attachmentType === 'file' && !omitSet.has(attachment.providerAttachmentId),
      bodyContentType: options?.bodyContentType,
    });
  }

  async getAttachmentValue(mailboxId: string, providerMessageId: string, attachmentId: string): Promise<Uint8Array> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.attachment.value');
    const container = resolveContainer(this.engine, mailbox, providerMessageId);
    const attachment = attachmentFromContainer(container, attachmentId);
    if (attachment.attachmentType !== 'file') {
      throw new NotFoundError(`Mock Graph attachment is not downloadable via $value (${attachmentId})`);
    }
    return new Uint8Array(attachment.contentBytes);
  }

  async createReplyDraft(mailboxId: string, providerMessageId: string) {
    // Reply drafts inherit thread identity and flip the directionality of the
    // original message, which is the part many downstream compose flows care
    // about more than exact quoted-body rendering.
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.createReply.post');
    const inbound = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
    if (!inbound) {
      throw new NotFoundError(`Mock Graph message not found (${providerMessageId})`);
    }
    const draft = this.engine.createDraft(mailboxId, {
      providerDraftId: this.engine.generateId('outlook-draft'),
      providerDraftMessageId: this.engine.generateId('outlook-draft-message'),
      providerThreadId: inbound.providerThreadId,
      to: inbound.from,
      subject: inbound.subject,
      bodyText: '',
      bodyHtml: null,
    });
    return {
      id: draft.providerDraftId,
      conversationId: draft.providerThreadId,
    };
  }

  async createDraft(mailboxId: string, body: Record<string, unknown>) {
    // Draft creation accepts Graph resource-shaped JSON and normalizes it into
    // the shared draft model so later patch/send/upload flows stay uniform.
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.messages.post');
    const patch = draftPatchFromBody(body);
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.map((entry) => graphAttachmentSeed(entry)).filter((entry): entry is AttachmentSeed => Boolean(entry))
      : [];
    const draft = this.engine.createDraft(mailboxId, {
      providerDraftId: this.engine.generateId('outlook-draft'),
      providerDraftMessageId: this.engine.generateId('outlook-draft-message'),
      providerThreadId: this.engine.generateId('outlook-thread'),
      to: patch.to,
      subject: patch.subject ?? null,
      bodyText: patch.bodyText ?? '',
      bodyHtml: patch.bodyHtml ?? null,
      attachments,
    });
    return draftToResource(draft);
  }

  async patchDraft(mailboxId: string, providerDraftId: string, body: Record<string, unknown>) {
    // Patch only updates the mutable compose fields Graph exposes through this
    // route; attachment upload stays on the dedicated upload-session path.
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.patch');
    const updated = this.engine.updateDraft(mailboxId, providerDraftId, draftPatchFromBody(body));
    return draftToResource(updated);
  }

  async sendDraft(mailboxId: string, providerDraftId: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.send.post');
    const draft = this.engine.getDraft(mailboxId, providerDraftId);
    if (!draft) {
      throw new NotFoundError(`Draft not found: ${providerDraftId}`);
    }
    // Record the send in core before materializing the sent-item row so outbound
    // observability stays consistent across draft-send and direct-send flows.
    this.engine.sendDraft(mailboxId, providerDraftId, 'graph', providerDraftId);
    const sentMessage = this.engine.appendMessage(mailboxId, {
      providerMessageId: providerDraftId,
      providerThreadId: draft.providerThreadId,
      to: draft.to,
      subject: draft.subject,
      bodyText: draft.bodyText,
      bodyHtml: draft.bodyHtml,
      attachments: draft.attachments.map((attachment) => ({
        ...mailboxAttachmentToSeed(attachment),
      })),
    });
    setFolder(this.engine, mailbox, sentMessage.providerMessageId, 'sentitems');
    this.engine.deleteDraft(mailboxId, providerDraftId);
    return {};
  }

  async sendMail(mailboxId: string, body: Record<string, unknown> | string | Uint8Array | Buffer) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.sendmail.post');
    // Keep `/me/sendMail` available because it is a first-class Graph surface,
    // even though many downstream systems prefer draft-send for stronger
    // outbound traceability.
    const parsed =
      typeof body === 'string' || body instanceof Uint8Array || Buffer.isBuffer(body)
        ? this.parseMimeSendBody(body)
        : parseSendMailRequest(body);

    const sentMessage = parsed.saveToSentItems
      ? this.engine.appendMessage(mailboxId, {
          providerMessageId: this.engine.generateId('graph-sent'),
          providerThreadId: this.engine.generateId('graph-thread'),
          to: parsed.message.to,
          subject: parsed.message.subject,
          bodyText: parsed.message.bodyText,
          bodyHtml: parsed.message.bodyHtml,
          attachments: parsed.message.attachments,
        })
      : null;

    if (sentMessage) {
      setFolder(this.engine, mailbox, sentMessage.providerMessageId, 'sentitems');
    }

    const draftSeed = {
      providerDraftId: this.engine.generateId('graph-sendmail'),
      providerThreadId: sentMessage?.providerThreadId || this.engine.generateId('graph-thread'),
      to: parsed.message.to,
      subject: parsed.message.subject,
      bodyText: parsed.message.bodyText,
      bodyHtml: parsed.message.bodyHtml,
      attachments: parsed.message.attachments,
    };
    const draft = this.engine.createDraft(mailboxId, draftSeed);
    this.engine.sendDraft(mailboxId, draft.providerDraftId, 'graph', sentMessage?.providerMessageId || draft.providerDraftId);
    this.engine.deleteDraft(mailboxId, draft.providerDraftId);
  }

  async moveMessage(mailboxId: string, providerMessageId: string, destinationId: string, options?: GraphBodyOptions) {
    // Move changes Graph folder projection without cloning the canonical
    // message, which matches how Graph exposes the same logical item in a new
    // folder rather than creating a second message.
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.move');
    const message = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
    if (!message) {
      throw new NotFoundError(`Mock Graph message not found (${providerMessageId})`);
    }
    setFolder(this.engine, mailbox, providerMessageId, destinationId);
    return messageToResource(message, {
      bodyContentType: options?.bodyContentType,
      parentFolderId: destinationId,
    });
  }

  async copyMessage(mailboxId: string, providerMessageId: string, destinationId: string, options?: GraphBodyOptions) {
    // Copy intentionally materializes a second canonical message because Graph
    // returns a distinct resource in the destination folder, not just a folder
    // projection change.
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.copy');
    const message = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
    if (!message) {
      throw new NotFoundError(`Mock Graph message not found (${providerMessageId})`);
    }
    const copy = this.engine.appendMessage(mailboxId, {
      providerMessageId: this.engine.generateId('graph-copy'),
      providerThreadId: message.providerThreadId,
      subject: message.subject,
      from: message.from,
      to: message.to,
      messageId: `<${this.engine.generateId('graph-copy-message')}@email-connect.local>`,
      inReplyTo: message.inReplyTo,
      references: message.references,
      snippet: message.snippet,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      rawHeaders: message.rawHeaders,
      labels: message.labels,
      receivedAt: message.receivedAt,
      attachments: message.attachments.map((attachment) => ({
        ...mailboxAttachmentToSeed(attachment),
      })),
    });
    setFolder(this.engine, mailbox, copy.providerMessageId, destinationId);
    return messageToResource(copy, {
      bodyContentType: options?.bodyContentType,
      parentFolderId: destinationId,
    });
  }

  async createAttachmentUploadSession(
    mailboxId: string,
    providerMessageId: string,
    body: Record<string, unknown>,
    baseUrl: string,
  ) {
    // Upload sessions are deliberately provider-owned runtime state because the
    // semantics are Graph-specific: opaque URLs, ordered ranges, and chunk
    // completion behavior. The stored attachment still lands in core once the
    // upload finishes.
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.attachment.upload.create');
    const container = resolveContainer(this.engine, mailbox, providerMessageId);
    const item =
      body.AttachmentItem && typeof body.AttachmentItem === 'object'
        ? (body.AttachmentItem as Record<string, unknown>)
        : body.attachmentItem && typeof body.attachmentItem === 'object'
          ? (body.attachmentItem as Record<string, unknown>)
          : null;
    if (!item) {
      throw new ConflictError('AttachmentItem is required to create a Graph upload session');
    }
    const attachmentType = String(item.attachmentType || 'file').toLowerCase();
    if (attachmentType !== 'file') {
      throw new ConflictError('Graph upload sessions only support file attachments');
    }
    const size = Number(item.size || 0);
    if (!Number.isFinite(size) || size <= 0) {
      throw new ConflictError('AttachmentItem.size must be a positive number');
    }
    const sessionId = this.engine.generateId('graph-upload');
    const uploadUrl = encodeQueryUrl(baseUrl, `/__email-connect/upload/graph/${encodeURIComponent(sessionId)}`, {
      mailboxId,
      messageId: providerMessageId,
    });
    const session: GraphUploadSessionRecord = {
      sessionId,
      mailboxId,
      providerMessageId,
      targetKind: container.kind,
      name: String(item.name || 'attachment.bin'),
      mimeType: String(item.contentType || 'application/octet-stream'),
      size,
      isInline: Boolean(item.isInline),
      contentId: typeof item.contentId === 'string' ? item.contentId : null,
      contentLocation: typeof item.contentLocation === 'string' ? item.contentLocation : null,
      uploadedBytes: new Uint8Array(size),
      nextExpectedStart: 0,
      uploadUrl,
      expiresAt: new Date(Date.parse(this.engine.nowIso()) + 15 * 60 * 1000).toISOString(),
    };
    graphEngineRuntime(this.engine).uploadSessions.set(sessionId, session);
    return {
      '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#microsoft.graph.uploadSession',
      uploadUrl,
      expirationDateTime: session.expiresAt,
      nextExpectedRanges: ['0-'],
    };
  }

  async uploadAttachmentChunk(
    uploadPath: string,
    bytes: Uint8Array,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const sessionId = uploadPath.match(/\/__email-connect\/upload\/graph\/([^/?]+)/)?.[1];
    if (!sessionId) {
      throw new NotFoundError('Graph upload session not found');
    }
    const runtime = graphEngineRuntime(this.engine);
    const session = runtime.uploadSessions.get(decodeURIComponent(sessionId));
    if (!session) {
      throw new NotFoundError('Graph upload session not found');
    }
    if (Date.parse(session.expiresAt) <= Date.parse(this.engine.nowIso())) {
      runtime.uploadSessions.delete(session.sessionId);
      throw new NotFoundError('Graph upload session expired');
    }
    const contentRange = String(headers['content-range'] || '').trim();
    const match = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
    if (!match) {
      throw new ConflictError('Content-Range header is required for Graph upload sessions');
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
    // Upload sessions are ordered and stateful. Reject out-of-order or malformed
    // chunks so callers can exercise the same resume/retry logic they need in
    // production Graph integrations.
    if (total !== session.size || start !== session.nextExpectedStart || end < start || end + 1 - start !== bytes.byteLength) {
      throw new ConflictError('Graph upload chunk did not match next expected range');
    }

    session.uploadedBytes.set(bytes, start);
    session.nextExpectedStart = end + 1;

    if (session.nextExpectedStart < session.size) {
      return {
        statusCode: 202,
        body: {
          nextExpectedRanges: [`${session.nextExpectedStart}-`],
        },
      };
    }

    const attachment = {
      filename: session.name,
      mimeType: session.mimeType,
      contentBytes: session.uploadedBytes,
      sizeBytes: session.size,
      attachmentType: 'file' as const,
      isInline: session.isInline,
      contentId: session.contentId,
      contentLocation: session.contentLocation,
    };
    const created =
      session.targetKind === 'draft'
        ? this.engine.addDraftAttachment(session.mailboxId, session.providerMessageId, attachment)
        : this.engine.addAttachment(session.mailboxId, session.providerMessageId, attachment);
    runtime.uploadSessions.delete(session.sessionId);
    return {
      statusCode: 201,
      body: graphAttachmentResource(created, {
        inlineContent: true,
      }),
    };
  }

  async deleteMessageResource(mailboxId: string, providerMessageId: string) {
    // Graph DELETE applies to both drafts and messages depending on the id, so
    // resolve drafts first and then fall through to message deletion.
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.delete');
    if (this.engine.deleteDraft(mailboxId, providerMessageId)) {
      return;
    }
    this.engine.deleteMessage(mailboxId, providerMessageId);
  }

  private parseMimeSendBody(body: string | Uint8Array | Buffer) {
    // Graph clients sometimes send RFC822 payloads instead of JSON message
    // objects. Normalize that path here so both entrypoints share the same send
    // pipeline after parsing.
    const raw = typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
    const parsed = parseRawEmailBase64(raw.trim());
    return {
      saveToSentItems: true,
      message: {
        to: parsed.to
          ? parsed.to
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        bodyHtml: parsed.bodyHtml,
        attachments: parsed.attachments.map((attachment) => ({
          ...parsedFileAttachmentSeed(attachment),
        })),
      },
    };
  }

  private deltaItemForChange(
    mailbox: MailboxRecord,
    change: MailboxChange,
    message: MailboxMessage | undefined,
    bodyContentType?: 'text' | 'html',
  ) {
    // Delta should describe the inbox projection, not the whole mailbox. Once a
    // message moves out of inbox, folder events communicate that removal and we
    // stop returning the full resource from the inbox delta stream.
    if (change.kind === 'message_deleted') {
      return {
        id: change.providerMessageId,
        '@removed': {
          reason: 'deleted',
        },
      };
    }
    if (!message) return null;
    if (folderForMessage(this.engine, mailbox, message.providerMessageId) !== 'inbox') {
      return null;
    }
    return messageToResource(message, {
      bodyContentType,
      parentFolderId: 'inbox',
    });
  }

  private deltaItemForFolderAdd(
    mailbox: MailboxRecord,
    providerMessageId: string,
    bodyContentType?: 'text' | 'html',
  ) {
    const message = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
    if (!message) return null;
    return messageToResource(message, {
      bodyContentType,
      parentFolderId: 'inbox',
    });
  }
}

export { parsePreferBodyContentType };
