import type { MailboxDraft } from '../../core/types.js';
import { EmailConnectEngine } from '../../engine/email-connect-engine.js';
export declare class GraphService {
    private readonly engine;
    constructor(engine: EmailConnectEngine);
    getMe(mailboxId: string): Promise<{
        id: string;
        mail: string;
        userPrincipalName: string;
    }>;
    listMessages(mailboxId: string, path: string, baseUrl: string): Promise<{
        value: {
            id: string;
            subject: string | undefined;
            from: {
                emailAddress: {
                    address: string;
                };
            } | undefined;
            toRecipients: ({
                emailAddress: {
                    address: string;
                };
            } | undefined)[];
            receivedDateTime: string | undefined;
            internetMessageId: string | undefined;
            bodyPreview: string | undefined;
            body: {
                content: string;
                contentType: string;
            };
            conversationId: string | undefined;
            categories: string[] | undefined;
            hasAttachments: boolean;
            internetMessageHeaders: {
                name: string;
                value: string;
            }[];
        }[];
        '@odata.nextLink': string | undefined;
    }>;
    listInboxMessages(mailboxId: string, path: string, baseUrl: string): Promise<{
        value: {
            id: string;
            subject: string | undefined;
            from: {
                emailAddress: {
                    address: string;
                };
            } | undefined;
            toRecipients: ({
                emailAddress: {
                    address: string;
                };
            } | undefined)[];
            receivedDateTime: string | undefined;
            internetMessageId: string | undefined;
            bodyPreview: string | undefined;
            body: {
                content: string;
                contentType: string;
            };
            conversationId: string | undefined;
            categories: string[] | undefined;
            hasAttachments: boolean;
            internetMessageHeaders: {
                name: string;
                value: string;
            }[];
        }[];
        '@odata.nextLink': string | undefined;
    }>;
    delta(mailboxId: string, path: string, baseUrl: string): Promise<{
        value: ({
            id: string;
            subject: string | undefined;
            from: {
                emailAddress: {
                    address: string;
                };
            } | undefined;
            toRecipients: ({
                emailAddress: {
                    address: string;
                };
            } | undefined)[];
            receivedDateTime: string | undefined;
            internetMessageId: string | undefined;
            bodyPreview: string | undefined;
            body: {
                content: string;
                contentType: string;
            };
            conversationId: string | undefined;
            categories: string[] | undefined;
            hasAttachments: boolean;
            internetMessageHeaders: {
                name: string;
                value: string;
            }[];
        } | {
            id: string;
            '@removed': {
                reason: string;
            };
        })[];
        '@odata.nextLink': string | undefined;
        '@odata.deltaLink': string | undefined;
    }>;
    getMessage(mailboxId: string, providerMessageId: string): Promise<{
        id: string;
        subject: string | undefined;
        from: {
            emailAddress: {
                address: string;
            };
        } | undefined;
        toRecipients: ({
            emailAddress: {
                address: string;
            };
        } | undefined)[];
        receivedDateTime: string | undefined;
        internetMessageId: string | undefined;
        bodyPreview: string | undefined;
        body: {
            content: string;
            contentType: string;
        };
        conversationId: string | undefined;
        categories: string[] | undefined;
        hasAttachments: boolean;
        internetMessageHeaders: {
            name: string;
            value: string;
        }[];
    } | {
        id: string;
        subject: string | undefined;
        toRecipients: ({
            emailAddress: {
                address: string;
            };
        } | undefined)[];
        body: {
            content: string;
            contentType: string;
        };
        bodyPreview: string | undefined;
        conversationId: string | undefined;
        internetMessageHeaders: never[];
    }>;
    listAttachments(mailboxId: string, providerMessageId: string): Promise<{
        value: {
            id: string;
            name: string;
            contentType: string;
            size: number | undefined;
        }[];
    }>;
    listAttachmentsPage(mailboxId: string, providerMessageId: string, path: string, baseUrl: string): Promise<{
        value: {
            id: string;
            name: string;
            contentType: string;
            size: number | undefined;
        }[];
        '@odata.nextLink': string | undefined;
    }>;
    getAttachment(mailboxId: string, providerMessageId: string, attachmentId: string): Promise<{
        id: string;
        name: string;
        contentType: string;
        size: number | undefined;
        contentBytes: string | undefined;
    }>;
    getAttachmentValue(mailboxId: string, providerMessageId: string, attachmentId: string): Promise<Uint8Array>;
    createReplyDraft(mailboxId: string, providerMessageId: string): Promise<{
        id: string;
        conversationId: string | null;
    }>;
    createDraft(mailboxId: string, body: Record<string, unknown>): Promise<{
        id: string;
        conversationId: string | null;
    }>;
    patchDraft(mailboxId: string, providerDraftId: string, body: Record<string, unknown>): Promise<MailboxDraft>;
    sendDraft(mailboxId: string, providerDraftId: string): Promise<{}>;
    deleteMessageResource(mailboxId: string, providerMessageId: string): Promise<void>;
}
//# sourceMappingURL=service.d.ts.map