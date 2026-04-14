import { EmailConnectError } from '@email-connect/core';
import { defaultGraphScopesForCapabilityMode, isGraphOperationAuthorized } from './capabilities.js';
import { GraphService } from './service.js';
function graphUserInfo(mailbox) {
    return {
        id: mailbox.providerUserId,
        mail: mailbox.primaryEmail,
        userPrincipalName: mailbox.primaryEmail,
        displayName: mailbox.displayName || mailbox.primaryEmail,
    };
}
export const graphProvider = {
    id: 'graph',
    connect: {
        supportsIncrementalConsent: false,
        rotateRefreshTokenOnRefreshByDefault: true,
        providerEndpoints(baseUrl) {
            return {
                authorizeUrl: `${baseUrl}/common/oauth2/v2.0/authorize`,
                tokenUrl: `${baseUrl}/common/oauth2/v2.0/token`,
                graphMeUrl: `${baseUrl}/graph/v1.0/me`,
            };
        },
        defaultScopesForCapabilityMode(capabilityMode) {
            return defaultGraphScopesForCapabilityMode(capabilityMode);
        },
        isOperationAuthorized(scopes, operation) {
            return isGraphOperationAuthorized(scopes, operation);
        },
        buildUserInfo(mailbox) {
            return graphUserInfo(mailbox);
        },
        defaultAuthorizationErrorDescription(errorCode) {
            if (errorCode === 'access_denied')
                return 'the user canceled the authentication';
            return errorCode;
        },
        resolveAccessType(params) {
            if (params.requestedAccessType)
                return params.requestedAccessType;
            return params.requestedScopes.some((scope) => scope.toLowerCase() === 'offline_access') ? 'offline' : 'online';
        },
        shouldIssueRefreshToken(params) {
            return (params.accessType === 'offline' ||
                params.mailbox.auth.grantedScopes.some((scope) => scope.toLowerCase() === 'offline_access'));
        },
        idTokenIssuer() {
            return 'https://login.microsoftonline.com/common/v2.0';
        },
    },
    http: {
        async handle(context) {
            const { method, url } = context;
            const pathname = url.pathname;
            const service = new GraphService(context.engine);
            // Continuation links emitted by the black-box mock server must point back
            // to the mock host itself so non-JS consumers can follow them directly.
            const facadeBaseUrl = url.origin;
            const authorizeMatch = context.matchPath(pathname, /^\/([^/]+)\/oauth2\/v2\.0\/authorize$/);
            if (method === 'GET' && authorizeMatch?.[1]) {
                const responseType = String(url.searchParams.get('response_type') || 'code').trim().toLowerCase();
                if (responseType !== 'code') {
                    throw new EmailConnectError('Only response_type=code is supported', 400);
                }
                const requestedScopes = context.splitScopes(url.searchParams.get('scope'));
                const request = context.engine.connect.createAuthorizationRequest({
                    provider: 'graph',
                    clientId: String(url.searchParams.get('client_id') || ''),
                    redirectUri: String(url.searchParams.get('redirect_uri') || ''),
                    state: url.searchParams.get('state'),
                    requestedScopes,
                    capabilityMode: String(url.searchParams.get('email_connect_mode') || '').trim().toLowerCase() === 'read' ? 'read' : 'send',
                    accessType: requestedScopes.some((scope) => scope.toLowerCase() === 'offline_access') ? 'offline' : 'online',
                    prompt: url.searchParams.get('prompt'),
                    loginHint: url.searchParams.get('login_hint'),
                    codeChallenge: url.searchParams.get('code_challenge'),
                    codeChallengeMethod: String(url.searchParams.get('code_challenge_method') || '').trim().toUpperCase() === 'S256' ? 'S256' : null,
                });
                await context.completeOrRenderConsent('graph', request);
                return true;
            }
            const tokenMatch = context.matchPath(pathname, /^\/([^/]+)\/oauth2\/v2\.0\/token$/);
            if (method === 'POST' && tokenMatch?.[1]) {
                const body = await context.readFormBody();
                const grantType = String(body.grant_type || '').trim();
                if (grantType === 'authorization_code') {
                    await context.respondWithTokenGrant(() => context.engine.connect.exchangeAuthorizationCode({
                        provider: 'graph',
                        clientId: String(body.client_id || ''),
                        ...(body.client_secret != null ? { clientSecret: body.client_secret } : {}),
                        redirectUri: String(body.redirect_uri || ''),
                        code: String(body.code || ''),
                        ...(body.code_verifier != null ? { codeVerifier: body.code_verifier } : {}),
                    }));
                    return true;
                }
                if (grantType === 'refresh_token') {
                    await context.respondWithTokenGrant(() => context.engine.connect.refreshAccessToken({
                        provider: 'graph',
                        clientId: String(body.client_id || ''),
                        ...(body.client_secret != null ? { clientSecret: body.client_secret } : {}),
                        refreshToken: String(body.refresh_token || ''),
                        scopes: context.splitScopes(body.scope || null),
                    }));
                    return true;
                }
                throw new EmailConnectError(`Unsupported grant_type for Microsoft: ${grantType}`, 400);
            }
            const accessToken = pathname.startsWith('/graph/v1.0/') ? context.parseBearerToken() : null;
            if (!accessToken)
                return false;
            if (method === 'GET' && pathname === '/graph/v1.0/me') {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.me.get');
                context.sendJson(200, await service.getMe(mailbox.id));
                return true;
            }
            if (method === 'GET' && pathname === '/graph/v1.0/me/messages') {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.messages.list');
                context.sendJson(200, await service.listMessages(mailbox.id, `${pathname}${url.search}`, facadeBaseUrl));
                return true;
            }
            if (method === 'GET' && pathname === '/graph/v1.0/me/mailFolders/inbox/messages') {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.inbox.messages.list');
                context.sendJson(200, await service.listInboxMessages(mailbox.id, `${pathname}${url.search}`, facadeBaseUrl));
                return true;
            }
            if (method === 'GET' && pathname === '/graph/v1.0/me/mailFolders/inbox/messages/delta') {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.delta.get');
                context.sendJson(200, await service.delta(mailbox.id, `${pathname}${url.search}`, facadeBaseUrl));
                return true;
            }
            const messageMatch = context.matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)$/);
            if (method === 'GET' && messageMatch?.[1]) {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.message.get');
                context.sendJson(200, await service.getMessage(mailbox.id, decodeURIComponent(messageMatch[1])));
                return true;
            }
            const attachmentsListMatch = context.matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/attachments$/);
            if (method === 'GET' && attachmentsListMatch?.[1]) {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.attachments.list');
                context.sendJson(200, await service.listAttachmentsPage(mailbox.id, decodeURIComponent(attachmentsListMatch[1]), `${pathname}${url.search}`, facadeBaseUrl));
                return true;
            }
            const attachmentValueMatch = context.matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/attachments\/([^/]+)\/\$value$/);
            if (method === 'GET' && attachmentValueMatch?.[1] && attachmentValueMatch?.[2]) {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.attachment.get');
                context.sendBytes(200, await service.getAttachmentValue(mailbox.id, decodeURIComponent(attachmentValueMatch[1]), decodeURIComponent(attachmentValueMatch[2])));
                return true;
            }
            const attachmentMatch = context.matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/);
            if (method === 'GET' && attachmentMatch?.[1] && attachmentMatch?.[2]) {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.attachment.get');
                context.sendJson(200, await service.getAttachment(mailbox.id, decodeURIComponent(attachmentMatch[1]), decodeURIComponent(attachmentMatch[2])));
                return true;
            }
            const createReplyMatch = context.matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/createReply$/);
            if (method === 'POST' && createReplyMatch?.[1]) {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.reply.create');
                context.sendJson(200, await service.createReplyDraft(mailbox.id, decodeURIComponent(createReplyMatch[1])));
                return true;
            }
            if (method === 'POST' && pathname === '/graph/v1.0/me/messages') {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.draft.create');
                context.sendJson(200, await service.createDraft(mailbox.id, await context.readJsonBody()));
                return true;
            }
            const sendMatch = context.matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/send$/);
            if (method === 'POST' && sendMatch?.[1]) {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.draft.send');
                context.sendJson(200, await service.sendDraft(mailbox.id, decodeURIComponent(sendMatch[1])));
                return true;
            }
            if (method === 'PATCH' && messageMatch?.[1]) {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.draft.update');
                context.sendJson(200, await service.patchDraft(mailbox.id, decodeURIComponent(messageMatch[1]), await context.readJsonBody()));
                return true;
            }
            if (method === 'DELETE' && messageMatch?.[1]) {
                const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.message.delete');
                await service.deleteMessageResource(mailbox.id, decodeURIComponent(messageMatch[1]));
                context.sendJson(200, { success: true });
                return true;
            }
            return false;
        },
    },
};
//# sourceMappingURL=provider.js.map