export { EmailConnectEngine } from './engine/email-connect-engine.js';
export { loadScenario } from './control/scenario.js';
export {
  createArrayTemplateSource,
  createCallbackTemplateSource,
  generateMailboxEmails,
} from './testing/generation.js';
export {
  registerOAuthClient,
  beginOAuthAuthorization,
  approveOAuthAuthorization,
  denyOAuthAuthorization,
  exchangeAuthorizationCode,
  refreshAuthorizationGrant,
  revokeAuthorizationToken,
} from './connect/sdk.js';
export { getGmailClientForMailbox, downloadGmailAttachment, createGmailDraft, createGmailReplyDraft, sendGmailReplyDraft } from './providers/gmail/sdk.js';
export {
  registerGmailOAuthClient,
  beginGmailAuthorization,
  approveGmailAuthorization,
  denyGmailAuthorization,
  exchangeGmailAuthorizationCode,
  refreshGmailAuthorization,
  revokeGmailAuthorization,
} from './providers/gmail/connect-sdk.js';
export { getOutlookGraphClientForMailbox, downloadOutlookAttachment, createOutlookDraft, createOutlookReplyDraft, sendOutlookReplyDraft } from './providers/graph/sdk.js';
export {
  registerGraphOAuthClient,
  beginGraphAuthorization,
  approveGraphAuthorization,
  denyGraphAuthorization,
  exchangeGraphAuthorizationCode,
  refreshGraphAuthorization,
} from './providers/graph/connect-sdk.js';
export type * from './core/types.js';
