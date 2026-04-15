import { EmailConnectError, type EmailConnectProvider, type MailboxRecord } from '@email-connect/core';
import { defaultGmailScopesForCapabilityMode, isGmailOperationAuthorized } from './capabilities.js';
import { GmailService } from './service.js';

function gmailMessageGetOperation(format: string | null): string {
  const normalized = String(format || '').trim().toLowerCase();
  return normalized === 'full' || normalized === 'raw' ? 'gmail.messages.get.body' : 'gmail.messages.get.metadata';
}

function gmailThreadGetOperation(format: string | null): string {
  const normalized = String(format || '').trim().toLowerCase();
  return normalized === 'full' || normalized === 'raw' ? 'gmail.threads.get.body' : 'gmail.threads.get.metadata';
}

function gmailListOperation(q: string | null): string {
  return String(q || '').trim() ? 'gmail.messages.list.search' : 'gmail.messages.list';
}

function gmailUserInfo(mailbox: MailboxRecord): Record<string, unknown> {
  return {
    sub: mailbox.providerUserId,
    email: mailbox.primaryEmail,
    email_verified: true,
    name: mailbox.displayName || mailbox.primaryEmail,
    picture: `https://email-connect.local/avatar/${encodeURIComponent(mailbox.primaryEmail)}`,
  };
}

/**
 * Gmail provider wiring keeps Gmail-only details out of core: endpoint shapes,
 * incremental-consent behavior, and the HTTP route surface.
 */
export const gmailProvider: EmailConnectProvider = {
  id: 'gmail',
  connect: {
    supportsIncrementalConsent: true,
    rotateRefreshTokenOnRefreshByDefault: false,
    providerEndpoints(baseUrl) {
      return {
        authorizeUrl: `${baseUrl}/o/oauth2/v2/auth`,
        tokenUrl: `${baseUrl}/token`,
        revokeUrl: `${baseUrl}/revoke`,
        userInfoUrl: `${baseUrl}/openidconnect/v1/userinfo`,
      };
    },
    defaultScopesForCapabilityMode(capabilityMode) {
      return defaultGmailScopesForCapabilityMode(capabilityMode);
    },
    isOperationAuthorized(scopes, operation) {
      return isGmailOperationAuthorized(scopes, operation);
    },
    buildUserInfo(mailbox) {
      return gmailUserInfo(mailbox);
    },
    defaultAuthorizationErrorDescription(errorCode) {
      if (errorCode === 'access_denied') return 'The user denied the request';
      return errorCode;
    },
    resolveAccessType(params) {
      return params.requestedAccessType || 'offline';
    },
    shouldIssueRefreshToken(params) {
      if (params.accessType !== 'offline') return false;
      if (!params.mailbox.auth.offlineGrantIssued) return true;
      return String(params.prompt || '').toLowerCase().includes('consent');
    },
    idTokenIssuer() {
      return 'https://accounts.google.com';
    },
  },
  http: {
    async handle(context) {
      const { method, url } = context;
      const pathname = url.pathname;
      const service = new GmailService(context.engine);

      // OAuth and OIDC-style routes are exposed in provider-native locations so
      // black-box consumers can point real integrations at the mock.
      if (method === 'GET' && pathname === '/o/oauth2/v2/auth') {
        const responseType = String(url.searchParams.get('response_type') || 'code').trim().toLowerCase();
        if (responseType !== 'code') {
          throw new EmailConnectError('Only response_type=code is supported', 400);
        }
        const request = context.engine.connect.createAuthorizationRequest({
          provider: 'gmail',
          clientId: String(url.searchParams.get('client_id') || ''),
          redirectUri: String(url.searchParams.get('redirect_uri') || ''),
          state: url.searchParams.get('state'),
          requestedScopes: context.splitScopes(url.searchParams.get('scope')),
          includeGrantedScopes: context.parseBooleanQuery(url.searchParams.get('include_granted_scopes')),
          capabilityMode:
            String(url.searchParams.get('email_connect_mode') || '').trim().toLowerCase() === 'read' ? 'read' : 'send',
          accessType: String(url.searchParams.get('access_type') || '').trim().toLowerCase() === 'offline' ? 'offline' : 'online',
          prompt: url.searchParams.get('prompt'),
          loginHint: url.searchParams.get('login_hint'),
          codeChallenge: url.searchParams.get('code_challenge'),
          codeChallengeMethod:
            String(url.searchParams.get('code_challenge_method') || '').trim().toUpperCase() === 'S256' ? 'S256' : null,
        });
        await context.completeOrRenderConsent('gmail', request);
        return true;
      }

      if (method === 'POST' && pathname === '/token') {
        const body = await context.readFormBody();
        const grantType = String(body.grant_type || '').trim();
        if (grantType === 'authorization_code') {
          await context.respondWithTokenGrant(() =>
            context.engine.connect.exchangeAuthorizationCode({
              provider: 'gmail',
              clientId: String(body.client_id || ''),
              ...(body.client_secret != null ? { clientSecret: body.client_secret } : {}),
              redirectUri: String(body.redirect_uri || ''),
              code: String(body.code || ''),
              ...(body.code_verifier != null ? { codeVerifier: body.code_verifier } : {}),
            }),
          );
          return true;
        }
        if (grantType === 'refresh_token') {
          await context.respondWithTokenGrant(() =>
            context.engine.connect.refreshAccessToken({
              provider: 'gmail',
              clientId: String(body.client_id || ''),
              ...(body.client_secret != null ? { clientSecret: body.client_secret } : {}),
              refreshToken: String(body.refresh_token || ''),
              scopes: context.splitScopes(body.scope || null),
            }),
          );
          return true;
        }
        throw new EmailConnectError(`Unsupported grant_type for Google: ${grantType}`, 400);
      }

      if (method === 'POST' && pathname === '/revoke') {
        const body = await context.readFormBody();
        const token = String(body.token || url.searchParams.get('token') || '').trim();
        const revoked = context.engine.connect.revokeToken('gmail', token);
        context.sendText(revoked ? 200 : 400, '');
        return true;
      }

      if (method === 'GET' && pathname === '/openidconnect/v1/userinfo') {
        context.sendJson(200, context.engine.connect.getUserInfo('gmail', context.parseBearerToken()));
        return true;
      }

      const accessToken = pathname.startsWith('/gmail/v1/') ? context.parseBearerToken() : null;
      if (!accessToken) return false;

      // Gmail facade routes mirror the official REST hierarchy: profile/labels,
      // message resources, thread resources, history, compose, and watch.
      // Read routes come first because most consumers start by listing and then
      // fetching concrete resources before they move into mutation flows.
      if (method === 'GET' && pathname === '/gmail/v1/users/me/profile') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.profile.get');
        context.sendJson(200, (await service.getProfile(mailbox.id)).data);
        return true;
      }

      if (method === 'GET' && pathname === '/gmail/v1/users/me/labels') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.labels.list');
        context.sendJson(200, (await service.listLabels(mailbox.id)).data);
        return true;
      }

      if (method === 'GET' && pathname === '/gmail/v1/users/me/messages') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, gmailListOperation(url.searchParams.get('q')));
        context.sendJson(
          200,
          (
            await service.listMessages(mailbox.id, {
            ...(url.searchParams.get('q') ? { q: String(url.searchParams.get('q')) } : {}),
            ...(url.searchParams.getAll('labelIds').length ? { labelIds: url.searchParams.getAll('labelIds') } : {}),
            ...(url.searchParams.get('maxResults') ? { maxResults: Number(url.searchParams.get('maxResults')) } : {}),
            ...(url.searchParams.get('pageToken') ? { pageToken: String(url.searchParams.get('pageToken')) } : {}),
            })
          ).data,
        );
        return true;
      }

      if (method === 'POST' && pathname === '/gmail/v1/users/me/messages/import') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.messages.import');
        context.sendJson(200, (await service.importMessage(mailbox.id, await context.readJsonBody(), 'import')).data);
        return true;
      }

      if (method === 'POST' && pathname === '/gmail/v1/users/me/messages') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.messages.insert');
        context.sendJson(200, (await service.importMessage(mailbox.id, await context.readJsonBody(), 'insert')).data);
        return true;
      }

      const messageMatch = context.matchPath(pathname, /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
      if (method === 'GET' && messageMatch?.[1]) {
        const format = url.searchParams.get('format');
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, gmailMessageGetOperation(format));
        context.sendJson(
          200,
          (
            await service.getMessage(mailbox.id, decodeURIComponent(messageMatch[1]), {
              ...(format ? { format } : {}),
              ...(url.searchParams.getAll('metadataHeaders').length
                ? { metadataHeaders: url.searchParams.getAll('metadataHeaders') }
                : {}),
            })
          ).data,
        );
        return true;
      }

      const attachmentMatch = context.matchPath(pathname, /^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/);
      if (method === 'GET' && attachmentMatch?.[1] && attachmentMatch?.[2]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.attachments.get');
        context.sendJson(
          200,
          (
            await service.getAttachment(mailbox.id, decodeURIComponent(attachmentMatch[1]), decodeURIComponent(attachmentMatch[2]))
          ).data,
        );
        return true;
      }

      if (method === 'GET' && pathname === '/gmail/v1/users/me/history') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.history.list');
        const historyTypes = url.searchParams.getAll('historyTypes').filter(Boolean);
        context.sendJson(
          200,
          (
            await service.listHistory(mailbox.id, {
            startHistoryId: String(url.searchParams.get('startHistoryId') || ''),
            ...(url.searchParams.get('pageToken') ? { pageToken: String(url.searchParams.get('pageToken')) } : {}),
            ...(historyTypes.length ? { historyTypes } : {}),
            })
          ).data,
        );
        return true;
      }

      if (method === 'GET' && pathname === '/gmail/v1/users/me/threads') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.threads.list');
        context.sendJson(
          200,
          (
            await service.listThreads(mailbox.id, {
              ...(url.searchParams.get('q') ? { q: String(url.searchParams.get('q')) } : {}),
              ...(url.searchParams.getAll('labelIds').length ? { labelIds: url.searchParams.getAll('labelIds') } : {}),
              ...(url.searchParams.get('maxResults') ? { maxResults: Number(url.searchParams.get('maxResults')) } : {}),
              ...(url.searchParams.get('pageToken') ? { pageToken: String(url.searchParams.get('pageToken')) } : {}),
            })
          ).data,
        );
        return true;
      }

      const threadMatch = context.matchPath(pathname, /^\/gmail\/v1\/users\/me\/threads\/([^/]+)$/);
      if (method === 'GET' && threadMatch?.[1]) {
        const format = url.searchParams.get('format');
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, gmailThreadGetOperation(format));
        context.sendJson(
          200,
          (
            await service.getThread(mailbox.id, decodeURIComponent(threadMatch[1]), {
              ...(format ? { format } : {}),
              ...(url.searchParams.getAll('metadataHeaders').length
                ? { metadataHeaders: url.searchParams.getAll('metadataHeaders') }
                : {}),
            })
          ).data,
        );
        return true;
      }

      // Compose and mailbox-control routes are kept after the read surfaces so
      // the file matches the mental model of "connect, read, then mutate/watch".
      if (method === 'POST' && pathname === '/gmail/v1/users/me/watch') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.watch.create');
        context.sendJson(200, (await service.watchMailbox(mailbox.id, await context.readJsonBody())).data);
        return true;
      }

      if (method === 'POST' && pathname === '/gmail/v1/users/me/stop') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.watch.stop');
        context.sendJson(200, (await service.stopWatching(mailbox.id)).data);
        return true;
      }

      if (method === 'POST' && pathname === '/gmail/v1/users/me/drafts') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.drafts.create');
        context.sendJson(200, (await service.createDraft(mailbox.id, await context.readJsonBody())).data);
        return true;
      }

      if (method === 'POST' && pathname === '/gmail/v1/users/me/drafts/send') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.drafts.send');
        context.sendJson(200, (await service.sendDraft(mailbox.id, await context.readJsonBody())).data);
        return true;
      }

      if (method === 'POST' && pathname === '/gmail/v1/users/me/messages/send') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.messages.send');
        context.sendJson(200, (await service.sendMessage(mailbox.id, await context.readJsonBody())).data);
        return true;
      }

      return false;
    },
  },
};
