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
  supportsIncrementalConsent?: boolean;
  rotateRefreshTokenOnRefreshByDefault?: boolean;
  providerEndpoints(baseUrl: string): ProviderEndpointUrls;
  defaultScopesForCapabilityMode(capabilityMode: ConnectCapabilityMode): string[];
  isOperationAuthorized(scopes: string[], operation: string): boolean;
  buildUserInfo(mailbox: MailboxRecord): Record<string, unknown>;
  defaultAuthorizationErrorDescription(errorCode: string): string | null;
  resolveAccessType(params: {
    requestedScopes: string[];
    requestedAccessType?: 'online' | 'offline';
    capabilityMode: ConnectCapabilityMode | null;
  }): 'online' | 'offline';
  shouldIssueRefreshToken(params: {
    mailbox: MailboxRecord;
    accessType: 'online' | 'offline';
    prompt: string | null;
  }): boolean;
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
  readJsonBody(): Promise<Record<string, unknown>>;
  readFormBody(): Promise<Record<string, string>>;
  readRawBody(): Promise<Buffer>;
  sendJson(statusCode: number, body: unknown, options?: { headers?: Record<string, string> }): void;
  sendHtml(statusCode: number, body: string, options?: { headers?: Record<string, string> }): void;
  sendText(statusCode: number, body?: string, options?: { headers?: Record<string, string> }): void;
  sendBytes(
    statusCode: number,
    bytes: Uint8Array,
    options?: { headers?: Record<string, string>; contentType?: string },
  ): void;
  parseBearerToken(): string;
  matchPath(pathname: string, pattern: RegExp): RegExpMatchArray | null;
  splitScopes(raw: string | null): string[];
  parseBooleanQuery(value: string | null): boolean;
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
