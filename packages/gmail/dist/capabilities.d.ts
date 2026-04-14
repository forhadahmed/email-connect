import type { ConnectCapabilityMode } from '@email-connect/core';
export declare const GOOGLE_IDENTITY_SCOPES: readonly ["openid", "email", "profile"];
export declare const GMAIL_READ_SCOPES: readonly ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly"];
export declare const GMAIL_SEND_SCOPES: readonly ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.send"];
export declare function defaultGmailScopesForCapabilityMode(capabilityMode?: ConnectCapabilityMode): string[];
export declare function isGmailOperationAuthorized(scopes: string[], operation: string): boolean;
//# sourceMappingURL=capabilities.d.ts.map