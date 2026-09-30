/**
 * The third and last layer of the staff/client identity boundary.
 *
 * The first two are `select: false` on the model and the explicit serialisers. This one
 * scans the finished payload, and it exists because the other two are both things a
 * future change can bypass without noticing.
 *
 * ── WHY IT NEEDED FIXING RATHER THAN JUST TESTING ──
 * `LONG_DIGITS` needs only ten characters from [\d\s.\-()], so on the raw payload it
 * matched "Order 112-4567890-1234567" and "Case 13157354022" — detail staff are supposed
 * to receive and redaction deliberately preserves. An alarm that fires on ordinary
 * traffic is one nobody can act on, which is exactly why this assertion could only ever
 * log in production rather than refuse to serve.
 *
 * It now scans with business identifiers removed, so what remains is a digit run with no
 * identifier shape and no label — a leaked phone number, and nothing else.
 *
 * The subtlety worth keeping in mind: identifiers are removed and NOT restored, and the
 * text is not run through the redactor. Redacting first would report what the redactor
 * WOULD do, replacing the very leak this is here to catch; restoring would put the
 * identifiers back so they trip it anyway. The first attempt at this fix did both and
 * inverted the assertion completely — everything legitimate still threw, and every real
 * leak passed.
 */

const { assertNoIdentityLeak } = require('../../../Services/Email/messagePresenter.js');

/** @returns {boolean} whether the scan objected. */
const objects = (payload) => {
    try {
        assertNoIdentityLeak(payload);
        return false;
    } catch {
        return true;
    }
};

describe('operational detail staff are meant to receive', () => {
    test.each([
        ['an Amazon order id', 'Order 112-4567890-1234567 shipped'],
        ['a case number', 'Case 13157354022 is still open'],
        ['two case numbers in a list', 'Ref: Cases 13157354022 and 13186582392'],
        ['a UPC', 'UPC 850085664426 on the carton'],
        ['a SKU', 'SKU 198168045893 needs relabelling'],
        ['a shipment id', 'Shipment FBA19NDZ4D3Z is booked'],
        ['an ASIN', 'ASIN B0HKW36R58 is live'],
        ['a price', 'Total budget $5,931.30 per month'],
        ['a quantity', 'pack of 2,500 sets at 4.5 oz'],
        ['an IP address', 'DNS resolves to 69.16.221.246'],
        ['a date and time', 'Sent 2026-09-24 at 14:05:22'],
        ['a redacted body', 'Call me on [phone] today about [link]'],
    ])('passes %s', (_label, body) => {
        expect(objects({ body })).toBe(false);
    });
});

describe('identity that must never reach a staff payload', () => {
    test.each([
        ['an unseparated national number', 'call 0412841105 please'],
        ['an unseparated international number', 'call +61424812404 please'],
        ['a separated number', 'call 818 350 5302 please'],
        ['a bracketed number', 'call (925) 216-8961 please'],
        ['an email address', 'mail me at reena@othersupplier.com'],
    ])('objects to %s', (_label, body) => {
        expect(objects({ body })).toBe(true);
    });

    test('finds it wherever in the payload it landed', () => {
        // The scan runs over the serialised payload rather than one field, because the
        // failure it guards against is a field nobody remembered to check.
        expect(objects({ thread: { subject: 'Re: 0412841105' }, messages: [] })).toBe(true);
        expect(objects({ messages: [{ body: 'fine' }, { body: 'call 0412841105' }] })).toBe(true);
    });
});

describe('shapes that must not crash it', () => {
    test.each([[null], [undefined], [{}], [{ messages: [] }]])('handles %p', (payload) => {
        expect(objects(payload)).toBe(false);
    });

    test('returns the payload unchanged when it is clean', () => {
        const payload = { body: 'Update the listing' };
        expect(assertNoIdentityLeak(payload)).toBe(payload);
    });
});
