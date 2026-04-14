export declare class EmailConnectError extends Error {
    readonly statusCode: number;
    constructor(message: string, statusCode?: number);
}
export declare class NotFoundError extends EmailConnectError {
    constructor(message: string);
}
export declare class UnauthorizedError extends EmailConnectError {
    constructor(message?: string);
}
export declare class ForbiddenError extends EmailConnectError {
    constructor(message?: string);
}
export declare class ConflictError extends EmailConnectError {
    constructor(message: string);
}
//# sourceMappingURL=errors.d.ts.map