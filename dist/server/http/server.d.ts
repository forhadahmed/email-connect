import { EmailConnectEngine } from '../../engine/email-connect-engine.js';
/**
 * First-class HTTP facade for polyglot users.
 *
 * The server never owns provider semantics itself. It only authenticates the
 * request, delegates into the canonical engine-backed services, and renders the
 * result as JSON or bytes.
 */
export declare class EmailConnectHttpServer {
    readonly engine: EmailConnectEngine;
    readonly adminToken: string;
    private readonly gmail;
    private readonly graph;
    private server;
    private listeningAddress;
    constructor(options?: {
        engine?: EmailConnectEngine;
        adminToken?: string;
    });
    get baseUrl(): string;
    listen(options?: {
        host?: string;
        port?: number;
    }): Promise<{
        baseUrl: string;
        adminToken: string;
    }>;
    close(): Promise<void>;
    private handle;
    private handleControl;
    private handleConsentAction;
    private handleGoogleConnect;
    private handleMicrosoftConnect;
    private completeOrRenderConsent;
    private resolveConsentMode;
    private respondWithTokenGrant;
    private mapOAuthTokenError;
    private handleGmail;
    private handleGraph;
}
//# sourceMappingURL=server.d.ts.map