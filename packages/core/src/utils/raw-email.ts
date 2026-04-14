import { decodeBase64Url } from './base64.js';

export type ParsedRawEmail = {
  to: string | null;
  subject: string | null;
  bodyText: string;
  bodyHtml: string | null;
  headers: Record<string, string>;
};

function extractBoundary(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const match = contentType.match(/boundary="?([^";]+)"?/i);
  return match?.[1] ? String(match[1]).trim() : null;
}

function parseMultipartAlternativeBody(body: string, boundary: string): { bodyText: string; bodyHtml: string | null } {
  const marker = `--${boundary}`;
  const segments = body
    .split(marker)
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry !== '--');

  let bodyText = '';
  let bodyHtml: string | null = null;

  for (const segment of segments) {
    const [partHeaderBlock, ...partBodyParts] = segment.replace(/--$/, '').split(/\r?\n\r?\n/);
    const partHeaders: Record<string, string> = {};
    for (const line of String(partHeaderBlock || '').split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const name = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (name) partHeaders[name] = value;
    }
    const content = partBodyParts.join('\n\n').trim();
    const contentType = String(partHeaders['content-type'] || '').toLowerCase();
    if (!content) continue;
    if (contentType.includes('text/plain')) {
      bodyText = content;
      continue;
    }
    if (contentType.includes('text/html')) {
      bodyHtml = content;
    }
  }

  return { bodyText, bodyHtml };
}

/**
 * This parser intentionally targets the MIME shapes our provider harness needs
 * to round-trip in tests:
 * - simple text/plain bodies
 * - simple text/html bodies
 * - multipart/alternative messages produced by app-side mailbox senders
 *
 * It is not a general RFC 5322 / MIME implementation. Public harness code
 * should stay explicit about that so consumers know where to extend it.
 */
export function parseRawEmailBase64Url(raw: string): ParsedRawEmail {
  const decoded = decodeBase64Url(raw);
  const [headerBlock, ...bodyParts] = decoded.split(/\r?\n\r?\n/);
  const headers: Record<string, string> = {};
  for (const line of String(headerBlock || '').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (name) headers[name] = value;
  }
  const body = bodyParts.join('\n\n').trim();
  const contentType = String(headers['content-type'] || '').toLowerCase();

  if (contentType.includes('multipart/alternative')) {
    const boundary = extractBoundary(headers['content-type']);
    const parsed = boundary ? parseMultipartAlternativeBody(body, boundary) : { bodyText: body, bodyHtml: null };
    return {
      to: headers['to'] || null,
      subject: headers['subject'] || null,
      bodyText: parsed.bodyText,
      bodyHtml: parsed.bodyHtml,
      headers,
    };
  }

  return {
    to: headers['to'] || null,
    subject: headers['subject'] || null,
    bodyText: contentType.includes('text/html') ? '' : body,
    bodyHtml: contentType.includes('text/html') ? body : null,
    headers,
  };
}

export function normalizeAddressInput(value: string | string[] | null | undefined): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => String(entry || '').trim()).filter(Boolean);
    return normalized.length ? normalized.join(', ') : null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}
