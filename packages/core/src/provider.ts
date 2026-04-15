import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  AuthorizationRequestSnapshot,
  ConnectCapabilityMode,
  MailboxRecord,
  OAuthTokenGrant,
  ProviderEndpointUrls,
  ProviderKind,
} from './core/types.js';
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

export type EmailConnectProviderHttp = {
  handle(context: EmailConnectHttpRouteContext): Promise<boolean>;
};

export type EmailConnectProvider = {
  id: ProviderKind;
  connect: EmailConnectProviderConnectSemantics;
  http?: EmailConnectProviderHttp;
};
