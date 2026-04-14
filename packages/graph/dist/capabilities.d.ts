import type { ConnectCapabilityMode } from '@email-connect/core';
export declare const GRAPH_READ_SCOPES: readonly ["offline_access", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/User.Read"];
export declare const GRAPH_SEND_SCOPES: readonly ["offline_access", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/User.Read", "https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send"];
export declare function defaultGraphScopesForCapabilityMode(capabilityMode?: ConnectCapabilityMode): string[];
export declare function isGraphOperationAuthorized(scopes: string[], operation: string): boolean;
//# sourceMappingURL=capabilities.d.ts.map