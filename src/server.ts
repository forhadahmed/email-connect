import { EmailConnectHttpServer as CoreEmailConnectHttpServer } from '@email-connect/core';
import { EmailConnectEngine } from './index.js';

/**
 * Root-package server for the "both providers included" product.
 *
 * The reusable HTTP implementation lives in `@email-connect/core/server`.
 * This wrapper only supplies the root engine that installs Gmail and Graph by
 * default, keeping `email-connect/server` convenient without duplicating server
 * behavior in the top-level package.
 */
export class EmailConnectHttpServer extends CoreEmailConnectHttpServer {
  constructor(options?: { engine?: EmailConnectEngine; adminToken?: string }) {
    super({
      ...options,
      engine: options?.engine || new EmailConnectEngine(),
    });
  }
}
