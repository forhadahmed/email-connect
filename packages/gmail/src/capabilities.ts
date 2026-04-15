import type { ConnectCapabilityMode } from '@email-connect/core';

/**
 * Gmail scopes are grouped by the capability modes consumers actually reason
 * about: read-only mailbox access versus compose/send-capable access.
 */
export const GOOGLE_IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const;
// Read defaults include identity scopes because mailbox-connect flows commonly
// validate the connected Google account immediately after consent.
export const GMAIL_READ_SCOPES = [
  ...GOOGLE_IDENTITY_SCOPES,
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;
// Send defaults intentionally include modify/compose/send so draft, send, and
// mutation-oriented tests work from one practical consent bundle.
export const GMAIL_SEND_SCOPES = [
  ...GMAIL_READ_SCOPES,
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
] as const;
// Metadata and insert/full scopes are kept separately because they unlock
// important edge cases without being part of the default bundles.
export const GMAIL_METADATA_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
// Insert/import tests need this narrower Gmail scope without granting full
// mailbox access.
export const GMAIL_INSERT_SCOPE = 'https://www.googleapis.com/auth/gmail.insert';
// Full Gmail access acts as the catch-all escape hatch in Google's scope model.
export const GMAIL_FULL_SCOPE = 'https://mail.google.com/';

// Scope arrays should remain ordered for token payload assertions while still
// avoiding duplicate grants from composed capability groups.
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

// Capability checks are case-insensitive because providers treat scopes as
// strings but consumers often normalize them differently in fixtures.
function scopeSet(scopes: string[] | readonly string[] | null | undefined): Set<string> {
  return new Set(uniqueScopes(scopes || []).map((scope) => scope.toLowerCase()));
}

// Operation rules are usually "any of these scopes is sufficient", so keep that
// primitive explicit and shared across the policy table below.
function hasAnyScope(granted: Set<string>, expected: readonly string[]): boolean {
  return expected.some((scope) => granted.has(scope.toLowerCase()));
}

// Default Gmail consent bundles are intentionally opinionated product defaults,
// not the complete list of Gmail scopes.
export function defaultGmailScopesForCapabilityMode(capabilityMode: ConnectCapabilityMode = 'send'): string[] {
  return capabilityMode === 'read' ? [...GMAIL_READ_SCOPES] : [...GMAIL_SEND_SCOPES];
}

/**
 * Authorization checks are operation-oriented instead of route-oriented so the
 * same policy applies to SDK flows and HTTP facade calls.
 */
export function isGmailOperationAuthorized(scopes: string[], operation: string): boolean {
  const granted = scopeSet(scopes);
  const normalized = operation.trim().toLowerCase();

  if (normalized === 'gmail.profile.get' || normalized === 'profile.get') {
    return hasAnyScope(granted, [
      GMAIL_METADATA_SCOPE,
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.send',
      GMAIL_FULL_SCOPE,
    ]);
  }
  if (
    normalized === 'gmail.labels.list' ||
    normalized === 'gmail.messages.list' ||
    normalized === 'gmail.messages.get.metadata' ||
    normalized === 'gmail.history.list' ||
    normalized === 'gmail.threads.list' ||
    normalized === 'gmail.threads.get.metadata' ||
    normalized === 'gmail.watch.create' ||
    normalized === 'gmail.watch.stop'
  ) {
    return hasAnyScope(granted, [
      GMAIL_METADATA_SCOPE,
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      GMAIL_FULL_SCOPE,
    ]);
  }
  if (normalized === 'gmail.messages.list.search') {
    return hasAnyScope(granted, [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      GMAIL_FULL_SCOPE,
    ]);
  }
  if (
    normalized === 'gmail.messages.get.body' ||
    normalized === 'gmail.threads.get.body' ||
    normalized === 'gmail.attachments.get'
  ) {
    return hasAnyScope(granted, [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      GMAIL_FULL_SCOPE,
    ]);
  }
  if (normalized === 'gmail.drafts.create') {
    return hasAnyScope(granted, [
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
      GMAIL_FULL_SCOPE,
    ]);
  }
  if (normalized === 'gmail.drafts.send' || normalized === 'gmail.messages.send') {
    return hasAnyScope(granted, [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
      GMAIL_FULL_SCOPE,
    ]);
  }
  if (normalized === 'gmail.messages.import' || normalized === 'gmail.messages.insert') {
    return hasAnyScope(granted, [
      GMAIL_INSERT_SCOPE,
      'https://www.googleapis.com/auth/gmail.modify',
      GMAIL_FULL_SCOPE,
    ]);
  }
  return true;
}
