import { approveOAuthAuthorization, beginOAuthAuthorization, denyOAuthAuthorization, exchangeAuthorizationCode, refreshAuthorizationGrant, registerOAuthClient, revokeAuthorizationToken, } from '@email-connect/core';
export function registerGmailOAuthClient(engine, input) {
    return registerOAuthClient(engine, {
        ...input,
        provider: 'gmail',
    });
}
export function beginGmailAuthorization(params) {
    return beginOAuthAuthorization({
        ...params,
        provider: 'gmail',
    });
}
export function approveGmailAuthorization(params) {
    return approveOAuthAuthorization(params);
}
export function denyGmailAuthorization(params) {
    return denyOAuthAuthorization(params);
}
export function exchangeGmailAuthorizationCode(params) {
    return exchangeAuthorizationCode({
        ...params,
        provider: 'gmail',
    });
}
export function refreshGmailAuthorization(params) {
    return refreshAuthorizationGrant({
        ...params,
        provider: 'gmail',
    });
}
export function revokeGmailAuthorization(params) {
    return revokeAuthorizationToken({
        ...params,
        provider: 'gmail',
    });
}
//# sourceMappingURL=connect-sdk.js.map