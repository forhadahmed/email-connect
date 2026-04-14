export function bytesFromUnknown(value) {
    if (value instanceof Uint8Array)
        return new Uint8Array(value);
    if (value instanceof ArrayBuffer)
        return new Uint8Array(value);
    if (typeof value === 'string')
        return new Uint8Array(Buffer.from(value, 'utf8'));
    return new Uint8Array(value);
}
export function encodeBase64Url(raw) {
    return Buffer.from(raw, 'utf8').toString('base64url');
}
export function decodeBase64Url(raw) {
    return Buffer.from(raw, 'base64url').toString('utf8');
}
export function encodeBytesBase64Url(bytes) {
    return Buffer.from(bytes).toString('base64url');
}
export function encodeBytesBase64(bytes) {
    return Buffer.from(bytes).toString('base64');
}
export function decodeBase64ToBytes(raw) {
    return new Uint8Array(Buffer.from(raw, 'base64'));
}
export function decodeBase64UrlToBytes(raw) {
    return new Uint8Array(Buffer.from(raw, 'base64url'));
}
//# sourceMappingURL=base64.js.map