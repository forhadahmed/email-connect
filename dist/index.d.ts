import { EmailConnectEngine as CoreEmailConnectEngine, type EmailConnectEngineOptions } from '@email-connect/core';
export { loadScenario, createArrayTemplateSource, createCallbackTemplateSource, generateMailboxEmails, registerOAuthClient, beginOAuthAuthorization, approveOAuthAuthorization, denyOAuthAuthorization, exchangeAuthorizationCode, refreshAuthorizationGrant, revokeAuthorizationToken, } from '@email-connect/core';
export { getGmailClientForMailbox, downloadGmailAttachment, createGmailDraft, createGmailReplyDraft, sendGmailReplyDraft, registerGmailOAuthClient, beginGmailAuthorization, approveGmailAuthorization, denyGmailAuthorization, exchangeGmailAuthorizationCode, refreshGmailAuthorization, revokeGmailAuthorization, createGmailEngine, createGmailHttpServer, gmailProvider, } from '@email-connect/gmail';
export { getOutlookGraphClientForMailbox, downloadOutlookAttachment, createOutlookDraft, createOutlookReplyDraft, sendOutlookReplyDraft, registerGraphOAuthClient, beginGraphAuthorization, approveGraphAuthorization, denyGraphAuthorization, exchangeGraphAuthorizationCode, refreshGraphAuthorization, createGraphEngine, createGraphHttpServer, graphProvider, } from '@email-connect/graph';
export type * from '@email-connect/core';
/**
 * The root package is the convenience "both providers included" product.
 *
 * Provider-specific packages can be sold and consumed independently, but the
 * top-level `email-connect` package preserves the zero-config path that the
 * repo used before the split.
 */
export declare class EmailConnectEngine extends CoreEmailConnectEngine {
    constructor(options?: Omit<EmailConnectEngineOptions, 'providers'> & {
        providers?: EmailConnectEngineOptions['providers'];
    });
}
//# sourceMappingURL=index.d.ts.map