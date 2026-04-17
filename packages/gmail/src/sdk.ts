import { createHash } from 'node:crypto';
import { EmailConnectEngine, decodeBase64UrlToBytes } from '@email-connect/core';
import type {
  GmailApiResponse,
  GmailHistoryRecord,
  GmailLabel,
  GmailMessage,
  GmailMessageRef,
  GmailProfile,
  GmailThread,
  GmailThreadRef,
  GmailWatchResponse,
} from './service.js';
import { GmailService } from './service.js';

// GmailClient mirrors the nested `users.*` surface commonly used by Google API
// clients while still delegating every operation to the canonical mock service.
export type GmailClient = {
  users: {
    getProfile(params: { userId: string }): Promise<GmailApiResponse<GmailProfile>>;
    labels: {
      list(params: { userId: string }): Promise<GmailApiResponse<{ labels?: GmailLabel[] }>>;
    };
    messages: {
      list(params: {
        userId: string;
        q?: string;
        labelIds?: string[];
        maxResults?: number;
        pageToken?: string;
      }): Promise<GmailApiResponse<{ messages?: GmailMessageRef[]; nextPageToken?: string; resultSizeEstimate?: number }>>;
      get(params: {
        userId: string;
        id: string;
        format?: string;
        metadataHeaders?: string[];
      }): Promise<GmailApiResponse<GmailMessage>>;
      import(params: { userId: string; requestBody: Record<string, unknown> }): Promise<GmailApiResponse<GmailMessage>>;
      insert(params: { userId: string; requestBody: Record<string, unknown> }): Promise<GmailApiResponse<GmailMessage>>;
      send(params: { userId: string; requestBody: Record<string, unknown> }): Promise<GmailApiResponse<{ id?: string; threadId?: string }>>;
      attachments: {
        get(params: { userId: string; messageId: string; id: string }): Promise<GmailApiResponse<{ data?: string }>>;
      };
    };
    threads: {
      list(params: {
        userId: string;
        q?: string;
        labelIds?: string[];
        maxResults?: number;
        pageToken?: string;
      }): Promise<GmailApiResponse<{ threads?: GmailThreadRef[]; nextPageToken?: string; resultSizeEstimate?: number }>>;
      get(params: {
        userId: string;
        id: string;
        format?: string;
        metadataHeaders?: string[];
      }): Promise<GmailApiResponse<GmailThread>>;
    };
    history: {
      list(params: {
        userId: string;
        startHistoryId: string;
        pageToken?: string;
        historyTypes?: string[];
      }): Promise<GmailApiResponse<{ historyId?: string; nextPageToken?: string; history?: GmailHistoryRecord[] }>>;
    };
    drafts: {
      create(params: {
        userId: string;
        requestBody: Record<string, unknown>;
      }): Promise<GmailApiResponse<{ id?: string; message?: { id?: string; threadId?: string } }>>;
      send(params: { userId: string; requestBody: Record<string, unknown> }): Promise<GmailApiResponse<{ id?: string; threadId?: string }>>;
    };
    watch(params: { userId: string; requestBody: Record<string, unknown> }): Promise<GmailApiResponse<GmailWatchResponse>>;
    stop(params: { userId: string }): Promise<GmailApiResponse<Record<string, never>>>;
  };
};

/**
 * The white-box Gmail client mirrors the official nested client shape so
 * downstream tests can switch between mock and real client code with minimal
 * ceremony.
 */
// Gmail SDK ids in some helper flows use deterministic hashes so repeated
// fixture input produces stable draft/message identifiers.
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Build a Gmail-like nested client around the canonical service. The shape is
// intentionally close to common Google client libraries, but it never bypasses
// the same service code used by HTTP routes.
export function getGmailClientForMailbox(engine: EmailConnectEngine, mailboxId: string): GmailClient {
  const service = new GmailService(engine);
  return {
    users: {
      getProfile() {
        return service.getProfile(mailboxId);
      },
      labels: {
        list() {
          return service.listLabels(mailboxId);
        },
      },
      messages: {
        list(params) {
          return service.listMessages(mailboxId, params);
        },
        get(params) {
          return service.getMessage(mailboxId, params.id, {
            ...(params.format ? { format: params.format } : {}),
            ...(params.metadataHeaders?.length ? { metadataHeaders: params.metadataHeaders } : {}),
          });
        },
        import(params) {
          return service.importMessage(mailboxId, params.requestBody, 'import');
        },
        insert(params) {
          return service.importMessage(mailboxId, params.requestBody, 'insert');
        },
        send(params) {
          return service.sendMessage(mailboxId, params.requestBody);
        },
        attachments: {
          get(params) {
            return service.getAttachment(mailboxId, params.messageId, params.id);
          },
        },
      },
      threads: {
        list(params) {
          return service.listThreads(mailboxId, params);
        },
        get(params) {
          return service.getThread(mailboxId, params.id, {
            ...(params.format ? { format: params.format } : {}),
            ...(params.metadataHeaders?.length ? { metadataHeaders: params.metadataHeaders } : {}),
          });
        },
      },
      history: {
        list(params) {
          return service.listHistory(mailboxId, params);
        },
      },
      drafts: {
        create(params) {
          return service.createDraft(mailboxId, params.requestBody);
        },
        send(params) {
          return service.sendDraft(mailboxId, params.requestBody);
        },
      },
      watch(params) {
        return service.watchMailbox(mailboxId, params.requestBody);
      },
      stop() {
        return service.stopWatching(mailboxId);
      },
    },
  };
}

/**
 * Helpers below are opinionated convenience flows on top of the client-shaped
 * API. They model the common Gmail testing tasks consumers keep repeating.
 */
// Download one Gmail attachment and decode Gmail's base64url wrapper back into
// raw bytes for fixture assertions or downstream parsing.
export async function downloadGmailAttachment(params: {
  engine: EmailConnectEngine;
  mailboxId: string;
  providerMessageId: string;
  providerAttachmentId: string;
}): Promise<Uint8Array> {
  const client = getGmailClientForMailbox(params.engine, params.mailboxId);
  const res = await client.users.messages.attachments.get({
    userId: 'me',
    messageId: params.providerMessageId,
    id: params.providerAttachmentId,
  });
  if (!res.data.data) {
    throw new Error('Gmail attachment response missing data');
  }
  return decodeBase64UrlToBytes(res.data.data);
}

// Create a plain-text Gmail draft through the same canonical draft pipeline the
// provider HTTP facade uses.
export async function createGmailDraft(params: {
  engine: EmailConnectEngine;
  mailboxId: string;
  to: string;
  subject?: string | null;
  bodyText: string;
  threadId?: string | null;
  inReplyToMessageId?: string | null;
  referencesMessageId?: string | null;
}) {
  const service = new GmailService(params.engine);
  const created = await service.createPlainDraft(params.mailboxId, params);
  return {
    ...created,
    bodySha256: sha256Hex(params.bodyText),
  };
}

// Create a reply-oriented Gmail draft that preserves thread headers and
// normalizes the subject into Gmail-style reply form.
export async function createGmailReplyDraft(params: {
  engine: EmailConnectEngine;
  mailboxId: string;
  to: string;
  subject?: string | null;
  bodyText: string;
  threadId?: string | null;
  inReplyToMessageId?: string | null;
  referencesMessageId?: string | null;
}) {
  const service = new GmailService(params.engine);
  const created = await service.createReplyDraft(params.mailboxId, params);
  return {
    ...created,
    bodySha256: sha256Hex(params.bodyText),
  };
}

// Send an existing Gmail draft and return the provider-visible message and
// thread identifiers recorded by the mock.
export async function sendGmailReplyDraft(params: {
  engine: EmailConnectEngine;
  mailboxId: string;
  providerDraftId: string;
}): Promise<{ providerMessageId: string | null; providerThreadId: string | null }> {
  const service = new GmailService(params.engine);
  const sent = await service.sendDraft(params.mailboxId, {
    id: params.providerDraftId,
  });
  return {
    providerMessageId: sent.data.id || null,
    providerThreadId: sent.data.threadId || null,
  };
}
