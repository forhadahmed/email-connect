import { Buffer } from 'node:buffer';

export function encodeBase64Url(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function buildMultipartAlternativeRawEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
  inReplyToMessageId?: string;
  referencesMessageId?: string;
}): string {
  const boundary = 'example-mix-1';
  const headers = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ...(params.inReplyToMessageId ? [`In-Reply-To: ${params.inReplyToMessageId}`] : []),
    ...(params.referencesMessageId ? [`References: ${params.referencesMessageId}`] : []),
  ];
  return [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    params.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    params.html,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
