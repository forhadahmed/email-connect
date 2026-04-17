/**
 * `@email-connect/core` is the provider-neutral foundation package.
 *
 * If you are composing your own install shape, this is the package that owns:
 * - the in-memory engine and HTTP host
 * - scenario loading and deterministic mailbox generation
 * - the provider-agnostic OAuth/connect lifecycle
 * - shared utilities such as raw-message rendering/parsing
 *
 * Provider packages layer Gmail- or Graph-specific semantics on top of these
 * exports rather than bypassing them.
 */
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
// Utility exports are intentionally kept small and practical. They exist to
// support provider mocks and higher-level tests, not to become a general
// purpose mail-processing toolkit.
export { encodeBase64Url, encodeBytesBase64, encodeBytesBase64Url, decodeBase64ToBytes, decodeBase64UrlToBytes, bytesFromUnknown } from './utils/base64.js';
export { parseRawEmailBase64, parseRawEmailBase64Url, renderRawEmail, normalizeAddressInput } from './utils/raw-email.js';
export type * from './types.js';
export type * from './provider.js';
