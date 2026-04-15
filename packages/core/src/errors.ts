/**
 * Core errors deliberately map to HTTP semantics because the same engine powers
 * both the embeddable SDK and the black-box HTTP server.
 */
export class EmailConnectError extends Error {
  readonly statusCode: number;

  // Store the HTTP status on the error so SDK and server callers can share the
  // same exception hierarchy.
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'EmailConnectError';
    this.statusCode = statusCode;
  }
}

// Missing provider resources map cleanly to HTTP 404 in black-box mode.
export class NotFoundError extends EmailConnectError {
  // Keep not-found errors specific without requiring callers to remember status
  // codes at throw sites.
  constructor(message: string) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

// Auth failures cover missing/expired/revoked tokens and invalid OAuth clients.
export class UnauthorizedError extends EmailConnectError {
  // Default wording is useful for low-level auth gates where no provider-specific
  // detail is available.
  constructor(message = 'Unauthorized') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

// Forbidden is distinct from unauthorized for scope/capability-style failures.
export class ForbiddenError extends EmailConnectError {
  // Scope-style denials are explicit 403s, separate from missing/invalid tokens.
  constructor(message = 'Forbidden') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

// Conflict captures invalid scenario state transitions and duplicate resources.
export class ConflictError extends EmailConnectError {
  // Conflicts are used for malformed provider state transitions rather than
  // validation errors that can be corrected by auth alone.
  constructor(message: string) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}
