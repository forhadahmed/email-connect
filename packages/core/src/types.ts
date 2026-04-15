export type ProviderKind = string;
export type ConnectCapabilityMode = 'read' | 'send';
export type ConnectConsentMode = 'auto_approve' | 'interactive' | 'auto_deny';
export type ConnectTokenFailureMode =
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_scope'
  | 'temporarily_unavailable';

export type FailureMode = '429' | '503' | 'timeout' | 'disconnect';
export type AuthFailureMode = 'invalid_grant' | 'forbidden';

/**
 * Fault knobs are attached to a mailbox backend so scenarios can model
 * provider instability without mutating global process state.
 */
export type BackendFaultConfig = {
  latencyMs?: number;
  transientFailureMode?: FailureMode;
  transientFailureOperations?: string[];
  transientFailureHits?: number;
  authFailureMode?: AuthFailureMode;
  authFailureOperations?: string[];
  authFailureHits?: number;
};

/**
 * Gmail-only seams that materially affect sync clients.
 */
export type GmailBackendConfig = BackendFaultConfig & {
  historyResetBeforeRowId?: number;
  hiddenLabelNames?: string[];
  historyReplayMessageIds?: string[];
};

/**
 * Graph-only seams that materially affect delta and attachment clients.
 */
export type GraphBackendConfig = BackendFaultConfig & {
  invalidDeltaBeforeRowId?: number;
  omitAttachmentContentBytesIds?: string[];
};

/**
 * Connect-plane failures stay mailbox-local for the same reason as mail-plane
 * failures: consumers usually reason about a flaky mailbox grant, not a flaky
 * process-global OAuth service.
 */
export type ConnectBackendConfig = {
  consentMode?: ConnectConsentMode;
  tokenFailureMode?: ConnectTokenFailureMode;
  tokenFailureOperations?: string[];
  tokenFailureHits?: number;
  omitRefreshToken?: 'never' | 'once' | 'always';
  dropGrantedScopes?: string[];
  rotateRefreshTokenOnRefresh?: boolean;
  revokePriorRefreshTokenOnRotation?: boolean;
  authCodeTtlSec?: number;
  accessTokenTtlSec?: number;
  refreshTokenTtlSec?: number;
};

export type MailboxBackendConfig = GmailBackendConfig &
  GraphBackendConfig & {
    connect?: ConnectBackendConfig;
  };

/**
 * `MailboxAuthSeed` is intentionally close to the stored grant shape so tests
 * can preload a mailbox into any point of the OAuth lifecycle.
 */
export type MailboxAuthSeed = {
  clientId?: string | null;
  scopes?: string[];
  capabilityMode?: ConnectCapabilityMode | null;
  accessToken?: string;
  accessTokenExpiresAt?: string | Date | null;
  refreshToken?: string | null;
  refreshTokenExpiresAt?: string | Date | null;
  revokedAt?: string | Date | null;
  lastConsentAt?: string | Date | null;
};

export type MessageAddressLike =
  | string
  | string[]
  | null
  | undefined;

export type MailAttachmentType = 'file' | 'item' | 'reference';

export type HeaderMap = Record<string, string>;

/**
 * Embedded message metadata lets item attachments feel like message containers
 * without forcing core to model nested mailboxes.
 */
export type EmbeddedMessageSeed = {
  subject?: string | null;
  from?: string | null;
  to?: MessageAddressLike;
  bodyText?: string | null;
  bodyHtml?: string | null;
  receivedAt?: string | Date | null;
};

/**
 * Attachment seeds cover both heavyweight binary fixtures and generated
 * provider-native attachment shapes. `contentBytes` stays flexible because test
 * inputs often start life as strings, buffers, or decoded blobs.
 */
export type AttachmentSeed = {
  providerAttachmentId?: string;
  filename: string;
  mimeType: string;
  contentBytes: Uint8Array | ArrayBuffer | Buffer | string;
  sizeBytes?: number | null;
  attachmentType?: MailAttachmentType;
  isInline?: boolean;
  contentId?: string | null;
  contentLocation?: string | null;
  sourceUrl?: string | null;
  embeddedMessage?: EmbeddedMessageSeed | null;
};

/**
 * `MessageSeed` is the provider-neutral "mail plane" input shape. Provider
 * packages map it into Gmail payloads or Graph resources later.
 */
export type MessageSeed = {
  providerMessageId?: string;
  providerThreadId?: string | null;
  subject?: string | null;
  from?: string | null;
  to?: MessageAddressLike;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  rawHeaders?: HeaderMap | null;
  labels?: string[];
  receivedAt?: string | Date | null;
  attachments?: AttachmentSeed[];
};

/**
 * Drafts intentionally share most of the message shape so compose flows can
 * reuse the same attachment and body modeling as imported or received mail.
 */
export type DraftSeed = {
  providerDraftId?: string;
  providerDraftMessageId?: string | null;
  providerThreadId?: string | null;
  to?: MessageAddressLike;
  subject?: string | null;
  bodyText?: string;
  bodyHtml?: string | null;
  attachments?: AttachmentSeed[];
};

export type MailboxChangeKind = 'message_added' | 'message_replayed' | 'label_changed' | 'message_deleted';

/**
 * Change rows are the canonical substrate for Gmail history and Graph delta.
 * Providers can layer their own cursor semantics on top, but they should not
 * invent a second source of truth for mailbox evolution.
 */
export type MailboxChange = {
  rowId: number;
  kind: MailboxChangeKind;
  providerMessageId: string;
  at: string;
  addedLabels?: string[];
  removedLabels?: string[];
};

/**
 * Record types below are the normalized engine-owned state. They are stricter
 * than the seed types because provider services need fully materialized values.
 */
export type MailboxAttachment = {
  providerAttachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  contentBytes: Uint8Array;
  attachmentType: MailAttachmentType;
  isInline: boolean;
  contentId: string | null;
  contentLocation: string | null;
  sourceUrl: string | null;
  embeddedMessage: {
    subject: string | null;
    from: string | null;
    to: string | null;
    bodyText: string | null;
    bodyHtml: string | null;
    receivedAt: string | null;
  } | null;
};

export type MailboxMessage = {
  rowId: number;
  providerMessageId: string;
  providerThreadId: string | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  rawHeaders: HeaderMap | null;
  labels: string[];
  receivedAt: string | null;
  deleted: boolean;
  attachments: MailboxAttachment[];
};

export type MailboxDraft = {
  providerDraftId: string;
  providerDraftMessageId: string | null;
  providerThreadId: string | null;
  to: string | null;
  subject: string | null;
  bodyText: string;
  bodyHtml: string | null;
  attachments: MailboxAttachment[];
};

export type OutboxMessage = {
  id: string;
  provider: ProviderKind;
  mailboxId: string;
  to: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  providerMessageId: string;
  providerThreadId: string | null;
  sentAt: string;
};

/**
 * Mailbox creation is the main scenario-seeding seam. It accepts messages,
 * drafts, auth state, and backend behavior so a consumer can stand up a rich
 * mailbox in one call.
 */
export type CreateMailboxInput = {
  id?: string;
  alias?: string;
  provider: ProviderKind;
  primaryEmail: string;
  providerUserId?: string;
  displayName?: string | null;
  accessToken?: string;
  backend?: Partial<MailboxBackendConfig>;
  auth?: MailboxAuthSeed;
  messages?: MessageSeed[];
  drafts?: DraftSeed[];
};

/**
 * OAuth client registration is kept generic in core. Provider packages supply
 * the endpoint shapes and scope semantics around this shared lifecycle.
 */
export type OAuthClientInput = {
  provider: ProviderKind;
  clientId?: string;
  clientSecret?: string | null;
  name?: string | null;
  redirectUris: string[];
  defaultConsentMode?: ConnectConsentMode;
  allowPkce?: boolean;
};

export type OAuthClientRegistration = {
  id: string;
  provider: ProviderKind;
  clientId: string;
  clientSecret: string | null;
  name: string | null;
  redirectUris: string[];
  defaultConsentMode: ConnectConsentMode;
  allowPkce: boolean;
  createdAt: string;
};

/**
 * Authorization requests are the provider-neutral representation of "the app
 * sent the user to consent and is waiting on a decision".
 */
export type AuthorizationRequestInput = {
  provider: ProviderKind;
  clientId: string;
  redirectUri: string;
  state?: string | null;
  requestedScopes: string[];
  includeGrantedScopes?: boolean;
  capabilityMode?: ConnectCapabilityMode | null;
  accessType?: 'online' | 'offline';
  prompt?: string | null;
  loginHint?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: 'plain' | 'S256' | null;
  mailboxId?: string | null;
};

export type AuthorizationRequestSnapshot = {
  id: string;
  provider: ProviderKind;
  clientId: string;
  redirectUri: string;
  state: string | null;
  requestedScopes: string[];
  includeGrantedScopes: boolean;
  grantedScopes: string[] | null;
  capabilityMode: ConnectCapabilityMode | null;
  accessType: 'online' | 'offline';
  prompt: string | null;
  loginHint: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: 'plain' | 'S256' | null;
  mailboxId: string | null;
  consentMode: ConnectConsentMode;
  decision: 'pending' | 'approved' | 'denied';
  providerError: string | null;
  providerErrorDescription: string | null;
  createdAt: string;
  expiresAt: string;
};

/**
 * Snapshot types are what control-plane and HTTP consumers read back. Record
 * types are the internal fully materialized variant used by provider services.
 */
export type MailboxAuthSnapshot = {
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

export type MailboxAuthRecord = {
  clientId: string | null;
  grantedScopes: string[];
  capabilityMode: ConnectCapabilityMode | null;
  accessToken: string;
  accessTokenExpiresAt: string | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: string | null;
  revokedAt: string | null;
  lastConsentAt: string | null;
  offlineGrantIssued: boolean;
};

/**
 * Token grants intentionally look close to wire payloads returned by providers
 * so HTTP and white-box SDK flows assert against the same conceptual shape.
 */
export type OAuthTokenGrant = {
  provider: ProviderKind;
  mailboxId: string;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  grantedScopes: string[];
  capabilityMode: ConnectCapabilityMode | null;
  refreshToken?: string;
  refreshTokenExpiresAt?: string | null;
  idToken?: string;
};

export type ProviderEndpointUrls = {
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  userInfoUrl?: string;
  graphMeUrl?: string;
};

export type ScenarioMailboxInput = CreateMailboxInput;

/**
 * Scenarios are intentionally small: they set time and seed mailboxes. More
 * elaborate generation belongs in `testing/generation.ts`.
 */
export type ScenarioDefinition = {
  baseTime?: string | Date;
  mailboxes: ScenarioMailboxInput[];
};

export type MailboxSnapshot = {
  id: string;
  alias: string | null;
  provider: ProviderKind;
  primaryEmail: string;
  providerUserId: string;
  displayName: string | null;
  accessToken: string;
  auth: MailboxAuthSnapshot;
  backend: MailboxBackendConfig;
  messages: MailboxMessage[];
  drafts: MailboxDraft[];
  changes: MailboxChange[];
};

export type MailboxRecord = Omit<MailboxSnapshot, 'auth'> & {
  auth: MailboxAuthRecord;
  failureBudget: {
    transientHitsRemaining: number;
    authHitsRemaining: number;
  };
};

export type CreateMailboxResult = {
  mailboxId: string;
  alias: string | null;
  accessToken: string;
  provider: ProviderKind;
  primaryEmail: string;
};
