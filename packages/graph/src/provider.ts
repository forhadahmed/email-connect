import { EmailConnectError, type EmailConnectProvider, type MailboxRecord } from '@email-connect/core';
import { defaultGraphScopesForCapabilityMode, isGraphOperationAuthorized } from './capabilities.js';
import { GraphService, parsePreferBodyContentType } from './service.js';

// Graph has many nearby resource paths. Centralizing captures here makes the
// provider facade easier to audit against Microsoft route documentation.
const GRAPH_AUTHORIZE_ROUTE_PATTERN = /^\/([^/]+)\/oauth2\/v2\.0\/authorize$/;
const GRAPH_TOKEN_ROUTE_PATTERN = /^\/([^/]+)\/oauth2\/v2\.0\/token$/;
const GRAPH_MESSAGE_ROUTE_PATTERN = /^\/graph\/v1\.0\/me\/messages\/([^/]+)$/;
const GRAPH_MESSAGE_VALUE_ROUTE_PATTERN = /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/\$value$/;
const GRAPH_ATTACHMENTS_LIST_ROUTE_PATTERN = /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/attachments$/;
const GRAPH_ATTACHMENT_VALUE_ROUTE_PATTERN = /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/attachments\/([^/]+)\/\$value$/;
const GRAPH_ATTACHMENT_ROUTE_PATTERN = /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/;
const GRAPH_UPLOAD_SESSION_ROUTE_PATTERN = /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/attachments\/createUploadSession$/;
const GRAPH_CREATE_REPLY_ROUTE_PATTERN = /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/createReply$/;
const GRAPH_SEND_DRAFT_ROUTE_PATTERN = /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/send$/;
const GRAPH_MOVE_MESSAGE_ROUTE_PATTERN = /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/move$/;
const GRAPH_COPY_MESSAGE_ROUTE_PATTERN = /^\/graph\/v1\.0\/me\/messages\/([^/]+)\/copy$/;

// Graph `/me` and connect userinfo surfaces use this mailbox identity projection.
function graphUserInfo(mailbox: MailboxRecord): Record<string, unknown> {
  return {
    id: mailbox.providerUserId,
    mail: mailbox.primaryEmail,
    userPrincipalName: mailbox.primaryEmail,
    displayName: mailbox.displayName || mailbox.primaryEmail,
  };
}

/**
 * Graph provider wiring owns Microsoft-specific endpoint locations, delegated
 * scope behavior, and the HTTP routes mounted on top of the shared engine.
 */
export const graphProvider: EmailConnectProvider = {
  id: 'graph',
  connect: {
    supportsIncrementalConsent: false,
    rotateRefreshTokenOnRefreshByDefault: true,
    providerEndpoints(baseUrl) {
      return {
        authorizeUrl: `${baseUrl}/common/oauth2/v2.0/authorize`,
        tokenUrl: `${baseUrl}/common/oauth2/v2.0/token`,
        graphMeUrl: `${baseUrl}/graph/v1.0/me`,
      };
    },
    defaultScopesForCapabilityMode(capabilityMode) {
      return defaultGraphScopesForCapabilityMode(capabilityMode);
    },
    isOperationAuthorized(scopes, operation) {
      return isGraphOperationAuthorized(scopes, operation);
    },
    buildUserInfo(mailbox) {
      return graphUserInfo(mailbox);
    },
    defaultAuthorizationErrorDescription(errorCode) {
      if (errorCode === 'access_denied') return 'the user canceled the authentication';
      return errorCode;
    },
    resolveAccessType(params) {
      if (params.requestedAccessType) return params.requestedAccessType;
      return params.requestedScopes.some((scope) => scope.toLowerCase() === 'offline_access') ? 'offline' : 'online';
    },
    shouldIssueRefreshToken(params) {
      return (
        params.accessType === 'offline' ||
        params.mailbox.auth.grantedScopes.some((scope) => scope.toLowerCase() === 'offline_access')
      );
    },
    idTokenIssuer() {
      return 'https://login.microsoftonline.com/common/v2.0';
    },
  },
  http: {
    // The provider handler is the black-box Microsoft facade: it keeps route
    // shape, auth checks, and GraphService delegation in one audited seam.
    async handle(context) {
      const { method, url } = context;
      const pathname = url.pathname;
      const service = new GraphService(context.engine);
      // Continuation links emitted by the black-box mock server must point back
      // to the mock host itself so non-JS consumers can follow them directly.
      const facadeBaseUrl = url.origin;

      const authorizeMatch = context.matchPath(pathname, GRAPH_AUTHORIZE_ROUTE_PATTERN);
      // The authorize/token endpoints stay tenant-shaped because many products
      // carry those URLs directly in configuration.
      if (method === 'GET' && authorizeMatch?.[1]) {
        const responseType = String(url.searchParams.get('response_type') || 'code').trim().toLowerCase();
        if (responseType !== 'code') {
          throw new EmailConnectError('Only response_type=code is supported', 400);
        }
        const requestedScopes = context.splitScopes(url.searchParams.get('scope'));
        const request = context.engine.connect.createAuthorizationRequest({
          provider: 'graph',
          clientId: String(url.searchParams.get('client_id') || ''),
          redirectUri: String(url.searchParams.get('redirect_uri') || ''),
          state: url.searchParams.get('state'),
          requestedScopes,
          capabilityMode:
            String(url.searchParams.get('email_connect_mode') || '').trim().toLowerCase() === 'read' ? 'read' : 'send',
          accessType: requestedScopes.some((scope) => scope.toLowerCase() === 'offline_access') ? 'offline' : 'online',
          prompt: url.searchParams.get('prompt'),
          loginHint: url.searchParams.get('login_hint'),
          codeChallenge: url.searchParams.get('code_challenge'),
          codeChallengeMethod:
            String(url.searchParams.get('code_challenge_method') || '').trim().toUpperCase() === 'S256' ? 'S256' : null,
        });
        await context.completeOrRenderConsent('graph', request);
        return true;
      }

      const tokenMatch = context.matchPath(pathname, GRAPH_TOKEN_ROUTE_PATTERN);
      if (method === 'POST' && tokenMatch?.[1]) {
        const body = await context.readFormBody();
        const grantType = String(body.grant_type || '').trim();
        if (grantType === 'authorization_code') {
          await context.respondWithTokenGrant(() =>
            context.engine.connect.exchangeAuthorizationCode({
              provider: 'graph',
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
              provider: 'graph',
              clientId: String(body.client_id || ''),
              ...(body.client_secret != null ? { clientSecret: body.client_secret } : {}),
              refreshToken: String(body.refresh_token || ''),
              scopes: context.splitScopes(body.scope || null),
            }),
          );
          return true;
        }
        throw new EmailConnectError(`Unsupported grant_type for Microsoft: ${grantType}`, 400);
      }

      const accessToken = pathname.startsWith('/graph/v1.0/') ? context.parseBearerToken() : null;

      if (method === 'PUT' && pathname.startsWith('/__email-connect/upload/graph/')) {
        // Upload-session PUTs are provider-specific but sit outside `/graph/v1.0`
        // because Graph returns opaque upload URLs rather than normal resource
        // routes. Handle them before bearer-token routing.
        const outcome = await service.uploadAttachmentChunk(
          `${pathname}${url.search}`,
          await context.readRawBody(),
          Object.fromEntries(
            Object.entries(context.req.headers).map(([name, value]) => [name.toLowerCase(), value]),
          ),
        );
        context.sendJson(outcome.statusCode, outcome.body);
        return true;
      }

      if (!accessToken) return false;

      // The Graph facade preserves the split real clients see in production:
      // `/me`, collections, delta, attachments, compose/send, and uploads.
      const bodyContentType = parsePreferBodyContentType(
        typeof context.req.headers.prefer === 'string' ? context.req.headers.prefer : null,
      );
      const preferenceHeaders = bodyContentType
        ? {
            headers: {
              'Preference-Applied': `outlook.body-content-type="${bodyContentType}"`,
            },
          }
        : undefined;

      if (method === 'GET' && pathname === '/graph/v1.0/me') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.me.get');
        context.sendJson(200, await service.getMe(mailbox.id));
        return true;
      }

      if (method === 'GET' && pathname === '/graph/v1.0/me/messages') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.messages.list');
        context.sendJson(
          200,
          await service.listMessages(mailbox.id, `${pathname}${url.search}`, facadeBaseUrl, { bodyContentType: bodyContentType || undefined }),
          preferenceHeaders,
        );
        return true;
      }

      if (method === 'GET' && pathname === '/graph/v1.0/me/mailFolders/inbox/messages') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.inbox.messages.list');
        context.sendJson(
          200,
          await service.listInboxMessages(mailbox.id, `${pathname}${url.search}`, facadeBaseUrl, { bodyContentType: bodyContentType || undefined }),
          preferenceHeaders,
        );
        return true;
      }

      if (method === 'GET' && pathname === '/graph/v1.0/me/mailFolders/inbox/messages/delta') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.delta.get');
        context.sendJson(
          200,
          await service.delta(mailbox.id, `${pathname}${url.search}`, facadeBaseUrl, { bodyContentType: bodyContentType || undefined }),
          preferenceHeaders,
        );
        return true;
      }

      // Message and attachment resource routes are grouped ahead of compose so
      // the file follows the same read-first flow most Graph consumers do.
      const messageMatch = context.matchPath(pathname, GRAPH_MESSAGE_ROUTE_PATTERN);
      if (method === 'GET' && messageMatch?.[1]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.message.get');
        context.sendJson(
          200,
          await service.getMessage(mailbox.id, decodeURIComponent(messageMatch[1]), { bodyContentType: bodyContentType || undefined }),
          preferenceHeaders,
        );
        return true;
      }

      const messageValueMatch = context.matchPath(pathname, GRAPH_MESSAGE_VALUE_ROUTE_PATTERN);
      if (method === 'GET' && messageValueMatch?.[1]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.message.value');
        context.sendBytes(
          200,
          await service.getMessageValue(mailbox.id, decodeURIComponent(messageValueMatch[1])),
          { contentType: 'message/rfc822' },
        );
        return true;
      }

      const attachmentsListMatch = context.matchPath(pathname, GRAPH_ATTACHMENTS_LIST_ROUTE_PATTERN);
      if (method === 'GET' && attachmentsListMatch?.[1]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.attachments.list');
        context.sendJson(
          200,
          await service.listAttachmentsPage(
            mailbox.id,
            decodeURIComponent(attachmentsListMatch[1]),
            `${pathname}${url.search}`,
            facadeBaseUrl,
          ),
        );
        return true;
      }

      const attachmentValueMatch = context.matchPath(pathname, GRAPH_ATTACHMENT_VALUE_ROUTE_PATTERN);
      if (method === 'GET' && attachmentValueMatch?.[1] && attachmentValueMatch?.[2]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.attachment.get');
        context.sendBytes(
          200,
          await service.getAttachmentValue(mailbox.id, decodeURIComponent(attachmentValueMatch[1]), decodeURIComponent(attachmentValueMatch[2])),
        );
        return true;
      }

      const attachmentMatch = context.matchPath(pathname, GRAPH_ATTACHMENT_ROUTE_PATTERN);
      if (method === 'GET' && attachmentMatch?.[1] && attachmentMatch?.[2]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.attachment.get');
        context.sendJson(
          200,
          await service.getAttachment(mailbox.id, decodeURIComponent(attachmentMatch[1]), decodeURIComponent(attachmentMatch[2]), {
            bodyContentType: bodyContentType || undefined,
          }),
          preferenceHeaders,
        );
        return true;
      }

      const uploadSessionMatch = context.matchPath(
        pathname,
        GRAPH_UPLOAD_SESSION_ROUTE_PATTERN,
      );
      if (method === 'POST' && uploadSessionMatch?.[1]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.attachment.upload.create');
        context.sendJson(
          201,
          await service.createAttachmentUploadSession(
            mailbox.id,
            decodeURIComponent(uploadSessionMatch[1]),
            await context.readJsonBody(),
            facadeBaseUrl,
          ),
        );
        return true;
      }

      // Compose and mailbox-mutation routes come after reads and downloads so
      // the route binder mirrors the usual client lifecycle.
      const createReplyMatch = context.matchPath(pathname, GRAPH_CREATE_REPLY_ROUTE_PATTERN);
      if (method === 'POST' && createReplyMatch?.[1]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.reply.create');
        context.sendJson(200, await service.createReplyDraft(mailbox.id, decodeURIComponent(createReplyMatch[1])));
        return true;
      }

      if (method === 'POST' && pathname === '/graph/v1.0/me/messages') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.draft.create');
        context.sendJson(200, await service.createDraft(mailbox.id, await context.readJsonBody()), preferenceHeaders);
        return true;
      }

      if (method === 'POST' && pathname === '/graph/v1.0/me/sendMail') {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.sendmail.post');
        const contentType = String(context.req.headers['content-type'] || '').toLowerCase();
        await service.sendMail(
          mailbox.id,
          contentType.includes('application/json')
            ? await context.readJsonBody()
            : Buffer.from(await context.readRawBody()).toString('utf8'),
        );
        context.sendText(202, '');
        return true;
      }

      const sendMatch = context.matchPath(pathname, GRAPH_SEND_DRAFT_ROUTE_PATTERN);
      if (method === 'POST' && sendMatch?.[1]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.draft.send');
        await service.sendDraft(mailbox.id, decodeURIComponent(sendMatch[1]));
        context.sendText(202, '');
        return true;
      }

      const moveMatch = context.matchPath(pathname, GRAPH_MOVE_MESSAGE_ROUTE_PATTERN);
      if (method === 'POST' && moveMatch?.[1]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.message.move');
        const body = await context.readJsonBody();
        context.sendJson(
          201,
          await service.moveMessage(
            mailbox.id,
            decodeURIComponent(moveMatch[1]),
            String(body.destinationId || '').trim() || 'archive',
            { bodyContentType: bodyContentType || undefined },
          ),
          preferenceHeaders,
        );
        return true;
      }

      const copyMatch = context.matchPath(pathname, GRAPH_COPY_MESSAGE_ROUTE_PATTERN);
      if (method === 'POST' && copyMatch?.[1]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.message.copy');
        const body = await context.readJsonBody();
        context.sendJson(
          201,
          await service.copyMessage(
            mailbox.id,
            decodeURIComponent(copyMatch[1]),
            String(body.destinationId || '').trim() || 'archive',
            { bodyContentType: bodyContentType || undefined },
          ),
          preferenceHeaders,
        );
        return true;
      }

      if (method === 'PATCH' && messageMatch?.[1]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.draft.update');
        context.sendJson(
          200,
          await service.patchDraft(mailbox.id, decodeURIComponent(messageMatch[1]), await context.readJsonBody()),
          preferenceHeaders,
        );
        return true;
      }

      if (method === 'DELETE' && messageMatch?.[1]) {
        const mailbox = context.engine.connect.authorizeMailboxAccess('graph', accessToken, 'graph.message.delete');
        await service.deleteMessageResource(mailbox.id, decodeURIComponent(messageMatch[1]));
        context.sendJson(200, { success: true });
        return true;
      }

      return false;
    },
  },
};
