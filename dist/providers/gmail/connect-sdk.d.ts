import type { ConnectCapabilityMode, OAuthClientInput } from '../../core/types.js';
import { EmailConnectEngine } from '../../engine/email-connect-engine.js';
export declare function registerGmailOAuthClient(engine: EmailConnectEngine, input: Omit<OAuthClientInput, 'provider'>): import("../../core/types.js").OAuthClientRegistration;
export declare function beginGmailAuthorization(params: {
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
export declare function approveGmailAuthorization(params: {
    engine: EmailConnectEngine;
    requestId: string;
    mailboxId?: string | null;
    grantedScopes?: string[];
}): {
    redirectUrl: string;
    code: string;
    request: import("../../core/types.js").AuthorizationRequestSnapshot;
};
export declare function denyGmailAuthorization(params: {
    engine: EmailConnectEngine;
    requestId: string;
    providerError?: string;
    providerErrorDescription?: string;
}): {
    redirectUrl: string;
    request: import("../../core/types.js").AuthorizationRequestSnapshot;
};
export declare function exchangeGmailAuthorizationCode(params: {
    engine: EmailConnectEngine;
    clientId: string;
    clientSecret?: string | null;
    redirectUri: string;
    code: string;
    codeVerifier?: string | null;
}): import("../../core/types.js").OAuthTokenGrant;
export declare function refreshGmailAuthorization(params: {
    engine: EmailConnectEngine;
    clientId: string;
    clientSecret?: string | null;
    refreshToken: string;
    scopes?: string[];
}): import("../../core/types.js").OAuthTokenGrant;
export declare function revokeGmailAuthorization(params: {
    engine: EmailConnectEngine;
    token: string;
}): boolean;
//# sourceMappingURL=connect-sdk.d.ts.map