import { EmailConnectEngine, EmailConnectHttpServer, type EmailConnectEngineOptions } from '@email-connect/core';
export { gmailProvider } from './provider.js';
export { getGmailClientForMailbox, downloadGmailAttachment, createGmailDraft, createGmailReplyDraft, sendGmailReplyDraft } from './sdk.js';
export { registerGmailOAuthClient, beginGmailAuthorization, approveGmailAuthorization, denyGmailAuthorization, exchangeGmailAuthorizationCode, refreshGmailAuthorization, revokeGmailAuthorization, } from './connect-sdk.js';
export type * from './service.js';
/**
 * Convenience constructor for consumers who only want the Gmail surface area.
 */
export declare function createGmailEngine(options?: Omit<EmailConnectEngineOptions, 'providers'> & {
    providers?: EmailConnectEngineOptions['providers'];
}): EmailConnectEngine;
/**
 * Convenience HTTP host for Gmail-only black-box usage.
 */
export declare function createGmailHttpServer(options?: {
    engine?: EmailConnectEngine;
    adminToken?: string;
}): EmailConnectHttpServer;
//# sourceMappingURL=index.d.ts.map