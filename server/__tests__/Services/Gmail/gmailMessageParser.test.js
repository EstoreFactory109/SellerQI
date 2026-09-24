/**
 * Gmail's payload into the fields we store.
 *
 * Driven by the shapes real mail clients actually produce rather than by the API docs:
 * nested multiparts, encoded subjects, text attachments, missing Date headers. Each
 * block below is a failure that would reach a page rather than a test.
 */

const {
    parseMessage, decodeMimeWords, parseAddressList, tidySubject, pickBody, parseSentAt,
} = require('../../../Services/Gmail/gmailMessageParser.js');

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64url');

const header = (name, value) => ({ name, value });

/** An Outlook-shaped message: mixed wrapping alternative, plus a PDF. */
const outlookMessage = () => ({
    id: 'msg-1',
    threadId: 'thread-1',
    labelIds: ['INBOX', 'UNREAD'],
    internalDate: '1758537600000',
    payload: {
        mimeType: 'multipart/mixed',
        headers: [
            header('From', '"Nitesh Kumar" <walmart@morgansrepellent.com>'),
            header('To', 'hello@estorefactory.com'),
            header('Subject', 'Re: Walmart listings'),
            header('Date', 'Mon, 22 Sep 2026 10:00:00 +0000'),
            header('Message-ID', '<abc@morgansrepellent.com>'),
            header('Authentication-Results', 'mx.google.com; dkim=pass; spf=pass'),
        ],
        parts: [
            {
                mimeType: 'multipart/alternative',
                parts: [
                    { mimeType: 'text/plain', body: { data: b64('plain version') } },
                    { mimeType: 'text/html', body: { data: b64('<p>html version</p>') } },
                ],
            },
            {
                mimeType: 'application/pdf',
                filename: 'invoice.pdf',
                body: { attachmentId: 'att-1', size: 48210 },
            },
        ],
    },
});

describe('the encoded subject', () => {
    test('is decoded, so redaction can actually see the name in it', async () => {
        // Left encoded, a base64 blob matches no name and no phone pattern, sails
        // through redaction untouched, and decodes back to the client's name in the
        // browser — on the page whose whole purpose is that staff never see it.
        expect(decodeMimeWords('=?UTF-8?B?Tml0ZXNoIEt1bWFy?=')).toBe('Nitesh Kumar');
    });

    test('handles quoted-printable words as well as base64', async () => {
        expect(decodeMimeWords('=?UTF-8?Q?Nitesh_Kumar?=')).toBe('Nitesh Kumar');
        expect(decodeMimeWords('=?ISO-8859-1?Q?caf=E9?=')).toBe('café');
    });

    test('drops the separator between adjacent encoded words', async () => {
        // Whitespace between two encoded words is a wrapping artefact. Kept, a name
        // split across words comes back with a phantom gap.
        expect(decodeMimeWords('=?UTF-8?B?Tml0ZXNo?= =?UTF-8?B?IEt1bWFy?=')).toBe('Nitesh Kumar');
    });

    test('keeps whitespace around unencoded neighbours', async () => {
        expect(decodeMimeWords('Invoice from =?UTF-8?B?QWNtZQ==?= today')).toBe('Invoice from Acme today');
    });

    test('leaves a malformed word alone rather than deleting part of the subject', async () => {
        expect(decodeMimeWords('=?UTF-8?B?!!!not-base64!!!?=')).toContain('=?UTF-8?B?');
    });

    test('passes plain subjects straight through', async () => {
        expect(decodeMimeWords('Walmart listings')).toBe('Walmart listings');
    });
});

describe('choosing one body', () => {
    test('prefers HTML, because the plain alternative is often degraded', async () => {
        expect(parseMessage(outlookMessage()).bodyHtml).toBe('<p>html version</p>');
    });

    test('stores only one — never both', async () => {
        // Keeping both means one gets redacted and the other does not, and the
        // unredacted copy is precisely what must not exist.
        const parsed = parseMessage(outlookMessage());

        expect(parsed.bodyText).toBeNull();
    });

    test('falls back to plain text when there is no HTML part', async () => {
        const { html, text } = pickBody([{ mimeType: 'text/plain', content: 'only plain' }]);

        expect(html).toBeNull();
        expect(text).toBe('only plain');
    });

    test('finds a body nested several multiparts deep', async () => {
        const nested = {
            id: 'm', threadId: 't', payload: {
                mimeType: 'multipart/mixed',
                headers: [],
                parts: [{ parts: [{ parts: [{ mimeType: 'text/html', body: { data: b64('<b>deep</b>') } }] }] }],
            },
        };

        expect(parseMessage(nested).bodyHtml).toBe('<b>deep</b>');
    });

    test('a message with no body at all does not throw', async () => {
        expect(parseMessage({ id: 'm', payload: { headers: [] } }).bodyHtml).toBeNull();
    });
});

describe('attachments', () => {
    test('are collected with metadata only', async () => {
        expect(parseMessage(outlookMessage()).attachments).toEqual([
            { attachmentId: 'att-1', filename: 'invoice.pdf', mimeType: 'application/pdf', size: 48210 },
        ]);
    });

    test('a text attachment is never mistaken for the message body', async () => {
        // It has a filename, so it is an attachment even though its type is text/plain.
        // Treated as a body, its contents would appear on the page as though the client
        // had typed them.
        const withTextAttachment = {
            id: 'm', threadId: 't', payload: {
                headers: [],
                parts: [
                    { mimeType: 'text/plain', body: { data: b64('the real message') } },
                    {
                        mimeType: 'text/plain',
                        filename: 'notes.txt',
                        body: { attachmentId: 'att-9', size: 12, data: b64('SECRET NOTES') },
                    },
                ],
            },
        };

        const parsed = parseMessage(withTextAttachment);

        expect(parsed.bodyText).toBe('the real message');
        expect(parsed.bodyText).not.toContain('SECRET');
        expect(parsed.attachments).toHaveLength(1);
    });
});

describe('addresses', () => {
    test('a display name containing a comma does not split the list', async () => {
        // "Kumar, Nitesh" is an ordinary Outlook display name and the naive split on
        // commas turns one recipient into two, one of them garbage.
        expect(parseAddressList('"Kumar, Nitesh" <a@b.com>, c@d.com')).toEqual(['a@b.com', 'c@d.com']);
    });

    test('are lowercased, since matching is case-insensitive', async () => {
        expect(parseAddressList('A@B.COM')).toEqual(['a@b.com']);
    });

    test('entries with no address are dropped rather than kept as junk', async () => {
        expect(parseAddressList('undisclosed-recipients:;, real@x.com')).toEqual(['real@x.com']);
    });

    test('an absent header gives an empty list, not a crash', async () => {
        expect(parseAddressList(undefined)).toEqual([]);
    });
});

describe('subjects', () => {
    test('accumulated Re:/Fwd: prefixes are stripped for display', async () => {
        expect(tidySubject('Re: Fwd: RE: Walmart listings')).toBe('Walmart listings');
    });

    test('numbered prefixes some clients add are stripped too', async () => {
        expect(tidySubject('Re[2]: Walmart listings')).toBe('Walmart listings');
    });

    test('the raw form survives alongside it', async () => {
        // Gmail rejects a threaded send whose subject does not match the thread's, so
        // the raw form has to be kept even though nothing displays it.
        const parsed = parseMessage(outlookMessage());

        expect(parsed.rawSubject).toBe('Re: Walmart listings');
        expect(parsed.displaySubject).toBe('Walmart listings');
    });
});

describe('timestamps', () => {
    test('prefer the Date header, so the order matches what participants saw', async () => {
        expect(parseMessage(outlookMessage()).sentAt.toISOString()).toBe('2026-09-22T10:00:00.000Z');
    });

    test('fall back to internalDate when the header is missing', async () => {
        // A missing header must not produce an Invalid Date that sorts the message to
        // the epoch and puts it at the top of every conversation forever.
        expect(parseSentAt({}, '1758537600000').toISOString()).toBe('2025-09-22T10:40:00.000Z');
    });

    test('fall back when the header is unparseable, not just absent', async () => {
        expect(parseSentAt({ date: 'not a date' }, '1758537600000')).toBeInstanceOf(Date);
    });

    test('are null when neither is usable, rather than Invalid Date', async () => {
        expect(parseSentAt({}, undefined)).toBeNull();
    });
});

describe('the fields ingestion routes on', () => {
    test('labels, threading headers and the auth verdict all survive', async () => {
        const parsed = parseMessage(outlookMessage());

        expect(parsed.labelIds).toEqual(['INBOX', 'UNREAD']);
        expect(parsed.rfc822MessageId).toBe('<abc@morgansrepellent.com>');
        expect(parsed.authenticationResults).toMatch(/dkim=pass/);
        expect(parsed.fromEmail).toBe('walmart@morgansrepellent.com');
    });

    test('the origin header is surfaced, since it is the echo guard', async () => {
        const echo = outlookMessage();
        echo.payload.headers.push(header('X-SellerQI-Origin', 'portal-client'));

        expect(parseMessage(echo).originHeader).toBe('portal-client');
    });

    test('References is split into a list', async () => {
        const threaded = outlookMessage();
        threaded.payload.headers.push(header('References', '<a@x.com> <b@x.com>'));

        expect(parseMessage(threaded).references).toEqual(['<a@x.com>', '<b@x.com>']);
    });

    test('the payload tree itself is not returned', async () => {
        // Callers must not be able to reach past what has been decoded and vetted here.
        expect(parseMessage(outlookMessage())).not.toHaveProperty('payload');
    });
});
