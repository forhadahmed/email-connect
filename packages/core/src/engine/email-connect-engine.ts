import { ConflictError, NotFoundError, UnauthorizedError } from '../errors.js';
import type {
  AttachmentSeed,
  CreateMailboxInput,
  CreateMailboxResult,
  DraftSeed,
  MailboxAuthRecord,
  MailboxAttachment,
  MailboxBackendConfig,
  MailboxChange,
  MailboxDraft,
  MailboxMessage,
  MailboxRecord,
  MailboxSnapshot,
  MessageSeed,
  OutboxMessage,
  ScenarioDefinition,
} from '../types.js';
import { EmailConnectConnectPlane } from '../connect/plane.js';
import type { EmailConnectProvider } from '../provider.js';
import { bytesFromUnknown } from '../utils/base64.js';
import { normalizeAddressInput } from '../utils/raw-email.js';
import { DeterministicClock } from './clock.js';

// Most fixture fields are optional, so normalize strings once at the engine
// boundary before provider packages start projecting resources.
function cleanString(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

// Header maps are normalized while preserving caller-provided names. Provider
// projections can later decide whether to filter or render them.
function normalizeHeaders(value: Record<string, string> | null | undefined): Record<string, string> | null {
  if (!value) return null;
  const entries = Object.entries(value)
    .map(([key, entry]) => [String(key).trim(), String(entry).trim()] as const)
    .filter(([key, entry]) => key && entry);
  return entries.length ? Object.fromEntries(entries) : null;
}

// Stable dedupe preserves fixture order. That matters for label lists and scope
// payloads where tests often assert exact arrays.
function uniqueStrings(values: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of values || []) {
    const normalized = String(entry || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

// Message timestamps accept Date/string inputs but fall back to the deterministic
// clock so generated and hand-authored fixtures behave the same way.
function normalizeReceivedAt(value: string | Date | null | undefined, fallbackIso: string): string {
  if (value == null) return fallbackIso;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallbackIso;
  return parsed.toISOString();
}

// Backend config is normalized once at the engine seam so provider services can
// treat missing knobs as already-defaulted state.
function normalizeBackendConfig(input: Partial<MailboxBackendConfig> | undefined): MailboxBackendConfig {
  return {
    ...(input?.latencyMs != null ? { latencyMs: input.latencyMs } : {}),
    ...(input?.historyResetBeforeRowId != null ? { historyResetBeforeRowId: input.historyResetBeforeRowId } : {}),
    ...(input?.hiddenLabelNames != null ? { hiddenLabelNames: uniqueStrings(input.hiddenLabelNames) } : {}),
    ...(input?.historyReplayMessageIds != null ? { historyReplayMessageIds: uniqueStrings(input.historyReplayMessageIds) } : {}),
    ...(input?.invalidDeltaBeforeRowId != null ? { invalidDeltaBeforeRowId: input.invalidDeltaBeforeRowId } : {}),
    ...(input?.omitAttachmentContentBytesIds != null
      ? { omitAttachmentContentBytesIds: uniqueStrings(input.omitAttachmentContentBytesIds) }
      : {}),
    ...(input?.connect
      ? {
          connect: {
            ...(input.connect.consentMode != null ? { consentMode: input.connect.consentMode } : {}),
            ...(input.connect.tokenFailureMode != null ? { tokenFailureMode: input.connect.tokenFailureMode } : {}),
            ...(input.connect.tokenFailureOperations != null
              ? { tokenFailureOperations: uniqueStrings(input.connect.tokenFailureOperations) }
              : {}),
            ...(input.connect.tokenFailureHits != null ? { tokenFailureHits: input.connect.tokenFailureHits } : {}),
            ...(input.connect.omitRefreshToken != null ? { omitRefreshToken: input.connect.omitRefreshToken } : {}),
            ...(input.connect.dropGrantedScopes != null
              ? { dropGrantedScopes: uniqueStrings(input.connect.dropGrantedScopes) }
              : {}),
            ...(input.connect.rotateRefreshTokenOnRefresh != null
              ? { rotateRefreshTokenOnRefresh: input.connect.rotateRefreshTokenOnRefresh }
              : {}),
            ...(input.connect.revokePriorRefreshTokenOnRotation != null
              ? { revokePriorRefreshTokenOnRotation: input.connect.revokePriorRefreshTokenOnRotation }
              : {}),
            ...(input.connect.authCodeTtlSec != null ? { authCodeTtlSec: input.connect.authCodeTtlSec } : {}),
            ...(input.connect.accessTokenTtlSec != null ? { accessTokenTtlSec: input.connect.accessTokenTtlSec } : {}),
            ...(input.connect.refreshTokenTtlSec != null ? { refreshTokenTtlSec: input.connect.refreshTokenTtlSec } : {}),
          },
        }
      : {}),
    ...(input?.transientFailureMode != null ? { transientFailureMode: input.transientFailureMode } : {}),
    ...(input?.transientFailureOperations != null
      ? { transientFailureOperations: uniqueStrings(input.transientFailureOperations) }
      : {}),
    ...(input?.transientFailureHits != null ? { transientFailureHits: input.transientFailureHits } : {}),
    ...(input?.authFailureMode != null ? { authFailureMode: input.authFailureMode } : {}),
    ...(input?.authFailureOperations != null ? { authFailureOperations: uniqueStrings(input.authFailureOperations) } : {}),
    ...(input?.authFailureHits != null ? { authFailureHits: input.authFailureHits } : {}),
  };
}

// Clone binary attachments defensively so snapshots cannot mutate the canonical
// in-memory artifact store.
function cloneAttachment(attachment: MailboxAttachment): MailboxAttachment {
  return {
    providerAttachmentId: attachment.providerAttachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    contentBytes: new Uint8Array(attachment.contentBytes),
    attachmentType: attachment.attachmentType,
    isInline: attachment.isInline,
    contentId: attachment.contentId,
    contentLocation: attachment.contentLocation,
    sourceUrl: attachment.sourceUrl,
    embeddedMessage: attachment.embeddedMessage ? { ...attachment.embeddedMessage } : null,
  };
}

// Message clones preserve record shape while isolating mutable arrays and
// binary attachment buffers from callers.
function cloneMessage(message: MailboxMessage): MailboxMessage {
  return {
    ...message,
    labels: [...message.labels],
    rawHeaders: message.rawHeaders ? { ...message.rawHeaders } : null,
    attachments: message.attachments.map(cloneAttachment),
  };
}

// Draft clones follow the same rule as messages: consumers get snapshots, not
// direct handles into provider state.
function cloneDraft(draft: MailboxDraft): MailboxDraft {
  return {
    ...draft,
    attachments: draft.attachments.map(cloneAttachment),
  };
}

/**
 * Public harness callers often think in provider-operation names such as
 * `history.list` or `delta.get`, while internal service code may choose to
 * qualify those as `gmail.history.list` or `graph.delta.get`.
 *
 * Accepting both keeps the fault-injection surface ergonomic and preserves
 * compatibility with the operation names already used in microtms.
 */
function operationMatches(configuredOperations: string[] | undefined, operation: string): boolean {
  const operations = configuredOperations || [];
  if (!operations.length) return true;
  const normalized = operation.trim().toLowerCase();
  const suffix = normalized.includes('.') ? normalized.split('.').slice(1).join('.') : normalized;
  return operations.some((entry) => {
    const candidate = String(entry || '').trim().toLowerCase();
    if (!candidate) return false;
    return candidate === normalized || candidate === suffix;
  });
}

// Change-row snapshots keep label arrays isolated so history/delta assertions
// cannot accidentally rewrite future cursor behavior.
function cloneChange(change: MailboxChange): MailboxChange {
  return {
    ...change,
    ...(change.addedLabels ? { addedLabels: [...change.addedLabels] } : {}),
    ...(change.removedLabels ? { removedLabels: [...change.removedLabels] } : {}),
  };
}

// Auth clones expose current grant state to control-plane callers without
// letting callers mutate granted scopes directly.
function cloneAuth(auth: MailboxAuthRecord): MailboxAuthRecord {
  return {
    ...auth,
    grantedScopes: [...auth.grantedScopes],
  };
}

// Generic date normalization is used for auth and embedded-message state, where
// invalid fixture dates should be omitted rather than silently rewritten.
function normalizeDate(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

// Initial mailbox auth supports both pre-consented mailboxes and direct bearer
// token fixtures, then the connect plane canonicalizes the grant.
function initialMailboxAuth(input: CreateMailboxInput, accessToken: string): MailboxAuthRecord {
  const refreshToken =
    input.auth && 'refreshToken' in input.auth ? cleanString(input.auth.refreshToken) : `refresh-${accessToken}`;
  return {
    clientId: cleanString(input.auth?.clientId),
    grantedScopes: (input.auth?.scopes || []).map((scope) => String(scope || '').trim()).filter(Boolean),
    capabilityMode: input.auth?.capabilityMode || 'send',
    accessToken,
    accessTokenExpiresAt: normalizeDate(input.auth?.accessTokenExpiresAt),
    refreshToken,
    refreshTokenExpiresAt: normalizeDate(input.auth?.refreshTokenExpiresAt),
    revokedAt: normalizeDate(input.auth?.revokedAt),
    lastConsentAt: normalizeDate(input.auth?.lastConsentAt),
    offlineGrantIssued: Boolean(refreshToken),
  };
}

export type EmailConnectEngineOptions = {
  baseTime?: string | Date;
  providers?: EmailConnectProvider[];
};

/**
 * Canonical in-memory state engine shared by the SDK and HTTP server.
 *
 * Provider packages should not own durable mailbox state. They project this
 * provider-neutral model into Gmail or Graph shapes and feed mutations back
 * through these methods.
 */
export class EmailConnectEngine {
  // The clock is part of canonical state because token expiry, watch expiry,
  // generated mail timelines, and cursor behavior all depend on it.
  private readonly clock: DeterministicClock;
  // The harness intentionally keeps all mutable mailbox state in memory first.
  // Server and SDK surfaces both delegate into this engine, so tests can swap
  // storage later without changing provider semantics.
  private readonly mailboxes = new Map<string, MailboxRecord>();
  private readonly aliasToMailboxId = new Map<string, string>();
  private readonly accessTokenToMailboxId = new Map<string, string>();
  private readonly providers = new Map<string, EmailConnectProvider>();
  private readonly outbox: OutboxMessage[] = [];
  // Sequence counters intentionally stay separate so message rows, changes,
  // outbox entries, and synthetic ids can evolve independently.
  private nextMailboxSeq = 1;
  private nextMessageRowId = 1;
  private nextChangeRowId = 1;
  private nextOutboxSeq = 1;
  private nextSyntheticSeq = 1;
  readonly connect: EmailConnectConnectPlane;

  // Installing providers at construction keeps package composition explicit:
  // core can run alone, Gmail-only, Graph-only, or with both providers.
  constructor(options?: EmailConnectEngineOptions) {
    this.clock = new DeterministicClock(options?.baseTime);
    for (const provider of options?.providers || []) {
      this.installProvider(provider);
    }
    this.connect = new EmailConnectConnectPlane(this);
  }

  // Expose engine time as a first-class API so scenarios and token/cursor
  // behavior can be advanced deterministically.
  nowIso(): string {
    return this.clock.nowIso();
  }

  // Advance deterministic time without sleeping; useful for token expiry,
  // consent expiry, watch expiry, and generated mailbox timelines.
  advanceTimeMs(ms: number): string {
    return this.clock.advanceMs(ms);
  }

  /**
   * Deterministic synthetic ids matter for public test harnesses because users
   * often want exact fixture assertions and reproducible snapshots. Provider
   * facades should ask the engine for ids instead of mixing in `Date.now()` or
   * `Math.random()`.
   */
  generateId(prefix: string): string {
    return `${prefix}-${this.nextSyntheticSeq++}`;
  }

  // Provider installation is intentionally idempotence-hostile: duplicate
  // providers usually mean a package composition bug.
  installProvider(provider: EmailConnectProvider): void {
    const id = String(provider.id || '').trim();
    if (!id) throw new ConflictError('Provider id is required');
    if (this.providers.has(id)) {
      throw new ConflictError(`Provider already installed: ${id}`);
    }
    this.providers.set(id, provider);
  }

  // Return installed provider definitions for the HTTP host route loop.
  listProviders(): EmailConnectProvider[] {
    return Array.from(this.providers.values());
  }

  // Provider packages and control APIs use this to fail fast when a consumer
  // tries to exercise a provider that was not installed.
  requireProvider(providerId: string): EmailConnectProvider {
    const provider = this.providers.get(String(providerId || '').trim());
    if (!provider) {
      throw new NotFoundError(`Provider is not installed: ${providerId}`);
    }
    return provider;
  }

  /**
   * Mailbox creation is the canonical seeding seam. Everything else in the
   * product assumes a mailbox record already exists and points back here for
   * normalized auth state, failure budgets, and preloaded mail.
   */
  createMailbox(input: CreateMailboxInput): CreateMailboxResult {
    this.requireProvider(input.provider);
    const mailboxId = cleanString(input.id) || `mailbox-${this.nextMailboxSeq++}`;
    if (this.mailboxes.has(mailboxId)) {
      throw new ConflictError(`Mailbox already exists: ${mailboxId}`);
    }

    const alias = cleanString(input.alias);
    if (alias && this.aliasToMailboxId.has(alias)) {
      throw new ConflictError(`Mailbox alias already exists: ${alias}`);
    }

    const primaryEmail = String(input.primaryEmail || '').trim();
    if (!primaryEmail) {
      throw new ConflictError('primaryEmail is required');
    }

    const accessToken = cleanString(input.auth?.accessToken) || cleanString(input.accessToken) || this.generateId('access-token');
    if (this.accessTokenToMailboxId.has(accessToken)) {
      throw new ConflictError('Mailbox access token must be unique');
    }

    const backend = normalizeBackendConfig(input.backend);
    const record: MailboxRecord = {
      id: mailboxId,
      alias,
      provider: input.provider,
      primaryEmail,
      providerUserId: cleanString(input.providerUserId) || primaryEmail,
      displayName: cleanString(input.displayName),
      accessToken,
      auth: initialMailboxAuth(input, accessToken),
      backend,
      messages: [],
      drafts: [],
      changes: [],
      failureBudget: {
        transientHitsRemaining: backend.transientFailureHits ?? 0,
        authHitsRemaining: backend.authFailureHits ?? 0,
      },
    };

    this.mailboxes.set(mailboxId, record);
    if (alias) this.aliasToMailboxId.set(alias, mailboxId);
    this.accessTokenToMailboxId.set(accessToken, mailboxId);
    this.connect.seedMailboxGrant(mailboxId, {
      ...input.auth,
      accessToken,
    });

    for (const message of input.messages || []) {
      this.appendMessage(mailboxId, message);
    }
    for (const draft of input.drafts || []) {
      this.createDraft(mailboxId, draft);
    }

    return {
      mailboxId,
      alias,
      accessToken,
      provider: input.provider,
      primaryEmail,
    };
  }

  // Scenario loading is a thin convenience layer over mailbox creation so the
  // same validation applies to JSON scenarios and direct SDK setup.
  loadScenario(definition: ScenarioDefinition): CreateMailboxResult[] {
    if (definition.baseTime) {
      this.clock.setTime(definition.baseTime);
    }
    return definition.mailboxes.map((mailbox) => this.createMailbox(mailbox));
  }

  // List mailbox snapshots rather than records so callers can inspect state
  // without mutating the live engine.
  listMailboxes(): MailboxSnapshot[] {
    return Array.from(this.mailboxes.values()).map((mailbox) => this.snapshotMailbox(mailbox.id));
  }

  // Snapshots are the public inspection format for both SDK and control-plane
  // users; provider services should use `requireMailbox` when they need records.
  snapshotMailbox(identifier: string): MailboxSnapshot {
    const mailbox = this.requireMailbox(identifier);
    return {
      id: mailbox.id,
      alias: mailbox.alias,
      provider: mailbox.provider,
      primaryEmail: mailbox.primaryEmail,
      providerUserId: mailbox.providerUserId,
      displayName: mailbox.displayName,
      accessToken: mailbox.accessToken,
      auth: this.connect.getMailboxAuth(mailbox.id),
      backend: { ...mailbox.backend },
      messages: mailbox.messages.map(cloneMessage),
      drafts: mailbox.drafts.map(cloneDraft),
      changes: mailbox.changes.map(cloneChange),
    };
  }

  /**
   * Provider HTTP facades resolve bearer tokens through this mapping. The extra
   * provider check prevents a token minted for one facade from being reused
   * against another by accident.
   */
  resolveMailboxByAccessToken(provider: string, accessToken: string): MailboxRecord {
    const mailboxId = this.accessTokenToMailboxId.get(accessToken);
    if (!mailboxId) {
      throw new UnauthorizedError('Unknown mailbox access token');
    }
    const mailbox = this.requireMailbox(mailboxId);
    if (mailbox.provider !== provider) {
      throw new UnauthorizedError('Mailbox token is not valid for this provider facade');
    }
    return mailbox;
  }

  // Accept either mailbox id or alias. This keeps examples readable while still
  // allowing deterministic ids for black-box tests.
  requireMailbox(identifier: string): MailboxRecord {
    const direct = this.mailboxes.get(identifier);
    if (direct) return direct;
    const byAlias = this.aliasToMailboxId.get(identifier);
    if (byAlias) {
      const mailbox = this.mailboxes.get(byAlias);
      if (mailbox) return mailbox;
    }
    throw new NotFoundError(`Mailbox not found: ${identifier}`);
  }

  // Backend configuration is mutable by design: fault injection and provider
  // drift scenarios often need to change while a test is already running.
  configureBackend(identifier: string, patch: Partial<MailboxBackendConfig>): MailboxSnapshot {
    const mailbox = this.requireMailbox(identifier);
    mailbox.backend = normalizeBackendConfig({
      ...mailbox.backend,
      ...patch,
    });
    mailbox.failureBudget.transientHitsRemaining = mailbox.backend.transientFailureHits ?? 0;
    mailbox.failureBudget.authHitsRemaining = mailbox.backend.authFailureHits ?? 0;
    this.connect.resetMailboxRuntime(mailbox.id);
    return this.snapshotMailbox(identifier);
  }

  /**
   * Messages are immutable enough to act as the primary mailbox history record,
   * while change rows carry replay, deletion, and label churn on top.
   */
  appendMessage(identifier: string, seed: MessageSeed): MailboxMessage {
    const mailbox = this.requireMailbox(identifier);
    const providerMessageId = cleanString(seed.providerMessageId) || this.generateId(`${mailbox.provider}-msg`);
    const existing = mailbox.messages.find((message) => message.providerMessageId === providerMessageId);
    if (existing) {
      throw new ConflictError(`Message already exists: ${providerMessageId}`);
    }

    const rowId = this.nextMessageRowId++;
    const message: MailboxMessage = {
      rowId,
      providerMessageId,
      providerThreadId: cleanString(seed.providerThreadId) || this.generateId(`${mailbox.provider}-thread`),
      subject: cleanString(seed.subject),
      from: cleanString(seed.from),
      to: normalizeAddressInput(seed.to),
      messageId: cleanString(seed.messageId) || `<${providerMessageId}@email-connect.local>`,
      inReplyTo: cleanString(seed.inReplyTo),
      references: cleanString(seed.references),
      snippet: cleanString(seed.snippet) || cleanString(seed.bodyText) || cleanString(seed.bodyHtml),
      bodyText: cleanString(seed.bodyText),
      bodyHtml: cleanString(seed.bodyHtml),
      rawHeaders: normalizeHeaders(seed.rawHeaders),
      labels: uniqueStrings(seed.labels?.length ? seed.labels : ['INBOX']),
      receivedAt: normalizeReceivedAt(seed.receivedAt, this.clock.nowIso()),
      deleted: false,
      attachments: (seed.attachments || []).map((attachment) => this.materializeAttachment(attachment)),
    };
    mailbox.messages.push(message);
    mailbox.messages.sort((left, right) => {
      const a = left.receivedAt || '';
      const b = right.receivedAt || '';
      if (a === b) return left.rowId - right.rowId;
      return a.localeCompare(b);
    });

    this.recordChange(mailbox, {
      kind: 'message_added',
      providerMessageId,
    });
    return cloneMessage(message);
  }

  // Message updates are primarily for scenario evolution. Label changes also
  // emit change rows because providers expose those through sync feeds.
  updateMessage(
    identifier: string,
    providerMessageId: string,
    patch: {
      subject?: string | null;
      from?: string | null;
      to?: string | string[] | null;
      snippet?: string | null;
      bodyText?: string | null;
      bodyHtml?: string | null;
      labels?: string[];
      rawHeaders?: Record<string, string> | null;
    },
  ): MailboxMessage {
    const mailbox = this.requireMailbox(identifier);
    const message = this.findMessage(mailbox, providerMessageId);
    const priorLabels = [...message.labels];

    if ('subject' in patch) message.subject = cleanString(patch.subject);
    if ('from' in patch) message.from = cleanString(patch.from);
    if ('to' in patch) message.to = normalizeAddressInput(patch.to);
    if ('snippet' in patch) message.snippet = cleanString(patch.snippet);
    if ('bodyText' in patch) message.bodyText = cleanString(patch.bodyText);
    if ('bodyHtml' in patch) message.bodyHtml = cleanString(patch.bodyHtml);
    if ('rawHeaders' in patch) message.rawHeaders = normalizeHeaders(patch.rawHeaders);
    if ('labels' in patch) {
      message.labels = uniqueStrings(patch.labels?.length ? patch.labels : ['INBOX']);
      const added = message.labels.filter((label) => !priorLabels.includes(label));
      const removed = priorLabels.filter((label) => !message.labels.includes(label));
      if (added.length || removed.length) {
        this.recordChange(mailbox, {
          kind: 'label_changed',
          providerMessageId,
          addedLabels: added,
          removedLabels: removed,
        });
      }
    }

    return cloneMessage(message);
  }

  // Deletion is soft so full-state inspection and provider change feeds can
  // still describe that the item once existed.
  deleteMessage(identifier: string, providerMessageId: string): void {
    const mailbox = this.requireMailbox(identifier);
    const message = this.findMessage(mailbox, providerMessageId);
    if (message.deleted) return;
    message.deleted = true;
    this.recordChange(mailbox, {
      kind: 'message_deleted',
      providerMessageId,
    });
  }

  // Add an attachment to an existing message through the canonical artifact
  // path; provider-specific resource shapes are added at provider boundaries.
  addAttachment(identifier: string, providerMessageId: string, seed: AttachmentSeed): MailboxAttachment {
    const mailbox = this.requireMailbox(identifier);
    const message = this.findMessage(mailbox, providerMessageId);
    const attachment = this.materializeAttachment(seed);
    message.attachments.push(attachment);
    return cloneAttachment(attachment);
  }

  // Draft attachments are modeled directly in core so provider services can
  // share one compose substrate instead of inventing provider-specific draft
  // storage for uploads and inline files.
  addDraftAttachment(identifier: string, providerDraftId: string, seed: AttachmentSeed): MailboxAttachment {
    const mailbox = this.requireMailbox(identifier);
    const draft = mailbox.drafts.find((entry) => entry.providerDraftId === providerDraftId);
    if (!draft) {
      throw new NotFoundError(`Draft not found: ${providerDraftId}`);
    }
    const attachment = this.materializeAttachment(seed);
    draft.attachments.push(attachment);
    return cloneAttachment(attachment);
  }

  // Draft creation is provider-neutral. Gmail and Graph are responsible for
  // turning their respective compose request shapes into this seed.
  createDraft(identifier: string, seed: DraftSeed): MailboxDraft {
    const mailbox = this.requireMailbox(identifier);
    const providerDraftId = cleanString(seed.providerDraftId) || this.generateId(`${mailbox.provider}-draft`);
    if (mailbox.drafts.some((draft) => draft.providerDraftId === providerDraftId)) {
      throw new ConflictError(`Draft already exists: ${providerDraftId}`);
    }

    const draft: MailboxDraft = {
      providerDraftId,
      providerDraftMessageId: cleanString(seed.providerDraftMessageId) || providerDraftId,
      providerThreadId: cleanString(seed.providerThreadId),
      to: normalizeAddressInput(seed.to),
      subject: cleanString(seed.subject),
      bodyText: String(seed.bodyText || ''),
      bodyHtml: cleanString(seed.bodyHtml),
      attachments: (seed.attachments || []).map((attachment) => this.materializeAttachment(attachment)),
    };
    mailbox.drafts.push(draft);
    return cloneDraft(draft);
  }

  // Draft updates intentionally affect only compose fields. Attachment changes
  // go through dedicated attachment APIs so upload-session behavior is testable.
  updateDraft(
    identifier: string,
    providerDraftId: string,
    patch: {
      to?: string | string[] | null;
      subject?: string | null;
      bodyText?: string | null;
      bodyHtml?: string | null;
    },
  ): MailboxDraft {
    const mailbox = this.requireMailbox(identifier);
    const draft = mailbox.drafts.find((entry) => entry.providerDraftId === providerDraftId);
    if (!draft) {
      throw new NotFoundError(`Draft not found: ${providerDraftId}`);
    }
    if ('to' in patch) draft.to = normalizeAddressInput(patch.to);
    if ('subject' in patch) draft.subject = cleanString(patch.subject);
    if ('bodyText' in patch) draft.bodyText = String(patch.bodyText || '');
    if ('bodyHtml' in patch) draft.bodyHtml = cleanString(patch.bodyHtml);
    return cloneDraft(draft);
  }

  // Draft reads return a clone so provider services can safely project draft
  // state without exposing mutable references to callers.
  getDraft(identifier: string, providerDraftId: string): MailboxDraft | null {
    const mailbox = this.requireMailbox(identifier);
    const draft = mailbox.drafts.find((entry) => entry.providerDraftId === providerDraftId);
    return draft ? cloneDraft(draft) : null;
  }

  // Draft deletion is shared by send and explicit DELETE paths.
  deleteDraft(identifier: string, providerDraftId: string): boolean {
    const mailbox = this.requireMailbox(identifier);
    const index = mailbox.drafts.findIndex((entry) => entry.providerDraftId === providerDraftId);
    if (index < 0) return false;
    mailbox.drafts.splice(index, 1);
    return true;
  }

  /**
   * Sending a draft records the intent in outbox but does not automatically
   * materialize a sent-item row. Provider services may layer that behavior on
   * top because Gmail and Graph differ here.
   */
  sendDraft(
    identifier: string,
    providerDraftId: string,
    provider: 'gmail' | 'graph',
    providerMessageId?: string,
  ): OutboxMessage {
    const mailbox = this.requireMailbox(identifier);
    const draft = mailbox.drafts.find((entry) => entry.providerDraftId === providerDraftId);
    if (!draft) {
      throw new NotFoundError(`Draft not found: ${providerDraftId}`);
    }
    const outboxMessage: OutboxMessage = {
      id: `outbox-${this.nextOutboxSeq++}`,
      provider,
      mailboxId: mailbox.id,
      to: draft.to,
      subject: draft.subject,
      bodyText: draft.bodyText,
      bodyHtml: draft.bodyHtml,
      providerMessageId: providerMessageId || providerDraftId,
      providerThreadId: draft.providerThreadId,
      sentAt: this.clock.nowIso(),
    };
    this.outbox.push(outboxMessage);
    return { ...outboxMessage };
  }

  /**
   * Some providers can replay already-delivered change records without the
   * message itself changing. Modeling replay as a first-class change kind lets
   * Gmail history and Graph delta tests verify idempotence explicitly.
   */
  appendReplayChange(identifier: string, providerMessageId: string): void {
    const mailbox = this.requireMailbox(identifier);
    this.findMessage(mailbox, providerMessageId);
    this.recordChange(mailbox, {
      kind: 'message_replayed',
      providerMessageId,
    });
  }

  // Outbox is the canonical observable outbound side effect. Provider packages
  // may also materialize sent-item messages when their API semantics require it.
  listOutbox(mailboxId?: string): OutboxMessage[] {
    return this.outbox
      .filter((entry) => !mailboxId || entry.mailboxId === this.requireMailbox(mailboxId).id)
      .map((entry) => ({ ...entry }));
  }

  // Visible messages are what provider list/get endpoints should expose by
  // default; deleted messages remain available through change rows only.
  listVisibleMessages(mailbox: MailboxRecord): MailboxMessage[] {
    return mailbox.messages.filter((message) => !message.deleted).map(cloneMessage);
  }

  // All messages are used by sync feeds and inspection paths that must reason
  // about historical deleted items.
  listAllMessages(mailbox: MailboxRecord): MailboxMessage[] {
    return mailbox.messages.map(cloneMessage);
  }

  // Change rows are the provider-neutral substrate for Gmail history and Graph
  // delta.
  listChanges(mailbox: MailboxRecord): MailboxChange[] {
    return mailbox.changes.map(cloneChange);
  }

  // Token replacement updates both the mailbox record and the reverse lookup
  // map that provider HTTP facades use for bearer auth.
  replaceMailboxAccessToken(mailbox: MailboxRecord, accessToken: string): void {
    if (mailbox.accessToken) {
      this.accessTokenToMailboxId.delete(mailbox.accessToken);
    }
    mailbox.accessToken = accessToken;
    mailbox.auth = {
      ...mailbox.auth,
      accessToken,
    };
    this.accessTokenToMailboxId.set(accessToken, mailbox.id);
  }

  // Clearing a token removes the bearer lookup while preserving auth snapshot
  // metadata such as revokedAt for inspection.
  clearMailboxAccessToken(mailbox: MailboxRecord): void {
    if (mailbox.accessToken) {
      this.accessTokenToMailboxId.delete(mailbox.accessToken);
    }
  }

  // Failure injection is consumed by provider services right before the
  // simulated provider call would have happened, which keeps retries and
  // sequencing realistic from the consumer's point of view.
  maybeThrowInjectedFailure(mailbox: MailboxRecord, operation: string): void {
    const authOps = mailbox.backend.authFailureOperations || [];
    if (
      mailbox.backend.authFailureMode &&
      mailbox.failureBudget.authHitsRemaining > 0 &&
      operationMatches(authOps, operation)
    ) {
      mailbox.failureBudget.authHitsRemaining -= 1;
      if (mailbox.backend.authFailureMode === 'invalid_grant') {
        throw new Error(`access failed: invalid_grant (email-connect auth failure: ${operation})`);
      }
      const error = new Error(`403 Forbidden: insufficient privileges (email-connect auth failure: ${operation})`);
      Object.assign(error, { statusCode: 403, code: 'Forbidden' });
      throw error;
    }

    const transientOps = mailbox.backend.transientFailureOperations || [];
    if (
      mailbox.backend.transientFailureMode &&
      mailbox.failureBudget.transientHitsRemaining > 0 &&
      operationMatches(transientOps, operation)
    ) {
      mailbox.failureBudget.transientHitsRemaining -= 1;
      if (mailbox.backend.transientFailureMode === '429') {
        const error = new Error(`429 TooManyRequests (email-connect transient failure: ${operation})`);
        Object.assign(error, { statusCode: 429, code: 'TooManyRequests' });
        throw error;
      }
      if (mailbox.backend.transientFailureMode === '503') {
        const error = new Error(`503 Service Unavailable (email-connect transient failure: ${operation})`);
        Object.assign(error, { statusCode: 503, code: 'ServiceUnavailable' });
        throw error;
      }
      if (mailbox.backend.transientFailureMode === 'timeout') {
        throw new Error(`timeout while contacting provider (email-connect transient failure: ${operation})`);
      }
      throw new Error(`ECONNRESET network disconnect (email-connect transient failure: ${operation})`);
    }
  }

  // Latency injection uses real sleep because black-box clients need to exercise
  // timeout and concurrency behavior against actual wall-clock delay.
  async maybeDelay(mailbox: MailboxRecord): Promise<void> {
    if (!mailbox.backend.latencyMs || mailbox.backend.latencyMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, mailbox.backend.latencyMs));
  }

  // Materialization is where loose fixture input becomes a fully normalized
  // attachment record that every provider surface can trust.
  private materializeAttachment(seed: AttachmentSeed): MailboxAttachment {
    const bytes = bytesFromUnknown(seed.contentBytes);
    return {
      providerAttachmentId: cleanString(seed.providerAttachmentId) || this.generateId('att'),
      filename: String(seed.filename || '').trim() || 'attachment.bin',
      mimeType: String(seed.mimeType || '').trim() || 'application/octet-stream',
      sizeBytes: seed.sizeBytes == null ? bytes.byteLength : Number(seed.sizeBytes),
      contentBytes: bytes,
      attachmentType:
        seed.attachmentType === 'item' || seed.attachmentType === 'reference' ? seed.attachmentType : 'file',
      isInline: Boolean(seed.isInline),
      contentId: cleanString(seed.contentId),
      contentLocation: cleanString(seed.contentLocation),
      sourceUrl: cleanString(seed.sourceUrl),
      embeddedMessage: seed.embeddedMessage
        ? {
            subject: cleanString(seed.embeddedMessage.subject),
            from: cleanString(seed.embeddedMessage.from),
            to: normalizeAddressInput(seed.embeddedMessage.to),
            bodyText: cleanString(seed.embeddedMessage.bodyText),
            bodyHtml: cleanString(seed.embeddedMessage.bodyHtml),
            receivedAt: normalizeDate(seed.embeddedMessage.receivedAt),
          }
        : null,
    };
  }

  // Message lookup is a private invariant boundary: if a provider asks for a
  // missing item, the engine raises the same NotFound shape consistently.
  private findMessage(mailbox: MailboxRecord, providerMessageId: string): MailboxMessage {
    const message = mailbox.messages.find((entry) => entry.providerMessageId === providerMessageId);
    if (!message) {
      throw new NotFoundError(`Message not found: ${providerMessageId}`);
    }
    return message;
  }

  // Change rows are append-only so provider cursors can be derived later
  // without mutating historical sequencing.
  private recordChange(
    mailbox: MailboxRecord,
    change: {
      kind: MailboxChange['kind'];
      providerMessageId: string;
      addedLabels?: string[];
      removedLabels?: string[];
    },
  ): void {
    mailbox.changes.push({
      rowId: this.nextChangeRowId++,
      kind: change.kind,
      providerMessageId: change.providerMessageId,
      at: this.clock.nowIso(),
      ...(change.addedLabels?.length ? { addedLabels: [...change.addedLabels] } : {}),
      ...(change.removedLabels?.length ? { removedLabels: [...change.removedLabels] } : {}),
    });
  }
}
