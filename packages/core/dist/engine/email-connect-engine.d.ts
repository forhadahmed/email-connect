import type { AttachmentSeed, CreateMailboxInput, CreateMailboxResult, DraftSeed, MailboxAttachment, MailboxBackendConfig, MailboxChange, MailboxDraft, MailboxMessage, MailboxRecord, MailboxSnapshot, MessageSeed, OutboxMessage, ScenarioDefinition } from '../core/types.js';
import { EmailConnectConnectPlane } from '../connect/plane.js';
import type { EmailConnectProvider } from '../provider.js';
export type EmailConnectEngineOptions = {
    baseTime?: string | Date;
    providers?: EmailConnectProvider[];
};
export declare class EmailConnectEngine {
    private readonly clock;
    private readonly mailboxes;
    private readonly aliasToMailboxId;
    private readonly accessTokenToMailboxId;
    private readonly providers;
    private readonly outbox;
    private nextMailboxSeq;
    private nextMessageRowId;
    private nextChangeRowId;
    private nextOutboxSeq;
    private nextSyntheticSeq;
    readonly connect: EmailConnectConnectPlane;
    constructor(options?: EmailConnectEngineOptions);
    nowIso(): string;
    advanceTimeMs(ms: number): string;
    /**
     * Deterministic synthetic ids matter for public test harnesses because users
     * often want exact fixture assertions and reproducible snapshots. Provider
     * facades should ask the engine for ids instead of mixing in `Date.now()` or
     * `Math.random()`.
     */
    generateId(prefix: string): string;
    installProvider(provider: EmailConnectProvider): void;
    listProviders(): EmailConnectProvider[];
    requireProvider(providerId: string): EmailConnectProvider;
    createMailbox(input: CreateMailboxInput): CreateMailboxResult;
    loadScenario(definition: ScenarioDefinition): CreateMailboxResult[];
    listMailboxes(): MailboxSnapshot[];
    snapshotMailbox(identifier: string): MailboxSnapshot;
    resolveMailboxByAccessToken(provider: string, accessToken: string): MailboxRecord;
    requireMailbox(identifier: string): MailboxRecord;
    configureBackend(identifier: string, patch: Partial<MailboxBackendConfig>): MailboxSnapshot;
    appendMessage(identifier: string, seed: MessageSeed): MailboxMessage;
    updateMessage(identifier: string, providerMessageId: string, patch: {
        subject?: string | null;
        from?: string | null;
        to?: string | string[] | null;
        snippet?: string | null;
        bodyText?: string | null;
        bodyHtml?: string | null;
        labels?: string[];
        rawHeaders?: Record<string, string> | null;
    }): MailboxMessage;
    deleteMessage(identifier: string, providerMessageId: string): void;
    addAttachment(identifier: string, providerMessageId: string, seed: AttachmentSeed): MailboxAttachment;
    createDraft(identifier: string, seed: DraftSeed): MailboxDraft;
    updateDraft(identifier: string, providerDraftId: string, patch: {
        to?: string | string[] | null;
        subject?: string | null;
        bodyText?: string | null;
        bodyHtml?: string | null;
    }): MailboxDraft;
    getDraft(identifier: string, providerDraftId: string): MailboxDraft | null;
    deleteDraft(identifier: string, providerDraftId: string): boolean;
    sendDraft(identifier: string, providerDraftId: string, provider: 'gmail' | 'graph', providerMessageId?: string): OutboxMessage;
    /**
     * Some providers can replay already-delivered change records without the
     * message itself changing. Modeling replay as a first-class change kind lets
     * Gmail history and Graph delta tests verify idempotence explicitly.
     */
    appendReplayChange(identifier: string, providerMessageId: string): void;
    listOutbox(mailboxId?: string): OutboxMessage[];
    listVisibleMessages(mailbox: MailboxRecord): MailboxMessage[];
    listAllMessages(mailbox: MailboxRecord): MailboxMessage[];
    listChanges(mailbox: MailboxRecord): MailboxChange[];
    replaceMailboxAccessToken(mailbox: MailboxRecord, accessToken: string): void;
    clearMailboxAccessToken(mailbox: MailboxRecord): void;
    maybeThrowInjectedFailure(mailbox: MailboxRecord, operation: string): void;
    maybeDelay(mailbox: MailboxRecord): Promise<void>;
    private materializeAttachment;
    private findMessage;
    private recordChange;
}
//# sourceMappingURL=email-connect-engine.d.ts.map