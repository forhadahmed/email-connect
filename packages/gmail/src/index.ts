import { EmailConnectEngine, EmailConnectHttpServer, type EmailConnectEngineOptions } from '@email-connect/core';
import { gmailProvider } from './provider.js';

export { gmailProvider } from './provider.js';
export { getGmailClientForMailbox, downloadGmailAttachment, createGmailDraft, createGmailReplyDraft, sendGmailReplyDraft } from './sdk.js';
export {
  registerGmailOAuthClient,
  beginGmailAuthorization,
  approveGmailAuthorization,
  denyGmailAuthorization,
  exchangeGmailAuthorizationCode,
  refreshGmailAuthorization,
  revokeGmailAuthorization,
} from './connect-sdk.js';
export type * from './service.js';

/**
 * Convenience constructor for consumers who only want the Gmail surface area.
 */
export function createGmailEngine(options?: Omit<EmailConnectEngineOptions, 'providers'> & { providers?: EmailConnectEngineOptions['providers'] }) {
  return new EmailConnectEngine({
    ...options,
    providers: [gmailProvider, ...(options?.providers || [])],
  });
}

/**
 * Convenience HTTP host for Gmail-only black-box usage.
 */
export function createGmailHttpServer(options?: {
  engine?: EmailConnectEngine;
  adminToken?: string;
}) {
  return new EmailConnectHttpServer({
    ...options,
    engine: options?.engine || createGmailEngine(),
  });
}
