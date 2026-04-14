import { EmailConnectHttpServer as CoreEmailConnectHttpServer } from '@email-connect/core';
import { EmailConnectEngine } from '../index.js';
export class EmailConnectHttpServer extends CoreEmailConnectHttpServer {
    constructor(options) {
        super({
            ...options,
            engine: options?.engine || new EmailConnectEngine(),
        });
    }
}
//# sourceMappingURL=index.js.map