import { afterEach, describe, expect, it } from 'vitest';
import { EmailConnectEngine, EmailConnectHttpServer } from '@email-connect/core';
import { createGmailEngine, getGmailClientForMailbox, gmailProvider } from '@email-connect/gmail';
import { createGraphHttpServer, getOutlookGraphClientForMailbox, graphProvider } from '@email-connect/graph';

describe('provider packages', () => {
  const servers: EmailConnectHttpServer[] = [];

  afterEach(async () => {
    while (servers.length) {
      const server = servers.pop();
      if (server) await server.close();
    }
  });

  it('lets core compose a Gmail-only product without Graph installed', async () => {
    const engine = new EmailConnectEngine({
      baseTime: '2026-04-14T12:00:00.000Z',
      providers: [gmailProvider],
    });
    const created = engine.createMailbox({
      id: 'gmail-only',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
    });

    engine.appendMessage('gmail-only', {
      providerMessageId: 'gmail-only-msg-1',
      subject: 'Inbound update',
      bodyText: 'Carrier says the trailer is loaded.',
    });

    const gmail = getGmailClientForMailbox(engine, 'gmail-only');
    const listed = await gmail.users.messages.list({ userId: 'me' });
    expect(listed.data.messages).toEqual([
      expect.objectContaining({ id: 'gmail-only-msg-1' }),
    ]);

    expect(() =>
      engine.createMailbox({
        id: 'graph-should-fail',
        provider: 'graph',
        primaryEmail: 'dispatch@example.com',
      }),
    ).toThrow(/Provider is not installed: graph/);

    const server = new EmailConnectHttpServer({ engine });
    servers.push(server);
    const { baseUrl } = await server.listen();

    const graphResponse = await fetch(`${baseUrl}/graph/v1.0/me`, {
      headers: {
        Authorization: `Bearer ${created.accessToken}`,
      },
    });
    expect(graphResponse.status).toBe(404);
  });

  it('lets provider convenience packages stay self-sufficient and isolated', async () => {
    const gmailEngine = createGmailEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    gmailEngine.createMailbox({
      id: 'gmail-convenience',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
    });

    expect(() =>
      gmailEngine.createMailbox({
        id: 'gmail-no-graph',
        provider: 'graph',
        primaryEmail: 'dispatch@example.com',
      }),
    ).toThrow(/Provider is not installed: graph/);

    const graphEngine = new EmailConnectEngine({
      baseTime: '2026-04-14T12:00:00.000Z',
      providers: [graphProvider],
    });
    const graphMailbox = graphEngine.createMailbox({
      id: 'graph-only',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
    });
    graphEngine.appendMessage('graph-only', {
      providerMessageId: 'graph-only-msg-1',
      subject: 'Dispatch update',
      bodyText: 'Inbound graph message body.',
    });

    const graph = getOutlookGraphClientForMailbox(graphEngine, 'graph-only');
    const inbox = await graph.client.api('/me/mailFolders/inbox/messages?$top=1').get();
    expect(inbox.value).toHaveLength(1);
    expect(inbox.value[0]?.id).toBe('graph-only-msg-1');

    expect(() =>
      graphEngine.createMailbox({
        id: 'graph-no-gmail',
        provider: 'gmail',
        primaryEmail: 'ops@example.com',
      }),
    ).toThrow(/Provider is not installed: gmail/);

    const server = createGraphHttpServer({ engine: graphEngine });
    servers.push(server);
    const { baseUrl } = await server.listen();

    const me = await fetch(`${baseUrl}/graph/v1.0/me`, {
      headers: {
        Authorization: `Bearer ${graphMailbox.accessToken}`,
      },
    });
    expect(me.status).toBe(200);

    const gmailResponse = await fetch(`${baseUrl}/gmail/v1/users/me/profile`, {
      headers: {
        Authorization: `Bearer ${graphMailbox.accessToken}`,
      },
    });
    expect(gmailResponse.status).toBe(404);
  });
});
