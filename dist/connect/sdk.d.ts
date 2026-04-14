import type { AuthorizationRequestSnapshot, ConnectCapabilityMode, OAuthClientInput, OAuthTokenGrant, ProviderKind } from '../core/types.js';
import { EmailConnectEngine } from '../engine/email-connect-engine.js';
export declare function registerOAuthClient(engine: EmailConnectEngine, input: OAuthClientInput): import("../core/types.js").OAuthClientRegistration;
export declare function beginOAuthAuthorization(params: {
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
}): {
    authorizationUrl: string;
    request: AuthorizationRequestSnapshot;
};
export declare function approveOAuthAuthorization(params: {
    engine: EmailConnectEngine;
    requestId: string;
    mailboxId?: string | null;
    grantedScopes?: string[];
}): {
    redirectUrl: string;
    code: string;
    request: AuthorizationRequestSnapshot;
};
export declare function denyOAuthAuthorization(params: {
    engine: EmailConnectEngine;
    requestId: string;
    providerError?: string;
    providerErrorDescription?: string;
}): {
    redirectUrl: string;
    request: AuthorizationRequestSnapshot;
};
export declare function exchangeAuthorizationCode(params: {
    engine: EmailConnectEngine;
    provider: ProviderKind;
    clientId: string;
    clientSecret?: string | null;
    redirectUri: string;
    code: string;
    codeVerifier?: string | null;
}): OAuthTokenGrant;
export declare function refreshAuthorizationGrant(params: {
    engine: EmailConnectEngine;
    provider: ProviderKind;
    clientId: string;
    clientSecret?: string | null;
    refreshToken: string;
    scopes?: string[];
}): OAuthTokenGrant;
export declare function revokeAuthorizationToken(params: {
    engine: EmailConnectEngine;
    provider: ProviderKind;
    token: string;
}): boolean;
//# sourceMappingURL=sdk.d.ts.map