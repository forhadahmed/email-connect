import { EmailConnectEngine, type ConnectCapabilityMode, type OAuthClientInput } from '@email-connect/core';
import {
  approveOAuthAuthorization,
  beginOAuthAuthorization,
  denyOAuthAuthorization,
  exchangeAuthorizationCode,
  refreshAuthorizationGrant,
  registerOAuthClient,
  revokeAuthorizationToken,
} from '@email-connect/core';

// Keep the provider-specific connect SDK deliberately thin. These helpers give
// consumers Gmail-named entrypoints while the canonical OAuth state machine
// still lives in core.
export function registerGmailOAuthClient(
  engine: EmailConnectEngine,
  input: Omit<OAuthClientInput, 'provider'>,
) {
  return registerOAuthClient(engine, {
    ...input,
    provider: 'gmail',
  });
}

// Start a Gmail-shaped white-box authorization flow, including Google-specific
// knobs such as access_type and incremental consent.
export function beginGmailAuthorization(params: {
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
    provider: 'gmail',
  });
}

// Approve a pending Gmail consent request without rendering the browser page.
export function approveGmailAuthorization(params: {
  engine: EmailConnectEngine;
  requestId: string;
  mailboxId?: string | null;
  grantedScopes?: string[];
}) {
  return approveOAuthAuthorization(params);
}

// Deny a pending Gmail consent request with Google-style callback errors.
export function denyGmailAuthorization(params: {
  engine: EmailConnectEngine;
  requestId: string;
  providerError?: string;
  providerErrorDescription?: string;
}) {
  return denyOAuthAuthorization(params);
}

// Exchange a Gmail auth code through the shared core OAuth state machine.
export function exchangeGmailAuthorizationCode(params: {
  engine: EmailConnectEngine;
  clientId: string;
  clientSecret?: string | null;
  redirectUri: string;
  code: string;
  codeVerifier?: string | null;
}) {
  return exchangeAuthorizationCode({
    ...params,
    provider: 'gmail',
  });
}

// Refresh a Gmail mailbox grant while preserving Google's refresh-token reuse
// semantics unless backend config says otherwise.
export function refreshGmailAuthorization(params: {
  engine: EmailConnectEngine;
  clientId: string;
  clientSecret?: string | null;
  refreshToken: string;
  scopes?: string[];
}) {
  return refreshAuthorizationGrant({
    ...params,
    provider: 'gmail',
  });
}

// Revoke a Gmail access or refresh token from white-box tests.
export function revokeGmailAuthorization(params: {
  engine: EmailConnectEngine;
  token: string;
}) {
  return revokeAuthorizationToken({
    ...params,
    provider: 'gmail',
  });
}
