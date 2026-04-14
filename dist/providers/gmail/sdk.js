import { createHash } from 'node:crypto';
import { GmailService } from './service.js';
import { decodeBase64UrlToBytes } from '../../utils/base64.js';
function sha256Hex(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
export function getGmailClientForMailbox(engine, mailboxId) {
    const service = new GmailService(engine);
    return {
        users: {
            getProfile() {
                return service.getProfile(mailboxId);
            },
            labels: {
                list() {
                    return service.listLabels(mailboxId);
                },
            },
            messages: {
                list(params) {
                    return service.listMessages(mailboxId, params);
                },
                get(params) {
                    return service.getMessage(mailboxId, params.id);
                },
                send(params) {
                    return service.sendMessage(mailboxId, params.requestBody);
                },
                attachments: {
                    get(params) {
                        return service.getAttachment(mailboxId, params.messageId, params.id);
                    },
                },
            },
            history: {
                list(params) {
                    return service.listHistory(mailboxId, params);
                },
            },
            drafts: {
                create(params) {
                    return service.createDraft(mailboxId, params.requestBody);
                },
                send(params) {
                    return service.sendDraft(mailboxId, params.requestBody);
                },
            },
        },
    };
}
export async function downloadGmailAttachment(params) {
    const client = getGmailClientForMailbox(params.engine, params.mailboxId);
    const res = await client.users.messages.attachments.get({
        userId: 'me',
        messageId: params.providerMessageId,
        id: params.providerAttachmentId,
    });
    if (!res.data.data) {
        throw new Error('Gmail attachment response missing data');
    }
    return decodeBase64UrlToBytes(res.data.data);
}
export async function createGmailDraft(params) {
    const service = new GmailService(params.engine);
    const created = await service.createPlainDraft(params.mailboxId, params);
    return {
        ...created,
        bodySha256: sha256Hex(params.bodyText),
    };
}
export async function createGmailReplyDraft(params) {
    const service = new GmailService(params.engine);
    const created = await service.createReplyDraft(params.mailboxId, params);
    return {
        ...created,
        bodySha256: sha256Hex(params.bodyText),
    };
}
export async function sendGmailReplyDraft(params) {
    const service = new GmailService(params.engine);
    const sent = await service.sendDraft(params.mailboxId, {
        id: params.providerDraftId,
    });
    return {
        providerMessageId: sent.data.id || null,
        providerThreadId: sent.data.threadId || null,
    };
}
//# sourceMappingURL=sdk.js.map