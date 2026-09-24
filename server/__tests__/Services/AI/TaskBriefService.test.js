/**
 * Turning a client's words into something the team can work from.
 *
 * This service deliberately bends the rule EmailRedactionService sets out — "a model
 * asked to rewrite freely will eventually drop a negation" — because clarity is the
 * point of the call rather than a side effect. What makes that safe is not the prompt,
 * which cannot be tested here, but the validation below: every identifier preserved,
 * negations counted, contacts checked.
 *
 * So these tests are almost entirely about what gets REJECTED. A rewrite that reaches
 * Zoho having quietly turned "do NOT publish" into "publish" is the failure this whole
 * file exists to prevent.
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const {
    stripContacts, identifiersIn, countNegations, rejectionReason, leaksContact,
} = require('../../../Services/AI/TaskBriefService.js');
const { buildIdentityBundle } = require('../../../Services/Email/identityRedaction.js');

const bundle = buildIdentityBundle({
    firstName: 'Nitesh',
    lastName: 'Kumar',
    email: 'walmart@morgansrepellent.com',
    phone: '913-269-8400',
});

const SOURCE = 'Update B08XYZ1234 and B07ABC5678 by 10/07/2026. Do NOT change the price. '
    + 'See amazon.com/dp/B08XYZ1234';

describe('contacts go, links stay', () => {
    test('removes the name, address and number we hold', async () => {
        const out = stripContacts(
            'Hi its Nitesh Kumar, call 913-269-8400 or walmart@morgansrepellent.com',
            bundle
        );

        expect(out).not.toContain('Nitesh');
        expect(out).not.toContain('913-269-8400');
        expect(out).not.toContain('walmart@morgansrepellent.com');
    });

    test('removes an address we hold nothing for', async () => {
        // A colleague's, a supplier's — still a contact detail.
        expect(stripContacts('email steve@othercompany.com about it', bundle))
            .not.toContain('steve@othercompany.com');
    });

    test('KEEPS a product link, which redactStructural would have stripped', async () => {
        // The single most actionable line a task description can carry. Reusing
        // redactStructural here would have removed it along with the contacts.
        expect(stripContacts('update amazon.com/dp/B08XYZ1234 please', bundle))
            .toContain('amazon.com/dp/B08XYZ1234');
    });

    test('removes a tel: link, which is a contact rather than a reference', async () => {
        expect(stripContacts('reach me on tel:+19132698400', bundle)).not.toContain('9132698400');
    });

    test('leaves an ASIN alone', async () => {
        // A 10-character code is not a phone number, and mangling SKUs would make every
        // brief useless.
        expect(stripContacts('fix B08XYZ1234', bundle)).toContain('B08XYZ1234');
    });
});

describe('what the model is not allowed to lose', () => {
    test('an identifier it dropped', async () => {
        const brief = 'Update ASIN B08XYZ1234 by 10/07/2026. Do NOT change the price. amazon.com/dp/B08XYZ1234';

        expect(rejectionReason(brief, SOURCE, bundle)).toMatch(/dropped identifiers/);
    });

    test('a NEGATION it dropped', async () => {
        // The failure that makes a rewrite worse than no rewrite: the task now says to
        // do the one thing the client asked us not to.
        const brief = 'Update B08XYZ1234 and B07ABC5678 by 10/07/2026. Change the price. amazon.com/dp/B08XYZ1234';

        expect(rejectionReason(brief, SOURCE, bundle)).toBe('dropped a negation');
    });

    test('a contact detail it invented or carried through', async () => {
        const brief = `${SOURCE} for Nitesh Kumar`;

        expect(rejectionReason(brief, SOURCE, bundle)).toBe('contains identity');
    });

    test('a summary that collapsed the request', async () => {
        expect(rejectionReason('Update the listings.', SOURCE, bundle)).toMatch(/dropped identifiers/);
    });

    test('an empty answer', async () => {
        expect(rejectionReason('', SOURCE, bundle)).toBe('empty');
    });

    test('a faithful rewrite is accepted', async () => {
        const brief = [
            '- Update ASIN B08XYZ1234',
            '- Update ASIN B07ABC5678',
            '- Deadline 10/07/2026',
            '- Do NOT change the price',
            '- Reference amazon.com/dp/B08XYZ1234',
        ].join('\n');

        expect(rejectionReason(brief, SOURCE, bundle)).toBeNull();
    });
});

describe('the link exception', () => {
    test('a kept product link does not read as identity', async () => {
        /**
         * containsIdentity counts every link as a leak, because it was written for
         * messages shown to staff. Used directly here it rejected every rewrite that had
         * done its job — and it returns an OBJECT, so reading it as a boolean rejected
         * every rewrite full stop and the AI layer silently never ran at all.
         */
        expect(leaksContact('see amazon.com/dp/B08XYZ1234', bundle)).toBe(false);
    });

    test('a name still does', async () => {
        expect(leaksContact('ask Nitesh Kumar about it', bundle)).toBe(true);
    });

    test('a clean brief returns false rather than a truthy object', async () => {
        expect(leaksContact('Update the listing', bundle)).toBe(false);
    });
});

describe('the pieces the guards are built from', () => {
    test.each([
        ['ASINs', 'fix B08XYZ1234 and B07ABC5678', 2],
        ['a full URL', 'see https://amazon.com/dp/B08XYZ1234', 2],
        // A bare domain is how people actually paste a listing, and the http/www pattern
        // misses it entirely — a rewrite could have dropped one with nothing to catch it.
        ['a bare domain', 'see amazon.com/dp/B08XYZ1234', 2],
        ['a slashed date', 'by 10/07/2026', 1],
        ['a written date', 'before 10 July', 1],
        ['a price', 'under $19.99', 1],
        ['a percentage', 'raise it 15%', 1],
    ])('identifiersIn finds %s', async (_label, text, atLeast) => {
        expect(identifiersIn(text).length).toBeGreaterThanOrEqual(atLeast);
    });

    test.each([
        ['do not publish', 1],
        ["don't change the price", 1],
        ['never use the old images', 1],
        ['update everything except the bundle', 1],
        ['update the listing', 0],
    ])('countNegations reads "%s"', async (text, expected) => {
        expect(countNegations(text)).toBe(expected);
    });
});
