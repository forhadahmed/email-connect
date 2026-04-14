export const GOOGLE_IDENTITY_SCOPES = ['openid', 'email', 'profile'];
export const GMAIL_READ_SCOPES = [
    ...GOOGLE_IDENTITY_SCOPES,
    'https://www.googleapis.com/auth/gmail.readonly',
];
export const GMAIL_SEND_SCOPES = [
    ...GMAIL_READ_SCOPES,
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.send',
];
function uniqueScopes(scopes) {
    const out = [];
    const seen = new Set();
    for (const scope of scopes) {
        const clean = String(scope || '').trim();
        if (!clean)
            continue;
        const key = clean.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(clean);
    }
    return out;
}
function scopeSet(scopes) {
    return new Set(uniqueScopes(scopes || []).map((scope) => scope.toLowerCase()));
}
function hasAnyScope(granted, expected) {
    return expected.some((scope) => granted.has(scope.toLowerCase()));
}
export function defaultGmailScopesForCapabilityMode(capabilityMode = 'send') {
    return capabilityMode === 'read' ? [...GMAIL_READ_SCOPES] : [...GMAIL_SEND_SCOPES];
}
export function isGmailOperationAuthorized(scopes, operation) {
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
    if (normalized === 'gmail.labels.list' ||
        normalized === 'gmail.messages.list' ||
        normalized === 'gmail.messages.get' ||
        normalized === 'gmail.history.list' ||
        normalized === 'gmail.attachments.get') {
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
//# sourceMappingURL=capabilities.js.map