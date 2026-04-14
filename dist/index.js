import { EmailConnectEngine as CoreEmailConnectEngine, } from '@email-connect/core';
import { gmailProvider } from '@email-connect/gmail';
import { graphProvider } from '@email-connect/graph';
export { loadScenario, createArrayTemplateSource, createCallbackTemplateSource, generateMailboxEmails, registerOAuthClient, beginOAuthAuthorization, approveOAuthAuthorization, denyOAuthAuthorization, exchangeAuthorizationCode, refreshAuthorizationGrant, revokeAuthorizationToken, } from '@email-connect/core';
export { getGmailClientForMailbox, downloadGmailAttachment, createGmailDraft, createGmailReplyDraft, sendGmailReplyDraft, registerGmailOAuthClient, beginGmailAuthorization, approveGmailAuthorization, denyGmailAuthorization, exchangeGmailAuthorizationCode, refreshGmailAuthorization, revokeGmailAuthorization, createGmailEngine, createGmailHttpServer, gmailProvider, } from '@email-connect/gmail';
export { getOutlookGraphClientForMailbox, downloadOutlookAttachment, createOutlookDraft, createOutlookReplyDraft, sendOutlookReplyDraft, registerGraphOAuthClient, beginGraphAuthorization, approveGraphAuthorization, denyGraphAuthorization, exchangeGraphAuthorizationCode, refreshGraphAuthorization, createGraphEngine, createGraphHttpServer, graphProvider, } from '@email-connect/graph';
/**
 * The root package is the convenience "both providers included" product.
 *
 * Provider-specific packages can be sold and consumed independently, but the
 * top-level `email-connect` package preserves the zero-config path that the
 * repo used before the split.
 */
export class EmailConnectEngine extends CoreEmailConnectEngine {
    constructor(options) {
        super({
            ...options,
            providers: [gmailProvider, graphProvider, ...(options?.providers || [])],
        });
    }
}
//# sourceMappingURL=index.js.map