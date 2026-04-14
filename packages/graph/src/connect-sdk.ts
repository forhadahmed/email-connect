import { EmailConnectEngine, type ConnectCapabilityMode, type OAuthClientInput } from '@email-connect/core';
import {
  approveOAuthAuthorization,
  beginOAuthAuthorization,
  denyOAuthAuthorization,
  exchangeAuthorizationCode,
  refreshAuthorizationGrant,
  registerOAuthClient,
} from '@email-connect/core';

export function registerGraphOAuthClient(
  engine: EmailConnectEngine,
  input: Omit<OAuthClientInput, 'provider'>,
) {
  return registerOAuthClient(engine, {
    ...input,
    provider: 'graph',
  });
}

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

export function approveGraphAuthorization(params: {
  engine: EmailConnectEngine;
  requestId: string;
  mailboxId?: string | null;
  grantedScopes?: string[];
}) {
  return approveOAuthAuthorization(params);
}

export function denyGraphAuthorization(params: {
  engine: EmailConnectEngine;
  requestId: string;
  providerError?: string;
  providerErrorDescription?: string;
}) {
  return denyOAuthAuthorization(params);
}

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
