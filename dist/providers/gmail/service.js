import { createHash } from 'node:crypto';
import { NotFoundError } from '../../core/errors.js';
import { encodeBase64Url, encodeBytesBase64Url } from '../../utils/base64.js';
import { parseRawEmailBase64Url } from '../../utils/raw-email.js';
function parsePageToken(pageToken) {
    if (!pageToken)
        return 0;
    const parsed = Number.parseInt(String(pageToken), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function receivedAfterFromQuery(q) {
    const match = String(q || '').match(/\bafter:(\d+)\b/);
    if (!match)
        return undefined;
    const value = match[1];
    if (!value)
        return undefined;
    const seconds = Number.parseInt(value, 10);
    if (!Number.isFinite(seconds) || seconds <= 0)
        return undefined;
    return new Date(seconds * 1000).toISOString();
}
function parseGmailQueryValues(prefix, q) {
    const pattern = new RegExp(`\\b${prefix}:(?:"([^"]+)"|([^\\s()]+))`, 'gi');
    const values = [];
    let match = null;
    while ((match = pattern.exec(String(q || '')))) {
        const value = String(match[1] || match[2] || '').trim().toLowerCase();
        if (value)
            values.push(value);
    }
    return values;
}
function addressMatches(raw, value) {
    if (!raw)
        return false;
    const lower = raw.toLowerCase();
    if (value.includes('@'))
        return lower.includes(value);
    return lower.includes(`@${value}`) || lower.includes(value);
}
function normalizeReplySubject(subject) {
    const clean = String(subject || '').trim();
    if (!clean)
        return 'Re:';
    if (/^\s*re:/i.test(clean))
        return clean;
    return `Re: ${clean}`;
}
function normalizeSubject(subject) {
    const clean = String(subject || '').trim();
    return clean || '(no subject)';
}
function sha256Hex(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
export function mockGmailLabelId(labelName) {
    return `Label_${Buffer.from(labelName, 'utf8').toString('base64url')}`;
}
function messageHeaders(message) {
    const headers = [];
    if (message.subject)
        headers.push({ name: 'Subject', value: message.subject });
    if (message.from)
        headers.push({ name: 'From', value: message.from });
    if (message.to)
        headers.push({ name: 'To', value: message.to });
    if (message.receivedAt)
        headers.push({ name: 'Date', value: message.receivedAt });
    if (message.messageId)
        headers.push({ name: 'Message-ID', value: message.messageId });
    if (message.inReplyTo)
        headers.push({ name: 'In-Reply-To', value: message.inReplyTo });
    if (message.references)
        headers.push({ name: 'References', value: message.references });
    if (message.rawHeaders) {
        for (const [name, value] of Object.entries(message.rawHeaders)) {
            if (headers.some((entry) => String(entry.name || '').toLowerCase() === name.toLowerCase()))
                continue;
            headers.push({ name, value });
        }
    }
    return headers;
}
function buildPayload(message) {
    const parts = [];
    if (message.bodyText) {
        parts.push({
            mimeType: 'text/plain',
            body: { data: encodeBase64Url(message.bodyText) },
        });
    }
    if (message.bodyHtml) {
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
        headers: messageHeaders(message),
        parts,
    };
}
function buildMessage(message) {
    return {
        id: message.providerMessageId,
        ...(message.providerThreadId ? { threadId: message.providerThreadId } : {}),
        payload: buildPayload(message),
        labelIds: message.labels.map(mockGmailLabelId),
        ...(message.snippet ? { snippet: message.snippet } : {}),
    };
}
function matchesQuery(message, q) {
    const after = receivedAfterFromQuery(q);
    if (after && message.receivedAt && message.receivedAt < after)
        return false;
    const labelTerms = parseGmailQueryValues('label', q);
    if (labelTerms.length) {
        const labels = message.labels.map((label) => label.toLowerCase());
        if (!labelTerms.some((label) => labels.includes(label)))
            return false;
    }
    const fromTerms = parseGmailQueryValues('from', q);
    if (fromTerms.length && !fromTerms.some((value) => addressMatches(message.from, value)))
        return false;
    const toTerms = parseGmailQueryValues('to', q);
    if (toTerms.length && !toTerms.some((value) => addressMatches(message.to, value)))
        return false;
    const subjectTerms = parseGmailQueryValues('subject', q);
    if (subjectTerms.length) {
        const subject = String(message.subject || '').toLowerCase();
        if (!subjectTerms.some((value) => subject.includes(value)))
            return false;
    }
    return true;
}
function historyRecordForChange(change, message) {
    if (!message && change.kind !== 'message_deleted')
        return [];
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
function filterHistoryRecordByTypes(record, historyTypes) {
    const filters = new Set((historyTypes || []).map((entry) => entry.toLowerCase()));
    if (!filters.size)
        return record;
    const filtered = {};
    if ((record.messagesAdded?.length || 0) > 0 && filters.has('messageadded')) {
        filtered.messagesAdded = [...record.messagesAdded];
    }
    if ((record.messagesDeleted?.length || 0) > 0 && filters.has('messagedeleted')) {
        filtered.messagesDeleted = [...record.messagesDeleted];
    }
    if ((record.labelsAdded?.length || 0) > 0 && filters.has('labeladded')) {
        filtered.labelsAdded = [...record.labelsAdded];
    }
    if ((record.labelsRemoved?.length || 0) > 0 && filters.has('labelremoved')) {
        filtered.labelsRemoved = [...record.labelsRemoved];
    }
    const hasAnyEvent = Boolean(filtered.messagesAdded?.length) ||
        Boolean(filtered.messagesDeleted?.length) ||
        Boolean(filtered.labelsAdded?.length) ||
        Boolean(filtered.labelsRemoved?.length);
    if (!hasAnyEvent && filters.has('message')) {
        if (record.messages?.length) {
            filtered.messages = [...record.messages];
        }
    }
    else if (hasAnyEvent && record.messages?.length) {
        filtered.messages = [...record.messages];
    }
    return Object.keys(filtered).length ? filtered : null;
}
export class GmailService {
    engine;
    constructor(engine) {
        this.engine = engine;
    }
    async getProfile(mailboxId) {
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
    async listLabels(mailboxId) {
        const mailbox = this.engine.requireMailbox(mailboxId);
        await this.engine.maybeDelay(mailbox);
        this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.labels.list');
        const hidden = new Set((mailbox.backend.hiddenLabelNames || []).map((entry) => entry.toLowerCase()));
        const labels = new Set(['INBOX']);
        for (const message of this.engine.listAllMessages(mailbox)) {
            for (const label of message.labels)
                labels.add(label);
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
    async listMessages(mailboxId, params) {
        const mailbox = this.engine.requireMailbox(mailboxId);
        await this.engine.maybeDelay(mailbox);
        this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.messages.list');
        const offset = parsePageToken(params.pageToken);
        const maxResults = Math.max(1, Number(params.maxResults || 100));
        const filtered = this.engine
            .listVisibleMessages(mailbox)
            .filter((message) => matchesQuery(message, params.q))
            .sort((left, right) => {
            const a = left.receivedAt || '';
            const b = right.receivedAt || '';
            if (a === b)
                return right.rowId - left.rowId;
            return b.localeCompare(a);
        });
        const page = filtered.slice(offset, offset + maxResults);
        return {
            data: {
                messages: page.map((message) => ({ id: message.providerMessageId })),
                ...(filtered.length > offset + page.length ? { nextPageToken: String(offset + page.length) } : {}),
            },
        };
    }
    async getMessage(mailboxId, providerMessageId) {
        const mailbox = this.engine.requireMailbox(mailboxId);
        await this.engine.maybeDelay(mailbox);
        this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.messages.get');
        const message = this.engine.listVisibleMessages(mailbox).find((entry) => entry.providerMessageId === providerMessageId);
        if (!message) {
            throw new NotFoundError(`Mock Gmail message not found (${providerMessageId})`);
        }
        return { data: buildMessage(message) };
    }
    async getAttachment(mailboxId, providerMessageId, attachmentId) {
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
    async listHistory(mailboxId, params) {
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
                    .filter((record) => record != null);
            }
            return [...records, { messages: [{ id: change.providerMessageId }] }, { messagesAdded: [] }]
                .map((record) => filterHistoryRecordByTypes(record, params.historyTypes))
                .filter((record) => record != null);
        });
        return {
            data: {
                ...(changes.at(-1) ? { historyId: String(changes.at(-1)?.rowId) } : {}),
                history,
                ...(changes.length > offset + page.length ? { nextPageToken: String(offset + page.length) } : {}),
            },
        };
    }
    async createDraft(mailboxId, requestBody) {
        const mailbox = this.engine.requireMailbox(mailboxId);
        await this.engine.maybeDelay(mailbox);
        this.engine.maybeThrowInjectedFailure(mailbox, 'gmail.drafts.create');
        const message = (requestBody.message || {});
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
    async sendDraft(mailboxId, requestBody) {
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
    async sendMessage(mailboxId, requestBody) {
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
        });
        const outbox = this.engine.sendDraft(mailboxId, tempDraftId, 'gmail', this.engine.generateId('gmail-sent'));
        return {
            data: {
                id: outbox.providerMessageId,
                ...(outbox.providerThreadId ? { threadId: outbox.providerThreadId } : {}),
            },
        };
    }
    async createPlainDraft(mailboxId, params) {
        const headers = [];
        headers.push(`To: ${params.to}`);
        headers.push(`Subject: ${normalizeSubject(params.subject)}`);
        headers.push('MIME-Version: 1.0');
        headers.push('Content-Type: text/plain; charset="UTF-8"');
        if (params.inReplyToMessageId)
            headers.push(`In-Reply-To: ${params.inReplyToMessageId}`);
        if (params.referencesMessageId)
            headers.push(`References: ${params.referencesMessageId}`);
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
    async createReplyDraft(mailboxId, params) {
        return this.createPlainDraft(mailboxId, {
            ...params,
            subject: normalizeReplySubject(params.subject),
        });
    }
}
//# sourceMappingURL=service.js.map