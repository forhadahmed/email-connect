import { createHash } from 'node:crypto';
import { ConflictError, NotFoundError, UnauthorizedError } from '../core/errors.js';
import { defaultScopesForCapabilityMode, isOperationAuthorized, normalizeScopeSet } from './capabilities.js';
function cleanString(value) {
    if (value == null)
        return null;
    const normalized = String(value).trim();
    return normalized || null;
}
function normalizeDate(value) {
    if (value == null)
        return null;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return null;
    return parsed.toISOString();
}
function isoPlusSeconds(baseIso, seconds) {
    const baseMs = Date.parse(baseIso);
    return new Date(baseMs + seconds * 1000).toISOString();
}
function isoToMs(value) {
    return Date.parse(value);
}
function toSnapshot(auth) {
    return {
        clientId: auth.clientId,
        grantedScopes: [...auth.grantedScopes],
        capabilityMode: auth.capabilityMode,
        accessToken: auth.accessToken,
        accessTokenExpiresAt: auth.accessTokenExpiresAt,
        refreshTokenPresent: Boolean(auth.refreshToken),
        refreshTokenExpiresAt: auth.refreshTokenExpiresAt,
        revokedAt: auth.revokedAt,
        lastConsentAt: auth.lastConsentAt,
    };
}
function signedJwtPayload(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }), 'utf8').toString('base64url');
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${header}.${body}.email-connect`;
}
function codeChallengeMatches(challenge, method, verifier) {
    if (method === 'plain')
        return challenge === verifier;
    const encoded = createHash('sha256').update(verifier, 'utf8').digest('base64url');
    return challenge === encoded;
}
/**
 * The connect plane intentionally keeps one active mailbox grant per mailbox.
 *
 * That mirrors how the primary consumer (`microtms-next`) stores mailbox auth:
 * one connected app grant currently owns the mailbox row. If the project later
 * needs concurrent grants per mailbox, that extension should happen here rather
 * than leaking provider token state throughout the mail-plane services.
 */
export class EmailConnectConnectPlane {
    engine;
    clients = new Map();
    requests = new Map();
    codes = new Map();
    refreshTokenToMailboxId = new Map();
    tokenFailureBudget = new Map();
    constructor(engine) {
        this.engine = engine;
    }
    providerEndpoints(provider, baseUrl) {
        if (provider === 'gmail') {
            return {
                authorizeUrl: `${baseUrl}/o/oauth2/v2/auth`,
                tokenUrl: `${baseUrl}/token`,
                revokeUrl: `${baseUrl}/revoke`,
                userInfoUrl: `${baseUrl}/openidconnect/v1/userinfo`,
            };
        }
        return {
            authorizeUrl: `${baseUrl}/common/oauth2/v2.0/authorize`,
            tokenUrl: `${baseUrl}/common/oauth2/v2.0/token`,
            graphMeUrl: `${baseUrl}/graph/v1.0/me`,
        };
    }
    registerClient(input) {
        const provider = input.provider;
        const clientId = cleanString(input.clientId) || this.engine.generateId(`${provider}-client`);
        const key = this.clientKey(provider, clientId);
        if (this.clients.has(key)) {
            throw new ConflictError(`OAuth client already exists: ${provider}/${clientId}`);
        }
        const redirectUris = Array.from(new Set((input.redirectUris || [])
            .map((uri) => String(uri || '').trim())
            .filter(Boolean)));
        if (!redirectUris.length) {
            throw new ConflictError('OAuth client requires at least one redirect URI');
        }
        const registration = {
            id: this.engine.generateId(`${provider}-oauth-client`),
            provider,
            clientId,
            clientSecret: cleanString(input.clientSecret) || null,
            name: cleanString(input.name),
            redirectUris,
            defaultConsentMode: input.defaultConsentMode || 'auto_approve',
            allowPkce: input.allowPkce ?? true,
            createdAt: this.engine.nowIso(),
        };
        this.clients.set(key, registration);
        return this.cloneClient(registration);
    }
    listClients(provider) {
        return Array.from(this.clients.values())
            .filter((client) => !provider || client.provider === provider)
            .map((client) => this.cloneClient(client));
    }
    getMailboxAuth(mailboxId) {
        const mailbox = this.engine.requireMailbox(mailboxId);
        return toSnapshot(mailbox.auth);
    }
    seedMailboxGrant(mailboxId, seed) {
        const mailbox = this.engine.requireMailbox(mailboxId);
        const capabilityMode = seed?.capabilityMode || 'send';
        const grantedScopes = normalizeScopeSet(seed?.scopes || defaultScopesForCapabilityMode(mailbox.provider, capabilityMode));
        const accessToken = cleanString(seed?.accessToken) || mailbox.accessToken || this.engine.generateId('access-token');
        const refreshToken = seed && 'refreshToken' in seed ? cleanString(seed.refreshToken) : this.engine.generateId('refresh-token');
        mailbox.auth = {
            clientId: cleanString(seed?.clientId),
            grantedScopes,
            capabilityMode,
            accessToken,
            accessTokenExpiresAt: normalizeDate(seed?.accessTokenExpiresAt),
            refreshToken,
            refreshTokenExpiresAt: normalizeDate(seed?.refreshTokenExpiresAt),
            revokedAt: normalizeDate(seed?.revokedAt),
            lastConsentAt: normalizeDate(seed?.lastConsentAt),
            offlineGrantIssued: Boolean(refreshToken),
        };
        this.engine.replaceMailboxAccessToken(mailbox, accessToken);
        this.syncRefreshToken(mailbox.id, refreshToken);
        this.resetMailboxRuntime(mailbox.id);
    }
    resetMailboxRuntime(mailboxId) {
        this.tokenFailureBudget.delete(mailboxId);
    }
    createAuthorizationRequest(input) {
        const client = this.requireClient(input.provider, input.clientId);
        this.assertRedirectUriAllowed(client, input.redirectUri);
        if (input.codeChallengeMethod && !input.codeChallenge) {
            throw new ConflictError('code_challenge is required when code_challenge_method is provided');
        }
        if (input.codeChallenge && !client.allowPkce) {
            throw new ConflictError(`OAuth client does not allow PKCE: ${client.clientId}`);
        }
        const request = {
            id: this.engine.generateId(`${input.provider}-oauth-request`),
            provider: input.provider,
            clientId: client.clientId,
            redirectUri: String(input.redirectUri),
            state: cleanString(input.state),
            requestedScopes: normalizeScopeSet(input.requestedScopes.length
                ? input.requestedScopes
                : defaultScopesForCapabilityMode(input.provider, input.capabilityMode || 'send')),
            includeGrantedScopes: Boolean(input.includeGrantedScopes && input.provider === 'gmail'),
            grantedScopes: null,
            capabilityMode: input.capabilityMode || null,
            accessType: input.accessType ||
                (input.provider === 'graph' && input.requestedScopes.some((scope) => scope.toLowerCase() === 'offline_access')
                    ? 'offline'
                    : input.provider === 'gmail'
                        ? 'offline'
                        : 'online'),
            prompt: cleanString(input.prompt),
            loginHint: cleanString(input.loginHint),
            codeChallenge: cleanString(input.codeChallenge),
            codeChallengeMethod: input.codeChallengeMethod || null,
            mailboxId: cleanString(input.mailboxId),
            consentMode: client.defaultConsentMode,
            decision: 'pending',
            providerError: null,
            providerErrorDescription: null,
            createdAt: this.engine.nowIso(),
            expiresAt: isoPlusSeconds(this.engine.nowIso(), 300),
        };
        this.requests.set(request.id, request);
        return this.cloneRequest(request);
    }
    listAuthorizationRequests() {
        return Array.from(this.requests.values()).map((request) => this.cloneRequest(request));
    }
    getAuthorizationRequest(requestId) {
        const request = this.requests.get(requestId);
        if (!request)
            throw new NotFoundError(`Authorization request not found: ${requestId}`);
        return this.cloneRequest(request);
    }
    approveAuthorizationRequest(requestId, options) {
        const request = this.requirePendingRequest(requestId);
        const mailbox = this.resolveMailboxForAuthorization(request, cleanString(options?.mailboxId));
        const consentMode = mailbox.backend.connect?.consentMode || request.consentMode;
        request.consentMode = consentMode;
        // Google incremental consent can request additional scopes while keeping
        // previously granted scopes attached to the same mailbox grant. We model
        // that here at approval time because mailbox resolution is what tells us
        // which existing grant should participate in the union.
        const requestedScopes = request.includeGrantedScopes
            ? normalizeScopeSet([...mailbox.auth.grantedScopes, ...(options?.grantedScopes || request.requestedScopes)])
            : normalizeScopeSet(options?.grantedScopes || request.requestedScopes);
        const grantedScopes = requestedScopes.filter((scope) => !(mailbox.backend.connect?.dropGrantedScopes || []).map((entry) => entry.toLowerCase()).includes(scope.toLowerCase()));
        const code = this.engine.generateId(`${request.provider}-auth-code`);
        const codeTtlSec = mailbox.backend.connect?.authCodeTtlSec ?? 60;
        this.codes.set(code, {
            code,
            requestId: request.id,
            provider: request.provider,
            mailboxId: mailbox.id,
            clientId: request.clientId,
            redirectUri: request.redirectUri,
            grantedScopes,
            capabilityMode: request.capabilityMode,
            accessType: request.accessType,
            codeChallenge: request.codeChallenge,
            codeChallengeMethod: request.codeChallengeMethod,
            expiresAt: isoPlusSeconds(this.engine.nowIso(), codeTtlSec),
            usedAt: null,
            includeIdToken: grantedScopes.some((scope) => scope.toLowerCase() === 'openid'),
        });
        request.mailboxId = mailbox.id;
        request.grantedScopes = grantedScopes;
        request.decision = 'approved';
        const redirectUrl = this.buildRedirectUrl(request.redirectUri, {
            code,
            state: request.state,
        });
        return {
            redirectUrl,
            code,
            request: this.cloneRequest(request),
        };
    }
    denyAuthorizationRequest(requestId, providerError = 'access_denied', providerErrorDescription = null) {
        const request = this.requirePendingRequest(requestId);
        request.decision = 'denied';
        request.providerError = providerError;
        request.providerErrorDescription = cleanString(providerErrorDescription);
        return {
            redirectUrl: this.buildRedirectUrl(request.redirectUri, {
                error: providerError,
                errorDescription: request.providerErrorDescription,
                state: request.state,
            }),
            request: this.cloneRequest(request),
        };
    }
    exchangeAuthorizationCode(params) {
        const client = this.requireClient(params.provider, params.clientId);
        this.assertClientSecret(client, params.clientSecret);
        this.assertRedirectUriAllowed(client, params.redirectUri);
        const code = this.codes.get(params.code);
        if (!code || code.provider !== params.provider) {
            throw new UnauthorizedError('Invalid authorization code');
        }
        if (code.usedAt) {
            throw new UnauthorizedError('Authorization code already used');
        }
        if (code.clientId !== client.clientId || code.redirectUri !== params.redirectUri) {
            throw new UnauthorizedError('Authorization code client mismatch');
        }
        if (isoToMs(code.expiresAt) <= isoToMs(this.engine.nowIso())) {
            throw new UnauthorizedError('Authorization code expired');
        }
        if (code.codeChallenge) {
            const verifier = cleanString(params.codeVerifier);
            if (!verifier || !codeChallengeMatches(code.codeChallenge, code.codeChallengeMethod || 'plain', verifier)) {
                throw new UnauthorizedError('Invalid PKCE verifier');
            }
        }
        const mailbox = this.engine.requireMailbox(code.mailboxId);
        this.maybeThrowTokenFailure(mailbox.id, 'code.exchange', mailbox.backend.connect?.tokenFailureMode);
        const grant = this.issueTokensForMailbox(mailbox.id, {
            clientId: client.clientId,
            grantedScopes: code.grantedScopes,
            capabilityMode: code.capabilityMode,
            accessType: code.accessType,
            includeIdToken: code.includeIdToken,
            prompt: this.requests.get(code.requestId)?.prompt || null,
        });
        code.usedAt = this.engine.nowIso();
        return grant;
    }
    refreshAccessToken(params) {
        const client = this.requireClient(params.provider, params.clientId);
        this.assertClientSecret(client, params.clientSecret);
        const mailboxId = this.refreshTokenToMailboxId.get(params.refreshToken);
        if (!mailboxId) {
            throw new UnauthorizedError('Invalid refresh token');
        }
        const mailbox = this.engine.requireMailbox(mailboxId);
        if (mailbox.provider !== params.provider) {
            throw new UnauthorizedError('Refresh token provider mismatch');
        }
        if (mailbox.auth.clientId && mailbox.auth.clientId !== client.clientId) {
            throw new UnauthorizedError('Refresh token client mismatch');
        }
        if (mailbox.auth.revokedAt) {
            throw new UnauthorizedError('Refresh token revoked');
        }
        if (mailbox.auth.refreshToken !== params.refreshToken) {
            throw new UnauthorizedError('Refresh token superseded');
        }
        if (mailbox.auth.refreshTokenExpiresAt && isoToMs(mailbox.auth.refreshTokenExpiresAt) <= isoToMs(this.engine.nowIso())) {
            throw new UnauthorizedError('Refresh token expired');
        }
        this.maybeThrowTokenFailure(mailbox.id, 'token.refresh', mailbox.backend.connect?.tokenFailureMode);
        const grantedScopes = normalizeScopeSet(params.scopes?.length ? params.scopes : mailbox.auth.grantedScopes);
        const accessToken = this.engine.generateId(`${mailbox.provider}-access-token`);
        const accessTokenExpiresAt = isoPlusSeconds(this.engine.nowIso(), mailbox.backend.connect?.accessTokenTtlSec ?? 3600);
        const priorRefreshToken = mailbox.auth.refreshToken;
        const shouldRotateRefreshToken = mailbox.backend.connect?.rotateRefreshTokenOnRefresh ??
            (mailbox.provider === 'graph');
        const nextRefreshToken = shouldRotateRefreshToken
            ? this.engine.generateId(`${mailbox.provider}-refresh-token`)
            : priorRefreshToken;
        mailbox.auth = {
            ...mailbox.auth,
            clientId: client.clientId,
            grantedScopes,
            accessToken,
            accessTokenExpiresAt,
            refreshToken: nextRefreshToken,
            refreshTokenExpiresAt: mailbox.auth.refreshTokenExpiresAt,
        };
        this.engine.replaceMailboxAccessToken(mailbox, accessToken);
        if (shouldRotateRefreshToken && priorRefreshToken && mailbox.backend.connect?.revokePriorRefreshTokenOnRotation !== false) {
            this.refreshTokenToMailboxId.delete(priorRefreshToken);
        }
        this.syncRefreshToken(mailbox.id, nextRefreshToken);
        return this.buildTokenGrant(mailbox.id, {
            includeRefreshToken: Boolean(nextRefreshToken),
            includeIdToken: false,
        });
    }
    revokeToken(provider, token) {
        const clean = String(token || '').trim();
        if (!clean)
            return false;
        const mailbox = this.findMailboxByCurrentToken(provider, clean) || this.findMailboxByRefreshToken(provider, clean);
        if (!mailbox)
            return false;
        mailbox.auth = {
            ...mailbox.auth,
            revokedAt: this.engine.nowIso(),
        };
        this.engine.clearMailboxAccessToken(mailbox);
        if (mailbox.auth.refreshToken) {
            this.refreshTokenToMailboxId.delete(mailbox.auth.refreshToken);
        }
        return true;
    }
    getUserInfo(provider, accessToken) {
        const mailbox = this.authorizeMailboxAccess(provider, accessToken, provider === 'gmail' ? 'gmail.profile.get' : 'graph.me.get');
        if (provider === 'gmail') {
            return {
                sub: mailbox.providerUserId,
                email: mailbox.primaryEmail,
                email_verified: true,
                name: mailbox.displayName || mailbox.primaryEmail,
                picture: `https://email-connect.local/avatar/${encodeURIComponent(mailbox.primaryEmail)}`,
            };
        }
        return {
            id: mailbox.providerUserId,
            mail: mailbox.primaryEmail,
            userPrincipalName: mailbox.primaryEmail,
            displayName: mailbox.displayName || mailbox.primaryEmail,
        };
    }
    authorizeMailboxAccess(provider, accessToken, operation) {
        const mailbox = this.findMailboxByCurrentToken(provider, accessToken);
        if (!mailbox) {
            throw new UnauthorizedError('Unknown mailbox access token');
        }
        if (mailbox.auth.revokedAt) {
            throw new UnauthorizedError('Mailbox grant has been revoked');
        }
        if (mailbox.auth.accessTokenExpiresAt && isoToMs(mailbox.auth.accessTokenExpiresAt) <= isoToMs(this.engine.nowIso())) {
            throw new UnauthorizedError('Mailbox access token has expired');
        }
        if (!isOperationAuthorized(provider, mailbox.auth.grantedScopes, operation)) {
            throw new UnauthorizedError(`Mailbox token does not permit ${operation}`);
        }
        return mailbox;
    }
    buildRedirectUrl(redirectUri, params) {
        const url = new URL(redirectUri);
        if (params.code)
            url.searchParams.set('code', params.code);
        if (params.error)
            url.searchParams.set('error', params.error);
        if (params.errorDescription)
            url.searchParams.set('error_description', params.errorDescription);
        if (params.state)
            url.searchParams.set('state', params.state);
        return url.toString();
    }
    issueTokensForMailbox(mailboxId, params) {
        const mailbox = this.engine.requireMailbox(mailboxId);
        const now = this.engine.nowIso();
        const accessToken = this.engine.generateId(`${mailbox.provider}-access-token`);
        const accessTokenExpiresAt = isoPlusSeconds(now, mailbox.backend.connect?.accessTokenTtlSec ?? 3600);
        const shouldIssueRefreshToken = this.shouldIssueRefreshToken(mailboxId, {
            provider: mailbox.provider,
            accessType: params.accessType,
            prompt: params.prompt,
        });
        const refreshToken = shouldIssueRefreshToken ? this.engine.generateId(`${mailbox.provider}-refresh-token`) : mailbox.auth.refreshToken;
        const refreshTokenExpiresAt = shouldIssueRefreshToken || mailbox.auth.refreshToken
            ? isoPlusSeconds(now, mailbox.backend.connect?.refreshTokenTtlSec ?? 30 * 24 * 3600)
            : null;
        mailbox.auth = {
            ...mailbox.auth,
            clientId: params.clientId,
            grantedScopes: normalizeScopeSet(params.grantedScopes),
            capabilityMode: params.capabilityMode,
            accessToken,
            accessTokenExpiresAt,
            refreshToken,
            refreshTokenExpiresAt,
            revokedAt: null,
            lastConsentAt: now,
            offlineGrantIssued: mailbox.auth.offlineGrantIssued || shouldIssueRefreshToken,
        };
        this.engine.replaceMailboxAccessToken(mailbox, accessToken);
        this.syncRefreshToken(mailbox.id, refreshToken);
        return this.buildTokenGrant(mailbox.id, {
            includeRefreshToken: shouldIssueRefreshToken,
            includeIdToken: params.includeIdToken,
        });
    }
    shouldIssueRefreshToken(mailboxId, params) {
        const mailbox = this.engine.requireMailbox(mailboxId);
        const configured = mailbox.backend.connect?.omitRefreshToken || 'never';
        if (configured === 'always')
            return false;
        if (configured === 'once') {
            mailbox.backend = {
                ...mailbox.backend,
                connect: {
                    ...mailbox.backend.connect,
                    omitRefreshToken: 'never',
                },
            };
            return false;
        }
        if (params.provider === 'gmail') {
            if (params.accessType !== 'offline')
                return false;
            if (!mailbox.auth.offlineGrantIssued)
                return true;
            return String(params.prompt || '').toLowerCase().includes('consent');
        }
        return (params.accessType === 'offline' ||
            normalizeScopeSet(mailbox.auth.grantedScopes).some((scope) => scope.toLowerCase() === 'offline_access'));
    }
    buildTokenGrant(mailboxId, options) {
        const mailbox = this.engine.requireMailbox(mailboxId);
        const nowMs = isoToMs(this.engine.nowIso());
        const expiresAt = mailbox.auth.accessTokenExpiresAt ? isoToMs(mailbox.auth.accessTokenExpiresAt) : nowMs + 3600_000;
        const expiresIn = Math.max(1, Math.floor((expiresAt - nowMs) / 1000));
        return {
            provider: mailbox.provider,
            mailboxId: mailbox.id,
            accessToken: mailbox.auth.accessToken,
            tokenType: 'Bearer',
            expiresIn,
            grantedScopes: [...mailbox.auth.grantedScopes],
            capabilityMode: mailbox.auth.capabilityMode,
            ...(options.includeRefreshToken && mailbox.auth.refreshToken ? { refreshToken: mailbox.auth.refreshToken } : {}),
            ...(mailbox.auth.refreshTokenExpiresAt ? { refreshTokenExpiresAt: mailbox.auth.refreshTokenExpiresAt } : {}),
            ...(options.includeIdToken
                ? {
                    idToken: signedJwtPayload({
                        sub: mailbox.providerUserId,
                        email: mailbox.primaryEmail,
                        name: mailbox.displayName || mailbox.primaryEmail,
                        iss: mailbox.provider === 'gmail' ? 'https://accounts.google.com' : 'https://login.microsoftonline.com/common/v2.0',
                        aud: mailbox.auth.clientId,
                    }),
                }
                : {}),
        };
    }
    requireClient(provider, clientId) {
        const client = this.clients.get(this.clientKey(provider, clientId));
        if (!client) {
            throw new UnauthorizedError(`Unknown OAuth client: ${provider}/${clientId}`);
        }
        return client;
    }
    assertClientSecret(client, candidate) {
        if (!client.clientSecret)
            return;
        if (cleanString(candidate) !== client.clientSecret) {
            throw new UnauthorizedError('Invalid client secret');
        }
    }
    assertRedirectUriAllowed(client, redirectUri) {
        const normalized = String(redirectUri || '').trim();
        if (!normalized || !client.redirectUris.includes(normalized)) {
            throw new UnauthorizedError('Redirect URI is not registered for this client');
        }
    }
    requirePendingRequest(requestId) {
        const request = this.requests.get(requestId);
        if (!request) {
            throw new NotFoundError(`Authorization request not found: ${requestId}`);
        }
        if (request.decision !== 'pending') {
            throw new ConflictError(`Authorization request is already ${request.decision}`);
        }
        if (isoToMs(request.expiresAt) <= isoToMs(this.engine.nowIso())) {
            throw new UnauthorizedError('Authorization request expired');
        }
        return request;
    }
    resolveMailboxForAuthorization(request, explicitMailboxId) {
        if (explicitMailboxId) {
            const mailbox = this.engine.requireMailbox(explicitMailboxId);
            if (mailbox.provider !== request.provider) {
                throw new ConflictError(`Mailbox provider mismatch for request ${request.id}`);
            }
            return mailbox;
        }
        if (request.mailboxId) {
            const mailbox = this.engine.requireMailbox(request.mailboxId);
            if (mailbox.provider !== request.provider) {
                throw new ConflictError(`Mailbox provider mismatch for request ${request.id}`);
            }
            return mailbox;
        }
        if (request.loginHint) {
            const hint = request.loginHint.toLowerCase();
            const matches = this.engine
                .listMailboxes()
                .filter((mailbox) => mailbox.provider === request.provider)
                .filter((mailbox) => {
                return (mailbox.id.toLowerCase() === hint ||
                    (mailbox.alias || '').toLowerCase() === hint ||
                    mailbox.primaryEmail.toLowerCase() === hint ||
                    mailbox.providerUserId.toLowerCase() === hint);
            });
            const [onlyMatch] = matches;
            if (onlyMatch && matches.length === 1)
                return this.engine.requireMailbox(onlyMatch.id);
        }
        const providerMailboxes = this.engine.listMailboxes().filter((mailbox) => mailbox.provider === request.provider);
        const [onlyMailbox] = providerMailboxes;
        if (onlyMailbox && providerMailboxes.length === 1) {
            return this.engine.requireMailbox(onlyMailbox.id);
        }
        if (!providerMailboxes.length) {
            throw new NotFoundError(`No ${request.provider} mailbox is available for authorization`);
        }
        throw new ConflictError(`Authorization request requires mailbox selection for ${request.provider}; supply login_hint or mailboxId`);
    }
    maybeThrowTokenFailure(mailboxId, operation, mode) {
        if (!mode)
            return;
        const mailbox = this.engine.requireMailbox(mailboxId);
        const operations = (mailbox.backend.connect?.tokenFailureOperations || []).map((entry) => entry.toLowerCase());
        if (operations.length && !operations.includes(operation.toLowerCase()))
            return;
        const remaining = this.tokenFailureBudget.get(mailboxId) ?? mailbox.backend.connect?.tokenFailureHits ?? 0;
        if (remaining <= 0)
            return;
        this.tokenFailureBudget.set(mailboxId, remaining - 1);
        if (mode === 'temporarily_unavailable') {
            const error = new Error('temporarily_unavailable');
            Object.assign(error, { statusCode: 503, code: 'temporarily_unavailable' });
            throw error;
        }
        if (mode === 'invalid_client')
            throw new UnauthorizedError('Invalid client');
        if (mode === 'invalid_scope')
            throw new UnauthorizedError('Invalid scope');
        throw new UnauthorizedError('Invalid grant');
    }
    syncRefreshToken(mailboxId, refreshToken) {
        for (const [token, ownerMailboxId] of this.refreshTokenToMailboxId.entries()) {
            if (ownerMailboxId === mailboxId)
                this.refreshTokenToMailboxId.delete(token);
        }
        if (refreshToken) {
            this.refreshTokenToMailboxId.set(refreshToken, mailboxId);
        }
    }
    findMailboxByCurrentToken(provider, token) {
        try {
            const mailbox = this.engine.resolveMailboxByAccessToken(provider, token);
            if (mailbox.auth.accessToken !== token)
                return null;
            return mailbox;
        }
        catch {
            return null;
        }
    }
    findMailboxByRefreshToken(provider, refreshToken) {
        const mailboxId = this.refreshTokenToMailboxId.get(refreshToken);
        if (!mailboxId)
            return null;
        const mailbox = this.engine.requireMailbox(mailboxId);
        if (mailbox.provider !== provider)
            return null;
        if (mailbox.auth.refreshToken !== refreshToken)
            return null;
        return mailbox;
    }
    clientKey(provider, clientId) {
        return `${provider}:${clientId}`;
    }
    cloneClient(client) {
        return {
            ...client,
            redirectUris: [...client.redirectUris],
        };
    }
    cloneRequest(request) {
        return {
            ...request,
            requestedScopes: [...request.requestedScopes],
            grantedScopes: request.grantedScopes ? [...request.grantedScopes] : null,
        };
    }
}
//# sourceMappingURL=plane.js.map