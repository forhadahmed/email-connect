import { EmailConnectError, type EmailConnectProvider, type MailboxRecord } from '@email-connect/core';
import { defaultGmailScopesForCapabilityMode, isGmailOperationAuthorized } from './capabilities.js';
import { GmailService } from './service.js';

function gmailUserInfo(mailbox: MailboxRecord): Record<string, unknown> {
  return {
    sub: mailbox.providerUserId,
    email: mailbox.primaryEmail,
    email_verified: true,
    name: mailbox.displayName || mailbox.primaryEmail,
    picture: `https://email-connect.local/avatar/${encodeURIComponent(mailbox.primaryEmail)}`,
  };
}

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

      if (method === 'GET' && pathname === '/gmail/v1/users/me/profile') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.profile.get');
        context.sendJson(200, await service.getProfile(mailbox.id));
        return true;
      }

      if (method === 'GET' && pathname === '/gmail/v1/users/me/labels') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.labels.list');
        context.sendJson(200, await service.listLabels(mailbox.id));
        return true;
      }

      if (method === 'GET' && pathname === '/gmail/v1/users/me/messages') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.messages.list');
        context.sendJson(
          200,
          await service.listMessages(mailbox.id, {
            ...(url.searchParams.get('q') ? { q: String(url.searchParams.get('q')) } : {}),
            ...(url.searchParams.get('maxResults') ? { maxResults: Number(url.searchParams.get('maxResults')) } : {}),
            ...(url.searchParams.get('pageToken') ? { pageToken: String(url.searchParams.get('pageToken')) } : {}),
          }),
        );
        return true;
      }

      const messageMatch = context.matchPath(pathname, /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
      if (method === 'GET' && messageMatch?.[1]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.messages.get');
        context.sendJson(200, await service.getMessage(mailbox.id, decodeURIComponent(messageMatch[1])));
        return true;
      }

      const attachmentMatch = context.matchPath(pathname, /^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/);
      if (method === 'GET' && attachmentMatch?.[1] && attachmentMatch?.[2]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.attachments.get');
        context.sendJson(
          200,
          await service.getAttachment(mailbox.id, decodeURIComponent(attachmentMatch[1]), decodeURIComponent(attachmentMatch[2])),
        );
        return true;
      }

      if (method === 'GET' && pathname === '/gmail/v1/users/me/history') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.history.list');
        const historyTypes = url.searchParams.getAll('historyTypes').filter(Boolean);
        context.sendJson(
          200,
          await service.listHistory(mailbox.id, {
            startHistoryId: String(url.searchParams.get('startHistoryId') || ''),
            ...(url.searchParams.get('pageToken') ? { pageToken: String(url.searchParams.get('pageToken')) } : {}),
            ...(historyTypes.length ? { historyTypes } : {}),
          }),
        );
        return true;
      }

      if (method === 'POST' && pathname === '/gmail/v1/users/me/drafts') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.drafts.create');
        context.sendJson(200, await service.createDraft(mailbox.id, await context.readJsonBody()));
        return true;
      }

      if (method === 'POST' && pathname === '/gmail/v1/users/me/drafts/send') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.drafts.send');
        context.sendJson(200, await service.sendDraft(mailbox.id, await context.readJsonBody()));
        return true;
      }

      if (method === 'POST' && pathname === '/gmail/v1/users/me/messages/send') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('gmail', accessToken, 'gmail.messages.send');
        context.sendJson(200, await service.sendMessage(mailbox.id, await context.readJsonBody()));
        return true;
      }

      return false;
    },
  },
};
