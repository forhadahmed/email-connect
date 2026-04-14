import { EmailConnectEngine, EmailConnectHttpServer } from '@email-connect/core';
import { gmailProvider } from './provider.js';
export { gmailProvider } from './provider.js';
export { getGmailClientForMailbox, downloadGmailAttachment, createGmailDraft, createGmailReplyDraft, sendGmailReplyDraft } from './sdk.js';
export { registerGmailOAuthClient, beginGmailAuthorization, approveGmailAuthorization, denyGmailAuthorization, exchangeGmailAuthorizationCode, refreshGmailAuthorization, revokeGmailAuthorization, } from './connect-sdk.js';
/**
 * Convenience constructor for consumers who only want the Gmail surface area.
 */
export function createGmailEngine(options) {
    return new EmailConnectEngine({
        ...options,
        providers: [gmailProvider, ...(options?.providers || [])],
    });
}
/**
 * Convenience HTTP host for Gmail-only black-box usage.
 */
export function createGmailHttpServer(options) {
    return new EmailConnectHttpServer({
        ...options,
        engine: options?.engine || createGmailEngine(),
    });
}
//# sourceMappingURL=index.js.map