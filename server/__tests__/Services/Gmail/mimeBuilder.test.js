/**
 * Hand-rolled MIME.
 *
 * Every failure in this file is quiet. A header that should have been encoded arrives
 * as mojibake, a missing In-Reply-To silently starts a second conversation in the
 * client's mail app, an unquoted comma sends the message to an address that does not
 * exist. None of them throw, and none of them are visible from our side — which is why
 * this is pure functions with their own suite rather than something checked in
 * production.
 */

const {
    buildMimeMessage, generateMessageId, replySubject, buildReferences,
    formatAddress, encodeHeaderValue, sanitizeHeader,
} = require('../../../Services/Gmail/mimeBuilder.js');

const decode = (raw) => Buffer.from(raw, 'base64url').toString('utf8');

const message = (over = {}) => buildMimeMessage({
    from: { name: 'eStore Factory', email: 'hello@estorefactory.com' },
    to: { email: 'walmart@morgansrepellent.com' },
    rawSubject: 'Re: Walmart listings',
    bodyText: 'We have paused the listings.',
    inReplyTo: '<abc@morgansrepellent.com>',
    references: ['<root@morgansrepellent.com>'],
    date: new Date('2026-09-22T10:00:00Z'),
    ...over,
});

describe('threading', () => {
    test('carries In-Reply-To, which is what the client mail app threads on', async () => {
        // threadId on the API call is Gmail-internal. With only that, the conversation
        // looks right to us and fragments into separate emails for them — reading as
        // their mail client misbehaving, so it gets reported late if at all.
        expect(decode(message().raw)).toContain('In-Reply-To: <abc@morgansrepellent.com>');
    });

    test('appends the replied-to id to References', async () => {
        expect(buildReferences(['<a@x.com>'], '<b@x.com>')).toEqual(['<a@x.com>', '<b@x.com>']);
    });

    test('does not repeat an id already in the chain', async () => {
        expect(buildReferences(['<a@x.com>'], '<a@x.com>')).toEqual(['<a@x.com>']);
    });

    test('caps a runaway chain but keeps the root', async () => {
        // Some clients never trim References, and an unbounded header eventually
        // exceeds line-length limits and is mangled in transit. Most clients thread on
        // the root, so that is the one that must survive.
        const long = Array.from({ length: 40 }, (_, i) => `<m${i}@x.com>`);

        const result = buildReferences(long, '<newest@x.com>');

        expect(result).toHaveLength(10);
        expect(result[0]).toBe('<m0@x.com>');
        expect(result.at(-1)).toBe('<newest@x.com>');
    });

    test('omits the headers entirely for a message that starts a thread', async () => {
        const raw = decode(message({ inReplyTo: null, references: [] }).raw);

        expect(raw).not.toContain('In-Reply-To:');
        expect(raw).not.toContain('References:');
    });
});

describe('the Message-ID', () => {
    test('is generated before sending, so our own echo can be recognised', async () => {
        // Relying on the id Gmail assigns loses a race: the push notification can
        // arrive before our write lands, and the message is then ingested as new,
        // duplicating every reply.
        expect(message().messageId).toMatch(/^<[0-9a-f-]{36}@estorefactory\.com>$/);
    });

    test('is unique per message', async () => {
        expect(generateMessageId('x.com')).not.toBe(generateMessageId('x.com'));
    });

    test('strips anything odd from the domain rather than emitting a broken header', async () => {
        expect(generateMessageId('evil.com>\r\nBcc: victim@x.com')).toMatch(/^<[0-9a-f-]+@[\w.-]+>$/);
    });
});

describe('subjects', () => {
    test('are prefixed with Re: when they are not already', async () => {
        // Gmail rejects a threaded send whose subject does not match the thread's.
        expect(replySubject('Walmart listings')).toBe('Re: Walmart listings');
    });

    test('are not double-prefixed', async () => {
        expect(replySubject('Re: Walmart listings')).toBe('Re: Walmart listings');
    });

    test('fall back rather than sending an empty header', async () => {
        expect(replySubject('')).toBe('Re: (no subject)');
    });

    test('are encoded when they contain non-ASCII', async () => {
        const raw = decode(message({ rawSubject: 'Café update' }).raw);

        expect(raw).toContain('=?UTF-8?B?');
        expect(raw).not.toContain('Café update');
    });

    test('are left alone when plain ASCII', async () => {
        expect(encodeHeaderValue('Walmart listings')).toBe('Walmart listings');
    });
});

describe('header injection', () => {
    test('a newline in a subject cannot introduce new headers', async () => {
        // The subject is stored data that originated in an email we received, so it is
        // untrusted. Unsanitised, it terminates the header and the rest is read as more
        // headers — an attacker-supplied Bcc, for instance.
        const raw = decode(message({ rawSubject: 'Hello\r\nBcc: attacker@evil.com' }).raw);

        expect(raw).not.toMatch(/^Bcc:/m);
    });

    test('a newline in a display name cannot either', async () => {
        const raw = decode(message({
            from: { name: 'ESF\r\nBcc: attacker@evil.com', email: 'hello@estorefactory.com' },
        }).raw);

        expect(raw).not.toMatch(/^Bcc:/m);
    });

    test('sanitizeHeader collapses CR and LF', async () => {
        expect(sanitizeHeader('a\r\nb')).toBe('a b');
    });
});

describe('addresses', () => {
    test('a display name with a comma is quoted, so it stays one recipient', async () => {
        // Unquoted, the comma is a recipient separator and the message goes to a second
        // address that does not exist.
        expect(formatAddress({ name: 'Kumar, Nitesh', email: 'a@b.com' }))
            .toBe('"Kumar, Nitesh" <a@b.com>');
    });

    test('a bare address needs no quoting', async () => {
        expect(formatAddress({ email: 'a@b.com' })).toBe('a@b.com');
    });

    test('a non-ASCII display name is encoded', async () => {
        expect(formatAddress({ name: 'Café Ltd', email: 'a@b.com' })).toContain('=?UTF-8?B?');
    });
});

describe('the body', () => {
    test('round-trips through base64 unchanged', async () => {
        const raw = decode(message({ bodyText: 'Line one\nLine two — dash' }).raw);
        const body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n');

        expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'))
            .toBe('Line one\nLine two — dash');
    });

    test('is wrapped at 76 characters, as RFC 2045 requires', async () => {
        // A single long base64 line is rejected outright by some servers.
        const raw = decode(message({ bodyText: 'x'.repeat(5000) }).raw);
        const body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n');

        body.split('\r\n').forEach((line) => expect(line.length).toBeLessThanOrEqual(76));
    });

    test('an empty body produces a valid message rather than throwing', async () => {
        expect(() => message({ bodyText: '' })).not.toThrow();
    });
});

describe('the echo guard', () => {
    test.each(['portal-staff', 'portal-client'])('stamps X-SellerQI-Origin: %s', async (origin) => {
        // Without it, every portal message is re-ingested when the watch reports our
        // own write, and appears twice.
        expect(decode(message({ origin }).raw)).toContain(`X-SellerQI-Origin: ${origin}`);
    });

    test('is absent when no origin is given', async () => {
        expect(decode(message().raw)).not.toContain('X-SellerQI-Origin');
    });
});

describe('encoding for the API', () => {
    test('the payload is base64url, which is what Gmail requires', async () => {
        // Standard base64 is rejected. '+' and '/' must not appear.
        expect(message({ bodyText: '~~~???>>>' }).raw).not.toMatch(/[+/]/);
    });

    test('headers are separated from the body by a blank line', async () => {
        expect(decode(message().raw)).toMatch(/\r\n\r\n/);
    });

    test('lines end with CRLF, not bare LF', async () => {
        const headerBlock = decode(message().raw).split('\r\n\r\n')[0];

        expect(headerBlock).not.toMatch(/[^\r]\n/);
    });
});
