import type { ConnectCapabilityMode, ProviderKind } from '../core/types.js';
export type MailboxCapabilities = {
    read: boolean;
    nativeDraft: boolean;
    nativeSend: boolean;
};
export declare const GOOGLE_IDENTITY_SCOPES: readonly ["openid", "email", "profile"];
export declare const GMAIL_READ_SCOPES: readonly ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly"];
export declare const GMAIL_SEND_SCOPES: readonly ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.send"];
export declare const GRAPH_READ_SCOPES: readonly ["offline_access", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/User.Read"];
export declare const GRAPH_SEND_SCOPES: readonly ["offline_access", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/User.Read", "https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send"];
export declare function normalizeScopeSet(scopes: string[] | readonly string[] | null | undefined): string[];
/**
 * The standalone harness exposes two high-level capability modes because that
 * matches how most consumers think about mailbox auth: "can I read?" and
 * "can I also compose/send?" The concrete provider scope bundles stay here so
 * HTTP facades, SDK helpers, and examples all request the same canonical set.
 */
export declare function defaultScopesForCapabilityMode(provider: ProviderKind, capabilityMode?: ConnectCapabilityMode): string[];
/**
 * Provider operation checks are intentionally a little more precise than the
 * coarse `capabilityMode`. This keeps the black-box HTTP facades honest: a
 * mailbox granted read-only Graph scopes can still list mail, but it cannot
 * create drafts or send. Consumers that want simpler product policy can derive
 * their own capability interpretation on top of these raw provider semantics.
 */
export declare function requiredScopeAlternativesForOperation(provider: ProviderKind, operation: string): string[][];
export declare function isOperationAuthorized(provider: ProviderKind, scopes: string[] | readonly string[], operation: string): boolean;
export declare function deriveMailboxCapabilities(provider: ProviderKind, scopes: string[] | readonly string[]): MailboxCapabilities;
//# sourceMappingURL=capabilities.d.ts.map