import type { ConnectCapabilityMode, OAuthClientInput } from '../../core/types.js';
import { EmailConnectEngine } from '../../engine/email-connect-engine.js';
export declare function registerGraphOAuthClient(engine: EmailConnectEngine, input: Omit<OAuthClientInput, 'provider'>): import("../../core/types.js").OAuthClientRegistration;
export declare function beginGraphAuthorization(params: {
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
}): {
    authorizationUrl: string;
    request: import("../../core/types.js").AuthorizationRequestSnapshot;
};
export declare function approveGraphAuthorization(params: {
    engine: EmailConnectEngine;
    requestId: string;
    mailboxId?: string | null;
    grantedScopes?: string[];
}): {
    redirectUrl: string;
    code: string;
    request: import("../../core/types.js").AuthorizationRequestSnapshot;
};
export declare function denyGraphAuthorization(params: {
    engine: EmailConnectEngine;
    requestId: string;
    providerError?: string;
    providerErrorDescription?: string;
}): {
    redirectUrl: string;
    request: import("../../core/types.js").AuthorizationRequestSnapshot;
};
export declare function exchangeGraphAuthorizationCode(params: {
    engine: EmailConnectEngine;
    clientId: string;
    clientSecret?: string | null;
    redirectUri: string;
    code: string;
    codeVerifier?: string | null;
}): import("../../core/types.js").OAuthTokenGrant;
export declare function refreshGraphAuthorization(params: {
    engine: EmailConnectEngine;
    clientId: string;
    clientSecret?: string | null;
    refreshToken: string;
    scopes?: string[];
}): import("../../core/types.js").OAuthTokenGrant;
//# sourceMappingURL=connect-sdk.d.ts.map