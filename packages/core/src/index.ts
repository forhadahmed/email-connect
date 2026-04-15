export { EmailConnectEngine, type EmailConnectEngineOptions } from './engine/email-connect-engine.js';
export { EmailConnectHttpServer } from './server/index.js';
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
export { EmailConnectError, ConflictError, NotFoundError, UnauthorizedError } from './errors.js';
export { encodeBase64Url, encodeBytesBase64, encodeBytesBase64Url, decodeBase64ToBytes, decodeBase64UrlToBytes, bytesFromUnknown } from './utils/base64.js';
export { parseRawEmailBase64, parseRawEmailBase64Url, renderRawEmail, normalizeAddressInput } from './utils/raw-email.js';
export type * from './types.js';
export type * from './provider.js';
