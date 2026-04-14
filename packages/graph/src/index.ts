import { EmailConnectEngine, EmailConnectHttpServer, type EmailConnectEngineOptions } from '@email-connect/core';
import { graphProvider } from './provider.js';

export { graphProvider } from './provider.js';
export { getOutlookGraphClientForMailbox, downloadOutlookAttachment, createOutlookDraft, createOutlookReplyDraft, sendOutlookReplyDraft } from './sdk.js';
export {
  registerGraphOAuthClient,
  beginGraphAuthorization,
  approveGraphAuthorization,
  denyGraphAuthorization,
  exchangeGraphAuthorizationCode,
  refreshGraphAuthorization,
} from './connect-sdk.js';
export type * from './service.js';

/**
 * Convenience constructor for consumers who only want the Graph surface area.
 */
export function createGraphEngine(options?: Omit<EmailConnectEngineOptions, 'providers'> & { providers?: EmailConnectEngineOptions['providers'] }) {
  return new EmailConnectEngine({
    ...options,
    providers: [graphProvider, ...(options?.providers || [])],
  });
}

/**
 * Convenience HTTP host for Graph-only black-box usage.
 */
export function createGraphHttpServer(options?: {
  engine?: EmailConnectEngine;
  adminToken?: string;
}) {
  return new EmailConnectHttpServer({
    ...options,
    engine: options?.engine || createGraphEngine(),
  });
}
