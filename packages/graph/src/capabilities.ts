import type { ConnectCapabilityMode } from '@email-connect/core';

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

function scopeSet(scopes: string[] | readonly string[] | null | undefined): Set<string> {
  return new Set(uniqueScopes(scopes || []).map((scope) => scope.toLowerCase()));
}

function hasAnyScope(granted: Set<string>, expected: readonly string[]): boolean {
  return expected.some((scope) => granted.has(scope.toLowerCase()));
}

export function defaultGraphScopesForCapabilityMode(capabilityMode: ConnectCapabilityMode = 'send'): string[] {
  return capabilityMode === 'read' ? [...GRAPH_READ_SCOPES] : [...GRAPH_SEND_SCOPES];
}

export function isGraphOperationAuthorized(scopes: string[], operation: string): boolean {
  const granted = scopeSet(scopes);
  const normalized = operation.trim().toLowerCase();

  if (normalized === 'graph.me.get' || normalized === 'profile.get') {
    return hasAnyScope(granted, [
      'https://graph.microsoft.com/user.read',
      'https://graph.microsoft.com/mail.read',
      'https://graph.microsoft.com/mail.readwrite',
    ]);
  }
  if (
    normalized === 'graph.messages.list' ||
    normalized === 'graph.inbox.messages.list' ||
    normalized === 'graph.delta.get' ||
    normalized === 'graph.message.get' ||
    normalized === 'graph.attachments.list' ||
    normalized === 'graph.attachment.get'
  ) {
    return hasAnyScope(granted, [
      'https://graph.microsoft.com/mail.read',
      'https://graph.microsoft.com/mail.readwrite',
    ]);
  }
  if (
    normalized === 'graph.draft.create' ||
    normalized === 'graph.draft.update' ||
    normalized === 'graph.message.delete' ||
    normalized === 'graph.reply.create'
  ) {
    return hasAnyScope(granted, ['https://graph.microsoft.com/mail.readwrite']);
  }
  if (normalized === 'graph.draft.send') {
    return hasAnyScope(granted, ['https://graph.microsoft.com/mail.send']);
  }
  return true;
}
