export type ProviderKind = 'gmail' | 'graph';
export type ConnectCapabilityMode = 'read' | 'send';
export type ConnectConsentMode = 'auto_approve' | 'interactive' | 'auto_deny';
export type ConnectTokenFailureMode =
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_scope'
  | 'temporarily_unavailable';

export type FailureMode = '429' | '503' | 'timeout' | 'disconnect';
export type AuthFailureMode = 'invalid_grant' | 'forbidden';

export type BackendFaultConfig = {
  latencyMs?: number;
  transientFailureMode?: FailureMode;
  transientFailureOperations?: string[];
  transientFailureHits?: number;
  authFailureMode?: AuthFailureMode;
  authFailureOperations?: string[];
  authFailureHits?: number;
};

export type GmailBackendConfig = BackendFaultConfig & {
  historyResetBeforeRowId?: number;
  hiddenLabelNames?: string[];
  historyReplayMessageIds?: string[];
};

export type GraphBackendConfig = BackendFaultConfig & {
  invalidDeltaBeforeRowId?: number;
  omitAttachmentContentBytesIds?: string[];
};

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

export type HeaderMap = Record<string, string>;

export type AttachmentSeed = {
  providerAttachmentId?: string;
  filename: string;
  mimeType: string;
  contentBytes: Uint8Array | ArrayBuffer | Buffer | string;
  sizeBytes?: number | null;
};

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

export type DraftSeed = {
  providerDraftId?: string;
  providerDraftMessageId?: string | null;
  providerThreadId?: string | null;
  to?: MessageAddressLike;
  subject?: string | null;
  bodyText?: string;
  bodyHtml?: string | null;
};

export type MailboxChangeKind = 'message_added' | 'message_replayed' | 'label_changed' | 'message_deleted';

export type MailboxChange = {
  rowId: number;
  kind: MailboxChangeKind;
  providerMessageId: string;
  at: string;
  addedLabels?: string[];
  removedLabels?: string[];
};

export type MailboxAttachment = {
  providerAttachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  contentBytes: Uint8Array;
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
