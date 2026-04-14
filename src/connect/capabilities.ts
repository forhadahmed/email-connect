import type { ConnectCapabilityMode, ProviderKind } from '../core/types.js';

export type MailboxCapabilities = {
  read: boolean;
  nativeDraft: boolean;
  nativeSend: boolean;
};

export const GOOGLE_IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const;
export const GMAIL_READ_SCOPES = [
  ...GOOGLE_IDENTITY_SCOPES,
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;
export const GMAIL_SEND_SCOPES = [
  ...GOOGLE_IDENTITY_SCOPES,
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

export const GRAPH_READ_SCOPES = [
  'offline_access',
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/User.Read',
] as const;
export const GRAPH_SEND_SCOPES = [
  ...GRAPH_READ_SCOPES,
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
] as const;

function uniqueScopes(scopes: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    const clean = String(scope || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

export function normalizeScopeSet(scopes: string[] | readonly string[] | null | undefined): string[] {
  return uniqueScopes((scopes || []).map((scope) => String(scope || '').trim()).filter(Boolean));
}

function scopeSet(scopes: string[] | readonly string[] | null | undefined): Set<string> {
  return new Set(normalizeScopeSet(scopes).map((scope) => scope.toLowerCase()));
}

function hasAnyScope(granted: Set<string>, expected: readonly string[]): boolean {
  return expected.some((scope) => granted.has(scope.toLowerCase()));
}

/**
 * The standalone harness exposes two high-level capability modes because that
 * matches how most consumers think about mailbox auth: "can I read?" and
 * "can I also compose/send?" The concrete provider scope bundles stay here so
 * HTTP facades, SDK helpers, and examples all request the same canonical set.
 */
export function defaultScopesForCapabilityMode(
  provider: ProviderKind,
  capabilityMode: ConnectCapabilityMode = 'send',
): string[] {
  if (provider === 'gmail') {
    return capabilityMode === 'read' ? [...GMAIL_READ_SCOPES] : [...GMAIL_SEND_SCOPES];
  }
  return capabilityMode === 'read' ? [...GRAPH_READ_SCOPES] : [...GRAPH_SEND_SCOPES];
}

/**
 * Provider operation checks are intentionally a little more precise than the
 * coarse `capabilityMode`. This keeps the black-box HTTP facades honest: a
 * mailbox granted read-only Graph scopes can still list mail, but it cannot
 * create drafts or send. Consumers that want simpler product policy can derive
 * their own capability interpretation on top of these raw provider semantics.
 */
export function requiredScopeAlternativesForOperation(provider: ProviderKind, operation: string): string[][] {
  const normalized = operation.trim().toLowerCase();

  if (provider === 'gmail') {
    if (normalized === 'gmail.profile.get') {
      return [
        ['https://www.googleapis.com/auth/gmail.readonly'],
        ['https://www.googleapis.com/auth/gmail.modify'],
        ['https://www.googleapis.com/auth/gmail.compose'],
        ['https://www.googleapis.com/auth/gmail.send'],
      ];
    }
    if (
      normalized === 'gmail.labels.list' ||
      normalized === 'gmail.messages.list' ||
      normalized === 'gmail.messages.get' ||
      normalized === 'gmail.history.list' ||
      normalized === 'gmail.attachments.get'
    ) {
      return [
        ['https://www.googleapis.com/auth/gmail.readonly'],
        ['https://www.googleapis.com/auth/gmail.modify'],
      ];
    }
    if (normalized === 'gmail.drafts.create') {
      return [
        ['https://www.googleapis.com/auth/gmail.compose'],
        ['https://www.googleapis.com/auth/gmail.modify'],
      ];
    }
    if (normalized === 'gmail.drafts.send' || normalized === 'gmail.messages.send') {
      return [
        ['https://www.googleapis.com/auth/gmail.send'],
        ['https://www.googleapis.com/auth/gmail.compose'],
        ['https://www.googleapis.com/auth/gmail.modify'],
      ];
    }
    return [];
  }

  if (normalized === 'graph.me.get') {
    return [
      ['https://graph.microsoft.com/user.read'],
      ['https://graph.microsoft.com/mail.read'],
      ['https://graph.microsoft.com/mail.readwrite'],
    ];
  }
  if (
    normalized === 'graph.messages.list' ||
    normalized === 'graph.inbox.messages.list' ||
    normalized === 'graph.delta.get' ||
    normalized === 'graph.message.get' ||
    normalized === 'graph.attachments.list' ||
    normalized === 'graph.attachment.get'
  ) {
    return [
      ['https://graph.microsoft.com/mail.read'],
      ['https://graph.microsoft.com/mail.readwrite'],
    ];
  }
  if (
    normalized === 'graph.draft.create' ||
    normalized === 'graph.draft.update' ||
    normalized === 'graph.message.delete' ||
    normalized === 'graph.reply.create'
  ) {
    return [['https://graph.microsoft.com/mail.readwrite']];
  }
  if (normalized === 'graph.draft.send') {
    return [['https://graph.microsoft.com/mail.send']];
  }
  return [];
}

export function isOperationAuthorized(provider: ProviderKind, scopes: string[] | readonly string[], operation: string): boolean {
  const alternatives = requiredScopeAlternativesForOperation(provider, operation);
  if (!alternatives.length) return true;
  const granted = scopeSet(scopes);
  return alternatives.some((group) => hasAnyScope(granted, group));
}

export function deriveMailboxCapabilities(provider: ProviderKind, scopes: string[] | readonly string[]): MailboxCapabilities {
  const granted = scopeSet(scopes);
  if (provider === 'gmail') {
    return {
      read: hasAnyScope(granted, [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
      ]),
      nativeDraft: hasAnyScope(granted, [
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.modify',
      ]),
      nativeSend: hasAnyScope(granted, [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.modify',
      ]),
    };
  }

  return {
    read: hasAnyScope(granted, [
      'https://graph.microsoft.com/mail.read',
      'https://graph.microsoft.com/mail.readwrite',
    ]),
    nativeDraft: hasAnyScope(granted, ['https://graph.microsoft.com/mail.readwrite']),
    nativeSend: hasAnyScope(granted, ['https://graph.microsoft.com/mail.send']),
  };
}
