import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  AuthorizationRequestSnapshot,
  ConnectCapabilityMode,
  MailboxRecord,
  OAuthTokenGrant,
  ProviderEndpointUrls,
  ProviderKind,
} from './types.js';
import type { EmailConnectEngine } from './engine/email-connect-engine.js';

/**
 * Keep the provider contract intentionally small.
 *
 * Core owns generic OAuth lifecycle, mailbox state, generation, and the HTTP
 * host. Provider packages only supply the semantics that genuinely vary across
 * Gmail and Graph: scopes, endpoint shapes, capability checks, and HTTP route
 * mounting.
 */
export type EmailConnectProviderConnectSemantics = {
  // Gmail supports incremental consent; Graph does not. Core uses this to
  // decide whether `includeGrantedScopes` should have any effect.
  supportsIncrementalConsent?: boolean;
  // Providers differ on refresh-token rotation defaults, so the connect plane
  // asks the provider instead of hardcoding one policy.
  rotateRefreshTokenOnRefreshByDefault?: boolean;
  // Return provider-native OAuth or profile endpoint locations rooted at the
  // mock server's current origin.
  providerEndpoints(baseUrl: string): ProviderEndpointUrls;
  // Map the high-level capability intent (`read` vs `send`) into the provider's
  // practical default scope bundle.
  defaultScopesForCapabilityMode(capabilityMode: ConnectCapabilityMode): string[];
  // Decide whether the currently granted scopes authorize one logical provider
  // operation such as `gmail.history.list` or `graph.message.move`.
  isOperationAuthorized(scopes: string[], operation: string): boolean;
  // Project the connected mailbox into the provider's lightweight profile or
  // userinfo resource.
  buildUserInfo(mailbox: MailboxRecord): Record<string, unknown>;
  // Providers phrase callback errors differently; this fills in the mock's
  // default `error_description` when a flow is denied.
  defaultAuthorizationErrorDescription(errorCode: string): string | null;
  // Normalize provider-specific access-type rules such as Gmail's explicit
  // `access_type=offline` and Graph's `offline_access` scope.
  resolveAccessType(params: {
    requestedScopes: string[];
    requestedAccessType?: 'online' | 'offline';
    capabilityMode: ConnectCapabilityMode | null;
  }): 'online' | 'offline';
  // Decide whether a new refresh token should be issued for this approval or
  // refresh cycle.
  shouldIssueRefreshToken(params: {
    mailbox: MailboxRecord;
    accessType: 'online' | 'offline';
    prompt: string | null;
  }): boolean;
  // The mock can emit unsigned ID tokens; providers still control the issuer
  // claim so downstream validation code sees realistic values.
  idTokenIssuer(mailbox: MailboxRecord): string;
};

// Route context is the small HTTP host API that provider packages receive. It
// gives providers request utilities without coupling them to server internals.
export type EmailConnectHttpRouteContext = {
  engine: EmailConnectEngine;
  method: string;
  url: URL;
  req: IncomingMessage;
  res: ServerResponse;
  // Body readers centralize stream parsing in core so provider packages can
  // stay focused on semantics instead of HTTP plumbing.
  readJsonBody(): Promise<Record<string, unknown>>;
  readFormBody(): Promise<Record<string, string>>;
  readRawBody(): Promise<Buffer>;
  // Response helpers keep provider route handlers framework-free but still
  // consistent about content types and status handling.
  sendJson(statusCode: number, body: unknown, options?: { headers?: Record<string, string> }): void;
  sendHtml(statusCode: number, body: string, options?: { headers?: Record<string, string> }): void;
  sendText(statusCode: number, body?: string, options?: { headers?: Record<string, string> }): void;
  sendBytes(
    statusCode: number,
    bytes: Uint8Array,
    options?: { headers?: Record<string, string>; contentType?: string },
  ): void;
  // Request helpers cover the parsing primitives both Gmail and Graph need for
  // auth, scope, and route handling.
  parseBearerToken(): string;
  matchPath(pathname: string, pattern: RegExp): RegExpMatchArray | null;
  splitScopes(raw: string | null): string[];
  parseBooleanQuery(value: string | null): boolean;
  // Connect helpers let provider packages reuse the canonical consent and token
  // response flow without re-implementing it.
  completeOrRenderConsent(provider: ProviderKind, request: AuthorizationRequestSnapshot): Promise<void>;
  respondWithTokenGrant(issueGrant: () => OAuthTokenGrant): Promise<void>;
};

// Provider HTTP handlers return true only when they fully handled the request;
// this lets the host try installed providers without a framework router.
export type EmailConnectProviderHttp = {
  handle(context: EmailConnectHttpRouteContext): Promise<boolean>;
};

// A provider package is the unit of sellable/installable behavior: connect
// semantics plus optional black-box HTTP routes for that provider.
export type EmailConnectProvider = {
  id: ProviderKind;
  connect: EmailConnectProviderConnectSemantics;
  http?: EmailConnectProviderHttp;
};
