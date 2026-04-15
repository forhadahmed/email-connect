import { EmailConnectEngine, type ConnectCapabilityMode, type OAuthClientInput } from '@email-connect/core';
import {
  approveOAuthAuthorization,
  beginOAuthAuthorization,
  denyOAuthAuthorization,
  exchangeAuthorizationCode,
  refreshAuthorizationGrant,
  registerOAuthClient,
} from '@email-connect/core';

// Keep the provider-specific connect SDK deliberately thin. These wrappers
// expose Microsoft-shaped entrypoints without re-implementing the canonical
// OAuth lifecycle outside core.
export function registerGraphOAuthClient(
  engine: EmailConnectEngine,
  input: Omit<OAuthClientInput, 'provider'>,
) {
  return registerOAuthClient(engine, {
    ...input,
    provider: 'graph',
  });
}

// Start a Microsoft-shaped white-box authorization flow, including the Graph
// scope bundle and tenant-shaped endpoints exposed by the provider package.
export function beginGraphAuthorization(params: {
  engine: EmailConnectEngine;
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  state?: string | null;
  scopes?: string[];
  capabilityMode?: ConnectCapabilityMode;
  accessType?: 'online' | 'offline';
  includeGrantedScopes?: boolean;
  prompt?: string | null;
  loginHint?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: 'plain' | 'S256' | null;
  mailboxId?: string | null;
}) {
  return beginOAuthAuthorization({
    ...params,
    provider: 'graph',
  });
}

// Approve a pending Graph consent request without rendering the browser page.
export function approveGraphAuthorization(params: {
  engine: EmailConnectEngine;
  requestId: string;
  mailboxId?: string | null;
  grantedScopes?: string[];
}) {
  return approveOAuthAuthorization(params);
}

// Deny a pending Graph consent request with Microsoft-style callback errors.
export function denyGraphAuthorization(params: {
  engine: EmailConnectEngine;
  requestId: string;
  providerError?: string;
  providerErrorDescription?: string;
}) {
  return denyOAuthAuthorization(params);
}

// Exchange a Graph auth code through the shared core OAuth state machine.
export function exchangeGraphAuthorizationCode(params: {
  engine: EmailConnectEngine;
  clientId: string;
  clientSecret?: string | null;
  redirectUri: string;
  code: string;
  codeVerifier?: string | null;
}) {
  return exchangeAuthorizationCode({
    ...params,
    provider: 'graph',
  });
}

// Refresh a Graph mailbox grant, including Microsoft-style refresh-token
// rotation when the provider semantics require it.
export function refreshGraphAuthorization(params: {
  engine: EmailConnectEngine;
  clientId: string;
  clientSecret?: string | null;
  refreshToken: string;
  scopes?: string[];
}) {
  return refreshAuthorizationGrant({
    ...params,
    provider: 'graph',
  });
}
