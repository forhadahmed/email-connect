export type ParsedRawEmail = {
    to: string | null;
    subject: string | null;
    bodyText: string;
    bodyHtml: string | null;
    headers: Record<string, string>;
};
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
export declare function parseRawEmailBase64Url(raw: string): ParsedRawEmail;
export declare function normalizeAddressInput(value: string | string[] | null | undefined): string | null;
//# sourceMappingURL=raw-email.d.ts.map