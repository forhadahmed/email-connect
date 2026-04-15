/**
 * Core errors deliberately map to HTTP semantics because the same engine powers
 * both the embeddable SDK and the black-box HTTP server.
 */
export class EmailConnectError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'EmailConnectError';
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends EmailConnectError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends EmailConnectError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends EmailConnectError {
  constructor(message = 'Forbidden') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends EmailConnectError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}
