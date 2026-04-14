import type { AttachmentSeed, MessageSeed, ProviderKind } from '../core/types.js';
import { EmailConnectEngine } from '../engine/email-connect-engine.js';
import { SeededRandom } from '../utils/rng.js';

export type MailboxEmailProfile = 'quiet' | 'steady' | 'busy' | 'bursty';

export type GeneratedTemplate = Omit<
  MessageSeed,
  'providerMessageId' | 'providerThreadId' | 'messageId' | 'inReplyTo' | 'references' | 'receivedAt'
> & {
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

class ArrayTemplateSource implements MessageTemplateSource {
  private cursor = 0;

  constructor(private readonly items: GeneratedTemplate[]) {}

  nextTemplate(): GeneratedTemplate {
    if (!this.items.length) {
      return {
        subject: 'Untitled',
        bodyText: 'Generated body',
      };
    }
    const item = this.items[this.cursor % this.items.length]!;
    this.cursor += 1;
    return {
      ...item,
      ...(item.labels ? { labels: [...item.labels] } : {}),
      ...(item.attachments ? { attachments: [...item.attachments] } : {}),
    };
  }
}

class CallbackTemplateSource implements MessageTemplateSource {
  constructor(private readonly callback: (context: TemplateRequestContext) => Promise<GeneratedTemplate> | GeneratedTemplate) {}

  nextTemplate(context: TemplateRequestContext): Promise<GeneratedTemplate> | GeneratedTemplate {
    return this.callback(context);
  }
}

export function createArrayTemplateSource(items: GeneratedTemplate[]): MessageTemplateSource {
  return new ArrayTemplateSource(items);
}

export function createCallbackTemplateSource(
  callback: (context: TemplateRequestContext) => Promise<GeneratedTemplate> | GeneratedTemplate,
): MessageTemplateSource {
  return new CallbackTemplateSource(callback);
}

type ThreadState = {
  providerThreadId: string;
  rootSubject: string | null;
  lastMessageId: string | null;
  references: string | null;
  depth: number;
  lastFrom: string | null;
};

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

function normalizeDate(value: string | Date | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function clampProbability(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function buildTimeline(params: {
  count: number;
  startAt: Date;
  endAt: Date;
  profile: MailboxEmailProfile;
  random: SeededRandom;
}): string[] {
  if (params.count <= 0) return [];
  const startMs = params.startAt.getTime();
  const endMs = Math.max(startMs + 1, params.endAt.getTime());
  const windowMs = Math.max(1, endMs - startMs);
  const anchors: number[] = [];

  if (params.profile === 'bursty') {
    const burstCount = Math.max(1, Math.min(5, Math.ceil(params.count / 6)));
    for (let index = 0; index < burstCount; index += 1) {
      anchors.push(startMs + Math.floor(windowMs * params.random.next()));
    }
    anchors.sort((left, right) => left - right);
  }

  const result: number[] = [];
  for (let index = 0; index < params.count; index += 1) {
    const fraction = params.count === 1 ? 0 : index / (params.count - 1);
    let atMs = startMs + Math.floor(windowMs * fraction);

    if (params.profile === 'quiet') {
      atMs += Math.floor(windowMs * 0.01 * (params.random.next() - 0.5));
    } else if (params.profile === 'steady') {
      atMs += Math.floor(windowMs * 0.03 * (params.random.next() - 0.5));
    } else if (params.profile === 'busy') {
      atMs += Math.floor(windowMs * 0.08 * (params.random.next() - 0.5));
    } else if (anchors.length) {
      const anchor = anchors[index % anchors.length]!;
      atMs = anchor + Math.floor(windowMs * 0.015 * (params.random.next() - 0.5));
    }

    result.push(Math.max(startMs, Math.min(endMs, atMs)));
  }

  result.sort((left, right) => left - right);
  return result.map((entry) => new Date(entry).toISOString());
}

function syntheticAttachment(context: TemplateRequestContext): AttachmentSeed {
  return {
    filename: `attachment-${context.index + 1}.txt`,
    mimeType: 'text/plain',
    contentBytes: `Generated attachment for ${context.mailboxId} message ${context.index + 1}`,
  };
}

/**
 * Generate mailbox traffic from either a corpus-backed source or a programmatic
 * callback. The plan describes inbox tempo and conversational density rather
 * than raw provider rows, which keeps tests expressive and close to user intent.
 */
export async function generateMailboxEmails(
  engine: EmailConnectEngine,
  plan: EmailGenerationPlan,
): Promise<{ messages: MessageSeed[] }> {
  const mailbox = engine.requireMailbox(plan.mailboxId);
  const random = new SeededRandom(plan.seed ?? 0x5eed1234);
  const profile = plan.profile || 'steady';
  const startAt = normalizeDate(plan.startAt, new Date(engine.nowIso()));
  const endAt = normalizeDate(plan.endAt, new Date(startAt.getTime() + Math.max(1, plan.count) * 60_000));
  const replyChance = clampProbability(plan.replyChance, profile === 'quiet' ? 0.15 : profile === 'bursty' ? 0.45 : 0.3);
  const attachmentChance = clampProbability(
    plan.attachmentChance,
    profile === 'quiet' ? 0.08 : profile === 'busy' ? 0.22 : 0.14,
  );
  const maxThreadDepth = Math.max(1, Math.trunc(plan.maxThreadDepth ?? 4));
  const timeline = buildTimeline({
    count: plan.count,
    startAt,
    endAt,
    profile,
    random,
  });
  const senders = plan.participants?.senders?.length
    ? [...plan.participants.senders]
    : [`shipper+${mailbox.alias || mailbox.id}@example.com`, `dispatcher+${mailbox.alias || mailbox.id}@example.com`];
  const recipients = plan.participants?.recipients?.length
    ? [...plan.participants.recipients]
    : [mailbox.primaryEmail];

  const threads: ThreadState[] = [];
  const emitted: MessageSeed[] = [];

  for (let index = 0; index < plan.count; index += 1) {
    const canReply = threads.length > 0 && random.bool(replyChance);
    let threadIndex = threads.length;
    let replyDepth = 0;
    let thread: ThreadState | null = null;

    if (canReply) {
      const candidates = threads.filter((entry) => entry.depth < maxThreadDepth);
      if (candidates.length) {
        thread = random.pick(candidates);
        threadIndex = threads.indexOf(thread);
        replyDepth = thread.depth + 1;
      }
    }

    const context: TemplateRequestContext = {
      mailboxId: mailbox.id,
      provider: mailbox.provider,
      index,
      threadIndex,
      replyDepth,
      isReply: Boolean(thread),
      receivedAt: timeline[index]!,
      random,
    };
    const template = await plan.templateSource.nextTemplate(context);
    const subjectBase = String(template.subject || 'Untitled').trim() || 'Untitled';
    const from = template.from || senders[index % senders.length]!;
    const to = template.to || recipients[index % recipients.length]!;

    const messageSeed: MessageSeed = {
      subject: thread ? (/^\s*re:/i.test(subjectBase) ? subjectBase : `Re: ${thread.rootSubject || subjectBase}`) : subjectBase,
      from,
      to,
      bodyText: template.bodyText || `Generated mailbox traffic body #${index + 1}`,
      bodyHtml: template.bodyHtml ?? null,
      labels: template.labels ? [...template.labels] : ['INBOX'],
      receivedAt: timeline[index]!,
      ...(template.attachments ? { attachments: [...template.attachments] } : {}),
    };

    if (thread) {
      messageSeed.providerThreadId = thread.providerThreadId;
      messageSeed.inReplyTo = thread.lastMessageId;
      messageSeed.references = thread.references || thread.lastMessageId;
    } else {
      messageSeed.providerThreadId = engine.generateId(`${mailbox.provider}-thread`);
    }

    if ((!messageSeed.attachments || !messageSeed.attachments.length) && random.bool(attachmentChance)) {
      const generatedAttachment = plan.syntheticAttachmentFactory?.(context) || syntheticAttachment(context);
      if (generatedAttachment) {
        messageSeed.attachments = [generatedAttachment];
      }
    }

    const inserted = engine.appendMessage(mailbox.id, messageSeed);
    emitted.push({
      ...messageSeed,
      providerMessageId: inserted.providerMessageId,
      providerThreadId: inserted.providerThreadId,
      messageId: inserted.messageId,
      inReplyTo: inserted.inReplyTo,
      references: inserted.references,
    });

    if (thread) {
      thread.depth += 1;
      thread.lastMessageId = inserted.messageId;
      thread.references = inserted.references || inserted.messageId;
      thread.lastFrom = inserted.from;
    } else {
      threads.push({
        providerThreadId: inserted.providerThreadId || engine.generateId(`${mailbox.provider}-thread-fallback`),
        rootSubject: inserted.subject,
        lastMessageId: inserted.messageId,
        references: inserted.messageId,
        depth: 0,
        lastFrom: inserted.from,
      });
    }
  }

  return { messages: emitted };
}
