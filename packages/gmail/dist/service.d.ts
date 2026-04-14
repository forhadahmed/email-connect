import { EmailConnectEngine } from '@email-connect/core';
export type GmailApiResponse<T> = {
    data: T;
};
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
};
export type GmailHistoryRecord = {
    messages?: GmailMessageRef[];
    messagesAdded?: Array<{
        message?: GmailMessageRef;
    }>;
    messagesDeleted?: Array<{
        message?: GmailMessageRef;
    }>;
    labelsAdded?: Array<{
        message?: GmailMessageRef;
        labelIds?: string[];
    }>;
    labelsRemoved?: Array<{
        message?: GmailMessageRef;
        labelIds?: string[];
    }>;
};
export type GmailMessagePayloadHeader = {
    name?: string;
    value?: string;
};
export type GmailMessagePayload = {
    mimeType?: string;
    headers?: GmailMessagePayloadHeader[];
    filename?: string;
    body?: {
        data?: string;
        attachmentId?: string;
        size?: number;
    };
    parts?: GmailMessagePayload[];
};
export type GmailMessage = {
    id?: string;
    threadId?: string;
    payload?: GmailMessagePayload;
    labelIds?: string[];
    snippet?: string;
};
export declare function mockGmailLabelId(labelName: string): string;
export declare class GmailService {
    private readonly engine;
    constructor(engine: EmailConnectEngine);
    getProfile(mailboxId: string): Promise<GmailApiResponse<GmailProfile>>;
    listLabels(mailboxId: string): Promise<GmailApiResponse<{
        labels?: GmailLabel[];
    }>>;
    listMessages(mailboxId: string, params: {
        q?: string;
        maxResults?: number;
        pageToken?: string;
    }): Promise<GmailApiResponse<{
        messages?: GmailMessageRef[];
        nextPageToken?: string;
    }>>;
    getMessage(mailboxId: string, providerMessageId: string): Promise<GmailApiResponse<GmailMessage>>;
    getAttachment(mailboxId: string, providerMessageId: string, attachmentId: string): Promise<GmailApiResponse<{
        data?: string;
    }>>;
    listHistory(mailboxId: string, params: {
        startHistoryId: string;
        pageToken?: string;
        historyTypes?: string[];
    }): Promise<GmailApiResponse<{
        historyId?: string;
        nextPageToken?: string;
        history?: GmailHistoryRecord[];
    }>>;
    createDraft(mailboxId: string, requestBody: Record<string, unknown>): Promise<GmailApiResponse<{
        id?: string;
        message?: {
            id?: string;
            threadId?: string;
        };
    }>>;
    sendDraft(mailboxId: string, requestBody: Record<string, unknown>): Promise<GmailApiResponse<{
        id?: string;
        threadId?: string;
    }>>;
    sendMessage(mailboxId: string, requestBody: Record<string, unknown>): Promise<GmailApiResponse<{
        id?: string;
        threadId?: string;
    }>>;
    createPlainDraft(mailboxId: string, params: {
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
    }>;
    createReplyDraft(mailboxId: string, params: {
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
    }>;
}
//# sourceMappingURL=service.d.ts.map