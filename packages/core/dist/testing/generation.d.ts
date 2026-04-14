import type { AttachmentSeed, MessageSeed, ProviderKind } from '../core/types.js';
import { EmailConnectEngine } from '../engine/email-connect-engine.js';
import { SeededRandom } from '../utils/rng.js';
export type MailboxEmailProfile = 'quiet' | 'steady' | 'busy' | 'bursty';
export type GeneratedTemplate = Omit<MessageSeed, 'providerMessageId' | 'providerThreadId' | 'messageId' | 'inReplyTo' | 'references' | 'receivedAt'> & {
    attachments?: AttachmentSeed[];
};
export type TemplateRequestContext = {
    mailboxId: string;
    provider: ProviderKind;
    index: number;
    threadIndex: number;
    replyDepth: number;
    isReply: boolean;
    receivedAt: string;
    random: SeededRandom;
};
export interface MessageTemplateSource {
    nextTemplate(context: TemplateRequestContext): Promise<GeneratedTemplate> | GeneratedTemplate;
}
export declare function createArrayTemplateSource(items: GeneratedTemplate[]): MessageTemplateSource;
export declare function createCallbackTemplateSource(callback: (context: TemplateRequestContext) => Promise<GeneratedTemplate> | GeneratedTemplate): MessageTemplateSource;
export type EmailGenerationPlan = {
    mailboxId: string;
    count: number;
    startAt?: string | Date;
    endAt?: string | Date;
    profile?: MailboxEmailProfile;
    seed?: number;
    templateSource: MessageTemplateSource;
    participants?: {
        senders?: string[];
        recipients?: string[];
    };
    replyChance?: number;
    maxThreadDepth?: number;
    attachmentChance?: number;
    syntheticAttachmentFactory?: (context: TemplateRequestContext) => AttachmentSeed | null;
};
/**
 * Generate mailbox traffic from either a corpus-backed source or a programmatic
 * callback. The plan describes inbox tempo and conversational density rather
 * than raw provider rows, which keeps tests expressive and close to user intent.
 */
export declare function generateMailboxEmails(engine: EmailConnectEngine, plan: EmailGenerationPlan): Promise<{
    messages: MessageSeed[];
}>;
//# sourceMappingURL=generation.d.ts.map