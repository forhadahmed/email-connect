import {
  EmailConnectEngine as CoreEmailConnectEngine,
  type EmailConnectEngineOptions,
} from '@email-connect/core';
import { gmailProvider } from '@email-connect/gmail';
import { graphProvider } from '@email-connect/graph';

/**
 * The root `email-connect` package is the shortest-path install for developers
 * who want both providers without explicit composition.
 *
 * It re-exports the high-value combined surface from `@email-connect/core`,
 * `@email-connect/gmail`, and `@email-connect/graph`, then installs both
 * providers by default in the root engine below.
 */
export {
  loadScenario,
  createArrayTemplateSource,
  createCallbackTemplateSource,
  generateMailboxEmails,
  registerOAuthClient,
  beginOAuthAuthorization,
  approveOAuthAuthorization,
  denyOAuthAuthorization,
  exchangeAuthorizationCode,
  refreshAuthorizationGrant,
  revokeAuthorizationToken,
} from '@email-connect/core';
export {
  getGmailClientForMailbox,
  downloadGmailAttachment,
  createGmailDraft,
  createGmailReplyDraft,
  sendGmailReplyDraft,
  registerGmailOAuthClient,
  beginGmailAuthorization,
  approveGmailAuthorization,
  denyGmailAuthorization,
  exchangeGmailAuthorizationCode,
  refreshGmailAuthorization,
  revokeGmailAuthorization,
  createGmailEngine,
  createGmailHttpServer,
  gmailProvider,
} from '@email-connect/gmail';
export {
  getOutlookGraphClientForMailbox,
  downloadOutlookAttachment,
  createOutlookDraft,
  createOutlookReplyDraft,
  sendOutlookReplyDraft,
  registerGraphOAuthClient,
  beginGraphAuthorization,
  approveGraphAuthorization,
  denyGraphAuthorization,
  exchangeGraphAuthorizationCode,
  refreshGraphAuthorization,
  createGraphEngine,
  createGraphHttpServer,
  graphProvider,
} from '@email-connect/graph';
export type * from '@email-connect/core';

/**
 * The root package is the convenience "both providers included" product.
 *
 * Provider-specific packages can be sold and consumed independently, but the
 * top-level `email-connect` package preserves the zero-config path that the
 * repo used before the split.
 */
export class EmailConnectEngine extends CoreEmailConnectEngine {
  constructor(options?: Omit<EmailConnectEngineOptions, 'providers'> & { providers?: EmailConnectEngineOptions['providers'] }) {
    super({
      ...options,
      providers: [gmailProvider, graphProvider, ...(options?.providers || [])],
    });
  }
}
