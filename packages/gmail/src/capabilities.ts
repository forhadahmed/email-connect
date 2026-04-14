import type { ConnectCapabilityMode } from '@email-connect/core';

export const GOOGLE_IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const;
export const GMAIL_READ_SCOPES = [
  ...GOOGLE_IDENTITY_SCOPES,
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;
export const GMAIL_SEND_SCOPES = [
  ...GMAIL_READ_SCOPES,
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
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

function scopeSet(scopes: string[] | readonly string[] | null | undefined): Set<string> {
  return new Set(uniqueScopes(scopes || []).map((scope) => scope.toLowerCase()));
}

function hasAnyScope(granted: Set<string>, expected: readonly string[]): boolean {
  return expected.some((scope) => granted.has(scope.toLowerCase()));
}

export function defaultGmailScopesForCapabilityMode(capabilityMode: ConnectCapabilityMode = 'send'): string[] {
  return capabilityMode === 'read' ? [...GMAIL_READ_SCOPES] : [...GMAIL_SEND_SCOPES];
}

export function isGmailOperationAuthorized(scopes: string[], operation: string): boolean {
  const granted = scopeSet(scopes);
  const normalized = operation.trim().toLowerCase();

  if (normalized === 'gmail.profile.get' || normalized === 'profile.get') {
    return hasAnyScope(granted, [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.send',
    ]);
  }
  if (
    normalized === 'gmail.labels.list' ||
    normalized === 'gmail.messages.list' ||
    normalized === 'gmail.messages.get' ||
    normalized === 'gmail.history.list' ||
    normalized === 'gmail.attachments.get'
  ) {
    return hasAnyScope(granted, [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
    ]);
  }
  if (normalized === 'gmail.drafts.create') {
    return hasAnyScope(granted, [
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
    ]);
  }
  if (normalized === 'gmail.drafts.send' || normalized === 'gmail.messages.send') {
    return hasAnyScope(granted, [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
    ]);
  }
  return true;
}
