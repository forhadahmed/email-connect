import type {
  AuthorizationRequestSnapshot,
  ConnectCapabilityMode,
  OAuthClientInput,
  OAuthTokenGrant,
  ProviderKind,
} from '../core/types.js';
import { defaultScopesForCapabilityMode } from './capabilities.js';
import { EmailConnectEngine } from '../engine/email-connect-engine.js';

function buildAuthorizationUrl(params: {
  authorizeUrl: string;
  provider: ProviderKind;
  clientId: string;
  redirectUri: string;
  state?: string | null;
  scopes: string[];
  capabilityMode: ConnectCapabilityMode;
  accessType: 'online' | 'offline';
  includeGrantedScopes?: boolean;
  prompt?: string | null;
  loginHint?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: 'plain' | 'S256' | null;
}): string {
  const url = new URL(params.authorizeUrl);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('email_connect_mode', params.capabilityMode);
  if (params.provider === 'gmail') {
    url.searchParams.set('access_type', params.accessType);
    if (params.includeGrantedScopes) {
      url.searchParams.set('include_granted_scopes', 'true');
    }
  }
  if (params.state) url.searchParams.set('state', params.state);
  if (params.prompt) url.searchParams.set('prompt', params.prompt);
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint);
  if (params.codeChallenge) url.searchParams.set('code_challenge', params.codeChallenge);
  if (params.codeChallengeMethod) url.searchParams.set('code_challenge_method', params.codeChallengeMethod);
  return url.toString();
}

export function registerOAuthClient(engine: EmailConnectEngine, input: OAuthClientInput) {
  return engine.connect.registerClient(input);
}

export function beginOAuthAuthorization(params: {
  engine: EmailConnectEngine;
  provider: ProviderKind;
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
}): { authorizationUrl: string; request: AuthorizationRequestSnapshot } {
  const capabilityMode = params.capabilityMode || 'send';
  const scopes = params.scopes || defaultScopesForCapabilityMode(params.provider, capabilityMode);
  const accessType =
    params.accessType ||
    (params.provider === 'graph' && scopes.some((scope) => scope.toLowerCase() === 'offline_access')
      ? 'offline'
      : params.provider === 'gmail'
        ? 'offline'
        : 'online');
  const endpoints = params.engine.connect.providerEndpoints(params.provider, params.baseUrl);
  const request = params.engine.connect.createAuthorizationRequest({
    provider: params.provider,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    requestedScopes: scopes,
    ...(params.includeGrantedScopes !== undefined ? { includeGrantedScopes: params.includeGrantedScopes } : {}),
    capabilityMode,
    accessType,
    ...(params.state !== undefined ? { state: params.state } : {}),
    ...(params.prompt !== undefined ? { prompt: params.prompt } : {}),
    ...(params.loginHint !== undefined ? { loginHint: params.loginHint } : {}),
    ...(params.codeChallenge !== undefined ? { codeChallenge: params.codeChallenge } : {}),
    ...(params.codeChallengeMethod !== undefined ? { codeChallengeMethod: params.codeChallengeMethod } : {}),
    ...(params.mailboxId !== undefined ? { mailboxId: params.mailboxId } : {}),
  });
  return {
    authorizationUrl: buildAuthorizationUrl({
      authorizeUrl: endpoints.authorizeUrl,
      provider: params.provider,
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      scopes,
      capabilityMode,
      accessType,
      ...(params.includeGrantedScopes !== undefined ? { includeGrantedScopes: params.includeGrantedScopes } : {}),
      ...(params.state !== undefined ? { state: params.state } : {}),
      ...(params.prompt !== undefined ? { prompt: params.prompt } : {}),
      ...(params.loginHint !== undefined ? { loginHint: params.loginHint } : {}),
      ...(params.codeChallenge !== undefined ? { codeChallenge: params.codeChallenge } : {}),
      ...(params.codeChallengeMethod !== undefined ? { codeChallengeMethod: params.codeChallengeMethod } : {}),
    }),
    request,
  };
}

export function approveOAuthAuthorization(params: {
  engine: EmailConnectEngine;
  requestId: string;
  mailboxId?: string | null;
  grantedScopes?: string[];
}) {
  return params.engine.connect.approveAuthorizationRequest(params.requestId, {
    ...(params.mailboxId != null ? { mailboxId: params.mailboxId } : {}),
    ...(params.grantedScopes ? { grantedScopes: params.grantedScopes } : {}),
  });
}

export function denyOAuthAuthorization(params: {
  engine: EmailConnectEngine;
  requestId: string;
  providerError?: string;
  providerErrorDescription?: string;
}) {
  return params.engine.connect.denyAuthorizationRequest(
    params.requestId,
    params.providerError,
    params.providerErrorDescription,
  );
}

export function exchangeAuthorizationCode(params: {
  engine: EmailConnectEngine;
  provider: ProviderKind;
  clientId: string;
  clientSecret?: string | null;
  redirectUri: string;
  code: string;
  codeVerifier?: string | null;
}): OAuthTokenGrant {
  return params.engine.connect.exchangeAuthorizationCode({
    provider: params.provider,
    clientId: params.clientId,
    ...(params.clientSecret != null ? { clientSecret: params.clientSecret } : {}),
    redirectUri: params.redirectUri,
    code: params.code,
    ...(params.codeVerifier != null ? { codeVerifier: params.codeVerifier } : {}),
  });
}

export function refreshAuthorizationGrant(params: {
  engine: EmailConnectEngine;
  provider: ProviderKind;
  clientId: string;
  clientSecret?: string | null;
  refreshToken: string;
  scopes?: string[];
}): OAuthTokenGrant {
  return params.engine.connect.refreshAccessToken({
    provider: params.provider,
    clientId: params.clientId,
    ...(params.clientSecret != null ? { clientSecret: params.clientSecret } : {}),
    refreshToken: params.refreshToken,
    ...(params.scopes ? { scopes: params.scopes } : {}),
  });
}

export function revokeAuthorizationToken(params: {
  engine: EmailConnectEngine;
  provider: ProviderKind;
  token: string;
}): boolean {
  return params.engine.connect.revokeToken(params.provider, params.token);
}
