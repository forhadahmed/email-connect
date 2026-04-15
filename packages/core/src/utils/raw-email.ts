import { decodeBase64Url, decodeBase64ToBytes, decodeBase64UrlToBytes } from './base64.js';

// Parsed raw mail is the normalized bridge from RFC822-ish provider inputs into
// the engine's provider-neutral message model.
export type ParsedRawEmail = {
  from: string | null;
  to: string | null;
  subject: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  date: string | null;
  bodyText: string;
  bodyHtml: string | null;
  headers: Record<string, string>;
  attachments: RawEmailAttachmentPart[];
};

// Attachment parts are the subset of MIME metadata that provider mocks expose
// through Gmail attachments, Graph attachments, and raw message round-trips.
export type RawEmailAttachmentPart = {
  filename: string;
  mimeType: string;
  contentBytes: Uint8Array;
  isInline?: boolean;
  contentId?: string | null;
};

// Raw email rendering input mirrors canonical message fields so Gmail `raw` and
// Graph `$value` can be generated from one shared utility.
export type RawEmailRenderInput = {
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  date?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  headers?: Record<string, string> | null;
  attachments?: RawEmailAttachmentPart[];
};

// Keep MIME grammar fragments named. These are intentionally small, practical
// patterns for provider-test fixtures rather than a full RFC parser.
const MIME_BOUNDARY_PARAMETER_PATTERN = /boundary="?([^";]+)"?/i;
const MIME_FILENAME_PARAMETER_PATTERN = /filename="?([^";]+)"?/i;
const MIME_NAME_PARAMETER_PATTERN = /name="?([^";]+)"?/i;
const MIME_LINE_BREAK_PATTERN = /\r?\n/;
const MIME_LINE_BREAK_GLOBAL_PATTERN = /\r?\n/g;
const MIME_HEADER_BODY_SEPARATOR_PATTERN = /\r?\n\r?\n/;
const MIME_CLOSING_BOUNDARY_SUFFIX_PATTERN = /--$/;
const MIME_CONTENT_ID_WRAPPER_PATTERN = /[<>]/g;
const BASE64URL_MARKER_PATTERN = /[-_]/;

// MIME parsing here is intentionally practical rather than exhaustive. The
// goal is to support the raw-message seams that provider mocks expose, not to
// become a full general-purpose email parser.
// Boundary extraction is deliberately small because the renderer below emits
// simple quoted boundaries and the parser targets those provider-test shapes.
function extractBoundary(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const match = contentType.match(MIME_BOUNDARY_PARAMETER_PATTERN);
  return match?.[1] ? String(match[1]).trim() : null;
}

// Parse headers into lower-case keys for easier lookup while preserving the
// original rendered header names elsewhere when provider resources need them.
function parseHeadersBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of String(block || '').split(MIME_LINE_BREAK_PATTERN)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (name) headers[name] = value;
  }
  return headers;
}

// Attachment names can appear in Content-Disposition or Content-Type depending
// on which client generated the MIME part.
function filenameFromHeaders(headers: Record<string, string>): string | null {
  const contentDisposition = String(headers['content-disposition'] || '');
  const dispositionMatch = contentDisposition.match(MIME_FILENAME_PARAMETER_PATTERN);
  if (dispositionMatch?.[1]) return String(dispositionMatch[1]).trim();
  const contentType = String(headers['content-type'] || '');
  const typeMatch = contentType.match(MIME_NAME_PARAMETER_PATTERN);
  if (typeMatch?.[1]) return String(typeMatch[1]).trim();
  return null;
}

// Decode the encodings the harness emits and common client fixtures use.
function decodePartBody(body: string, transferEncoding: string): Uint8Array {
  const normalized = body.replace(MIME_LINE_BREAK_GLOBAL_PATTERN, '');
  if (transferEncoding.toLowerCase() === 'base64') {
    return new Uint8Array(Buffer.from(normalized, 'base64'));
  }
  return new Uint8Array(Buffer.from(body, 'utf8'));
}

// Multipart parsing may recurse through alternative bodies; merge keeps the
// first text/html body and accumulates attachments.
function mergeBodyParts(
  target: { bodyText: string; bodyHtml: string | null; attachments: RawEmailAttachmentPart[] },
  source: { bodyText: string; bodyHtml: string | null; attachments: RawEmailAttachmentPart[] },
): void {
  if (!target.bodyText && source.bodyText) target.bodyText = source.bodyText;
  if (target.bodyHtml == null && source.bodyHtml != null) target.bodyHtml = source.bodyHtml;
  target.attachments.push(...source.attachments);
}

// Multipart parsing preserves the pieces provider mocks actually surface:
// plain text, HTML, file attachments, and inline content ids.
function parseMultipartBody(
  body: string,
  boundary: string,
): { bodyText: string; bodyHtml: string | null; attachments: RawEmailAttachmentPart[] } {
  const marker = `--${boundary}`;
  const segments = body
    .split(marker)
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry !== '--');

  const parsed = {
    bodyText: '',
    bodyHtml: null as string | null,
    attachments: [] as RawEmailAttachmentPart[],
  };

  for (const segment of segments) {
    const [partHeaderBlock, ...partBodyParts] = segment
      .replace(MIME_CLOSING_BOUNDARY_SUFFIX_PATTERN, '')
      .split(MIME_HEADER_BODY_SEPARATOR_PATTERN);
    const partHeaders = parseHeadersBlock(partHeaderBlock || '');
    const content = partBodyParts.join('\n\n').trim();
    const contentType = String(partHeaders['content-type'] || '').toLowerCase();
    const contentDisposition = String(partHeaders['content-disposition'] || '').toLowerCase();
    const nestedBoundary = extractBoundary(partHeaders['content-type']);
    if (!content) continue;
    if (contentType.includes('multipart/') && nestedBoundary) {
      mergeBodyParts(parsed, parseMultipartBody(content, nestedBoundary));
      continue;
    }
    const filename = filenameFromHeaders(partHeaders);
    const isAttachment =
      Boolean(filename) ||
      contentDisposition.includes('attachment') ||
      contentDisposition.includes('inline');
    if (isAttachment) {
      parsed.attachments.push({
        filename: filename || 'attachment.bin',
        mimeType: contentType.split(';')[0]?.trim() || 'application/octet-stream',
        contentBytes: decodePartBody(content, String(partHeaders['content-transfer-encoding'] || '')),
        ...(contentDisposition.includes('inline') ? { isInline: true } : {}),
        ...(partHeaders['content-id']
          ? { contentId: String(partHeaders['content-id']).replace(MIME_CONTENT_ID_WRAPPER_PATTERN, '').trim() || null }
          : {}),
      });
      continue;
    }
    if (contentType.includes('text/plain')) {
      parsed.bodyText = content;
      continue;
    }
    if (contentType.includes('text/html')) {
      parsed.bodyHtml = content;
    }
  }

  return parsed;
}

// Parse one decoded RFC822-ish message into the canonical raw-email structure
// used by Gmail raw send/import and Graph MIME send.
function parseRawEmail(decoded: string): ParsedRawEmail {
  const [headerBlock, ...bodyParts] = decoded.split(MIME_HEADER_BODY_SEPARATOR_PATTERN);
  const headers = parseHeadersBlock(headerBlock || '');
  const body = bodyParts.join('\n\n').trim();
  const contentType = String(headers['content-type'] || '').toLowerCase();

  if (contentType.includes('multipart/')) {
    const boundary = extractBoundary(headers['content-type']);
    const parsed = boundary
      ? parseMultipartBody(body, boundary)
      : { bodyText: body, bodyHtml: null, attachments: [] as RawEmailAttachmentPart[] };
    return {
      from: headers['from'] || null,
      to: headers['to'] || null,
      subject: headers['subject'] || null,
      messageId: headers['message-id'] || null,
      inReplyTo: headers['in-reply-to'] || null,
      references: headers['references'] || null,
      date: headers['date'] || null,
      bodyText: parsed.bodyText,
      bodyHtml: parsed.bodyHtml,
      headers,
      attachments: parsed.attachments,
    };
  }

  return {
    from: headers['from'] || null,
    to: headers['to'] || null,
    subject: headers['subject'] || null,
    messageId: headers['message-id'] || null,
    inReplyTo: headers['in-reply-to'] || null,
    references: headers['references'] || null,
    date: headers['date'] || null,
    bodyText: contentType.includes('text/html') ? '' : body,
    bodyHtml: contentType.includes('text/html') ? body : null,
    headers,
    attachments: [],
  };
}

// Render standard headers once so Gmail raw and Graph `$value` stay aligned.
function baseMimeHeaders(input: RawEmailRenderInput): string[] {
  const headers: string[] = [];
  if (input.from) headers.push(`From: ${input.from}`);
  if (input.to) headers.push(`To: ${input.to}`);
  if (input.subject) headers.push(`Subject: ${input.subject}`);
  if (input.date) headers.push(`Date: ${input.date}`);
  if (input.messageId) headers.push(`Message-ID: ${input.messageId}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);
  for (const [name, value] of Object.entries(input.headers || {})) {
    if (!String(name || '').trim() || !String(value || '').trim()) continue;
    const normalized = name.trim().toLowerCase();
    if (
      normalized === 'from' ||
      normalized === 'to' ||
      normalized === 'subject' ||
      normalized === 'date' ||
      normalized === 'message-id' ||
      normalized === 'in-reply-to' ||
      normalized === 'references'
    ) {
      continue;
    }
    headers.push(`${name.trim()}: ${String(value).trim()}`);
  }
  return headers;
}

// Body rendering chooses single-part text/html or multipart/alternative based
// on the canonical body fields.
function renderAlternativeBody(input: RawEmailRenderInput): { contentType: string; body: string } {
  const bodyText = String(input.bodyText || '');
  const bodyHtml = input.bodyHtml == null ? null : String(input.bodyHtml);
  if (bodyHtml != null && bodyText) {
    const boundary = 'email-connect-alt';
    return {
      contentType: `multipart/alternative; boundary="${boundary}"`,
      body: [
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        bodyText,
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        '',
        bodyHtml,
        `--${boundary}--`,
      ].join('\r\n'),
    };
  }
  if (bodyHtml != null) {
    return {
      contentType: 'text/html; charset="UTF-8"',
      body: bodyHtml,
    };
  }
  return {
    contentType: 'text/plain; charset="UTF-8"',
    body: bodyText,
  };
}

/**
 * Providers expose raw MIME bodies through different routes and encodings, but
 * the message-shape substrate is shared. Keeping rendering in `core` lets Gmail
 * and Graph stay consistent without inventing provider-specific MIME builders.
 */
export function renderRawEmail(input: RawEmailRenderInput): string {
  const headers = baseMimeHeaders(input);
  headers.push('MIME-Version: 1.0');

  const attachments = input.attachments || [];
  const bodyPart = renderAlternativeBody(input);

  if (!attachments.length) {
    headers.push(`Content-Type: ${bodyPart.contentType}`);
    return `${headers.join('\r\n')}\r\n\r\n${bodyPart.body}\r\n`;
  }

  const mixedBoundary = 'email-connect-mixed';
  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  const parts: string[] = [
    `--${mixedBoundary}`,
    `Content-Type: ${bodyPart.contentType}`,
    '',
    bodyPart.body,
  ];

  for (const attachment of attachments) {
    parts.push(`--${mixedBoundary}`);
    parts.push(`Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`);
    parts.push('Content-Transfer-Encoding: base64');
    parts.push(
      `Content-Disposition: ${attachment.isInline ? 'inline' : 'attachment'}; filename="${attachment.filename}"`,
    );
    if (attachment.contentId) {
      parts.push(`Content-ID: <${attachment.contentId}>`);
    }
    parts.push('');
    parts.push(Buffer.from(attachment.contentBytes).toString('base64'));
  }
  parts.push(`--${mixedBoundary}--`);
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n`;
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
  return parseRawEmail(decodeBase64Url(raw));
}

// Some provider APIs and client libraries are inconsistent about base64 vs
// base64url. Accept both at this seam to keep examples and tests ergonomic.
export function parseRawEmailBase64(raw: string): ParsedRawEmail {
  const bytes = BASE64URL_MARKER_PATTERN.test(raw) ? decodeBase64UrlToBytes(raw) : decodeBase64ToBytes(raw);
  return parseRawEmail(Buffer.from(bytes).toString('utf8'));
}

// Canonical address inputs accept strings or arrays because Graph and Gmail
// compose helpers naturally start from different shapes.
export function normalizeAddressInput(value: string | string[] | null | undefined): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => String(entry || '').trim()).filter(Boolean);
    return normalized.length ? normalized.join(', ') : null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}
