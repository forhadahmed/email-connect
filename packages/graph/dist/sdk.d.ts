import { EmailConnectEngine } from '@email-connect/core';
export type GraphRequestLike = {
    header(name: string, value: string): GraphRequestLike;
    get(): Promise<any>;
    post(body?: unknown): Promise<any>;
    patch(body: Record<string, unknown>): Promise<any>;
    delete(): Promise<void>;
};
export type OutlookGraphClientLike = {
    api(path: string): GraphRequestLike;
};
export declare function getOutlookGraphClientForMailbox(engine: EmailConnectEngine, mailboxId: string): {
    client: OutlookGraphClientLike;
};
export declare function downloadOutlookAttachment(params: {
    engine: EmailConnectEngine;
    mailboxId: string;
    providerMessageId: string;
    providerAttachmentId: string;
}): Promise<Uint8Array>;
export declare function createOutlookReplyDraft(params: {
    engine: EmailConnectEngine;
    mailboxId: string;
    providerMessageId: string;
    subject?: string | null;
    bodyText: string;
}): Promise<{
    providerDraftId: string;
    providerDraftMessageId: string;
    providerThreadId: string | null;
}>;
export declare function sendOutlookReplyDraft(params: {
    engine: EmailConnectEngine;
    mailboxId: string;
    providerDraftId: string;
}): Promise<{
    providerMessageId: string | null;
    providerThreadId: string | null;
}>;
export declare function createOutlookDraft(params: {
    engine: EmailConnectEngine;
    mailboxId: string;
    to: string;
    subject?: string | null;
    bodyText: string;
}): Promise<{
    providerDraftId: string;
    providerDraftMessageId: string;
    providerThreadId: string | null;
}>;
//# sourceMappingURL=sdk.d.ts.map