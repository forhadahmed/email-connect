import { EmailConnectHttpServer as CoreEmailConnectHttpServer } from '@email-connect/core';
import { EmailConnectEngine } from '../index.js';

export class EmailConnectHttpServer extends CoreEmailConnectHttpServer {
  constructor(options?: { engine?: EmailConnectEngine; adminToken?: string }) {
    super({
      ...options,
      engine: options?.engine || new EmailConnectEngine(),
    });
  }
}
