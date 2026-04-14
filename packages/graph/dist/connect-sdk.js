import { approveOAuthAuthorization, beginOAuthAuthorization, denyOAuthAuthorization, exchangeAuthorizationCode, refreshAuthorizationGrant, registerOAuthClient, } from '@email-connect/core';
export function registerGraphOAuthClient(engine, input) {
    return registerOAuthClient(engine, {
        ...input,
        provider: 'graph',
    });
}
export function beginGraphAuthorization(params) {
    return beginOAuthAuthorization({
        ...params,
        provider: 'graph',
    });
}
export function approveGraphAuthorization(params) {
    return approveOAuthAuthorization(params);
}
export function denyGraphAuthorization(params) {
    return denyOAuthAuthorization(params);
}
export function exchangeGraphAuthorizationCode(params) {
    return exchangeAuthorizationCode({
        ...params,
        provider: 'graph',
    });
}
export function refreshGraphAuthorization(params) {
    return refreshAuthorizationGrant({
        ...params,
        provider: 'graph',
    });
}
//# sourceMappingURL=connect-sdk.js.map