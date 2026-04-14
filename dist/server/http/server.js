import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { EmailConnectError, UnauthorizedError } from '../../core/errors.js';
import { EmailConnectEngine } from '../../engine/email-connect-engine.js';
import { loadScenario } from '../../control/scenario.js';
import { createArrayTemplateSource, createCallbackTemplateSource, generateMailboxEmails, } from '../../testing/generation.js';
import { GmailService } from '../../providers/gmail/service.js';
import { GraphService } from '../../providers/graph/service.js';
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
async function readJsonBody(req) {
    const raw = await readBody(req);
    if (!raw.length)
        return {};
    return JSON.parse(raw.toString('utf8'));
}
async function readFormBody(req) {
    const raw = await readBody(req);
    if (!raw.length)
        return {};
    const params = new URLSearchParams(raw.toString('utf8'));
    return Object.fromEntries(params.entries());
}
function sendJson(res, statusCode, body) {
    const payload = JSON.stringify(body, null, 2);
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(payload);
}
function sendHtml(res, statusCode, body) {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(body);
}
function sendText(res, statusCode, body = '') {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(body);
}
function sendBytes(res, statusCode, bytes) {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/octet-stream');
    res.end(Buffer.from(bytes));
}
function parseBearerToken(req) {
    const header = String(req.headers.authorization || '');
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
        throw new UnauthorizedError('Missing Bearer token');
    }
    return match[1];
}
function ensureAdminToken(req, expectedToken) {
    const provided = String(req.headers['x-email-connect-admin-token'] || '').trim();
    if (!provided || provided !== expectedToken) {
        throw new UnauthorizedError('Missing or invalid admin token');
    }
}
function matchPath(pathname, pattern) {
    return pathname.match(pattern);
}
function splitScopes(raw) {
    return String(raw || '')
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);
}
function parseBooleanQuery(value) {
    return /^(1|true)$/i.test(String(value || '').trim());
}
function providerDisplayName(provider) {
    return provider === 'gmail' ? 'Google' : 'Microsoft';
}
function defaultAuthorizationErrorDescription(provider, error) {
    if (provider === 'graph' && error === 'access_denied') {
        return 'the user canceled the authentication';
    }
    if (provider === 'gmail' && error === 'access_denied') {
        return 'The user denied the request';
    }
    return error;
}
function consentPageHtml(params) {
    const options = params.availableMailboxes
        .map((mailbox) => {
        const selected = params.request.mailboxId === mailbox.id ? ' selected' : '';
        const label = mailbox.alias ? `${mailbox.alias} (${mailbox.primaryEmail})` : mailbox.primaryEmail;
        return `<option value="${mailbox.id}"${selected}>${label}</option>`;
    })
        .join('\n');
    const scopes = params.request.requestedScopes.map((scope) => `<li><code>${scope}</code></li>`).join('\n');
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${providerDisplayName(params.provider)} consent</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; line-height: 1.5; }
      main { max-width: 42rem; }
      form { margin-top: 1.5rem; }
      label, select, button { display: block; margin-top: 0.75rem; }
      code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 4px; }
      button { padding: 0.6rem 1rem; }
      .actions { display: flex; gap: 0.75rem; margin-top: 1rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>${providerDisplayName(params.provider)} mailbox consent</h1>
      <p><strong>Client:</strong> <code>${params.request.clientId}</code></p>
      <p><strong>Redirect URI:</strong> <code>${params.request.redirectUri}</code></p>
      <p><strong>Requested scopes:</strong></p>
      <ul>${scopes}</ul>
      <form method="post" action="/__email-connect/consent">
        <input type="hidden" name="provider" value="${params.provider}" />
        <input type="hidden" name="request_id" value="${params.request.id}" />
        <label for="mailbox_id">Mailbox</label>
        <select id="mailbox_id" name="mailbox_id">${options}</select>
        <div class="actions">
          <button type="submit" name="decision" value="approve">Approve</button>
          <button type="submit" name="decision" value="deny">Deny</button>
        </div>
      </form>
    </main>
  </body>
</html>`;
}
/**
 * First-class HTTP facade for polyglot users.
 *
 * The server never owns provider semantics itself. It only authenticates the
 * request, delegates into the canonical engine-backed services, and renders the
 * result as JSON or bytes.
 */
export class EmailConnectHttpServer {
    engine;
    adminToken;
    gmail;
    graph;
    server = null;
    listeningAddress = null;
    constructor(options) {
        this.engine = options?.engine || new EmailConnectEngine();
        this.adminToken = options?.adminToken || `admin_${randomBytes(16).toString('base64url')}`;
        this.gmail = new GmailService(this.engine);
        this.graph = new GraphService(this.engine);
    }
    get baseUrl() {
        if (!this.listeningAddress) {
            throw new Error('HTTP server is not listening');
        }
        return this.listeningAddress;
    }
    async listen(options) {
        if (this.server) {
            return {
                baseUrl: this.baseUrl,
                adminToken: this.adminToken,
            };
        }
        this.server = createServer((req, res) => {
            this.handle(req, res).catch((error) => {
                if (error instanceof EmailConnectError) {
                    sendJson(res, error.statusCode, { error: error.name, message: error.message });
                    return;
                }
                const message = error instanceof Error ? error.message : String(error);
                const statusCode = Number(error?.statusCode || 500);
                const code = String(error?.code || 'InternalError');
                const body = error?.body;
                sendJson(res, statusCode, body || { error: code, message });
            });
        });
        const host = options?.host || '127.0.0.1';
        const port = options?.port ?? 0;
        await new Promise((resolve, reject) => {
            this.server?.once('error', reject);
            this.server?.listen(port, host, () => resolve());
        });
        const address = this.server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Could not determine listening address');
        }
        this.listeningAddress = `http://${host}:${address.port}`;
        return {
            baseUrl: this.baseUrl,
            adminToken: this.adminToken,
        };
    }
    async close() {
        if (!this.server)
            return;
        await new Promise((resolve, reject) => {
            this.server?.close((error) => (error ? reject(error) : resolve()));
        });
        this.server = null;
        this.listeningAddress = null;
    }
    async handle(req, res) {
        const method = String(req.method || 'GET').toUpperCase();
        const url = new URL(String(req.url || '/'), this.baseUrl || 'http://127.0.0.1');
        const pathname = url.pathname;
        if (method === 'POST' && pathname === '/__email-connect/consent') {
            await this.handleConsentAction(req, res);
            return;
        }
        if (pathname.startsWith('/__email-connect/v1/')) {
            ensureAdminToken(req, this.adminToken);
            await this.handleControl(method, pathname, req, res);
            return;
        }
        if (pathname === '/o/oauth2/v2/auth' ||
            pathname === '/token' ||
            pathname === '/revoke' ||
            pathname === '/openidconnect/v1/userinfo') {
            await this.handleGoogleConnect(method, url, req, res);
            return;
        }
        if (matchPath(pathname, /^\/[^/]+\/oauth2\/v2\.0\/(?:authorize|token)$/)) {
            await this.handleMicrosoftConnect(method, url, req, res);
            return;
        }
        if (pathname.startsWith('/gmail/v1/')) {
            await this.handleGmail(parseBearerToken(req), method, url, req, res);
            return;
        }
        if (pathname.startsWith('/graph/v1.0/')) {
            await this.handleGraph(parseBearerToken(req), method, url, req, res);
            return;
        }
        sendJson(res, 404, {
            error: 'NotFound',
            message: `Unsupported route: ${method} ${pathname}`,
        });
    }
    async handleControl(method, pathname, req, res) {
        if (method === 'GET' && pathname === '/__email-connect/v1/mailboxes') {
            sendJson(res, 200, {
                data: this.engine.listMailboxes(),
            });
            return;
        }
        if (method === 'POST' && pathname === '/__email-connect/v1/mailboxes') {
            const body = await readJsonBody(req);
            const created = this.engine.createMailbox(body);
            sendJson(res, 201, {
                data: {
                    ...created,
                    providerBaseUrl: created.provider === 'gmail' ? `${this.baseUrl}/gmail/v1` : `${this.baseUrl}/graph/v1.0`,
                },
            });
            return;
        }
        if (method === 'POST' && pathname === '/__email-connect/v1/scenarios/load') {
            const body = await readJsonBody(req);
            const created = loadScenario(this.engine, body);
            sendJson(res, 201, { data: created });
            return;
        }
        if (method === 'POST' && pathname === '/__email-connect/v1/clock/advance') {
            const body = await readJsonBody(req);
            const ms = Number(body.ms || 0);
            sendJson(res, 200, {
                data: {
                    now: this.engine.advanceTimeMs(ms),
                },
            });
            return;
        }
        if (method === 'GET' && pathname === '/__email-connect/v1/outbox') {
            sendJson(res, 200, {
                data: this.engine.listOutbox(),
            });
            return;
        }
        if (method === 'GET' && pathname === '/__email-connect/v1/connect/clients') {
            const provider = String(new URL(String(req.url || '/'), this.baseUrl).searchParams.get('provider') || '').trim();
            sendJson(res, 200, {
                data: this.engine.connect.listClients(provider === 'gmail' || provider === 'graph' ? provider : undefined),
            });
            return;
        }
        if (method === 'POST' && pathname === '/__email-connect/v1/connect/clients') {
            const body = await readJsonBody(req);
            const created = this.engine.connect.registerClient(body);
            sendJson(res, 201, {
                data: {
                    ...created,
                    endpoints: this.engine.connect.providerEndpoints(created.provider, this.baseUrl),
                },
            });
            return;
        }
        if (method === 'GET' && pathname === '/__email-connect/v1/connect/requests') {
            sendJson(res, 200, { data: this.engine.connect.listAuthorizationRequests() });
            return;
        }
        const requestActionMatch = matchPath(pathname, /^\/__email-connect\/v1\/connect\/requests\/([^/]+)\/(approve|deny)$/);
        if (method === 'POST' && requestActionMatch?.[1] && requestActionMatch?.[2]) {
            const body = await readJsonBody(req);
            const requestId = decodeURIComponent(requestActionMatch[1]);
            const action = requestActionMatch[2];
            const decision = action === 'approve'
                ? this.engine.connect.approveAuthorizationRequest(requestId, {
                    mailboxId: typeof body.mailboxId === 'string' ? body.mailboxId : null,
                    ...(Array.isArray(body.grantedScopes)
                        ? { grantedScopes: body.grantedScopes.map((scope) => String(scope || '')) }
                        : {}),
                })
                : this.engine.connect.denyAuthorizationRequest(requestId, typeof body.error === 'string' ? body.error : 'access_denied', typeof body.errorDescription === 'string'
                    ? body.errorDescription
                    : null);
            sendJson(res, 200, { data: decision });
            return;
        }
        const mailboxMatch = matchPath(pathname, /^\/__email-connect\/v1\/mailboxes\/([^/]+)$/);
        if (method === 'GET' && mailboxMatch?.[1]) {
            sendJson(res, 200, { data: this.engine.snapshotMailbox(decodeURIComponent(mailboxMatch[1])) });
            return;
        }
        const backendMatch = matchPath(pathname, /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/backend$/);
        if (method === 'PATCH' && backendMatch?.[1]) {
            const body = await readJsonBody(req);
            sendJson(res, 200, {
                data: this.engine.configureBackend(decodeURIComponent(backendMatch[1]), body),
            });
            return;
        }
        const messagesMatch = matchPath(pathname, /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/messages$/);
        if (method === 'POST' && messagesMatch?.[1]) {
            const body = await readJsonBody(req);
            sendJson(res, 201, {
                data: this.engine.appendMessage(decodeURIComponent(messagesMatch[1]), body),
            });
            return;
        }
        const generateMatch = matchPath(pathname, /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/generate$/);
        if (method === 'POST' && generateMatch?.[1]) {
            const body = await readJsonBody(req);
            const templateSource = Array.isArray(body.templates)
                ? createArrayTemplateSource(body.templates)
                : createCallbackTemplateSource((context) => ({
                    subject: `Generated ${context.provider.toUpperCase()} mail ${context.index + 1}`,
                    bodyText: `Program-generated body for ${context.mailboxId} message ${context.index + 1}`,
                }));
            const plan = {
                ...body,
                mailboxId: decodeURIComponent(generateMatch[1]),
                templateSource,
            };
            const generated = await generateMailboxEmails(this.engine, plan);
            sendJson(res, 201, { data: generated });
            return;
        }
        const replayMatch = matchPath(pathname, /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/replay\/([^/]+)$/);
        if (method === 'POST' && replayMatch?.[1] && replayMatch?.[2]) {
            this.engine.appendReplayChange(decodeURIComponent(replayMatch[1]), decodeURIComponent(replayMatch[2]));
            sendJson(res, 200, { success: true });
            return;
        }
        const attachmentMatch = matchPath(pathname, /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/messages\/([^/]+)\/attachments$/);
        if (method === 'POST' && attachmentMatch?.[1] && attachmentMatch?.[2]) {
            const body = await readJsonBody(req);
            const bytes = typeof body.contentText === 'string'
                ? body.contentText
                : typeof body.contentBase64 === 'string'
                    ? Buffer.from(body.contentBase64, 'base64')
                    : '';
            sendJson(res, 201, {
                data: this.engine.addAttachment(decodeURIComponent(attachmentMatch[1]), decodeURIComponent(attachmentMatch[2]), {
                    filename: String(body.filename || 'attachment.bin'),
                    mimeType: String(body.mimeType || 'application/octet-stream'),
                    contentBytes: bytes,
                    ...(typeof body.providerAttachmentId === 'string' ? { providerAttachmentId: body.providerAttachmentId } : {}),
                }),
            });
            return;
        }
        const messagePatchMatch = matchPath(pathname, /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/messages\/([^/]+)$/);
        if (method === 'PATCH' && messagePatchMatch?.[1] && messagePatchMatch?.[2]) {
            const body = await readJsonBody(req);
            sendJson(res, 200, {
                data: this.engine.updateMessage(decodeURIComponent(messagePatchMatch[1]), decodeURIComponent(messagePatchMatch[2]), body),
            });
            return;
        }
        if (method === 'DELETE' && messagePatchMatch?.[1] && messagePatchMatch?.[2]) {
            this.engine.deleteMessage(decodeURIComponent(messagePatchMatch[1]), decodeURIComponent(messagePatchMatch[2]));
            sendJson(res, 200, { success: true });
            return;
        }
        sendJson(res, 404, {
            error: 'NotFound',
            message: `Unsupported control route: ${method} ${pathname}`,
        });
    }
    async handleConsentAction(req, res) {
        const body = await readFormBody(req);
        const requestId = String(body.request_id || '').trim();
        const decision = String(body.decision || '').trim().toLowerCase();
        const provider = body.provider === 'graph' ? 'graph' : 'gmail';
        if (!requestId || (decision !== 'approve' && decision !== 'deny')) {
            throw new EmailConnectError('Invalid consent action', 400);
        }
        const result = decision === 'approve'
            ? this.engine.connect.approveAuthorizationRequest(requestId, {
                mailboxId: String(body.mailbox_id || '').trim() || null,
            })
            : this.engine.connect.denyAuthorizationRequest(requestId, 'access_denied', defaultAuthorizationErrorDescription(provider, 'access_denied'));
        res.statusCode = 302;
        res.setHeader('location', result.redirectUrl);
        res.end();
    }
    async handleGoogleConnect(method, url, req, res) {
        const pathname = url.pathname;
        if (method === 'GET' && pathname === '/o/oauth2/v2/auth') {
            const responseType = String(url.searchParams.get('response_type') || 'code').trim().toLowerCase();
            if (responseType !== 'code') {
                throw new EmailConnectError('Only response_type=code is supported', 400);
            }
            const request = this.engine.connect.createAuthorizationRequest({
                provider: 'gmail',
                clientId: String(url.searchParams.get('client_id') || ''),
                redirectUri: String(url.searchParams.get('redirect_uri') || ''),
                state: url.searchParams.get('state'),
                requestedScopes: splitScopes(url.searchParams.get('scope')),
                includeGrantedScopes: parseBooleanQuery(url.searchParams.get('include_granted_scopes')),
                capabilityMode: String(url.searchParams.get('email_connect_mode') || '').trim().toLowerCase() === 'read' ? 'read' : 'send',
                accessType: String(url.searchParams.get('access_type') || '').trim().toLowerCase() === 'offline' ? 'offline' : 'online',
                prompt: url.searchParams.get('prompt'),
                loginHint: url.searchParams.get('login_hint'),
                codeChallenge: url.searchParams.get('code_challenge'),
                codeChallengeMethod: String(url.searchParams.get('code_challenge_method') || '').trim().toUpperCase() === 'S256' ? 'S256' : null,
            });
            await this.completeOrRenderConsent('gmail', request, res);
            return;
        }
        if (method === 'POST' && pathname === '/token') {
            const body = await readFormBody(req);
            const grantType = String(body.grant_type || '').trim();
            if (grantType === 'authorization_code') {
                await this.respondWithTokenGrant(res, () => this.engine.connect.exchangeAuthorizationCode({
                    provider: 'gmail',
                    clientId: String(body.client_id || ''),
                    ...(body.client_secret != null ? { clientSecret: body.client_secret } : {}),
                    redirectUri: String(body.redirect_uri || ''),
                    code: String(body.code || ''),
                    ...(body.code_verifier != null ? { codeVerifier: body.code_verifier } : {}),
                }));
                return;
            }
            if (grantType === 'refresh_token') {
                await this.respondWithTokenGrant(res, () => this.engine.connect.refreshAccessToken({
                    provider: 'gmail',
                    clientId: String(body.client_id || ''),
                    ...(body.client_secret != null ? { clientSecret: body.client_secret } : {}),
                    refreshToken: String(body.refresh_token || ''),
                    scopes: splitScopes(body.scope || null),
                }));
                return;
            }
            throw new EmailConnectError(`Unsupported grant_type for Google: ${grantType}`, 400);
        }
        if (method === 'POST' && pathname === '/revoke') {
            const body = await readFormBody(req);
            const token = String(body.token || url.searchParams.get('token') || '').trim();
            const revoked = this.engine.connect.revokeToken('gmail', token);
            sendText(res, revoked ? 200 : 400, '');
            return;
        }
        if (method === 'GET' && pathname === '/openidconnect/v1/userinfo') {
            sendJson(res, 200, this.engine.connect.getUserInfo('gmail', parseBearerToken(req)));
            return;
        }
        sendJson(res, 404, {
            error: 'NotFound',
            message: `Unsupported Google connect route: ${method} ${pathname}`,
        });
    }
    async handleMicrosoftConnect(method, url, req, res) {
        const pathname = url.pathname;
        const authorizeMatch = matchPath(pathname, /^\/([^/]+)\/oauth2\/v2\.0\/authorize$/);
        if (method === 'GET' && authorizeMatch?.[1]) {
            const responseType = String(url.searchParams.get('response_type') || 'code').trim().toLowerCase();
            if (responseType !== 'code') {
                throw new EmailConnectError('Only response_type=code is supported', 400);
            }
            const requestedScopes = splitScopes(url.searchParams.get('scope'));
            const request = this.engine.connect.createAuthorizationRequest({
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
            await this.completeOrRenderConsent('graph', request, res);
            return;
        }
        const tokenMatch = matchPath(pathname, /^\/([^/]+)\/oauth2\/v2\.0\/token$/);
        if (method === 'POST' && tokenMatch?.[1]) {
            const body = await readFormBody(req);
            const grantType = String(body.grant_type || '').trim();
            if (grantType === 'authorization_code') {
                await this.respondWithTokenGrant(res, () => this.engine.connect.exchangeAuthorizationCode({
                    provider: 'graph',
                    clientId: String(body.client_id || ''),
                    ...(body.client_secret != null ? { clientSecret: body.client_secret } : {}),
                    redirectUri: String(body.redirect_uri || ''),
                    code: String(body.code || ''),
                    ...(body.code_verifier != null ? { codeVerifier: body.code_verifier } : {}),
                }));
                return;
            }
            if (grantType === 'refresh_token') {
                await this.respondWithTokenGrant(res, () => this.engine.connect.refreshAccessToken({
                    provider: 'graph',
                    clientId: String(body.client_id || ''),
                    ...(body.client_secret != null ? { clientSecret: body.client_secret } : {}),
                    refreshToken: String(body.refresh_token || ''),
                    scopes: splitScopes(body.scope || null),
                }));
                return;
            }
            throw new EmailConnectError(`Unsupported grant_type for Microsoft: ${grantType}`, 400);
        }
        sendJson(res, 404, {
            error: 'NotFound',
            message: `Unsupported Microsoft connect route: ${method} ${pathname}`,
        });
    }
    async completeOrRenderConsent(provider, request, res) {
        const providerMailboxesFull = this.engine.listMailboxes().filter((mailbox) => mailbox.provider === provider);
        const providerMailboxes = providerMailboxesFull.map((mailbox) => ({
            id: mailbox.id,
            alias: mailbox.alias,
            primaryEmail: mailbox.primaryEmail,
        }));
        request.consentMode = this.resolveConsentMode(providerMailboxesFull, request);
        if (request.consentMode === 'auto_deny') {
            const denied = this.engine.connect.denyAuthorizationRequest(request.id, 'access_denied', defaultAuthorizationErrorDescription(provider, 'access_denied'));
            res.statusCode = 302;
            res.setHeader('location', denied.redirectUrl);
            res.end();
            return;
        }
        if (request.consentMode === 'auto_approve') {
            try {
                const approved = this.engine.connect.approveAuthorizationRequest(request.id);
                res.statusCode = 302;
                res.setHeader('location', approved.redirectUrl);
                res.end();
                return;
            }
            catch (error) {
                if (!(error instanceof EmailConnectError))
                    throw error;
            }
        }
        sendHtml(res, 200, consentPageHtml({
            provider,
            request,
            availableMailboxes: providerMailboxes,
        }));
    }
    resolveConsentMode(mailboxes, request) {
        const direct = request.mailboxId ? mailboxes.find((mailbox) => mailbox.id === request.mailboxId) : null;
        if (direct?.backend.connect?.consentMode)
            return direct.backend.connect.consentMode;
        if (request.loginHint) {
            const hint = request.loginHint.toLowerCase();
            const matches = mailboxes.filter((mailbox) => {
                return (mailbox.id.toLowerCase() === hint ||
                    (mailbox.alias || '').toLowerCase() === hint ||
                    mailbox.primaryEmail.toLowerCase() === hint ||
                    mailbox.providerUserId.toLowerCase() === hint);
            });
            const [onlyMatch] = matches;
            if (onlyMatch?.backend.connect?.consentMode && matches.length === 1) {
                return onlyMatch.backend.connect.consentMode;
            }
        }
        const [onlyMailbox] = mailboxes;
        if (onlyMailbox?.backend.connect?.consentMode && mailboxes.length === 1) {
            return onlyMailbox.backend.connect.consentMode;
        }
        return request.consentMode;
    }
    async respondWithTokenGrant(res, issueGrant) {
        try {
            const grant = issueGrant();
            sendJson(res, 200, {
                access_token: grant.accessToken,
                token_type: grant.tokenType,
                expires_in: grant.expiresIn,
                scope: grant.grantedScopes.join(' '),
                ...(grant.refreshToken ? { refresh_token: grant.refreshToken } : {}),
                ...(grant.idToken ? { id_token: grant.idToken } : {}),
            });
        }
        catch (error) {
            const mapped = this.mapOAuthTokenError(error);
            sendJson(res, mapped.statusCode, mapped.body);
        }
    }
    mapOAuthTokenError(error) {
        const message = error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();
        if (lower.includes('temporarily_unavailable')) {
            return {
                statusCode: 503,
                body: {
                    error: 'temporarily_unavailable',
                    error_description: message,
                },
            };
        }
        if (lower.includes('client')) {
            return {
                statusCode: 401,
                body: {
                    error: 'invalid_client',
                    error_description: message,
                },
            };
        }
        if (lower.includes('scope')) {
            return {
                statusCode: 400,
                body: {
                    error: 'invalid_scope',
                    error_description: message,
                },
            };
        }
        return {
            statusCode: 400,
            body: {
                error: 'invalid_grant',
                error_description: message,
            },
        };
    }
    async handleGmail(accessToken, method, url, req, res) {
        const pathname = url.pathname;
        if (method === 'GET' && pathname === '/gmail/v1/users/me/profile') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.profile.get');
            sendJson(res, 200, await this.gmail.getProfile(mailbox.id));
            return;
        }
        if (method === 'GET' && pathname === '/gmail/v1/users/me/labels') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.labels.list');
            sendJson(res, 200, await this.gmail.listLabels(mailbox.id));
            return;
        }
        if (method === 'GET' && pathname === '/gmail/v1/users/me/messages') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.messages.list');
            sendJson(res, 200, await this.gmail.listMessages(mailbox.id, {
                ...(url.searchParams.get('q') ? { q: String(url.searchParams.get('q')) } : {}),
                ...(url.searchParams.get('maxResults')
                    ? { maxResults: Number(url.searchParams.get('maxResults')) }
                    : {}),
                ...(url.searchParams.get('pageToken') ? { pageToken: String(url.searchParams.get('pageToken')) } : {}),
            }));
            return;
        }
        const messageMatch = matchPath(pathname, /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
        if (method === 'GET' && messageMatch?.[1]) {
            const mailbox = this.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.messages.get');
            sendJson(res, 200, await this.gmail.getMessage(mailbox.id, decodeURIComponent(messageMatch[1])));
            return;
        }
        const attachmentMatch = matchPath(pathname, /^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/);
        if (method === 'GET' && attachmentMatch?.[1] && attachmentMatch?.[2]) {
            const mailbox = this.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.attachments.get');
            sendJson(res, 200, await this.gmail.getAttachment(mailbox.id, decodeURIComponent(attachmentMatch[1]), decodeURIComponent(attachmentMatch[2])));
            return;
        }
        if (method === 'GET' && pathname === '/gmail/v1/users/me/history') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.history.list');
            const historyTypes = url.searchParams.getAll('historyTypes').filter(Boolean);
            sendJson(res, 200, await this.gmail.listHistory(mailbox.id, {
                startHistoryId: String(url.searchParams.get('startHistoryId') || ''),
                ...(url.searchParams.get('pageToken') ? { pageToken: String(url.searchParams.get('pageToken')) } : {}),
                ...(historyTypes.length ? { historyTypes } : {}),
            }));
            return;
        }
        if (method === 'POST' && pathname === '/gmail/v1/users/me/drafts') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.drafts.create');
            sendJson(res, 200, await this.gmail.createDraft(mailbox.id, await readJsonBody(req)));
            return;
        }
        if (method === 'POST' && pathname === '/gmail/v1/users/me/drafts/send') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.drafts.send');
            sendJson(res, 200, await this.gmail.sendDraft(mailbox.id, await readJsonBody(req)));
            return;
        }
        if (method === 'POST' && pathname === '/gmail/v1/users/me/messages/send') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.messages.send');
            sendJson(res, 200, await this.gmail.sendMessage(mailbox.id, await readJsonBody(req)));
            return;
        }
        sendJson(res, 404, {
            error: 'NotFound',
            message: `Unsupported Gmail route: ${method} ${pathname}`,
        });
    }
    async handleGraph(accessToken, method, url, req, res) {
        const pathname = url.pathname;
        if (method === 'GET' && pathname === '/graph/v1.0/me') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.me.get');
            sendJson(res, 200, await this.graph.getMe(mailbox.id));
            return;
        }
        if (method === 'GET' && pathname === '/graph/v1.0/me/messages') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.messages.list');
            sendJson(res, 200, await this.graph.listMessages(mailbox.id, `${pathname}${url.search}`, this.baseUrl));
            return;
        }
        if (method === 'GET' && pathname === '/graph/v1.0/me/mailFolders/inbox/messages') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.inbox.messages.list');
            sendJson(res, 200, await this.graph.listInboxMessages(mailbox.id, `${pathname}${url.search}`, this.baseUrl));
            return;
        }
        if (method === 'GET' && pathname === '/graph/v1.0/me/mailFolders/inbox/messages/delta') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.delta.get');
            sendJson(res, 200, await this.graph.delta(mailbox.id, `${pathname}${url.search}`, this.baseUrl));
            return;
        }
        const messageMatch = matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)$/);
        if (method === 'GET' && messageMatch?.[1]) {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.message.get');
            sendJson(res, 200, await this.graph.getMessage(mailbox.id, decodeURIComponent(messageMatch[1])));
            return;
        }
        const attachmentsListMatch = matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/attachments$/);
        if (method === 'GET' && attachmentsListMatch?.[1]) {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.attachments.list');
            sendJson(res, 200, await this.graph.listAttachmentsPage(mailbox.id, decodeURIComponent(attachmentsListMatch[1]), `${pathname}${url.search}`, this.baseUrl));
            return;
        }
        const attachmentValueMatch = matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/attachments\/([^/]+)\/\$value$/);
        if (method === 'GET' && attachmentValueMatch?.[1] && attachmentValueMatch?.[2]) {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.attachment.get');
            sendBytes(res, 200, await this.graph.getAttachmentValue(mailbox.id, decodeURIComponent(attachmentValueMatch[1]), decodeURIComponent(attachmentValueMatch[2])));
            return;
        }
        const attachmentMatch = matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/);
        if (method === 'GET' && attachmentMatch?.[1] && attachmentMatch?.[2]) {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.attachment.get');
            sendJson(res, 200, await this.graph.getAttachment(mailbox.id, decodeURIComponent(attachmentMatch[1]), decodeURIComponent(attachmentMatch[2])));
            return;
        }
        const createReplyMatch = matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/createReply$/);
        if (method === 'POST' && createReplyMatch?.[1]) {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.reply.create');
            sendJson(res, 200, await this.graph.createReplyDraft(mailbox.id, decodeURIComponent(createReplyMatch[1])));
            return;
        }
        if (method === 'POST' && pathname === '/graph/v1.0/me/messages') {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.draft.create');
            sendJson(res, 200, await this.graph.createDraft(mailbox.id, await readJsonBody(req)));
            return;
        }
        const sendMatch = matchPath(pathname, /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/send$/);
        if (method === 'POST' && sendMatch?.[1]) {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.draft.send');
            sendJson(res, 200, await this.graph.sendDraft(mailbox.id, decodeURIComponent(sendMatch[1])));
            return;
        }
        if (method === 'PATCH' && messageMatch?.[1]) {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.draft.update');
            sendJson(res, 200, await this.graph.patchDraft(mailbox.id, decodeURIComponent(messageMatch[1]), await readJsonBody(req)));
            return;
        }
        if (method === 'DELETE' && messageMatch?.[1]) {
            const mailbox = this.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.message.delete');
            await this.graph.deleteMessageResource(mailbox.id, decodeURIComponent(messageMatch[1]));
            sendJson(res, 200, { success: true });
            return;
        }
        sendJson(res, 404, {
            error: 'NotFound',
            message: `Unsupported Graph route: ${method} ${pathname}`,
        });
    }
}
//# sourceMappingURL=server.js.map