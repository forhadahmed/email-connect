import { createHash } from 'node:crypto';
import { EmailConnectEngine, decodeBase64UrlToBytes } from '@email-connect/core';
import type {
  GmailApiResponse,
  GmailHistoryRecord,
  GmailLabel,
  GmailMessage,
  GmailMessageRef,
  GmailProfile,
} from './service.js';
import { GmailService } from './service.js';

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
        maxResults?: number;
        pageToken?: string;
      }): Promise<GmailApiResponse<{ messages?: GmailMessageRef[]; nextPageToken?: string }>>;
      get(params: { userId: string; id: string; format?: string }): Promise<GmailApiResponse<GmailMessage>>;
      send(params: { userId: string; requestBody: Record<string, unknown> }): Promise<GmailApiResponse<{ id?: string; threadId?: string }>>;
      attachments: {
        get(params: { userId: string; messageId: string; id: string }): Promise<GmailApiResponse<{ data?: string }>>;
      };
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
  };
};

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

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
          return service.getMessage(mailboxId, params.id);
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
    },
  };
}

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
