import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EmailConnectEngine,
  beginGmailAuthorization,
  beginGraphAuthorization,
  approveGmailAuthorization,
  approveGraphAuthorization,
  exchangeGmailAuthorizationCode,
  exchangeGraphAuthorizationCode,
  getGmailClientForMailbox,
  getOutlookGraphClientForMailbox,
  refreshGraphAuthorization,
  registerGmailOAuthClient,
  registerGraphOAuthClient,
  revokeGmailAuthorization,
} from '../../src/index.js';

function codeFromRedirect(redirectUrl: string): string {
  const code = new URL(redirectUrl).searchParams.get('code');
  if (!code) throw new Error(`Redirect missing code: ${redirectUrl}`);
  return code;
}

describe('connect plane', () => {
  it('models Gmail offline-consent behavior, refresh-token omission on repeat auth, and revoke-by-refresh-token', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'gmail-connect',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
      auth: {
        refreshToken: null,
        lastConsentAt: null,
      },
    });
    registerGmailOAuthClient(engine, {
      clientId: 'gmail-client',
      clientSecret: 'gmail-secret',
      redirectUris: ['https://app.example.test/oauth/google/callback'],
      defaultConsentMode: 'auto_approve',
    });

    const first = beginGmailAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'gmail-client',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      state: 'state-1',
      prompt: 'consent',
      loginHint: 'ops@example.com',
    });
    const firstApproved = approveGmailAuthorization({
      engine,
      requestId: first.request.id,
    });
    const firstGrant = exchangeGmailAuthorizationCode({
      engine,
      clientId: 'gmail-client',
      clientSecret: 'gmail-secret',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      code: codeFromRedirect(firstApproved.redirectUrl),
    });

    expect(firstGrant.refreshToken).toBeTruthy();
    expect(firstGrant.idToken).toContain('.');
    expect(engine.connect.getMailboxAuth('gmail-connect')).toMatchObject({
      clientId: 'gmail-client',
      refreshTokenPresent: true,
    });

    const repeated = beginGmailAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'gmail-client',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      state: 'state-2',
      loginHint: 'ops@example.com',
    });
    const repeatedApproved = approveGmailAuthorization({
      engine,
      requestId: repeated.request.id,
    });
    const repeatedGrant = exchangeGmailAuthorizationCode({
      engine,
      clientId: 'gmail-client',
      clientSecret: 'gmail-secret',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      code: codeFromRedirect(repeatedApproved.redirectUrl),
    });

    expect(repeatedGrant.refreshToken).toBeUndefined();
    expect(engine.connect.getMailboxAuth('gmail-connect').refreshTokenPresent).toBe(true);

    const gmail = getGmailClientForMailbox(engine, 'gmail-connect');
    expect(() =>
      engine.connect.authorizeMailboxAccess('gmail', repeatedGrant.accessToken, 'gmail.messages.list'),
    ).not.toThrow();
    await expect(gmail.users.getProfile({ userId: 'me' })).resolves.toMatchObject({
      data: { emailAddress: 'ops@example.com' },
    });

    const revoked = revokeGmailAuthorization({
      engine,
      token: String(firstGrant.refreshToken),
    });
    expect(revoked).toBe(true);
    expect(() =>
      engine.connect.authorizeMailboxAccess('gmail', repeatedGrant.accessToken, 'gmail.messages.list'),
    ).toThrow(/unknown mailbox access token/i);
  });

  it('supports Graph read-only connect, send-capability upgrade, and refresh-token rotation', async () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'graph-connect',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
      auth: {
        refreshToken: null,
        lastConsentAt: null,
      },
    });
    engine.appendMessage('graph-connect', {
      providerMessageId: 'graph-msg-1',
      subject: 'Inbound dispatch',
      bodyText: 'Inbound dispatch body',
    });
    registerGraphOAuthClient(engine, {
      clientId: 'graph-client',
      clientSecret: 'graph-secret',
      redirectUris: ['https://app.example.test/oauth/microsoft/callback'],
      defaultConsentMode: 'auto_approve',
    });

    const readOnly = beginGraphAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'graph-client',
      redirectUri: 'https://app.example.test/oauth/microsoft/callback',
      capabilityMode: 'read',
      loginHint: 'dispatch@example.com',
      scopes: [
        'offline_access',
        'https://graph.microsoft.com/Mail.Read',
        'https://graph.microsoft.com/User.Read',
      ],
    });
    const readApproved = approveGraphAuthorization({
      engine,
      requestId: readOnly.request.id,
    });
    const readGrant = exchangeGraphAuthorizationCode({
      engine,
      clientId: 'graph-client',
      clientSecret: 'graph-secret',
      redirectUri: 'https://app.example.test/oauth/microsoft/callback',
      code: codeFromRedirect(readApproved.redirectUrl),
    });

    expect(readGrant.refreshToken).toBeTruthy();
    expect(() =>
      engine.connect.authorizeMailboxAccess('graph', readGrant.accessToken, 'graph.messages.list'),
    ).not.toThrow();
    expect(() =>
      engine.connect.authorizeMailboxAccess('graph', readGrant.accessToken, 'graph.draft.create'),
    ).toThrow(/does not permit/i);

    const { client } = getOutlookGraphClientForMailbox(engine, 'graph-connect');
    await expect(client.api('/me/messages').get()).resolves.toMatchObject({
      value: [{ id: 'graph-msg-1' }],
    });

    const upgraded = beginGraphAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'graph-client',
      redirectUri: 'https://app.example.test/oauth/microsoft/callback',
      capabilityMode: 'send',
      loginHint: 'dispatch@example.com',
    });
    const upgradedApproved = approveGraphAuthorization({
      engine,
      requestId: upgraded.request.id,
    });
    const upgradedGrant = exchangeGraphAuthorizationCode({
      engine,
      clientId: 'graph-client',
      clientSecret: 'graph-secret',
      redirectUri: 'https://app.example.test/oauth/microsoft/callback',
      code: codeFromRedirect(upgradedApproved.redirectUrl),
    });

    expect(() =>
      engine.connect.authorizeMailboxAccess('graph', upgradedGrant.accessToken, 'graph.draft.create'),
    ).not.toThrow();

    const refreshed = refreshGraphAuthorization({
      engine,
      clientId: 'graph-client',
      clientSecret: 'graph-secret',
      refreshToken: String(upgradedGrant.refreshToken),
    });
    expect(refreshed.refreshToken).toBeTruthy();
    expect(refreshed.refreshToken).not.toBe(upgradedGrant.refreshToken);
    expect(() =>
      refreshGraphAuthorization({
        engine,
        clientId: 'graph-client',
        clientSecret: 'graph-secret',
        refreshToken: String(upgradedGrant.refreshToken),
      }),
    ).toThrow(/invalid refresh token|superseded/i);
  });

  it('rejects authorization-code replay and enforces PKCE when a challenge is present', () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'gmail-pkce',
      provider: 'gmail',
      primaryEmail: 'pkce@example.com',
      auth: { refreshToken: null },
    });
    registerGmailOAuthClient(engine, {
      clientId: 'public-client',
      redirectUris: ['https://app.example.test/oauth/public'],
      defaultConsentMode: 'auto_approve',
    });

    const verifier = 'verifier-123';
    const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
    const auth = beginGmailAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'public-client',
      redirectUri: 'https://app.example.test/oauth/public',
      loginHint: 'pkce@example.com',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });
    const approved = approveGmailAuthorization({
      engine,
      requestId: auth.request.id,
    });
    const code = codeFromRedirect(approved.redirectUrl);

    expect(() =>
      exchangeGmailAuthorizationCode({
        engine,
        clientId: 'public-client',
        redirectUri: 'https://app.example.test/oauth/public',
        code,
        codeVerifier: 'wrong-verifier',
      }),
    ).toThrow(/pkce/i);

    const grant = exchangeGmailAuthorizationCode({
      engine,
      clientId: 'public-client',
      redirectUri: 'https://app.example.test/oauth/public',
      code,
      codeVerifier: verifier,
    });
    expect(grant.accessToken).toBeTruthy();
    expect(() =>
      exchangeGmailAuthorizationCode({
        engine,
        clientId: 'public-client',
        redirectUri: 'https://app.example.test/oauth/public',
        code,
        codeVerifier: verifier,
      }),
    ).toThrow(/already used/i);
  });

  it('supports expired requests, denied consent, and deliberate missing refresh tokens', () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'gmail-adversarial-connect',
      provider: 'gmail',
      primaryEmail: 'ops@example.com',
      backend: {
        connect: {
          consentMode: 'interactive',
          omitRefreshToken: 'once',
        },
      },
      auth: {
        refreshToken: null,
      },
    });
    registerGmailOAuthClient(engine, {
      clientId: 'gmail-adversarial-client',
      clientSecret: 'gmail-adversarial-secret',
      redirectUris: ['https://app.example.test/oauth/google/callback'],
      defaultConsentMode: 'interactive',
    });

    const denied = beginGmailAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'gmail-adversarial-client',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      loginHint: 'ops@example.com',
      state: 'deny-state',
    });
    const deniedResult = engine.connect.denyAuthorizationRequest(denied.request.id, 'access_denied');
    expect(new URL(deniedResult.redirectUrl).searchParams.get('error')).toBe('access_denied');
    expect(new URL(deniedResult.redirectUrl).searchParams.get('error_description')).toBeNull();

    const expired = beginGmailAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'gmail-adversarial-client',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      loginHint: 'ops@example.com',
      state: 'expired-state',
    });
    engine.advanceTimeMs(301_000);
    expect(() =>
      approveGmailAuthorization({
        engine,
        requestId: expired.request.id,
      }),
    ).toThrow(/expired/i);

    engine.advanceTimeMs(-301_000);
    const first = beginGmailAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'gmail-adversarial-client',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      prompt: 'consent',
      loginHint: 'ops@example.com',
    });
    const firstApproved = approveGmailAuthorization({
      engine,
      requestId: first.request.id,
    });
    const firstGrant = exchangeGmailAuthorizationCode({
      engine,
      clientId: 'gmail-adversarial-client',
      clientSecret: 'gmail-adversarial-secret',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      code: codeFromRedirect(firstApproved.redirectUrl),
    });
    expect(firstGrant.refreshToken).toBeUndefined();

    const second = beginGmailAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'gmail-adversarial-client',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      prompt: 'consent',
      loginHint: 'ops@example.com',
    });
    const secondApproved = approveGmailAuthorization({
      engine,
      requestId: second.request.id,
    });
    const secondGrant = exchangeGmailAuthorizationCode({
      engine,
      clientId: 'gmail-adversarial-client',
      clientSecret: 'gmail-adversarial-secret',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      code: codeFromRedirect(secondApproved.redirectUrl),
    });
    expect(secondGrant.refreshToken).toBeTruthy();
  });

  it('supports Gmail incremental consent when include_granted_scopes is requested', () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'gmail-incremental',
      provider: 'gmail',
      primaryEmail: 'incremental@example.com',
      auth: {
        refreshToken: null,
      },
    });
    registerGmailOAuthClient(engine, {
      clientId: 'gmail-incremental-client',
      clientSecret: 'gmail-incremental-secret',
      redirectUris: ['https://app.example.test/oauth/google/callback'],
      defaultConsentMode: 'auto_approve',
    });

    const readOnly = beginGmailAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'gmail-incremental-client',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      loginHint: 'incremental@example.com',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      accessType: 'online',
    });
    const readApproved = approveGmailAuthorization({
      engine,
      requestId: readOnly.request.id,
    });
    const readGrant = exchangeGmailAuthorizationCode({
      engine,
      clientId: 'gmail-incremental-client',
      clientSecret: 'gmail-incremental-secret',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      code: codeFromRedirect(readApproved.redirectUrl),
    });
    expect(() =>
      engine.connect.authorizeMailboxAccess('gmail', readGrant.accessToken, 'gmail.messages.list'),
    ).not.toThrow();
    expect(() =>
      engine.connect.authorizeMailboxAccess('gmail', readGrant.accessToken, 'gmail.messages.send'),
    ).toThrow(/does not permit/i);

    const upgraded = beginGmailAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'gmail-incremental-client',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      loginHint: 'incremental@example.com',
      scopes: ['https://www.googleapis.com/auth/gmail.send'],
      includeGrantedScopes: true,
      accessType: 'online',
      prompt: 'consent',
    });
    const upgradedApproved = approveGmailAuthorization({
      engine,
      requestId: upgraded.request.id,
    });
    const upgradedGrant = exchangeGmailAuthorizationCode({
      engine,
      clientId: 'gmail-incremental-client',
      clientSecret: 'gmail-incremental-secret',
      redirectUri: 'https://app.example.test/oauth/google/callback',
      code: codeFromRedirect(upgradedApproved.redirectUrl),
    });

    expect(upgradedGrant.grantedScopes).toEqual(
      expect.arrayContaining([
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
      ]),
    );
    expect(() =>
      engine.connect.authorizeMailboxAccess('gmail', upgradedGrant.accessToken, 'gmail.messages.list'),
    ).not.toThrow();
    expect(() =>
      engine.connect.authorizeMailboxAccess('gmail', upgradedGrant.accessToken, 'gmail.messages.send'),
    ).not.toThrow();
  });

  it('surfaces configured token endpoint failures through the connect plane', () => {
    const engine = new EmailConnectEngine({ baseTime: '2026-04-14T12:00:00.000Z' });
    engine.createMailbox({
      id: 'graph-token-failure',
      provider: 'graph',
      primaryEmail: 'dispatch@example.com',
      backend: {
        connect: {
          tokenFailureMode: 'temporarily_unavailable',
          tokenFailureOperations: ['code.exchange'],
          tokenFailureHits: 1,
        },
      },
      auth: {
        refreshToken: null,
      },
    });
    registerGraphOAuthClient(engine, {
      clientId: 'graph-failure-client',
      clientSecret: 'graph-failure-secret',
      redirectUris: ['https://app.example.test/oauth/microsoft/callback'],
      defaultConsentMode: 'auto_approve',
    });

    const started = beginGraphAuthorization({
      engine,
      baseUrl: 'http://email-connect.test',
      clientId: 'graph-failure-client',
      redirectUri: 'https://app.example.test/oauth/microsoft/callback',
      loginHint: 'dispatch@example.com',
    });
    const approved = approveGraphAuthorization({
      engine,
      requestId: started.request.id,
    });
    const code = codeFromRedirect(approved.redirectUrl);

    expect(() =>
      exchangeGraphAuthorizationCode({
        engine,
        clientId: 'graph-failure-client',
        clientSecret: 'graph-failure-secret',
        redirectUri: 'https://app.example.test/oauth/microsoft/callback',
        code,
      }),
    ).toThrow(/temporarily_unavailable/i);

    const retried = exchangeGraphAuthorizationCode({
      engine,
      clientId: 'graph-failure-client',
      clientSecret: 'graph-failure-secret',
      redirectUri: 'https://app.example.test/oauth/microsoft/callback',
      code,
    });
    expect(retried.accessToken).toBeTruthy();
  });
});
