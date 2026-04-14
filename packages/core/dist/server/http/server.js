import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { EmailConnectError, UnauthorizedError } from '../../core/errors.js';
import { EmailConnectEngine } from '../../engine/email-connect-engine.js';
import { loadScenario } from '../../control/scenario.js';
import { createArrayTemplateSource, createCallbackTemplateSource, generateMailboxEmails, } from '../../testing/generation.js';
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
    if (provider === 'gmail')
        return 'Google';
    if (provider === 'graph')
        return 'Microsoft';
    return provider;
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
    server = null;
    listeningAddress = null;
    constructor(options) {
        this.engine = options?.engine || new EmailConnectEngine();
        this.adminToken = options?.adminToken || `admin_${randomBytes(16).toString('base64url')}`;
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
        const context = {
            engine: this.engine,
            method,
            url,
            req,
            res,
            readJsonBody: () => readJsonBody(req),
            readFormBody: () => readFormBody(req),
            sendJson: (statusCode, body) => sendJson(res, statusCode, body),
            sendHtml: (statusCode, body) => sendHtml(res, statusCode, body),
            sendText: (statusCode, body = '') => sendText(res, statusCode, body),
            sendBytes: (statusCode, bytes) => sendBytes(res, statusCode, bytes),
            parseBearerToken: () => parseBearerToken(req),
            matchPath,
            splitScopes,
            parseBooleanQuery,
            completeOrRenderConsent: (provider, request) => this.completeOrRenderConsent(provider, request, res),
            respondWithTokenGrant: (issueGrant) => this.respondWithTokenGrant(res, issueGrant),
        };
        for (const provider of this.engine.listProviders()) {
            if (await provider.http?.handle(context)) {
                return;
            }
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
            : this.engine.connect.denyAuthorizationRequest(requestId, 'access_denied', this.engine.requireProvider(provider).connect.defaultAuthorizationErrorDescription('access_denied'));
        res.statusCode = 302;
        res.setHeader('location', result.redirectUrl);
        res.end();
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
            const denied = this.engine.connect.denyAuthorizationRequest(request.id, 'access_denied', this.engine.requireProvider(provider).connect.defaultAuthorizationErrorDescription('access_denied'));
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
}
//# sourceMappingURL=server.js.map