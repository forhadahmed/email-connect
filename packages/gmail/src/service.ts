import { createHash } from 'node:crypto';
import {
  EmailConnectEngine,
  NotFoundError,
  encodeBase64Url,
  encodeBytesBase64Url,
  parseRawEmailBase64Url,
  renderRawEmail,
} from '@email-connect/core';
import type { MailboxChange, MailboxMessage, MailboxRecord } from '@email-connect/core';

export type GmailApiResponse<T> = { data: T };

export type GmailProfile = {
  emailAddress?: string;
  historyId?: string;
  messagesTotal?: number;
  threadsTotal?: number;
};

export type GmailLabel = {
  id?: string;
  name?: string;
};

export type GmailMessageRef = {
  id?: string;
  threadId?: string;
};

export type GmailThreadRef = {
  id?: string;
  historyId?: string;
  snippet?: string;
};

export type GmailHistoryRecord = {
  messages?: GmailMessageRef[];
  messagesAdded?: Array<{ message?: GmailMessageRef }>;
  messagesDeleted?: Array<{ message?: GmailMessageRef }>;
  labelsAdded?: Array<{ message?: GmailMessageRef; labelIds?: string[] }>;
  labelsRemoved?: Array<{ message?: GmailMessageRef; labelIds?: string[] }>;
};

export type GmailMessagePayloadHeader = {
  name?: string;
  value?: string;
};

export type GmailMessagePayload = {
  mimeType?: string;
  headers?: GmailMessagePayloadHeader[];
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailMessagePayload[];
};

export type GmailMessage = {
  id?: string;
  threadId?: string;
  payload?: GmailMessagePayload;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
  raw?: string;
};

export type GmailThread = {
  id?: string;
  historyId?: string;
  snippet?: string;
  messages?: GmailMessage[];
};

export type GmailWatchResponse = {
  historyId?: string;
  expiration?: string;
};

export type GmailMessageFormat = 'minimal' | 'full' | 'raw' | 'metadata';

type GmailWatchState = {
  topicName: string;
  labelIds: string[];
  labelFilterAction: 'include' | 'exclude';
  expiration: string;
  historyId: string;
};

// Gmail query and label regexes are provider-contract details, not incidental
// string manipulation. Naming them keeps supported search grammar explicit.
const GMAIL_AFTER_QUERY_PATTERN = /\bafter:(\d+)\b/;
const REPLY_PREFIX_PATTERN = /^\s*re:/i;
const MOCK_GMAIL_LABEL_ID_PATTERN = /^Label_(.+)$/;

// Provider runtime that does not belong in core. Core owns canonical mailbox
// entities; Gmail owns watch state and other Gmail-specific ephemera.
const gmailRuntimeByEngine = new WeakMap<EmailConnectEngine, Map<string, { watch: GmailWatchState | null }>>();

// Gmail page tokens in this mock are simple offsets. Keeping that decode logic
// narrow makes pagination deterministic and easy to assert in black-box tests.
function parsePageToken(pageToken?: string): number {
  if (!pageToken) return 0;
  const parsed = Number.parseInt(String(pageToken), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

// Support the Gmail `after:` search operator because it is the most important
// query primitive for historical scans and incremental catch-up tests.
function receivedAfterFromQuery(q?: string): string | undefined {
  const match = String(q || '').match(GMAIL_AFTER_QUERY_PATTERN);
  if (!match) return undefined;
  const value = match[1];
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

// Runtime state is allocated lazily per engine/mailbox so multiple embedded
// harnesses can run in one process without sharing Gmail watch state.
function gmailRuntime(engine: EmailConnectEngine, mailboxId: string) {
  let perEngine = gmailRuntimeByEngine.get(engine);
  if (!perEngine) {
    perEngine = new Map();
    gmailRuntimeByEngine.set(engine, perEngine);
  }
  let state = perEngine.get(mailboxId);
  if (!state) {
    state = { watch: null };
    perEngine.set(mailboxId, state);
  }
  return state;
}

// Query parsing stays intentionally narrow: it covers the Gmail search terms
// that most influence sync/list behavior without pretending to implement the
// entire Gmail query language.
function normalizeMessageFormat(value: string | null | undefined): GmailMessageFormat {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'minimal' || normalized === 'raw' || normalized === 'metadata') return normalized;
  return 'full';
}

// Metadata headers are matched case-insensitively, mirroring how real mail
// headers are consumed even though the response preserves original casing.
function normalizeMetadataHeaderFilter(values: string[] | null | undefined): Set<string> | null {
  const filtered = (values || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  return filtered.length ? new Set(filtered) : null;
}

// Extract the subset of Gmail query terms this harness treats as first-class
// product behavior: labels, addresses, and subject filters.
function parseGmailQueryValues(prefix: 'label' | 'from' | 'to' | 'subject', q?: string): string[] {
  // The prefix is constrained by the type above, so dynamic RegExp construction
  // is safe here and avoids four duplicated query-term patterns.
  const pattern = new RegExp(`\\b${prefix}:(?:"([^"]+)"|([^\\s()]+))`, 'gi');
  const values: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(String(q || '')))) {
    const value = String(match[1] || match[2] || '').trim().toLowerCase();
    if (value) values.push(value);
  }
  return values;
}

// Address matching intentionally accepts either full addresses or domain/local
// fragments so generated inboxes can be queried ergonomically.
function addressMatches(raw: string | null, value: string): boolean {
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (value.includes('@')) return lower.includes(value);
  return lower.includes(`@${value}`) || lower.includes(value);
}

// Reply helpers preserve existing `Re:` subjects so tests can assert thread
// behavior without accumulating artificial prefixes.
function normalizeReplySubject(subject: string | null | undefined): string {
  const clean = String(subject || '').trim();
  if (!clean) return 'Re:';
  if (REPLY_PREFIX_PATTERN.test(clean)) return clean;
  return `Re: ${clean}`;
}

// Gmail rarely exposes empty subjects as truly absent in UI-driven flows; use a
// stable placeholder so generated examples stay readable.
function normalizeSubject(subject: string | null | undefined): string {
  const clean = String(subject || '').trim();
  return clean || '(no subject)';
}

// Custom label ids need to be stable and reversible enough for tests, but they
// should not collide with Gmail's system label names.
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Public helper used by tests/examples that need to compare Gmail-shaped custom
// label ids without duplicating the encoding scheme.
export function mockGmailLabelId(labelName: string): string {
  return `Label_${Buffer.from(labelName, 'utf8').toString('base64url')}`;
}

// Build the provider-visible header set from canonical message fields plus any
// raw headers that were seeded or imported.
function messageHeaders(message: MailboxMessage): GmailMessagePayloadHeader[] {
  const headers: GmailMessagePayloadHeader[] = [];
  if (message.subject) headers.push({ name: 'Subject', value: message.subject });
  if (message.from) headers.push({ name: 'From', value: message.from });
  if (message.to) headers.push({ name: 'To', value: message.to });
  if (message.receivedAt) headers.push({ name: 'Date', value: message.receivedAt });
  if (message.messageId) headers.push({ name: 'Message-ID', value: message.messageId });
  if (message.inReplyTo) headers.push({ name: 'In-Reply-To', value: message.inReplyTo });
  if (message.references) headers.push({ name: 'References', value: message.references });
  if (message.rawHeaders) {
    for (const [name, value] of Object.entries(message.rawHeaders)) {
      if (headers.some((entry) => String(entry.name || '').toLowerCase() === name.toLowerCase())) continue;
      headers.push({ name, value });
    }
  }
  return headers;
}

// Apply `metadataHeaders[]` at the payload boundary so callers get consistent
// filtering across `messages.get` and `threads.get`.
function filterPayloadHeaders(headers: GmailMessagePayloadHeader[], metadataHeaders?: string[]): GmailMessagePayloadHeader[] {
  const wanted = normalizeMetadataHeaderFilter(metadataHeaders);
  if (!wanted) return headers;
  return headers.filter((header) => wanted.has(String(header.name || '').toLowerCase()));
}

// Build the structured Gmail payload tree from canonical message bodies and
// attachments. This is separate from raw MIME rendering because Gmail exposes
// both representations with different contracts.
function buildPayload(
  message: MailboxMessage,
  options?: { includeBodies?: boolean; metadataHeaders?: string[] },
): GmailMessagePayload {
  const parts: GmailMessagePayload[] = [];
  const includeBodies = options?.includeBodies !== false;
  if (includeBodies && message.bodyText) {
    parts.push({
      mimeType: 'text/plain',
      body: { data: encodeBase64Url(message.bodyText) },
    });
  }
  if (includeBodies && message.bodyHtml) {
    parts.push({
      mimeType: 'text/html',
      body: { data: encodeBase64Url(message.bodyHtml) },
    });
  }
  for (const attachment of message.attachments) {
    parts.push({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      body: {
        attachmentId: attachment.providerAttachmentId,
        ...(attachment.sizeBytes != null ? { size: attachment.sizeBytes } : {}),
      },
    });
  }
  return {
    mimeType: parts.length > 1 ? 'multipart/mixed' : parts[0]?.mimeType || 'text/plain',
    headers: filterPayloadHeaders(messageHeaders(message), options?.metadataHeaders),
    ...(parts.length ? { parts } : {}),
  };
}

// Render the raw RFC822 form used by `format=raw` from canonical state instead
// of storing a second serialized representation.
function messageRawMime(message: MailboxMessage): string {
  return renderRawEmail({
    from: message.from,
    to: message.to,
    subject: message.subject,
    date: message.receivedAt,
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    references: message.references,
    bodyText: message.bodyText,
    bodyHtml: message.bodyHtml,
    headers: message.rawHeaders,
    attachments: message.attachments.map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      contentBytes: attachment.contentBytes,
    })),
  });
}

// Gmail `internalDate` is a millisecond timestamp encoded as a string; invalid
// fixture dates are omitted instead of inventing misleading provider state.
function messageInternalDate(message: MailboxMessage): string | undefined {
  if (!message.receivedAt) return undefined;
  const parsed = Date.parse(message.receivedAt);
  return Number.isNaN(parsed) ? undefined : String(parsed);
}

// History ids in the mock are derived from canonical change rows. That keeps
// replay and deletion ordering aligned with the engine's source of truth.
function latestHistoryIdForMessage(mailbox: MailboxRecord, providerMessageId: string, engine: EmailConnectEngine): string | undefined {
  const latest = engine
    .listChanges(mailbox)
    .filter((change) => change.providerMessageId === providerMessageId)
    .at(-1)?.rowId;
  return latest ? String(latest) : undefined;
}

// Project one canonical message into Gmail's `Message` resource, including the
// format-specific body/raw/metadata differences consumers rely on.
function buildMessage(
  mailbox: MailboxRecord,
  message: MailboxMessage,
  engine: EmailConnectEngine,
  options?: { format?: GmailMessageFormat; metadataHeaders?: string[] },
): GmailMessage {
  const format = normalizeMessageFormat(options?.format);
  const historyId = latestHistoryIdForMessage(mailbox, message.providerMessageId, engine);
  const internalDate = messageInternalDate(message);
  const raw = messageRawMime(message);
  const base: GmailMessage = {
    id: message.providerMessageId,
    ...(message.providerThreadId ? { threadId: message.providerThreadId } : {}),
    labelIds: message.labels.map(mockGmailLabelId),
    ...(message.snippet ? { snippet: message.snippet } : {}),
    ...(historyId ? { historyId } : {}),
    ...(internalDate ? { internalDate } : {}),
    sizeEstimate: Buffer.byteLength(raw, 'utf8'),
  };

  if (format === 'minimal') return base;
  if (format === 'raw') return { ...base, raw: Buffer.from(raw, 'utf8').toString('base64url') };
  if (format === 'metadata') {
    return {
      ...base,
      payload: buildPayload(message, {
        includeBodies: false,
        ...(options?.metadataHeaders?.length ? { metadataHeaders: options.metadataHeaders } : {}),
      }),
    };
  }
  return {
    ...base,
    payload: buildPayload(message),
  };
}

// Order messages inside a thread oldest-first, which is how most Gmail clients
// expect conversation materialization to behave.
function threadMessages(messages: MailboxMessage[], mailbox: MailboxRecord, engine: EmailConnectEngine, options?: {
  format?: GmailMessageFormat;
  metadataHeaders?: string[];
}): GmailMessage[] {
  return messages
    .slice()
    .sort((left, right) => {
      const a = left.receivedAt || '';
      const b = right.receivedAt || '';
      if (a === b) return left.rowId - right.rowId;
      return a.localeCompare(b);
    })
    .map((message) => buildMessage(mailbox, message, engine, options));
}

// Thread assembly is computed from canonical messages at read time so message
// updates, deletes, and replay changes automatically flow into thread reads.
function buildThread(mailbox: MailboxRecord, threadId: string, messages: MailboxMessage[], engine: EmailConnectEngine, options?: {
  format?: GmailMessageFormat;
  metadataHeaders?: string[];
}): GmailThread {
  const latestMessage = messages
    .slice()
    .sort((left, right) => {
      const a = left.receivedAt || '';
      const b = right.receivedAt || '';
      if (a === b) return right.rowId - left.rowId;
      return b.localeCompare(a);
    })[0];
  const historyId = engine
    .listChanges(mailbox)
    .filter((change) => {
      const message = messages.find((entry) => entry.providerMessageId === change.providerMessageId);
      return Boolean(message);
    })
    .at(-1)?.rowId;
  return {
    id: threadId,
    ...(historyId ? { historyId: String(historyId) } : {}),
    ...(latestMessage?.snippet ? { snippet: latestMessage.snippet } : {}),
    messages: threadMessages(messages, mailbox, engine, options),
  };
}

// Evaluate the supported Gmail query subset against canonical message state.
// Unsupported terms are ignored by design rather than approximated loosely.
function matchesQuery(message: MailboxMessage, q?: string): boolean {
  const after = receivedAfterFromQuery(q);
  if (after && message.receivedAt && message.receivedAt < after) return false;

  const labelTerms = parseGmailQueryValues('label', q);
  if (labelTerms.length) {
    const labels = message.labels.map((label) => label.toLowerCase());
    if (!labelTerms.some((label) => labels.includes(label))) return false;
  }

  const fromTerms = parseGmailQueryValues('from', q);
  if (fromTerms.length && !fromTerms.some((value) => addressMatches(message.from, value))) return false;

  const toTerms = parseGmailQueryValues('to', q);
  if (toTerms.length && !toTerms.some((value) => addressMatches(message.to, value))) return false;

  const subjectTerms = parseGmailQueryValues('subject', q);
  if (subjectTerms.length) {
    const subject = String(message.subject || '').toLowerCase();
    if (!subjectTerms.some((value) => subject.includes(value))) return false;
  }

  return true;
}

// `labelIds[]` are provider ids, so compare against Gmail-shaped label ids
// rather than raw canonical label names.
function matchesLabelFilter(message: MailboxMessage, labelIds?: string[]): boolean {
  if (!labelIds?.length) return true;
  const labels = new Set(message.labels.map((label) => mockGmailLabelId(label)));
  return labelIds.every((labelId) => labels.has(labelId));
}

// Gmail history emits different event arrays depending on the type of mailbox
// change. Keeping that mapping explicit makes replay/idempotence tests easier
// to reason about.
function historyRecordForChange(change: MailboxChange, message: MailboxMessage | undefined): GmailHistoryRecord[] {
  if (!message && change.kind !== 'message_deleted') return [];
  if (change.kind === 'message_added') {
    return [
      {
        messages: [{ id: change.providerMessageId }],
        messagesAdded: [{ message: { id: change.providerMessageId } }],
      },
    ];
  }
  if (change.kind === 'message_replayed') {
    return [{ messages: [{ id: change.providerMessageId }] }];
  }
  if (change.kind === 'message_deleted') {
    return [
      {
        messagesDeleted: [{ message: { id: change.providerMessageId } }],
      },
    ];
  }
  return [
    {
      messages: [{ id: change.providerMessageId }],
      ...(change.addedLabels?.length
        ? { labelsAdded: [{ message: { id: change.providerMessageId }, labelIds: change.addedLabels.map(mockGmailLabelId) }] }
        : {}),
      ...(change.removedLabels?.length
        ? { labelsRemoved: [{ message: { id: change.providerMessageId }, labelIds: change.removedLabels.map(mockGmailLabelId) }] }
        : {}),
    },
  ];
}

// Apply Gmail's `historyTypes[]` filtering after history records are built so
// replay/delete/label semantics stay centralized in `historyRecordForChange`.
function filterHistoryRecordByTypes(record: GmailHistoryRecord, historyTypes?: string[]): GmailHistoryRecord | null {
  const filters = new Set((historyTypes || []).map((entry) => entry.toLowerCase()));
  if (!filters.size) return record;

  const filtered: GmailHistoryRecord = {};
  if ((record.messagesAdded?.length || 0) > 0 && filters.has('messageadded')) {
    filtered.messagesAdded = [...record.messagesAdded!];
  }
  if ((record.messagesDeleted?.length || 0) > 0 && filters.has('messagedeleted')) {
    filtered.messagesDeleted = [...record.messagesDeleted!];
  }
  if ((record.labelsAdded?.length || 0) > 0 && filters.has('labeladded')) {
    filtered.labelsAdded = [...record.labelsAdded!];
  }
  if ((record.labelsRemoved?.length || 0) > 0 && filters.has('labelremoved')) {
    filtered.labelsRemoved = [...record.labelsRemoved!];
  }

  const hasAnyEvent =
    Boolean(filtered.messagesAdded?.length) ||
    Boolean(filtered.messagesDeleted?.length) ||
    Boolean(filtered.labelsAdded?.length) ||
    Boolean(filtered.labelsRemoved?.length);

  if (!hasAnyEvent && filters.has('message')) {
    if (record.messages?.length) {
      filtered.messages = [...record.messages];
    }
  } else if (hasAnyEvent && record.messages?.length) {
    filtered.messages = [...record.messages];
  }

  return Object.keys(filtered).length ? filtered : null;
}

/**
 * GmailService is the canonical Gmail semantic layer. The HTTP facade and the
 * white-box SDK both delegate here so message shape and cursor behavior stay
 * identical across product surfaces.
 */
export class GmailService {
  // The service receives the shared engine so SDK and HTTP callers see identical
  // mailbox state, history cursors, and fault injection.
  constructor(private readonly engine: EmailConnectEngine) {}

  // Profile exposes the mailbox identity plus the current history watermark,
  // which many Gmail sync clients use as their initial incremental cursor.
  async getProfile(mailboxId: string): Promise<GmailApiResponse<GmailProfile>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.profile.get');
    const latest = this.engine.listChanges(mailbox).at(-1)?.rowId;
    const messages = this.engine.listVisibleMessages(mailbox);
    return {
      data: {
        emailAddress: mailbox.primaryEmail,
        ...(latest ? { historyId: String(latest) } : {}),
        messagesTotal: messages.length,
        threadsTotal: new Set(messages.map((message) => message.providerThreadId || message.providerMessageId)).size,
      },
    };
  }

  // Label listing combines Gmail's system inbox label with labels discovered on
  // messages, while backend config can hide labels to test catalog drift.
  async listLabels(mailboxId: string): Promise<GmailApiResponse<{ labels?: GmailLabel[] }>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.labels.list');
    const hidden = new Set((mailbox.backend.hiddenLabelNames || []).map((entry) => entry.toLowerCase()));
    const labels = new Set<string>(['INBOX']);
    for (const message of this.engine.listAllMessages(mailbox)) {
      for (const label of message.labels) labels.add(label);
    }
    return {
      data: {
        labels: Array.from(labels)
          .filter((label) => !hidden.has(label.toLowerCase()))
          .sort((left, right) => left.localeCompare(right))
          .map((label) => ({ id: mockGmailLabelId(label), name: label })),
      },
    };
  }

  // `messages.list` intentionally returns lightweight references. Consumers
  // that need bodies or headers should follow up with `messages.get`.
  async listMessages(mailboxId: string, params: {
    q?: string;
    labelIds?: string[];
    maxResults?: number;
    pageToken?: string;
  }): Promise<GmailApiResponse<{ messages?: GmailMessageRef[]; nextPageToken?: string; resultSizeEstimate?: number }>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.messages.list');
    const offset = parsePageToken(params.pageToken);
    const maxResults = Math.max(1, Number(params.maxResults || 100));
    const filtered = this.engine
      .listVisibleMessages(mailbox)
      .filter((message) => matchesQuery(message, params.q))
      .filter((message) => matchesLabelFilter(message, params.labelIds))
      .sort((left, right) => {
        const a = left.receivedAt || '';
        const b = right.receivedAt || '';
        if (a === b) return right.rowId - left.rowId;
        return b.localeCompare(a);
      });
    const page = filtered.slice(offset, offset + maxResults);
    return {
      data: {
        messages: page.map((message) => ({
          id: message.providerMessageId,
          ...(message.providerThreadId ? { threadId: message.providerThreadId } : {}),
        })),
        resultSizeEstimate: filtered.length,
        ...(filtered.length > offset + page.length ? { nextPageToken: String(offset + page.length) } : {}),
      },
    };
  }

  // Threads are grouped from canonical messages at read time so replay, deletes,
  // and imported historical mail all feed the same thread view.
  async listThreads(mailboxId: string, params: {
    q?: string;
    labelIds?: string[];
    maxResults?: number;
    pageToken?: string;
  }): Promise<GmailApiResponse<{ threads?: GmailThreadRef[]; nextPageToken?: string; resultSizeEstimate?: number }>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.threads.list');
    const offset = parsePageToken(params.pageToken);
    const maxResults = Math.max(1, Number(params.maxResults || 100));
    const grouped = new Map<string, MailboxMessage[]>();
    for (const message of this.engine.listVisibleMessages(mailbox)) {
      if (!matchesQuery(message, params.q) || !matchesLabelFilter(message, params.labelIds)) continue;
      const threadId = message.providerThreadId || message.providerMessageId;
      const existing = grouped.get(threadId) || [];
      existing.push(message);
      grouped.set(threadId, existing);
    }
    const threads = Array.from(grouped.entries())
      .map(([threadId, messages]) => buildThread(mailbox, threadId, messages, this.engine))
      .sort((left, right) => {
        const a = String(left.messages?.at(-1)?.internalDate || '0');
        const b = String(right.messages?.at(-1)?.internalDate || '0');
        if (a === b) return String(right.id || '').localeCompare(String(left.id || ''));
        return b.localeCompare(a);
      });
    const page = threads.slice(offset, offset + maxResults);
    return {
      data: {
        threads: page.map((thread) => ({
          ...(thread.id ? { id: thread.id } : {}),
          ...(thread.historyId ? { historyId: thread.historyId } : {}),
          ...(thread.snippet ? { snippet: thread.snippet } : {}),
        })),
        resultSizeEstimate: threads.length,
        ...(threads.length > offset + page.length ? { nextPageToken: String(offset + page.length) } : {}),
      },
    };
  }

  // `getMessage` is where the chosen Gmail format is finally projected from
  // canonical mailbox state into the provider-specific payload shape.
  async getMessage(
    mailboxId: string,
    providerMessageId: string,
    options?: { format?: string; metadataHeaders?: string[] },
  ): Promise<GmailApiResponse<GmailMessage>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.messages.get');
    const message = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
    if (!message) {
      throw new NotFoundError(`Mock Gmail message not found (${providerMessageId})`);
    }
    return {
      data: buildMessage(mailbox, message, this.engine, {
        format: normalizeMessageFormat(options?.format),
        ...(options?.metadataHeaders?.length ? { metadataHeaders: options.metadataHeaders } : {}),
      }),
    };
  }

  // Thread reads intentionally reuse the same message projection rules as
  // message reads so `format` and `metadataHeaders` behave consistently.
  async getThread(
    mailboxId: string,
    providerThreadId: string,
    options?: { format?: string; metadataHeaders?: string[] },
  ): Promise<GmailApiResponse<GmailThread>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.threads.get');
    const messages = this.engine.listVisibleMessages(mailbox).filter((entry) => (entry.providerThreadId || entry.providerMessageId) === providerThreadId);
    if (!messages.length) {
      throw new NotFoundError(`Mock Gmail thread not found (${providerThreadId})`);
    }
    return {
      data: buildThread(mailbox, providerThreadId, messages, this.engine, {
        format: normalizeMessageFormat(options?.format),
        ...(options?.metadataHeaders?.length ? { metadataHeaders: options.metadataHeaders } : {}),
      }),
    };
  }

  // Attachment reads return Gmail's base64url wrapper, not raw bytes. That keeps
  // black-box callers on the provider contract instead of the core binary form.
  async getAttachment(mailboxId: string, providerMessageId: string, attachmentId: string): Promise<GmailApiResponse<{ data?: string }>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.attachments.get');
    const message = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
    if (!message) {
      throw new NotFoundError(`Mock Gmail message not found (${providerMessageId})`);
    }
    const attachment = message.attachments.find((entry) => entry.providerAttachmentId === attachmentId);
    if (!attachment) {
      throw new NotFoundError(`Mock Gmail attachment not found (${attachmentId})`);
    }
    return {
      data: {
        data: encodeBytesBase64Url(attachment.contentBytes),
      },
    };
  }

  // Gmail history is derived from canonical change rows and then expanded into
  // Gmail-style event arrays. That keeps replay and stale-cursor tests rooted
  // in one source of truth.
  async listHistory(mailboxId: string, params: {
    startHistoryId: string;
    pageToken?: string;
    historyTypes?: string[];
  }): Promise<GmailApiResponse<{ historyId?: string; nextPageToken?: string; history?: GmailHistoryRecord[] }>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.history.list');
    const startHistoryId = Number.parseInt(String(params.startHistoryId || '0'), 10);
    if (!Number.isFinite(startHistoryId) || startHistoryId < 0) {
      throw new Error('Invalid startHistoryId');
    }
    if (mailbox.backend.historyResetBeforeRowId && startHistoryId < mailbox.backend.historyResetBeforeRowId) {
      throw new Error('Requested entity was not found: startHistoryId expired');
    }

    const offset = parsePageToken(params.pageToken);
    const changes = this.engine.listChanges(mailbox).filter((change) => change.rowId > startHistoryId);
    const page = changes.slice(offset, offset + 100);
    const replaySet = new Set(mailbox.backend.historyReplayMessageIds || []);
    const messagesById = new Map(this.engine.listAllMessages(mailbox).map((message) => [message.providerMessageId, message]));
    const history = page.flatMap((change) => {
      const records = historyRecordForChange(change, messagesById.get(change.providerMessageId));
      if (change.kind !== 'message_added' || !replaySet.has(change.providerMessageId)) {
        return records
          .map((record) => filterHistoryRecordByTypes(record, params.historyTypes))
          .filter((record): record is GmailHistoryRecord => record != null);
      }
      return [...records, { messages: [{ id: change.providerMessageId }] }, { messagesAdded: [] }]
        .map((record) => filterHistoryRecordByTypes(record, params.historyTypes))
        .filter((record): record is GmailHistoryRecord => record != null);
    });

    return {
      data: {
        ...(changes.at(-1) ? { historyId: String(changes.at(-1)?.rowId) } : {}),
        history,
        ...(changes.length > offset + page.length ? { nextPageToken: String(offset + page.length) } : {}),
      },
    };
  }

  // Draft creation consumes raw RFC822 input because that is the seam many
  // Gmail clients already use for compose and reply flows.
  async createDraft(mailboxId: string, requestBody: Record<string, unknown>): Promise<
    GmailApiResponse<{
      id?: string;
      message?: { id?: string; threadId?: string };
    }>
  > {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.drafts.create');
    const message = (requestBody.message || {}) as Record<string, unknown>;
    const raw = String(message.raw || '');
    const parsed = parseRawEmailBase64Url(raw);
    const draft = this.engine.createDraft(mailboxId, {
      providerDraftId: this.engine.generateId('gmail-draft'),
      providerDraftMessageId: this.engine.generateId('gmail-draft-message'),
      providerThreadId: String(message.threadId || '').trim() || this.engine.generateId('gmail-thread'),
      to: parsed.to,
      subject: parsed.subject,
      bodyText: parsed.bodyText,
      bodyHtml: parsed.bodyHtml,
    });
    return {
      data: {
        id: draft.providerDraftId,
        message: {
          ...(draft.providerDraftMessageId ? { id: draft.providerDraftMessageId } : {}),
          ...(draft.providerThreadId ? { threadId: draft.providerThreadId } : {}),
        },
      },
    };
  }

  // Draft send records an outbound event without inventing a received message
  // in the mailbox, matching Gmail's compose-focused API surface.
  async sendDraft(mailboxId: string, requestBody: Record<string, unknown>): Promise<GmailApiResponse<{ id?: string; threadId?: string }>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.drafts.send');
    const providerDraftId = String(requestBody.id || '');
    const draft = this.engine.getDraft(mailboxId, providerDraftId);
    if (!draft) {
      throw new NotFoundError(`Mock Gmail draft not found (${providerDraftId})`);
    }
    const outbox = this.engine.sendDraft(mailboxId, providerDraftId, 'gmail', `gmail-sent-${providerDraftId}`);
    return {
      data: {
        id: outbox.providerMessageId,
        ...(outbox.providerThreadId ? { threadId: outbox.providerThreadId } : {}),
      },
    };
  }

  // `messages.send` is modeled as a transient draft+send internally so the
  // outbox and threading behavior line up with draft-send flows.
  async sendMessage(mailboxId: string, requestBody: Record<string, unknown>): Promise<GmailApiResponse<{ id?: string; threadId?: string }>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.messages.send');
    const raw = String(requestBody.raw || '');
    const parsed = parseRawEmailBase64Url(raw);
    const providerThreadId = String(requestBody.threadId || '').trim() || this.engine.generateId('gmail-thread');
    const tempDraftId = this.engine.generateId('gmail-temp-send');
    this.engine.createDraft(mailboxId, {
      providerDraftId: tempDraftId,
      providerDraftMessageId: tempDraftId,
      providerThreadId,
      to: parsed.to,
      subject: parsed.subject,
      bodyText: parsed.bodyText,
      bodyHtml: parsed.bodyHtml,
      attachments: parsed.attachments.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        contentBytes: attachment.contentBytes,
        attachmentType: 'file',
        ...(attachment.isInline ? { isInline: true } : {}),
        ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
      })),
    });
    const outbox = this.engine.sendDraft(mailboxId, tempDraftId, 'gmail', this.engine.generateId('gmail-sent'));
    return {
      data: {
        id: outbox.providerMessageId,
        ...(outbox.providerThreadId ? { threadId: outbox.providerThreadId } : {}),
      },
    };
  }

  // `import` and `insert` share the same raw-message ingestion path; the caller
  // chooses the mode so auth and tests can distinguish the provider operation.
  async importMessage(
    mailboxId: string,
    requestBody: Record<string, unknown>,
    mode: 'import' | 'insert',
  ): Promise<GmailApiResponse<GmailMessage>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, mode === 'import' ? 'gmail.messages.import' : 'gmail.messages.insert');
    const raw = String(requestBody.raw || '');
    const parsed = parseRawEmailBase64Url(raw);
    const internalDateSource = String(requestBody.internalDateSource || '').trim().toLowerCase();
    const dateFromHeader =
      internalDateSource === 'dateheader' && parsed.date ? new Date(parsed.date) : null;
    const receivedAt =
      dateFromHeader && !Number.isNaN(dateFromHeader.getTime()) ? dateFromHeader.toISOString() : this.engine.nowIso();
    const inserted = this.engine.appendMessage(mailboxId, {
      ...(String(requestBody.threadId || '').trim()
        ? { providerThreadId: String(requestBody.threadId || '').trim() }
        : {}),
      from: parsed.from,
      to: parsed.to,
      subject: parsed.subject,
      messageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
      bodyText: parsed.bodyText,
      bodyHtml: parsed.bodyHtml,
      rawHeaders: parsed.headers,
      attachments: parsed.attachments.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        contentBytes: attachment.contentBytes,
        attachmentType: 'file',
        ...(attachment.isInline ? { isInline: true } : {}),
        ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
      })),
      ...(Array.isArray(requestBody.labelIds)
        ? {
            labels: requestBody.labelIds
              .map((labelId) => String(labelId || '').trim())
              .filter(Boolean)
              .map((labelId) => {
                const match = labelId.match(MOCK_GMAIL_LABEL_ID_PATTERN);
                return match?.[1] ? Buffer.from(match[1], 'base64url').toString('utf8') : labelId;
              }),
          }
        : {}),
      receivedAt,
    });
    if (requestBody.deleted === true) {
      this.engine.deleteMessage(mailboxId, inserted.providerMessageId);
    }
    return {
      data: buildMessage(mailbox, this.engine.listAllMessages(mailbox).find((entry) => entry.providerMessageId === inserted.providerMessageId)!, this.engine, {
        format: 'full',
      }),
    };
  }

  // Watch state is intentionally lightweight. The mock preserves Gmail's
  // bootstrap contract and expiration shape more than it emulates Pub/Sub.
  async watchMailbox(
    mailboxId: string,
    requestBody: Record<string, unknown>,
  ): Promise<GmailApiResponse<GmailWatchResponse>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.watch.create');
    const latestHistoryId = String(this.engine.listChanges(mailbox).at(-1)?.rowId || 0);
    const expiration = new Date(Date.parse(this.engine.nowIso()) + 7 * 24 * 3600 * 1000).getTime();
    gmailRuntime(this.engine, mailboxId).watch = {
      topicName: String(requestBody.topicName || '').trim() || 'projects/email-connect/topics/gmail-watch',
      labelIds: Array.isArray(requestBody.labelIds)
        ? requestBody.labelIds.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
      labelFilterAction:
        String(requestBody.labelFilterAction || '').trim().toLowerCase() === 'exclude' ? 'exclude' : 'include',
      expiration: String(expiration),
      historyId: latestHistoryId,
    };
    return {
      data: {
        historyId: latestHistoryId,
        expiration: String(expiration),
      },
    };
  }

  // Stop watch clears only Gmail runtime state; it does not mutate messages or
  // cursors because consumers should be able to restart watches deterministically.
  async stopWatching(mailboxId: string): Promise<GmailApiResponse<Record<string, never>>> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.watch.stop');
    gmailRuntime(this.engine, mailboxId).watch = null;
    return { data: {} };
  }

  // Plain-draft helper is a white-box convenience built on the same canonical
  // draft store as the raw Gmail draft endpoint.
  async createPlainDraft(mailboxId: string, params: {
    to: string;
    subject?: string | null;
    bodyText: string;
    threadId?: string | null;
    inReplyToMessageId?: string | null;
    referencesMessageId?: string | null;
  }): Promise<{
    providerDraftId: string;
    providerDraftMessageId: string | null;
    providerThreadId: string | null;
    bodySha256: string;
  }> {
    const headers: string[] = [];
    headers.push(`To: ${params.to}`);
    headers.push(`Subject: ${normalizeSubject(params.subject)}`);
    headers.push('MIME-Version: 1.0');
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    if (params.inReplyToMessageId) headers.push(`In-Reply-To: ${params.inReplyToMessageId}`);
    if (params.referencesMessageId) headers.push(`References: ${params.referencesMessageId}`);
    const raw = encodeBase64Url(`${headers.join('\r\n')}\r\n\r\n${params.bodyText}\r\n`);
    const created = await this.createDraft(mailboxId, {
      message: {
        raw,
        threadId: params.threadId || undefined,
      },
    });
    return {
      providerDraftId: String(created.data.id || ''),
      providerDraftMessageId: created.data.message?.id || null,
      providerThreadId: created.data.message?.threadId || params.threadId || null,
      bodySha256: sha256Hex(params.bodyText),
    };
  }

  // Reply-draft helper keeps the common consumer flow concise while preserving
  // Gmail's thread and subject behavior.
  async createReplyDraft(mailboxId: string, params: {
    to: string;
    subject?: string | null;
    bodyText: string;
    threadId?: string | null;
    inReplyToMessageId?: string | null;
    referencesMessageId?: string | null;
  }): Promise<{
    providerDraftId: string;
    providerDraftMessageId: string | null;
    providerThreadId: string | null;
    bodySha256: string;
  }> {
    return this.createPlainDraft(mailboxId, {
      ...params,
      subject: normalizeReplySubject(params.subject),
    });
  }
}
