import { EmailConnectEngine } from '@email-connect/core';
import type { GmailApiResponse, GmailHistoryRecord, GmailLabel, GmailMessage, GmailMessageRef, GmailProfile } from './service.js';
export type GmailClient = {
    users: {
        getProfile(params: {
            userId: string;
        }): Promise<GmailApiResponse<GmailProfile>>;
        labels: {
            list(params: {
                userId: string;
            }): Promise<GmailApiResponse<{
                labels?: GmailLabel[];
            }>>;
        };
        messages: {
            list(params: {
                userId: string;
                q?: string;
                maxResults?: number;
                pageToken?: string;
            }): Promise<GmailApiResponse<{
                messages?: GmailMessageRef[];
                nextPageToken?: string;
            }>>;
            get(params: {
                userId: string;
                id: string;
                format?: string;
            }): Promise<GmailApiResponse<GmailMessage>>;
            send(params: {
                userId: string;
                requestBody: Record<string, unknown>;
            }): Promise<GmailApiResponse<{
                id?: string;
                threadId?: string;
            }>>;
            attachments: {
                get(params: {
                    userId: string;
                    messageId: string;
                    id: string;
                }): Promise<GmailApiResponse<{
                    data?: string;
                }>>;
            };
        };
        history: {
            list(params: {
                userId: string;
                startHistoryId: string;
                pageToken?: string;
                historyTypes?: string[];
            }): Promise<GmailApiResponse<{
                historyId?: string;
                nextPageToken?: string;
                history?: GmailHistoryRecord[];
            }>>;
        };
        drafts: {
            create(params: {
                userId: string;
                requestBody: Record<string, unknown>;
            }): Promise<GmailApiResponse<{
                id?: string;
                message?: {
                    id?: string;
                    threadId?: string;
                };
            }>>;
            send(params: {
                userId: string;
                requestBody: Record<string, unknown>;
            }): Promise<GmailApiResponse<{
                id?: string;
                threadId?: string;
            }>>;
        };
    };
};
export declare function getGmailClientForMailbox(engine: EmailConnectEngine, mailboxId: string): GmailClient;
export declare function downloadGmailAttachment(params: {
    engine: EmailConnectEngine;
    mailboxId: string;
    providerMessageId: string;
    providerAttachmentId: string;
}): Promise<Uint8Array>;
export declare function createGmailDraft(params: {
    engine: EmailConnectEngine;
    mailboxId: string;
    to: string;
    subject?: string | null;
    bodyText: string;
    threadId?: string | null;
    inReplyToMessageId?: string | null;
    referencesMessageId?: string | null;
}): Promise<{
    bodySha256: string;
    providerDraftId: string;
    providerDraftMessageId: string | null;
    providerThreadId: string | null;
}>;
export declare function createGmailReplyDraft(params: {
    engine: EmailConnectEngine;
    mailboxId: string;
    to: string;
    subject?: string | null;
    bodyText: string;
    threadId?: string | null;
    inReplyToMessageId?: string | null;
    referencesMessageId?: string | null;
}): Promise<{
    bodySha256: string;
    providerDraftId: string;
    providerDraftMessageId: string | null;
    providerThreadId: string | null;
}>;
export declare function sendGmailReplyDraft(params: {
    engine: EmailConnectEngine;
    mailboxId: string;
    providerDraftId: string;
}): Promise<{
    providerMessageId: string | null;
    providerThreadId: string | null;
}>;
//# sourceMappingURL=sdk.d.ts.map