import { NotFoundError } from '../../core/errors.js';
import type { MailboxChange, MailboxDraft, MailboxMessage } from '../../core/types.js';
import { EmailConnectEngine } from '../../engine/email-connect-engine.js';
import { encodeBytesBase64 } from '../../utils/base64.js';

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

function encodeDeltaUrl(baseUrl: string, path: string, params: Record<string, string | number | null | undefined>): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function messageAddress(address: string | null) {
  if (!address) return undefined;
  return {
    emailAddress: {
      address,
    },
  };
}

function graphBodyFromPayload(payload: unknown): { bodyText: string; bodyHtml: string | null } {
  const body = payload && typeof payload === 'object' ? (payload as { content?: unknown; contentType?: unknown }) : null;
  const content = typeof body?.content === 'string' ? body.content : '';
  const contentType = String(body?.contentType || 'Text').toLowerCase();
  if (contentType === 'html') {
    return {
      bodyText: '',
      bodyHtml: content || null,
    };
  }
  return {
    bodyText: content,
    bodyHtml: null,
  };
}

function draftPatchFromBody(body: Record<string, unknown>): {
  to?: string[];
  subject?: string;
  bodyText?: string;
  bodyHtml?: string | null;
} {
  const toRecipients = Array.isArray(body.toRecipients)
    ? body.toRecipients
        .map((entry) => (entry as { emailAddress?: { address?: string } })?.emailAddress?.address)
        .filter((entry): entry is string => Boolean(entry))
    : undefined;
  const normalizedBody = body.body == null ? null : graphBodyFromPayload(body.body);
  return {
    ...(toRecipients ? { to: toRecipients } : {}),
    ...(typeof body.subject === 'string' ? { subject: body.subject } : {}),
    ...(normalizedBody
      ? {
          bodyText: normalizedBody.bodyText,
          bodyHtml: normalizedBody.bodyHtml,
        }
      : {}),
  };
}

function buildMessage(message: MailboxMessage) {
  return {
    id: message.providerMessageId,
    subject: message.subject || undefined,
    from: messageAddress(message.from),
    toRecipients: message.to
      ? String(message.to)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => messageAddress(value))
      : [],
    receivedDateTime: message.receivedAt || undefined,
    internetMessageId: message.messageId || undefined,
    bodyPreview: message.snippet || undefined,
    body: {
      content: message.bodyText || message.bodyHtml || '',
      contentType: message.bodyHtml ? 'html' : 'text',
    },
    conversationId: message.providerThreadId || undefined,
    categories: message.labels.length ? [...message.labels] : undefined,
    hasAttachments: message.attachments.length > 0,
    internetMessageHeaders: [
      ...(message.messageId ? [{ name: 'Message-ID', value: message.messageId }] : []),
      ...(message.inReplyTo ? [{ name: 'In-Reply-To', value: message.inReplyTo }] : []),
      ...(message.references ? [{ name: 'References', value: message.references }] : []),
    ],
  };
}

function buildDraftMessage(draft: MailboxDraft | null) {
  if (!draft) return null;
  return {
    id: draft.providerDraftId,
    subject: draft.subject || undefined,
    toRecipients: draft.to
      ? String(draft.to)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => messageAddress(value))
      : [],
    body: {
      content: draft.bodyHtml || draft.bodyText || '',
      contentType: draft.bodyHtml ? 'html' : 'text',
    },
    bodyPreview: draft.bodyText || draft.bodyHtml || undefined,
    conversationId: draft.providerThreadId || undefined,
    internetMessageHeaders: [],
  };
}

function changeToDeltaItem(change: MailboxChange, message: MailboxMessage | undefined) {
  if (change.kind === 'message_deleted') {
    return {
      id: change.providerMessageId,
      '@removed': {
        reason: 'deleted',
      },
    };
  }
  if (!message) return null;
  return buildMessage(message);
}

export class GraphService {
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

  async listMessages(mailboxId: string, path: string, baseUrl: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
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
      value: page.map(buildMessage),
      '@odata.nextLink':
        rows.length > offset + page.length
          ? encodeDeltaUrl(baseUrl, '/graph/v1.0/me/messages', {
              offset: offset + page.length,
              '$top': top,
              receivedAfter,
            })
          : undefined,
    };
  }

  async listInboxMessages(mailboxId: string, path: string, baseUrl: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.inbox.messages.list');
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
      value: page.map(buildMessage),
      '@odata.nextLink':
        rows.length > offset + page.length
          ? encodeDeltaUrl(baseUrl, '/graph/v1.0/me/mailFolders/inbox/messages', {
              offset: offset + page.length,
              '$top': top,
              receivedAfter,
            })
          : undefined,
    };
  }

  async delta(mailboxId: string, path: string, baseUrl: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.delta.get');
    const url = parseUrl(path, baseUrl);
    const sinceRowId = Number.parseInt(String(url.searchParams.get('sinceRowId') || '0'), 10) || 0;
    if (mailbox.backend.invalidDeltaBeforeRowId && sinceRowId > 0 && sinceRowId < mailbox.backend.invalidDeltaBeforeRowId) {
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
    const top = parseTop(url, 50);
    const offset = parseOffset(url);
    const receivedAfter = url.searchParams.get('receivedAfter') || receivedAfterFromFilter(url.searchParams.get('$filter'));
    const changes = this.engine
      .listChanges(mailbox)
      .filter((change) => change.rowId > sinceRowId)
      .filter((change) => {
        if (!receivedAfter) return true;
        const message = this.engine.listAllMessages(mailbox).find((entry) => entry.providerMessageId === change.providerMessageId);
        return message?.receivedAt != null && message.receivedAt >= receivedAfter;
      });
    const page = changes.slice(offset, offset + top);
    const visibleById = new Map(this.engine.listAllMessages(mailbox).map((message) => [message.providerMessageId, message]));
    const latestRowId = this.engine.listChanges(mailbox).at(-1)?.rowId || 0;
    return {
      value: page
        .map((change) => changeToDeltaItem(change, visibleById.get(change.providerMessageId)))
        .filter((entry) => entry != null),
      '@odata.nextLink':
        changes.length > offset + page.length
          ? encodeDeltaUrl(baseUrl, '/graph/v1.0/me/mailFolders/inbox/messages/delta', {
              sinceRowId,
              offset: offset + page.length,
              '$top': top,
              receivedAfter,
            })
          : undefined,
      '@odata.deltaLink':
        changes.length > offset + page.length
          ? undefined
          : encodeDeltaUrl(baseUrl, '/graph/v1.0/me/mailFolders/inbox/messages/delta', {
              sinceRowId: latestRowId,
              '$top': top,
            }),
    };
  }

  async getMessage(mailboxId: string, providerMessageId: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.get');
    const draft = this.engine.getDraft(mailboxId, providerMessageId);
    const asDraft = buildDraftMessage(draft);
    if (asDraft) return asDraft;
    const message = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
    if (!message) {
      throw new NotFoundError(`Mock Graph message not found (${providerMessageId})`);
    }
    return buildMessage(message);
  }

  async listAttachments(mailboxId: string, providerMessageId: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.attachments.list');
    const message = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
    if (!message) {
      throw new NotFoundError(`Mock Graph message not found (${providerMessageId})`);
    }
    return {
      value: message.attachments.map((attachment) => ({
        id: attachment.providerAttachmentId,
        name: attachment.filename,
        contentType: attachment.mimeType,
        size: attachment.sizeBytes == null ? undefined : attachment.sizeBytes,
      })),
    };
  }

  async listAttachmentsPage(mailboxId: string, providerMessageId: string, path: string, baseUrl: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.attachments.list');
    const message = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
    if (!message) {
      throw new NotFoundError(`Mock Graph message not found (${providerMessageId})`);
    }
    const url = parseUrl(path, baseUrl);
    const top = parseTop(url, 100);
    const offset = parseOffset(url);
    const page = message.attachments.slice(offset, offset + top);
    return {
      value: page.map((attachment) => ({
        id: attachment.providerAttachmentId,
        name: attachment.filename,
        contentType: attachment.mimeType,
        size: attachment.sizeBytes == null ? undefined : attachment.sizeBytes,
      })),
      '@odata.nextLink':
        message.attachments.length > offset + page.length
          ? encodeDeltaUrl(baseUrl, `/graph/v1.0/me/messages/${encodeURIComponent(providerMessageId)}/attachments`, {
              offset: offset + page.length,
              '$top': top,
            })
          : undefined,
    };
  }

  async getAttachment(mailboxId: string, providerMessageId: string, attachmentId: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.attachment.get');
    const message = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
    if (!message) {
      throw new NotFoundError(`Mock Graph message not found (${providerMessageId})`);
    }
    const attachment = message.attachments.find((entry) => entry.providerAttachmentId === attachmentId);
    if (!attachment) {
      throw new NotFoundError(`Mock Graph attachment not found (${attachmentId})`);
    }
    const omitSet = new Set(mailbox.backend.omitAttachmentContentBytesIds || []);
    return {
      id: attachment.providerAttachmentId,
      name: attachment.filename,
      contentType: attachment.mimeType,
      size: attachment.sizeBytes == null ? undefined : attachment.sizeBytes,
      contentBytes: omitSet.has(attachment.providerAttachmentId) ? undefined : encodeBytesBase64(attachment.contentBytes),
    };
  }

  async getAttachmentValue(mailboxId: string, providerMessageId: string, attachmentId: string): Promise<Uint8Array> {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.attachment.value');
    const message = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
    if (!message) {
      throw new NotFoundError(`Mock Graph message not found (${providerMessageId})`);
    }
    const attachment = message.attachments.find((entry) => entry.providerAttachmentId === attachmentId);
    if (!attachment) {
      throw new NotFoundError(`Mock Graph attachment not found (${attachmentId})`);
    }
    return new Uint8Array(attachment.contentBytes);
  }

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

  async createDraft(mailboxId: string, body: Record<string, unknown>) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.messages.post');
    const patch = draftPatchFromBody(body);
    const draft = this.engine.createDraft(mailboxId, {
      providerDraftId: this.engine.generateId('outlook-draft'),
      providerDraftMessageId: this.engine.generateId('outlook-draft-message'),
      providerThreadId: this.engine.generateId('outlook-thread'),
      to: patch.to,
      subject: patch.subject ?? null,
      bodyText: patch.bodyText ?? '',
      bodyHtml: patch.bodyHtml ?? null,
    });
    return {
      id: draft.providerDraftId,
      conversationId: draft.providerThreadId,
    };
  }

  async patchDraft(mailboxId: string, providerDraftId: string, body: Record<string, unknown>) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.patch');
    return this.engine.updateDraft(mailboxId, providerDraftId, draftPatchFromBody(body));
  }

  async sendDraft(mailboxId: string, providerDraftId: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.send.post');
    this.engine.sendDraft(mailboxId, providerDraftId, 'graph', providerDraftId);
    return {};
  }

  async deleteMessageResource(mailboxId: string, providerMessageId: string) {
    const mailbox = this.engine.requireMailbox(mailboxId);
    await this.engine.maybeDelay(mailbox);
    this.engine.maybeThrowInjectedFailure(mailbox, 'graph.message.delete');
    if (this.engine.deleteDraft(mailboxId, providerMessageId)) {
      return;
    }
    this.engine.deleteMessage(mailboxId, providerMessageId);
  }
}
