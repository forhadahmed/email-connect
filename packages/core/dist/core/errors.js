export class EmailConnectError extends Error {
    statusCode;
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'EmailConnectError';
        this.statusCode = statusCode;
    }
}
export class NotFoundError extends EmailConnectError {
    constructor(message) {
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
    constructor(message) {
        super(message, 409);
        this.name = 'ConflictError';
    }
}
//# sourceMappingURL=errors.js.map