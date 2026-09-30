/**
 * Removing a client's identity from text ESF staff will read.
 *
 * This is the deterministic half of the boundary and the half that still has to hold
 * when the LLM is unavailable — so the bar here is not "usually works". Two failure
 * directions matter, and they pull against each other:
 *
 *   under-redaction  an address or number survives and the guarantee is broken
 *   over-redaction   an ASIN, order id, price or quantity is destroyed, and staff
 *                    act on mangled operational detail
 *
 * Both are tested. The over-redaction cases are not padding: staff work from these
 * emails, and a redactor that eats every long number is unusable in an agency inbox.
 */

const {
    buildIdentityBundle, redactKnown, redactStructural, redactAll, containsIdentity, PLACEHOLDER,
} = require('../../../Services/Email/identityRedaction.js');
const F = require('./__emailFixtures.js');

const CLIENT = {
    firstName: 'Nitesh',
    lastName: 'Kumar',
    email: 'walmart@morgansrepellent.com',
    additionalEmails: [{ email: 'nitesh.k@gmail.com', isVerified: false }],
    phone: '+1-913-269-8400',
    whatsapp: '+1-913-269-8400',
};

const bundle = buildIdentityBundle(CLIENT);

/** Nothing that identifies this client may appear in output. */
const IDENTIFYING = /nitesh|kumar|morgansrepellent|913.?269.?8400|9132698400/i;

describe('buildIdentityBundle', () => {
    test('collects names longest-first so the full name is consumed before its parts', () => {
        // Order matters at redaction time: shortest-first turns "Nitesh Kumar" into
        // "[name] [name]" instead of one placeholder.
        expect(bundle.names[0]).toBe('Nitesh Kumar');
    });

    test('includes unverified additional addresses', () => {
        // Verification governs whether an address can authenticate. It says nothing
        // about whether printing it leaks — and it does.
        expect(bundle.emails).toContain('nitesh.k@gmail.com');
    });

    test('reduces phones to digits so formatting cannot defeat matching', () => {
        expect(bundle.phones).toContain('19132698400');
    });

    test('ignores digit runs too short to be a phone number', () => {
        // Otherwise a stored "123" would redact every year and quantity in the corpus.
        expect(buildIdentityBundle({ phone: '123' }).phones).toHaveLength(0);
    });

    test('survives a user record with nothing on it', () => {
        expect(() => buildIdentityBundle({})).not.toThrow();
        expect(() => buildIdentityBundle()).not.toThrow();
    });
});

describe('known identifiers', () => {
    test('removes a signature block', () => {
        const out = redactAll('Thanks, Nitesh · 913-269-8400', bundle).text;

        expect(out).toBe(`Thanks, ${PLACEHOLDER.name} · ${PLACEHOLDER.phone}`);
        expect(out).not.toMatch(IDENTIFYING);
    });

    test('removes the address including a +tag the stored value lacks', () => {
        expect(redactAll('nitesh.k+amazon@gmail.com is my other one', bundle).text)
            .toBe(`${PLACEHOLDER.email} is my other one`);
    });

    test('removes a bare surname and its possessive', () => {
        // The possessive is consumed with the name so no orphaned "'s" is left.
        expect(redactAll("Kumar's approval came through", bundle).text)
            .toBe(`${PLACEHOLDER.name} approval came through`);
    });

    test('matches regardless of case', () => {
        expect(redactAll('NITESH KUMAR and nitesh kumar', bundle).text).not.toMatch(IDENTIFYING);
    });

    test('redacts the company domain on its own', () => {
        expect(redactAll('See morgansrepellent.com for specs', bundle).text).not.toMatch(IDENTIFYING);
    });
});

describe('phone formats — one number, many renderings', () => {
    // Matching the stored string literally finds none of these, which is why the
    // pattern is built from digits with separators allowed between them.
    const renderings = [
        '913-269-8400', '913 269 8400', '(913) 269-8400', '913.269.8400',
        '+1 913 269 8400', '+1-913-269-8400', '+1 (913) 269-8400', '+19132698400',
        '1-913-269-8400', '9132698400',
    ];

    renderings.forEach((rendering) => {
        test(`redacts "${rendering}" leaving no fragment behind`, () => {
            const out = redactAll(`Call me on ${rendering} today`, bundle).text;

            expect(out).toBe(`Call me on ${PLACEHOLDER.phone} today`);
            // A dangling "+" or "(" would tell a reader a number was there.
            expect(out).not.toMatch(/[+(]\s*\[phone\]/);
        });
    });
});

describe('structural identifiers we do not hold', () => {
    test("removes a third party's address", () => {
        // Their colleague, supplier or lawyer. We hold no identifier for these, so
        // only the pattern-based pass can catch them.
        const out = redactStructural('Reena at reena@othersupplier.com will send them').text;

        expect(out).toContain(PLACEHOLDER.email);
        expect(out).not.toContain('othersupplier');
    });

    test('removes URLs and tel:/mailto: links', () => {
        const out = redactStructural('See https://example.com/x or mailto:a@b.com').text;

        expect(out).not.toContain('example.com');
        expect(out).not.toContain('a@b.com');
    });

    test('removes a second phone number never stored on the record', () => {
        expect(redactStructural('my other mobile is 0771 234 5678').text).toContain(PLACEHOLDER.phone);
    });
});

/**
 * Numbers we do NOT hold on the client record, written with no separators at all.
 *
 * These reached staff untouched, and every guard agreed they were clean: containsIdentity
 * runs the same patterns, the model is told contact details are "already replaced" and is
 * only asked about names, and validate() gates the model on containsIdentity. The comment
 * on the structural pass claimed the rule was "a separator OR a leading +" — the code
 * required the separator either way, so a "+" on its own bought nothing.
 */
describe('phone numbers with no separators at all', () => {
    test.each([
        ['an international mobile', '+61424812404'],
        ['a national number with a leading 0', '0412841105'],
        ['an international number with a long subscriber part', '+919876543210'],
    ])('redacts %s', (_label, number) => {
        const out = redactStructural(`please call ${number} about the pallet`).text;

        expect(out).toBe(`please call ${PLACEHOLDER.phone} about the pallet`);
        // A leftover "+" tells a reader both that a number was removed and where from.
        expect(out).not.toMatch(/[+(]\s*\[phone\]/);
    });

    test('the leak is now visible to our own guard, which said clean before', () => {
        // This single assertion is the regression test for the whole change: the value of
        // containsIdentity is that validate() and leaksContact both gate on it.
        const leaky = 'call our warehouse manager on 0412841105';

        expect(containsIdentity(leaky, bundle).clean).toBe(false);
        expect(containsIdentity(redactAll(leaky, bundle).text, bundle).clean).toBe(true);
    });

    test('a bare run with no + and no leading 0 is left alone', () => {
        // The narrowness is deliberate. Widening this to any 9-15 digit run is what eats
        // UPCs and case numbers, and no protection list catches every one of those.
        expect(redactStructural('reference 123456789012 on the carton').text)
            .toBe('reference 123456789012 on the carton');
    });

    /**
     * The exact ambiguity the protection step exists for, and the only place it is
     * load-bearing.
     *
     * The narrow patterns avoid most identifiers for free — a case number has no leading
     * "+", no leading "0" and no separators, so nothing matches it. What they cannot
     * avoid is an identifier that happens to START WITH ZERO: "0412841105" is a phone
     * number and "0412841105" is a plausible SKU, and the two are the same string. Only
     * the label beside it tells them apart, which is why labelled values are lifted out
     * of the text before the phone pass runs and put back afterwards.
     *
     * Without protection these are destroyed and nothing anywhere reports it.
     */
    test.each([
        ['a SKU that starts with zero', 'SKU 0412841105 needs relabelling'],
        ['a UPC-A with a leading zero', 'UPC 0850085664426 on the carton'],
        ['a case number that starts with zero', 'Case 022088339131 is still open'],
        ['an order reference that starts with zero', 'Order no. 0987654321 was cancelled'],
    ])('keeps %s, which is indistinguishable from a phone number by shape', (_label, text) => {
        expect(redactStructural(text).text).toBe(text);
    });

    test('but the same digits with no label are still treated as a number', () => {
        // The label is doing the work, and it should be obvious that it is.
        expect(redactStructural('please call 0412841105').text)
            .toBe(`please call ${PLACEHOLDER.phone}`);
    });
});

/**
 * Numbers spelled with letters, where the digit floor that protects every SKU cannot help:
 * "(417) 2-STORES" holds four digits and is perfectly dialable.
 *
 * These reach staff the same way any other number does — a supplier's line quoted in
 * prose, a storefront in a signature — and the nine-digit rule discards them by design.
 */
describe('vanity numbers', () => {
    test.each([
        ['a bracketed area code', 'call (417) 2-STORES today'],
        ['the 1-800 form', 'call 1-800-FLOWERS today'],
        ['a bare area code', 'call 417 2-STORES today'],
    ])('redacts %s despite holding too few digits', (_label, text) => {
        expect(redactStructural(text).text).toBe(text.replace(/(?:\(?\d{3}\)?[\s-]|1-\d{3}-)\S+/, PLACEHOLDER.phone));
    });

    test('does not fire on an ordinary hyphenated identifier', () => {
        // The letters must follow an area code and a hyphen, so a part code is untouched.
        [
            'part MTG-400 is on order',
            'use code SAVE-20 at checkout',
            'ASIN B0HKW36R58 is live',
        ].forEach((text) => expect(redactStructural(text).text).toBe(text));
    });
});

describe("Gmail's tel: artifact", () => {
    test('does not leave a second copy of the number behind', () => {
        // "<tel:(818)%20308-1444>" begins with a parenthesis, which the scheme-link
        // pattern excluded — so the visible number was replaced while the artifact beside
        // it kept the digits. The result was "[phone]<tel:(818)%20308-1444>".
        const phoneBundle = buildIdentityBundle({ firstName: 'Nitesh', lastName: 'Kumar', phone: '+1 (818) 308-1444' });
        const out = redactAll('Best regards,\nNitesh\n+1 (818) 308-1444<tel:(818)%20308-1444>', phoneBundle).text;

        expect(out).toBe(`Best regards,\n${PLACEHOLDER.name}\n${PLACEHOLDER.phone}`);
        expect(out).not.toMatch(/308.?1444/);
    });

    test('strips the wrapper without taking the identifier in front of it', () => {
        const out = redactAll(F.GMAIL_TEL_ARTIFACT, bundle).text;

        expect(out).toContain('Item 13100301:');
        expect(out).not.toContain('tel:');
        expect(out).not.toContain('308-1444');
    });

    test.each([
        ['a tel: link with a bracketed number', 'reach me at tel:(818)%20308-1444 anytime'],
        ['a mailto: with brackets in the local part', 'see mailto:(weird)@x.com now'],
    ])('removes %s, which is not wrapped in angle brackets', (_label, text) => {
        // cleanGmailArtifacts only strips the "<tel:…>" wrapper, so a bare scheme link
        // falls to the link pattern — whose character class used to exclude "(" and so
        // matched nothing at all when the value began with one.
        const out = redactStructural(text).text;

        expect(out).toContain(PLACEHOLDER.link);
        expect(out).not.toMatch(/308.?1444|weird/);
    });
});

describe('the whole inbox, both directions at once', () => {
    const out = () => redactAll(F.CONTACT_CASES, bundle).text;

    test.each(F.CONTACT_CASES_IDENTIFIERS.map((id) => [id]))(
        'keeps the business identifier %s',
        (identifier) => {
            expect(out()).toContain(identifier);
        },
    );

    test.each(F.CONTACT_CASES_CONTACTS.map((c) => [c]))(
        'removes the contact detail %s',
        (contact) => {
            expect(out()).not.toContain(contact);
        },
    );

    test('no protection sentinel escapes into the output', () => {
        // The sentinels are private to the pass. One reaching a staff payload would be
        // invisible to every other guard — assertNoIdentityLeak does not look for them
        // and quoteSplitter's tokeniser does not strip them.
        expect(out()).not.toMatch(/[⟦⟧]/);
    });

    test('redacting twice changes nothing the second time', () => {
        // Protect/restore introduces tokens mid-pass; if one survived, a second pass
        // would behave differently. Also means a re-redaction on a version bump is safe.
        const once = out();
        expect(redactAll(once, bundle).text).toBe(once);
    });
});

describe('over-redaction — operational detail must survive', () => {
    // Staff act on these emails. A redactor that eats order numbers and quantities is
    // worse than useless, and this is the failure mode the digit rule is tuned against.
    const mustSurvive = [
        ['an Amazon order id', 'Order 112-4567890-1234567 shipped'],
        ['an ASIN', 'ASIN B08XYZ1234 is live'],
        ['a quantity', '240 units arrived'],
        ['a price', 'Invoice total $1,049.00'],
        ['a date', 'Due 2026-09-22'],
        ['a SKU', 'SKU 12345678 needs relabelling'],
        ['a percentage', 'ACOS improved to 38.3%'],
    ];

    mustSurvive.forEach(([label, text]) => {
        test(`keeps ${label}`, () => {
            expect(redactAll(text, bundle).text).toBe(text);
        });
    });
});

describe('the local part is not redacted on its own', () => {
    test("a client's own address local part survives as an ordinary word", () => {
        // The live client is walmart@<brand>.com and their project is about the
        // Walmart channel. Redacting the bare local part rewrote "hold the Walmart
        // listings" as "hold the [email] listings" — the message loses its subject.
        const out = redactAll('Please hold the Walmart listings until Friday', bundle).text;

        expect(out).toBe('Please hold the Walmart listings until Friday');
    });

    test('but the full address is still removed', () => {
        expect(redactAll('reply to walmart@morgansrepellent.com', bundle).text)
            .toBe(`reply to ${PLACEHOLDER.email}`);
    });
});

describe('role words', () => {
    test("a client's role-style address is still removed", () => {
        // The mirror-image redactor skips these words because a Zoho user is called
        // "Support". Skipping them HERE would leak the client's own address, which is
        // very often sales@ or info@.
        const roleClient = buildIdentityBundle({ email: 'sales@acmebrand.com', firstName: 'A', lastName: 'B' });
        const out = redactAll('Write to sales@acmebrand.com', roleClient).text;

        expect(out).toContain(PLACEHOLDER.email);
        expect(out).not.toContain('acmebrand');
    });

    test('a client literally named "Support" does not mangle ordinary prose', () => {
        const odd = buildIdentityBundle({ firstName: 'Support', lastName: 'Desk', email: 'x@y.com' });

        expect(redactAll('Contact Amazon support about this', odd).text)
            .toBe('Contact Amazon support about this');
    });
});

describe('containsIdentity — the gate on the model output', () => {
    test('passes clean text', () => {
        expect(containsIdentity('The listings are ready for review.', bundle).clean).toBe(true);
    });

    test('catches a name the model reintroduced', () => {
        // Because step 8 rephrases, it can put an identity back — including a
        // hallucinated one. This is what rejects that.
        const verdict = containsIdentity('Nitesh confirmed the pricing.', bundle);

        expect(verdict.clean).toBe(false);
        expect(verdict.found).toContain('name');
    });

    test('catches an address or number the model reintroduced', () => {
        expect(containsIdentity('Reach them at a@b.com', bundle).found).toContain('email');
        expect(containsIdentity('Call 913-269-8400', bundle).found).toContain('phone');
    });
});

describe('robustness', () => {
    test('never throws on empty or malformed input', () => {
        [null, undefined, '', 42].forEach((input) => {
            expect(() => redactAll(input, bundle)).not.toThrow();
            expect(() => containsIdentity(input, bundle)).not.toThrow();
        });
    });

    test('a name containing regex metacharacters is escaped, not interpreted', () => {
        const odd = buildIdentityBundle({ firstName: 'A.*', lastName: 'B(x)', email: 'a@b.com' });

        // An unescaped ".*" would redact the entire message.
        expect(redactAll('Nothing to do with the client here', odd).text)
            .toBe('Nothing to do with the client here');
    });

    test('a realistic full email loses every identifier', () => {
        const body = [
            'Hi team,',
            '',
            'Please hold the Walmart listings until Friday.',
            'If anything is urgent call me on (913) 269-8400 or reply to',
            'walmart@morgansrepellent.com.',
            '',
            'Thanks,',
            'Nitesh Kumar',
            'Natural Environmental Solutions',
        ].join('\n');

        const out = redactAll(body, bundle).text;

        expect(out).not.toMatch(IDENTIFYING);
        // …while the instruction itself survives, which is the whole point.
        expect(out).toContain('hold the Walmart listings until Friday');
    });
});
