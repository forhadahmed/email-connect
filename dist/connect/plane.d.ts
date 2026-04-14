import type { AuthorizationRequestInput, AuthorizationRequestSnapshot, ConnectCapabilityMode, MailboxAuthSeed, OAuthClientInput, OAuthClientRegistration, OAuthTokenGrant, ProviderEndpointUrls, ProviderKind } from '../core/types.js';
import type { EmailConnectEngine } from '../engine/email-connect-engine.js';
/**
 * The connect plane intentionally keeps one active mailbox grant per mailbox.
 *
 * That mirrors how the primary consumer (`microtms-next`) stores mailbox auth:
 * one connected app grant currently owns the mailbox row. If the project later
 * needs concurrent grants per mailbox, that extension should happen here rather
 * than leaking provider token state throughout the mail-plane services.
 */
export declare class EmailConnectConnectPlane {
    private readonly engine;
    private readonly clients;
    private readonly requests;
    private readonly codes;
    private readonly refreshTokenToMailboxId;
    private readonly tokenFailureBudget;
    constructor(engine: EmailConnectEngine);
    providerEndpoints(provider: ProviderKind, baseUrl: string): ProviderEndpointUrls;
    registerClient(input: OAuthClientInput): OAuthClientRegistration;
    listClients(provider?: ProviderKind): OAuthClientRegistration[];
    getMailboxAuth(mailboxId: string): {
        clientId: string | null;
        grantedScopes: string[];
        capabilityMode: ConnectCapabilityMode | null;
        accessToken: string;
        accessTokenExpiresAt: string | null;
        refreshTokenPresent: boolean;
        refreshTokenExpiresAt: string | null;
        revokedAt: string | null;
        lastConsentAt: string | null;
    };
    seedMailboxGrant(mailboxId: string, seed: MailboxAuthSeed | undefined): void;
    resetMailboxRuntime(mailboxId: string): void;
    createAuthorizationRequest(input: AuthorizationRequestInput): AuthorizationRequestSnapshot;
    listAuthorizationRequests(): AuthorizationRequestSnapshot[];
    getAuthorizationRequest(requestId: string): AuthorizationRequestSnapshot;
    approveAuthorizationRequest(requestId: string, options?: {
        mailboxId?: string | null;
        grantedScopes?: string[];
    }): {
        redirectUrl: string;
        code: string;
        request: AuthorizationRequestSnapshot;
    };
    denyAuthorizationRequest(requestId: string, providerError?: string, providerErrorDescription?: string | null): {
        redirectUrl: string;
        request: AuthorizationRequestSnapshot;
    };
    exchangeAuthorizationCode(params: {
        provider: ProviderKind;
        clientId: string;
        clientSecret?: string | null;
        redirectUri: string;
        code: string;
        codeVerifier?: string | null;
    }): OAuthTokenGrant;
    refreshAccessToken(params: {
        provider: ProviderKind;
        clientId: string;
        clientSecret?: string | null;
        refreshToken: string;
        scopes?: string[];
    }): OAuthTokenGrant;
    revokeToken(provider: ProviderKind, token: string): boolean;
    getUserInfo(provider: ProviderKind, accessToken: string): Record<string, unknown>;
    authorizeMailboxAccess(provider: ProviderKind, accessToken: string, operation: string): import("../core/types.js").MailboxRecord;
    private buildRedirectUrl;
    private issueTokensForMailbox;
    private shouldIssueRefreshToken;
    private buildTokenGrant;
    private requireClient;
    private assertClientSecret;
    private assertRedirectUriAllowed;
    private requirePendingRequest;
    private resolveMailboxForAuthorization;
    private maybeThrowTokenFailure;
    private syncRefreshToken;
    private findMailboxByCurrentToken;
    private findMailboxByRefreshToken;
    private clientKey;
    private cloneClient;
    private cloneRequest;
}
//# sourceMappingURL=plane.d.ts.map