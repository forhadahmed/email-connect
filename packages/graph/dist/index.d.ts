import { EmailConnectEngine, EmailConnectHttpServer, type EmailConnectEngineOptions } from '@email-connect/core';
export { graphProvider } from './provider.js';
export { getOutlookGraphClientForMailbox, downloadOutlookAttachment, createOutlookDraft, createOutlookReplyDraft, sendOutlookReplyDraft } from './sdk.js';
export { registerGraphOAuthClient, beginGraphAuthorization, approveGraphAuthorization, denyGraphAuthorization, exchangeGraphAuthorizationCode, refreshGraphAuthorization, } from './connect-sdk.js';
export type * from './service.js';
/**
 * Convenience constructor for consumers who only want the Graph surface area.
 */
export declare function createGraphEngine(options?: Omit<EmailConnectEngineOptions, 'providers'> & {
    providers?: EmailConnectEngineOptions['providers'];
}): EmailConnectEngine;
/**
 * Convenience HTTP host for Graph-only black-box usage.
 */
export declare function createGraphHttpServer(options?: {
    engine?: EmailConnectEngine;
    adminToken?: string;
}): EmailConnectHttpServer;
//# sourceMappingURL=index.d.ts.map