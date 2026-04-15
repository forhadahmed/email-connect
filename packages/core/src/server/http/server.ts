import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { EmailConnectError, UnauthorizedError } from '../../errors.js';
import { EmailConnectEngine } from '../../engine/email-connect-engine.js';
import type { EmailConnectHttpRouteContext } from '../../provider.js';
import { loadScenario } from '../../control/scenario.js';
import type { AuthorizationRequestSnapshot, ConnectConsentMode, OAuthClientInput, ProviderKind } from '../../types.js';
import {
  createArrayTemplateSource,
  createCallbackTemplateSource,
  generateMailboxEmails,
  type EmailGenerationPlan,
} from '../../testing/generation.js';

// Host-level parsing patterns are intentionally framework-free but named so
// auth parsing and control-route captures are easy to review.
const BEARER_AUTHORIZATION_PATTERN = /^Bearer\s+(.+)$/i;
const OAUTH_SCOPE_SEPARATOR_PATTERN = /\s+/;
const TRUE_QUERY_VALUE_PATTERN = /^(1|true)$/i;
const CONNECT_REQUEST_ACTION_ROUTE_PATTERN = /^\/__email-connect\/v1\/connect\/requests\/([^/]+)\/(approve|deny)$/;
const CONTROL_MAILBOX_ROUTE_PATTERN = /^\/__email-connect\/v1\/mailboxes\/([^/]+)$/;
const CONTROL_BACKEND_ROUTE_PATTERN = /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/backend$/;
const CONTROL_MESSAGES_ROUTE_PATTERN = /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/messages$/;
const CONTROL_GENERATE_ROUTE_PATTERN = /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/generate$/;
const CONTROL_REPLAY_ROUTE_PATTERN = /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/replay\/([^/]+)$/;
const CONTROL_ATTACHMENTS_ROUTE_PATTERN = /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/messages\/([^/]+)\/attachments$/;
const CONTROL_MESSAGE_ROUTE_PATTERN = /^\/__email-connect\/v1\/mailboxes\/([^/]+)\/messages\/([^/]+)$/;

// Read raw request bodies once at the host boundary so providers can choose
// JSON, form, or byte parsing without owning stream plumbing.
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Request parsing is centralized here so provider route handlers can stay
// focused on semantics instead of reimplementing body decoding and headers.
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
}

// OAuth token endpoints submit form-encoded bodies, so keep form parsing beside
// JSON parsing instead of pushing it into each provider package.
async function readFormBody(req: IncomingMessage): Promise<Record<string, string>> {
  const raw = await readBody(req);
  if (!raw.length) return {};
  const params = new URLSearchParams(raw.toString('utf8'));
  return Object.fromEntries(params.entries());
}

// Response helpers keep HTTP rendering boring and consistent across control
// routes and provider route handlers.
function applyHeaders(res: ServerResponse, headers: Record<string, string> | undefined): void {
  for (const [name, value] of Object.entries(headers || {})) {
    if (!String(name || '').trim()) continue;
    res.setHeader(name, value);
  }
}

// JSON responses are pretty-printed because this server is also an inspection
// tool during local black-box integration development.
function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  options?: { headers?: Record<string, string> },
): void {
  const payload = JSON.stringify(body, null, 2);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  applyHeaders(res, options?.headers);
  res.end(payload);
}

// HTML is reserved for the minimal consent page; product docs/UI should live
// outside the mock server.
function sendHtml(
  res: ServerResponse,
  statusCode: number,
  body: string,
  options?: { headers?: Record<string, string> },
): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  applyHeaders(res, options?.headers);
  res.end(body);
}

// Text responses are used for provider endpoints that intentionally return an
// empty body, such as revoke and accepted send operations.
function sendText(
  res: ServerResponse,
  statusCode: number,
  body = '',
  options?: { headers?: Record<string, string> },
): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  applyHeaders(res, options?.headers);
  res.end(body);
}

// Byte responses are the black-box attachment and raw MIME serving path.
function sendBytes(
  res: ServerResponse,
  statusCode: number,
  bytes: Uint8Array,
  options?: { headers?: Record<string, string>; contentType?: string },
): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', options?.contentType || 'application/octet-stream');
  applyHeaders(res, options?.headers);
  res.end(Buffer.from(bytes));
}

// Provider facades use bearer tokens exactly like real Gmail/Graph APIs; admin
// control routes use a separate header token.
function parseBearerToken(req: IncomingMessage): string {
  const header = String(req.headers.authorization || '');
  const match = header.match(BEARER_AUTHORIZATION_PATTERN);
  if (!match?.[1]) {
    throw new UnauthorizedError('Missing Bearer token');
  }
  return match[1];
}

// The control plane can mutate mailboxes and faults, so protect it even in a
// local mock server.
function ensureAdminToken(req: IncomingMessage, expectedToken: string): void {
  const provided = String(req.headers['x-email-connect-admin-token'] || '').trim();
  if (!provided || provided !== expectedToken) {
    throw new UnauthorizedError('Missing or invalid admin token');
  }
}

// Route binders stay regex-based to avoid a framework dependency in the core
// package.
function matchPath(pathname: string, pattern: RegExp): RegExpMatchArray | null {
  return pathname.match(pattern);
}

// OAuth scopes are space-delimited in both Google and Microsoft authorization
// URLs and token requests.
function splitScopes(raw: string | null): string[] {
  return String(raw || '')
    .split(OAUTH_SCOPE_SEPARATOR_PATTERN)
    .map((value) => value.trim())
    .filter(Boolean);
}

// Query booleans are used for provider knobs like Gmail incremental consent.
function parseBooleanQuery(value: string | null): boolean {
  return TRUE_QUERY_VALUE_PATTERN.test(String(value || '').trim());
}

// Human-friendly provider names are only for the tiny consent page.
function providerDisplayName(provider: ProviderKind): string {
  if (provider === 'gmail') return 'Google';
  if (provider === 'graph') return 'Microsoft';
  return provider;
}

// The interactive consent page is intentionally minimal HTML. Its job is to
// make provider-connect flows debuggable in a browser, not to become a second
// product UI layer.
function consentPageHtml(params: {
  provider: ProviderKind;
  request: AuthorizationRequestSnapshot;
  availableMailboxes: Array<{ id: string; alias: string | null; primaryEmail: string }>;
}): string {
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
  readonly engine: EmailConnectEngine;
  readonly adminToken: string;

  // Runtime-only HTTP state is kept separate from the engine so closing and
  // restarting the facade never mutates mailbox data.
  private server: Server | null = null;
  private listeningAddress: string | null = null;

  // The server can own its own engine for simple demos or wrap a caller-supplied
  // engine when tests need direct white-box inspection.
  constructor(options?: { engine?: EmailConnectEngine; adminToken?: string }) {
    this.engine = options?.engine || new EmailConnectEngine();
    this.adminToken = options?.adminToken || `admin_${randomBytes(16).toString('base64url')}`;
  }

  get baseUrl(): string {
    if (!this.listeningAddress) {
      throw new Error('HTTP server is not listening');
    }
    return this.listeningAddress;
  }

  // Listen binds the control plane and all installed provider facades to one
  // origin so black-box clients can follow provider-issued absolute links.
  async listen(options?: { host?: string; port?: number }): Promise<{ baseUrl: string; adminToken: string }> {
    if (this.server) {
      return {
        baseUrl: this.baseUrl,
        adminToken: this.adminToken,
      };
    }
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        if (error instanceof EmailConnectError) {
          sendJson(res, error.statusCode, { error: error.name, message: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 500);
        const code = String((error as { code?: string })?.code || 'InternalError');
        const body = (error as { body?: unknown })?.body;
        sendJson(res, statusCode, body || { error: code, message });
      });
    });

    const host = options?.host || '127.0.0.1';
    const port = options?.port ?? 0;
    await new Promise<void>((resolve, reject) => {
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

  // Closing clears the cached origin so subsequent tests can restart the server
  // on a fresh ephemeral port without leaking state.
  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = null;
    this.listeningAddress = null;
  }

  // The top-level handler separates consent, admin control, and provider routes
  // before handing requests to provider packages.
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = String(req.method || 'GET').toUpperCase();
    const url = new URL(String(req.url || '/'), this.baseUrl || 'http://127.0.0.1');
    const pathname = url.pathname;

    // Control-plane routes live under `__email-connect`; provider routes are
    // delegated below. That split keeps the public provider facades clean.
    if (method === 'POST' && pathname === '/__email-connect/consent') {
      await this.handleConsentAction(req, res);
      return;
    }

    if (pathname.startsWith('/__email-connect/v1/')) {
      ensureAdminToken(req, this.adminToken);
      await this.handleControl(method, pathname, req, res);
      return;
    }

    const context: EmailConnectHttpRouteContext = {
      engine: this.engine,
      method,
      url,
      req,
      res,
      readJsonBody: () => readJsonBody(req),
      readFormBody: () => readFormBody(req),
      readRawBody: () => readBody(req),
      sendJson: (statusCode, body, options) => sendJson(res, statusCode, body, options),
      sendHtml: (statusCode, body, options) => sendHtml(res, statusCode, body, options),
      sendText: (statusCode, body = '', options) => sendText(res, statusCode, body, options),
      sendBytes: (statusCode, bytes, options) => sendBytes(res, statusCode, bytes, options),
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

  // Control routes are the operator surface for seeding, inspection, and fault
  // injection regardless of which mock provider packages are installed.
  private async handleControl(method: string, pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (method === 'GET' && pathname === '/__email-connect/v1/mailboxes') {
      sendJson(res, 200, {
        data: this.engine.listMailboxes(),
      });
      return;
    }

    if (method === 'POST' && pathname === '/__email-connect/v1/mailboxes') {
      const body = await readJsonBody(req);
      const created = this.engine.createMailbox(body as never);
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
      const created = loadScenario(this.engine, body as never);
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

    // Client registration and authorization-request inspection let black-box
    // tests drive the connect plane without falling back to white-box helpers.
    if (method === 'POST' && pathname === '/__email-connect/v1/connect/clients') {
      const body = await readJsonBody(req);
      const created = this.engine.connect.registerClient(body as OAuthClientInput);
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

    const requestActionMatch = matchPath(pathname, CONNECT_REQUEST_ACTION_ROUTE_PATTERN);
    if (method === 'POST' && requestActionMatch?.[1] && requestActionMatch?.[2]) {
      const body = await readJsonBody(req);
      const requestId = decodeURIComponent(requestActionMatch[1]);
      const action = requestActionMatch[2];
      const decision =
        action === 'approve'
          ? this.engine.connect.approveAuthorizationRequest(requestId, {
              mailboxId: typeof body.mailboxId === 'string' ? body.mailboxId : null,
              ...(Array.isArray(body.grantedScopes)
                ? { grantedScopes: body.grantedScopes.map((scope) => String(scope || '')) }
                : {}),
            })
          : this.engine.connect.denyAuthorizationRequest(
              requestId,
              typeof body.error === 'string' ? body.error : 'access_denied',
              typeof body.errorDescription === 'string'
                ? body.errorDescription
                : null,
            );
      sendJson(res, 200, { data: decision });
      return;
    }

    const mailboxMatch = matchPath(pathname, CONTROL_MAILBOX_ROUTE_PATTERN);
    if (method === 'GET' && mailboxMatch?.[1]) {
      sendJson(res, 200, { data: this.engine.snapshotMailbox(decodeURIComponent(mailboxMatch[1])) });
      return;
    }

    // Mailbox mutation routes are intentionally direct and low-level: they are
    // for scenario construction and adversarial test setup, not end-user UX.
    const backendMatch = matchPath(pathname, CONTROL_BACKEND_ROUTE_PATTERN);
    if (method === 'PATCH' && backendMatch?.[1]) {
      const body = await readJsonBody(req);
      sendJson(res, 200, {
        data: this.engine.configureBackend(decodeURIComponent(backendMatch[1]), body as never),
      });
      return;
    }

    const messagesMatch = matchPath(pathname, CONTROL_MESSAGES_ROUTE_PATTERN);
    if (method === 'POST' && messagesMatch?.[1]) {
      const body = await readJsonBody(req);
      sendJson(res, 201, {
        data: this.engine.appendMessage(decodeURIComponent(messagesMatch[1]), body as never),
      });
      return;
    }

    const generateMatch = matchPath(pathname, CONTROL_GENERATE_ROUTE_PATTERN);
    if (method === 'POST' && generateMatch?.[1]) {
      const body = await readJsonBody(req);
      const templateSource = Array.isArray(body.templates)
        ? createArrayTemplateSource(body.templates as never)
        : createCallbackTemplateSource((context) => ({
            subject: `Generated ${context.provider.toUpperCase()} mail ${context.index + 1}`,
            bodyText: `Program-generated body for ${context.mailboxId} message ${context.index + 1}`,
          }));
      const plan = {
        ...body,
        mailboxId: decodeURIComponent(generateMatch[1]),
        templateSource,
      } as EmailGenerationPlan;
      const generated = await generateMailboxEmails(this.engine, plan);
      sendJson(res, 201, { data: generated });
      return;
    }

    const replayMatch = matchPath(pathname, CONTROL_REPLAY_ROUTE_PATTERN);
    if (method === 'POST' && replayMatch?.[1] && replayMatch?.[2]) {
      this.engine.appendReplayChange(decodeURIComponent(replayMatch[1]), decodeURIComponent(replayMatch[2]));
      sendJson(res, 200, { success: true });
      return;
    }

    const attachmentMatch = matchPath(
      pathname,
      CONTROL_ATTACHMENTS_ROUTE_PATTERN,
    );
    if (method === 'POST' && attachmentMatch?.[1] && attachmentMatch?.[2]) {
      const body = await readJsonBody(req);
      const bytes =
        typeof body.contentText === 'string'
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

    const messagePatchMatch = matchPath(
      pathname,
      CONTROL_MESSAGE_ROUTE_PATTERN,
    );
    if (method === 'PATCH' && messagePatchMatch?.[1] && messagePatchMatch?.[2]) {
      const body = await readJsonBody(req);
      sendJson(res, 200, {
        data: this.engine.updateMessage(
          decodeURIComponent(messagePatchMatch[1]),
          decodeURIComponent(messagePatchMatch[2]),
          body as never,
        ),
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

  // The browser consent POST exists for manual black-box debugging; automated
  // tests should generally use the JSON approve/deny control routes.
  private async handleConsentAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readFormBody(req);
    const requestId = String(body.request_id || '').trim();
    const decision = String(body.decision || '').trim().toLowerCase();
    const provider = body.provider === 'graph' ? 'graph' : 'gmail';
    if (!requestId || (decision !== 'approve' && decision !== 'deny')) {
      throw new EmailConnectError('Invalid consent action', 400);
    }
    const result =
      decision === 'approve'
        ? this.engine.connect.approveAuthorizationRequest(requestId, {
            mailboxId: String(body.mailbox_id || '').trim() || null,
          })
        : this.engine.connect.denyAuthorizationRequest(
            requestId,
            'access_denied',
            this.engine.requireProvider(provider).connect.defaultAuthorizationErrorDescription('access_denied'),
          );
    res.statusCode = 302;
    res.setHeader('location', result.redirectUrl);
    res.end();
  }

  // Consent resolution applies auto-approve, auto-deny, and mailbox-picking
  // rules before redirecting browser flows back to the client app.
  private async completeOrRenderConsent(
    provider: ProviderKind,
    request: AuthorizationRequestSnapshot,
    res: ServerResponse,
  ): Promise<void> {
    const providerMailboxesFull = this.engine.listMailboxes().filter((mailbox) => mailbox.provider === provider);
    const providerMailboxes = providerMailboxesFull.map((mailbox) => ({
      id: mailbox.id,
      alias: mailbox.alias,
      primaryEmail: mailbox.primaryEmail,
    }));
    request.consentMode = this.resolveConsentMode(providerMailboxesFull, request);

    if (request.consentMode === 'auto_deny') {
      const denied = this.engine.connect.denyAuthorizationRequest(
        request.id,
        'access_denied',
        this.engine.requireProvider(provider).connect.defaultAuthorizationErrorDescription('access_denied'),
      );
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
      } catch (error) {
        if (!(error instanceof EmailConnectError)) throw error;
      }
    }

    sendHtml(
      res,
      200,
      consentPageHtml({
        provider,
        request,
        availableMailboxes: providerMailboxes,
      }),
    );
  }

  // Request-local settings win first; then login-hint or single-mailbox
  // heuristics can auto-resolve consent for lightweight browser flows.
  private resolveConsentMode(
    mailboxes: Array<{
      id: string;
      alias: string | null;
      primaryEmail: string;
      providerUserId: string;
      backend: { connect?: { consentMode?: ConnectConsentMode } };
    }>,
    request: AuthorizationRequestSnapshot,
  ): ConnectConsentMode {
    const direct = request.mailboxId ? mailboxes.find((mailbox) => mailbox.id === request.mailboxId) : null;
    if (direct?.backend.connect?.consentMode) return direct.backend.connect.consentMode;

    if (request.loginHint) {
      const hint = request.loginHint.toLowerCase();
      const matches = mailboxes.filter((mailbox) => {
        return (
          mailbox.id.toLowerCase() === hint ||
          (mailbox.alias || '').toLowerCase() === hint ||
          mailbox.primaryEmail.toLowerCase() === hint ||
          mailbox.providerUserId.toLowerCase() === hint
        );
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

  // Provider token endpoints all converge here so JSON token payloads and
  // OAuth-style error mapping stay consistent across Gmail and Graph.
  private async respondWithTokenGrant(
    res: ServerResponse,
    issueGrant: () => ReturnType<EmailConnectEngine['connect']['exchangeAuthorizationCode']>,
  ): Promise<void> {
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
    } catch (error) {
      const mapped = this.mapOAuthTokenError(error);
      sendJson(res, mapped.statusCode, mapped.body);
    }
  }

  // Core raises typed errors, but token endpoints need provider-shaped OAuth
  // payloads instead of generic application exceptions.
  private mapOAuthTokenError(error: unknown): {
    statusCode: number;
    body: { error: string; error_description: string };
  } {
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
