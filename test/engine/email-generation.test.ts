import { describe, expect, it } from 'vitest';
import {
  EmailConnectEngine,
  createArrayTemplateSource,
  createCallbackTemplateSource,
  generateMailboxEmails,
} from '../../src/index.js';

describe('email generation', () => {
  it('generates a quiet corpus-backed inbox with deterministic ordering and attachments', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'gmail-ops',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
    });

    const generated = await generateMailboxEmails(engine, {
      mailboxId: 'gmail-ops',
      count: 4,
      profile: 'quiet',
      seed: 7,
      attachmentChance: 1,
      templateSource: createArrayTemplateSource([
        { subject: 'Load pickup', bodyText: 'Load pickup body' },
        { subject: 'Rate confirmation', bodyText: 'Rate confirmation body', labels: ['INBOX', 'IMPORTANT'] },
      ]),
      startAt: '2026-04-14T08:00:00.000Z',
      endAt: '2026-04-14T12:00:00.000Z',
    });

    expect(generated.messages).toHaveLength(4);

    const snapshot = engine.snapshotMailbox('gmail-ops');
    expect(snapshot.messages).toHaveLength(4);
    expect(snapshot.messages.every((message) => message.attachments.length === 1)).toBe(true);

    const receivedAt = snapshot.messages.map((message) => String(message.receivedAt || ''));
    expect(receivedAt).toEqual([...receivedAt].sort());
    expect(snapshot.messages.map((message) => message.subject)).toEqual([
      'Load pickup',
      'Rate confirmation',
      'Load pickup',
      'Rate confirmation',
    ]);
  });

  it('generates threaded mailbox mail from a programmatic source with reply headers wired correctly', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'graph-dispatch',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
    });

    await generateMailboxEmails(engine, {
      mailboxId: 'graph-dispatch',
      count: 6,
      profile: 'busy',
      seed: 11,
      replyChance: 0.9,
      maxThreadDepth: 4,
      templateSource: createCallbackTemplateSource((context) => ({
        subject: context.isReply ? `Status update ${context.threadIndex + 1}` : `Shipment ${context.index + 1}`,
        bodyText: `Body ${context.index + 1}`,
      })),
      participants: {
        senders: ['shipper@example.com', 'carrier@example.com'],
        recipients: ['dispatch@example.com'],
      },
    });

    const snapshot = engine.snapshotMailbox('graph-dispatch');
    expect(snapshot.messages).toHaveLength(6);

    const replyMessages = snapshot.messages.filter((message) => message.inReplyTo);
    expect(replyMessages.length).toBeGreaterThan(0);
    expect(replyMessages.every((message) => message.references)).toBe(true);
    expect(new Set(snapshot.messages.map((message) => message.providerThreadId)).size).toBeLessThan(snapshot.messages.length);
  });

  it('supports explicit replay events on top of generated mailbox state', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'gmail-replay',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
    });
    const inserted = engine.appendMessage('gmail-replay', {
      subject: 'Replay me',
      bodyText: 'Replay body',
    });

    engine.appendReplayChange('gmail-replay', inserted.providerMessageId);

    const snapshot = engine.snapshotMailbox('gmail-replay');
    expect(snapshot.changes.map((change) => change.kind)).toEqual(['message_added', 'message_replayed']);
  });
});
