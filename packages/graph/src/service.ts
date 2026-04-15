import {
  ConflictError,
  EmailConnectEngine,
  NotFoundError,
  encodeBytesBase64,
  parseRawEmailBase64,
  renderRawEmail,
} from '@email-connect/core';
import type { AttachmentSeed, MailboxAttachment, MailboxChange, MailboxDraft, MailboxMessage, MailboxRecord } from '@email-connect/core';

// Graph parser regexes are intentionally named because they encode supported
// mock-provider contract, not just implementation detail.
const GRAPH_RECEIVED_AFTER_FILTER_PATTERN = /receivedDateTime ge ([^ )]+)/;
const GRAPH_FILTER_QUOTE_EDGE_PATTERN = /^'|'$/g;
const GRAPH_PREFER_BODY_CONTENT_TYPE_PATTERN = /outlook\.body-content-type\s*=\s*"?(text|html)"?/i;
const GRAPH_STYLE_BLOCK_PATTERN = /<style[\s\S]*?<\/style>/gi;
const GRAPH_SCRIPT_BLOCK_PATTERN = /<script[\s\S]*?<\/script>/gi;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const GRAPH_UPLOAD_SESSION_PATH_PATTERN = /\/__email-connect\/upload\/graph\/([^/?]+)/;
const GRAPH_CONTENT_RANGE_PATTERN = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i;

// Parse provider continuation URLs against a Graph-like origin so SDK calls and
// black-box route calls can share the same pagination code.
function parseUrl(path: string, origin = 'https://graph.microsoft.com/v1.0'): URL {
  return new URL(path, origin);
}

// Graph uses `$top` for page sizing. Clamp invalid values back to a documented
// fallback rather than leaking NaN into pagination.
function parseTop(url: URL, fallback: number): number {
  const top = Number.parseInt(String(url.searchParams.get('$top') || ''), 10);
  return Number.isFinite(top) && top > 0 ? top : fallback;
}

// Offset is an email-connect pagination convenience encoded in generated links;
// real Graph tokens are opaque, but tests still need deterministic page cuts.
function parseOffset(url: URL): number {
  const offset = Number.parseInt(String(url.searchParams.get('offset') || '0'), 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

// Support the high-value `receivedDateTime ge ...` filter shape used by sync
// and backfill consumers without pretending to implement the full OData grammar.
function receivedAfterFromFilter(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(GRAPH_RECEIVED_AFTER_FILTER_PATTERN);
  if (!match) return null;
  const candidate = String(match[1] || '').trim().replace(GRAPH_FILTER_QUOTE_EDGE_PATTERN, '');
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Continuation links must be absolute URLs pointing back at the mock server so
// non-JS black-box consumers can follow them without SDK assistance.
function encodeQueryUrl(baseUrl: string, path: string, params: Record<string, string | number | null | undefined>): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

// Delta and skip tokens are opaque to consumers, but internally they only need
// enough state to preserve cursor, page offset, and filter continuity.
function encodeOpaqueToken(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

// Invalid or tampered tokens decode to null so callers naturally fall back to
// initial-delta behavior or provider-shaped stale-token errors.
function decodeOpaqueToken<T extends Record<string, unknown>>(token: string | null): T | null {
  if (!token) return null;
  try {
    return JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

// Graph wraps addresses under `emailAddress`; keep the conversion tiny and
// centralized so messages, drafts, and item attachments all match.
function messageAddress(address: string | null) {
  if (!address) return undefined;
  return {
    emailAddress: {
      address,
    },
  };
}

// Normalize Graph recipient arrays into canonical address strings for the core
// draft/message model.
function normalizeRecipientList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => (entry as { emailAddress?: { address?: string } })?.emailAddress?.address)
        .filter((entry): entry is string => Boolean(entry))
    : [];
}

// HTML escaping is only used for generated HTML wrappers, not for sanitizing
// arbitrary application HTML.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Text-body negotiation derives plain text from HTML when callers request
// `Prefer: outlook.body-content-type="text"`.
function stripHtml(value: string): string {
  return value
    .replace(GRAPH_STYLE_BLOCK_PATTERN, ' ')
    .replace(GRAPH_SCRIPT_BLOCK_PATTERN, ' ')
    .replace(HTML_TAG_PATTERN, ' ')
    .replace(WHITESPACE_RUN_PATTERN, ' ')
    .trim();
}

// Plain text bodies are wrapped in minimal HTML when callers request Graph's
// default HTML body shape.
function toHtmlBody(bodyText: string): string {
  if (!bodyText) return '';
  return `<html><body><pre>${escapeHtml(bodyText)}</pre></body></html>`;
}

// Graph defaults to HTML bodies unless a caller explicitly asks for text.
function bodyContentPreference(value: string | null | undefined): 'text' | 'html' {
  const normalized = String(value || '').toLowerCase();
  return normalized === 'text' ? 'text' : 'html';
}

// Parse Graph's body-preference header at the provider edge so both route
// handlers and resource builders receive the same normalized preference.
function parsePreferBodyContentType(headerValue: string | null | undefined): 'text' | 'html' | null {
  if (!headerValue) return null;
  const match = String(headerValue).match(GRAPH_PREFER_BODY_CONTENT_TYPE_PATTERN);
  return match?.[1] ? bodyContentPreference(match[1]) : null;
}

// Parse Graph compose bodies while preserving the original content type so later
// reads can negotiate text/html without losing compose intent.
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

// Convert canonical body fields into Graph's `{contentType, content}` wrapper.
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

// Attachment type names are provider contract strings, so keep them adjacent to
// the resource renderer rather than leaking them into core types.
function attachmentTypeName(attachment: MailboxAttachment): string {
  if (attachment.attachmentType === 'reference') return '#microsoft.graph.referenceAttachment';
  if (attachment.attachmentType === 'item') return '#microsoft.graph.itemAttachment';
  return '#microsoft.graph.fileAttachment';
}

// Item attachments expose a nested message-like resource. The mock maps only
// the fields consumers commonly inspect while preserving body preference rules.
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

// Convert core attachments into the richer Graph attachment families at the
// edge. That keeps core storage provider-neutral while Graph callers still see
// `fileAttachment`, `itemAttachment`, or `referenceAttachment`.
function graphAttachmentResource(
  attachment: MailboxAttachment,
  options?: { inlineContent?: boolean | undefined; bodyContentType?: 'text' | 'html' | undefined },
) {
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

// Runtime state belongs to the provider package because folder placement and
// upload sessions are Graph-specific projections over canonical mailbox data.
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

// Initialize Graph runtime lazily from canonical messages so hand-seeded
// mailboxes immediately appear in inbox without explicit folder setup.
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

// Folder events need their own cursor sequence because move/copy operations can
// create delta-visible changes without adding core message change rows.
function nextMailboxCursor(engine: EmailConnectEngine, mailbox: MailboxRecord): number {
  const runtime = graphMailboxRuntime(engine, mailbox);
  runtime.lastCursor += 1;
  return runtime.lastCursor;
}

// Folder lookup defaults to inbox because that is the normal initial placement
// for seeded inbound messages.
function folderForMessage(engine: EmailConnectEngine, mailbox: MailboxRecord, providerMessageId: string): string {
  return graphMailboxRuntime(engine, mailbox).folderByMessageId.get(providerMessageId) || 'inbox';
}

// Folder events are recorded separately from canonical message changes so inbox
// delta can express moves without rewriting message history.
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

// Setting a folder emits both removal and addition events to approximate how
// folder-scoped delta clients observe moves.
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

// Internet headers are exposed on Graph message resources and raw MIME views,
// so build them from canonical message fields plus caller-provided headers.
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

// Keep the Graph message projection centralized so list/get/delta/move/copy all
// return the same resource shape, including body preference and folder placement.
function messageToResource(
  message: MailboxMessage,
  options: GraphBodyOptions & { parentFolderId: string },
) {
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

// Draft resources share Graph's message shape but stay marked as draft and live
// under the synthetic drafts folder.
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

// Graph routes address drafts and messages through overlapping path shapes.
// Resolve that overlap in one place so every downstream operation agrees on the
// provider id's container.
function resolveContainer(engine: EmailConnectEngine, mailbox: MailboxRecord, providerMessageId: string): GraphContainer {
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

// Attachment helpers operate over both messages and drafts because Graph exposes
// nearly identical attachment routes for each container type.
function containerAttachments(container: GraphContainer): MailboxAttachment[] {
  return container.kind === 'draft' ? container.draft.attachments : container.message.attachments;
}

// Resolve attachment ids at the provider boundary so NotFound errors are
// consistent across metadata reads and `$value` downloads.
function attachmentFromContainer(container: GraphContainer, attachmentId: string): MailboxAttachment {
  const attachment = containerAttachments(container).find((entry) => entry.providerAttachmentId === attachmentId);
  if (!attachment) {
    throw new NotFoundError(`Mock Graph attachment not found (${attachmentId})`);
  }
  return attachment;
}

// Extract mutable compose fields from Graph PATCH bodies without conflating them
// with attachment mutation.
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

// Normalize Graph request payloads into provider-neutral attachment seeds so
// white-box seeding and black-box HTTP mutation share the same storage path.
function graphAttachmentSeed(entry: unknown): AttachmentSeed | null {
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

// `/me/sendMail` accepts a nested Graph message resource rather than the core
// seed format. Parse it here so JSON send and MIME send converge on one path.
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

// MIME send parsing produces decoded file attachments; this adapter converts
// them into the same seed shape JSON compose paths use.
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

// Copying or sending existing attachments should preserve provider ids and
// Graph-specific metadata such as inline CID and reference/item details.
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

/**
 * Canonical Microsoft Graph mail-plane semantic layer.
 *
 * Core stores provider-neutral mailbox records. This service owns the Graph
 * projection: message resources, body preferences, folder-scoped delta,
 * compose/send, and upload sessions.
 */
export class GraphService {
  // The service receives the shared engine so SDK and HTTP callers exercise the
  // same Graph projection over canonical mailbox state.
  constructor(private readonly engine: EmailConnectEngine) {}

  // `/me` exposes mailbox identity for connected-account validation and basic
  // black-box smoke tests.
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

  // `/me/messages` spans the mailbox, not just inbox. Folder placement still
  // matters because Graph surfaces parent folder ids on each returned item.
  async listMessages(
    mailboxId: string,
    path: string,
    baseUrl: string,
    options?: GraphBodyOptions,
  ) {
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

  // Inbox listing is a projection over the shared mailbox state plus the
  // Graph-owned folder runtime. That separation is why move/copy can affect
  // inbox reads without rewriting canonical messages.
  async listInboxMessages(
    mailboxId: string,
    path: string,
    baseUrl: string,
    options?: GraphBodyOptions,
  ) {
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

  // Delta links are intentionally opaque to consumers. The mock keeps enough
  // state to preserve ordering and stale-token behavior without exposing the
  // internal cursor format as part of the product contract.
  async delta(
    mailboxId: string,
    path: string,
    baseUrl: string,
    options?: GraphBodyOptions,
  ) {
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

  // Message reads resolve drafts and messages through one id namespace because
  // Graph compose routes address drafts as messages.
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

  // `$value` is Graph's raw MIME view. Re-render from canonical state instead
  // of storing serialized MIME blobs so later mutations and seeds keep a single
  // source of truth.
  async getMessageValue(mailboxId: string, providerMessageId: string): Promise<Uint8Array> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.value');
    const container = resolveContainer(this.engine, mailbox, providerMessageId);
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

  // Attachment listing paginates over the resolved container so drafts and
  // sent/received messages share one attachment surface.
  async listAttachmentsPage(mailboxId: string, providerMessageId: string, path: string, baseUrl: string) {
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

  // Graph sometimes omits `contentBytes` on attachment reads. Preserve that
  // backend-config seam because real clients often have fallback logic for
  // `$value` downloads.
  async getAttachment(mailboxId: string, providerMessageId: string, attachmentId: string, options?: GraphBodyOptions) {
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

  // `$value` serves only file attachments; item/reference attachments remain
  // metadata resources like their Graph counterparts.
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

  // Reply drafts inherit thread identity and flip the directionality of the
  // original message, which is the part many downstream compose flows care
  // about more than exact quoted-body rendering.
  async createReplyDraft(mailboxId: string, providerMessageId: string) {
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

  // Draft creation accepts Graph resource-shaped JSON and normalizes it into
  // the shared draft model so later patch/send/upload flows stay uniform.
  async createDraft(mailboxId: string, body: Record<string, unknown>) {
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

  // Patch only updates the mutable compose fields Graph exposes through this
  // route; attachment upload stays on the dedicated upload-session path.
  async patchDraft(mailboxId: string, providerDraftId: string, body: Record<string, unknown>) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.patch');
    const updated = this.engine.updateDraft(mailboxId, providerDraftId, draftPatchFromBody(body));
    return draftToResource(updated);
  }

  // Draft send records outbox intent and materializes a sent-item copy because
  // Graph clients commonly expect the sent message to become addressable.
  async sendDraft(mailboxId: string, providerDraftId: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.send.post');
    const draft = this.engine.getDraft(mailboxId, providerDraftId);
    if (!draft) {
      throw new NotFoundError(`Draft not found: ${providerDraftId}`);
    }
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

  // Direct sendMail is normalized through the same outbox pipeline as draft
  // send, with optional sent-item materialization controlled by the request.
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

  // Move changes Graph folder projection without cloning the canonical message,
  // which matches how Graph exposes the same logical item in a new folder.
  async moveMessage(mailboxId: string, providerMessageId: string, destinationId: string, options?: GraphBodyOptions) {
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

  // Copy intentionally materializes a second canonical message because Graph
  // returns a distinct resource in the destination folder, not just a folder
  // projection change.
  async copyMessage(mailboxId: string, providerMessageId: string, destinationId: string, options?: GraphBodyOptions) {
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

  // Upload-session creation returns an opaque upload URL and stores ordered
  // chunk state in the provider runtime until the final PUT completes.
  async createAttachmentUploadSession(
    mailboxId: string,
    providerMessageId: string,
    body: Record<string, unknown>,
    baseUrl: string,
  ) {
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

  // Upload sessions are ordered and stateful. Reject out-of-order or malformed
  // chunks so callers can exercise the same resume/retry logic they need in
  // production Graph integrations.
  async uploadAttachmentChunk(
    uploadPath: string,
    bytes: Uint8Array,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const sessionId = uploadPath.match(GRAPH_UPLOAD_SESSION_PATH_PATTERN)?.[1];
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
    const match = contentRange.match(GRAPH_CONTENT_RANGE_PATTERN);
    if (!match) {
      throw new ConflictError('Content-Range header is required for Graph upload sessions');
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
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

  // Graph DELETE applies to both drafts and messages depending on the id, so
  // resolve drafts first and then fall through to message deletion.
  async deleteMessageResource(mailboxId: string, providerMessageId: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    graphMailboxRuntime(this.engine, mailbox);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.delete');
    if (this.engine.deleteDraft(mailboxId, providerMessageId)) {
      return;
    }
    this.engine.deleteMessage(mailboxId, providerMessageId);
  }

  // Graph clients sometimes send RFC822 payloads instead of JSON message
  // objects. Normalize that path here so both entrypoints share the same send
  // pipeline after parsing.
  private parseMimeSendBody(body: string | Uint8Array | Buffer) {
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

  // Delta should describe the inbox projection, not the whole mailbox. Once a
  // message moves out of inbox, folder events communicate that removal and we
  // stop returning the full resource from the inbox delta stream.
  private deltaItemForChange(
    mailbox: MailboxRecord,
    change: MailboxChange,
    message: MailboxMessage | undefined,
    bodyContentType?: 'text' | 'html',
  ) {
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

  // Folder-add events need to rematerialize the current resource because a
  // message moved back into inbox may have changed since it was first seeded.
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
