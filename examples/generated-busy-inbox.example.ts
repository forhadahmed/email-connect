import assert from 'node:assert/strict';
import {
  EmailConnectEngine,
  createCallbackTemplateSource,
  generateMailboxEmails,
} from '../src/index.js';

/**
 * Generated mailbox example:
 * - use the generation data plane instead of manually inserting rows
 * - simulate a busier inbox with reply chains and attachments
 */
const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
engine.createMailbox({
  id: 'generated-busy',
  provider: 'gmail',
  primaryEmail: 'ops@example.com',
});

await generateMailboxEmails(engine, {
  mailboxId: 'generated-busy',
  count: 8,
  profile: 'busy',
  seed: 11,
  replyChance: 0.8,
  attachmentChance: 0.5,
  maxThreadDepth: 4,
  templateSource: createCallbackTemplateSource((context) => ({
    subject: context.isReply ? `Re: Load ${context.threadIndex + 1}` : `Load ${context.index + 1}`,
    bodyText: `Generated body ${context.index + 1}`,
  })),
  participants: {
    senders: ['carrier@example.com', 'broker@example.com'],
    recipients: ['ops@example.com'],
  },
});

const snapshot = engine.snapshotMailbox('generated-busy');
assert.equal(snapshot.messages.length, 8);
assert.equal(snapshot.messages.some((message) => Boolean(message.inReplyTo)), true);
assert.equal(snapshot.messages.some((message) => message.attachments.length > 0), true);
