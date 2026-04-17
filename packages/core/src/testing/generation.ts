import type { AttachmentSeed, MessageSeed, ProviderKind } from '../types.js';
import { EmailConnectEngine } from '../engine/email-connect-engine.js';
import { SeededRandom } from '../utils/rng.js';

// Profiles are workload presets for inbox tempo: small quiet mailboxes, steady
// operational inboxes, high-volume inboxes, and clustered burst traffic.
export type MailboxEmailProfile = 'quiet' | 'steady' | 'busy' | 'bursty';

// Threaded generated messages should preserve existing reply prefixes rather
// than stacking synthetic `Re:` values on every generated child.
const REPLY_PREFIX_PATTERN = /^\s*re:/i;

/**
 * Template sources describe message content, while the generation plan
 * describes tempo and conversation shape. Keeping those concerns separate makes
 * it easy to reuse one corpus across many workload patterns.
 */
export type GeneratedTemplate = Omit<
  MessageSeed,
  'providerMessageId' | 'providerThreadId' | 'messageId' | 'inReplyTo' | 'references' | 'receivedAt'
> & {
  attachments?: AttachmentSeed[];
};

// Template context exposes generation position, thread shape, and deterministic
// randomness so callback templates can build realistic domain mail.
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

// Template sources are the pluggable content plane for generated mailboxes.
export interface MessageTemplateSource {
  nextTemplate(context: TemplateRequestContext): Promise<GeneratedTemplate> | GeneratedTemplate;
}

// Array-backed sources cycle through a fixed corpus, which is useful for
// deterministic domain examples such as insurance packets or dispatch mail.
class ArrayTemplateSource implements MessageTemplateSource {
  // Cursor advancement is deterministic and local to this source instance.
  private cursor = 0;

  // Hold the corpus by reference so callers can intentionally share lightweight
  // immutable fixture arrays across generation plans.
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

// Callback-backed sources let consumers generate mail from code while still
// using the engine's timeline, threading, and attachment machinery.
class CallbackTemplateSource implements MessageTemplateSource {
  // The callback is the only source of content; timeline and threading still
  // come from the generation plan.
  constructor(private readonly callback: (context: TemplateRequestContext) => Promise<GeneratedTemplate> | GeneratedTemplate) {}

  nextTemplate(context: TemplateRequestContext): Promise<GeneratedTemplate> | GeneratedTemplate {
    return this.callback(context);
  }
}

// Public factory keeps callers from depending on the concrete source class.
export function createArrayTemplateSource(items: GeneratedTemplate[]): MessageTemplateSource {
  return new ArrayTemplateSource(items);
}

// Public factory for programmatic corpora, useful when messages depend on the
// generated timestamp, thread depth, or random seed.
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

// Email generation plans combine mailbox target, volume, timing, conversation
// density, participants, and optional attachment generation.
export type EmailGenerationPlan = {
  // Target mailbox that will receive the generated traffic.
  mailboxId: string;
  // Total number of messages to emit into the mailbox.
  count: number;
  // Timeline bounds; defaults are derived from engine time and message count.
  startAt?: string | Date;
  endAt?: string | Date;
  // Workload profile shapes the timestamp distribution and default reply or
  // attachment density.
  profile?: MailboxEmailProfile;
  // Deterministic seed for reproducible timelines, thread choices, and
  // attachment insertion.
  seed?: number;
  // Source of subject/body/attachment content for each generated message.
  templateSource: MessageTemplateSource;
  // Optional sender and recipient pools used when templates omit those fields.
  participants?: {
    senders?: string[];
    recipients?: string[];
  };
  // Probability that the next generated message continues an existing thread.
  replyChance?: number;
  // Prevent runaway reply chains when generating busy or bursty inboxes.
  maxThreadDepth?: number;
  // Probability of injecting one synthetic attachment when the template did not
  // already supply attachments.
  attachmentChance?: number;
  // Override the default lightweight text attachment factory.
  syntheticAttachmentFactory?: (context: TemplateRequestContext) => AttachmentSeed | null;
};

// Generation accepts loose date inputs but normalizes once before timeline
// construction so profiles behave consistently.
function normalizeDate(value: string | Date | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

// Probability knobs are clamped rather than rejected so scenario files remain
// forgiving while still producing deterministic output.
function clampProbability(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

// Build a deterministic timeline from a workload profile. This is the core of
// the "quiet vs busy vs bursty inbox" product behavior.
function buildTimeline(params: {
  count: number;
  startAt: Date;
  endAt: Date;
  profile: MailboxEmailProfile;
  random: SeededRandom;
}): string[] {
  // Timeline generation is intentionally profile-based rather than purely
  // random. Consumers usually want "quiet but jittery" or "bursty after hours"
  // behavior, not just an arbitrary scatter of timestamps.
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

// Default generated attachments are small and textual; heavier binary profiles
// can replace this through `syntheticAttachmentFactory`.
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
      subject: thread ? (REPLY_PREFIX_PATTERN.test(subjectBase) ? subjectBase : `Re: ${thread.rootSubject || subjectBase}`) : subjectBase,
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
