// Normalize binary fixture inputs before they enter provider-specific
// attachment or MIME rendering paths.
export function bytesFromUnknown(value: Uint8Array | ArrayBuffer | Buffer | string): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string') return new Uint8Array(Buffer.from(value, 'utf8'));
  return new Uint8Array(value);
}

// Encode UTF-8 text for Gmail raw payloads and OAuth-ish compact tokens.
export function encodeBase64Url(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

// Decode URL-safe provider payloads back into text.
export function decodeBase64Url(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

// Encode binary content in Gmail's URL-safe attachment/raw-message style.
export function encodeBytesBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

// Encode binary content in standard base64 for MIME and Graph resource fields.
export function encodeBytesBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

// Decode standard base64 attachment/MIME payloads into bytes.
export function decodeBase64ToBytes(raw: string): Uint8Array {
  return new Uint8Array(Buffer.from(raw, 'base64'));
}

// Decode Gmail-style URL-safe base64 payloads into bytes.
export function decodeBase64UrlToBytes(raw: string): Uint8Array {
  return new Uint8Array(Buffer.from(raw, 'base64url'));
}
