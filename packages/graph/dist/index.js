import { EmailConnectEngine, EmailConnectHttpServer } from '@email-connect/core';
import { graphProvider } from './provider.js';
export { graphProvider } from './provider.js';
export { getOutlookGraphClientForMailbox, downloadOutlookAttachment, createOutlookDraft, createOutlookReplyDraft, sendOutlookReplyDraft } from './sdk.js';
export { registerGraphOAuthClient, beginGraphAuthorization, approveGraphAuthorization, denyGraphAuthorization, exchangeGraphAuthorizationCode, refreshGraphAuthorization, } from './connect-sdk.js';
/**
 * Convenience constructor for consumers who only want the Graph surface area.
 */
export function createGraphEngine(options) {
    return new EmailConnectEngine({
        ...options,
        providers: [graphProvider, ...(options?.providers || [])],
    });
}
/**
 * Convenience HTTP host for Graph-only black-box usage.
 */
export function createGraphHttpServer(options) {
    return new EmailConnectHttpServer({
        ...options,
        engine: options?.engine || createGraphEngine(),
    });
}
//# sourceMappingURL=index.js.map