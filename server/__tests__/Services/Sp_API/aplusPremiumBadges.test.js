/**
 * A+ Premium badge parsing.
 *
 * The Listings Audit reports Premium as a plain Yes/No per ASIN, and that
 * answer comes entirely from one field on Amazon's content metadata. The exact
 * name and shape of that field could not be confirmed against a live response
 * — every SP-API account on the machine this was written on returns 401
 * invalid_client — so the parser accepts several spellings.
 *
 * That is what makes these the tests worth having. A mocked fetch would only
 * prove the code agrees with my guess about the field name. These pin the
 * behaviour AROUND the guess: every plausible spelling is read, an unknown
 * badge is kept rather than dropped, and — the one that matters most — a
 * missing badge field is reported as "not captured" rather than as "not
 * Premium", because a report that says No when it means "we could not see"
 * is worse than one that says nothing.
 */
jest.mock('../../../models/seller-performance/APlusPremiumModel.js', () => ({
    create: jest.fn(),
}));

const { extractBadges, PREMIUM_BADGES } = require('../../../Services/Sp_API/GET_APLUS_CONTENT.js');

describe('extractBadges', () => {
    it('reads the documented field and finds Premium', () => {
        expect(extractBadges({ badgeSet: ['PREMIUM'] })).toEqual({
            badges: ['PREMIUM'],
            isPremium: true,
            recognised: true,
        });
    });

    it('accepts every spelling of the badge field alike', () => {
        for (const key of ['badgeSet', 'contentBadgeSet', 'badges', 'contentBadge', 'ContentBadge']) {
            const parsed = extractBadges({ [key]: ['PREMIUM'] });
            expect(parsed.isPremium).toBe(true);
            expect(parsed.recognised).toBe(true);
        }
    });

    it('accepts a bare string as well as a list', () => {
        expect(extractBadges({ badgeSet: 'PREMIUM' }).isPremium).toBe(true);
    });

    it('accepts objects, which is how an enum often arrives', () => {
        expect(extractBadges({ badgeSet: [{ badge: 'PREMIUM' }] }).isPremium).toBe(true);
        expect(extractBadges({ badgeSet: [{ name: 'PREMIUM' }] }).isPremium).toBe(true);
    });

    it('recognises each value that means the Premium tier', () => {
        for (const badge of PREMIUM_BADGES) {
            expect(extractBadges({ badgeSet: [badge] }).isPremium).toBe(true);
        }
    });

    it('uppercases, so a casing change cannot hide Premium', () => {
        expect(extractBadges({ badgeSet: ['premium'] }).isPremium).toBe(true);
    });

    it('keeps a badge it does not understand instead of dropping it', () => {
        const parsed = extractBadges({ badgeSet: ['BULK', 'SOME_NEW_TIER'] });
        expect(parsed.badges).toEqual(['BULK', 'SOME_NEW_TIER']);
        expect(parsed.isPremium).toBe(false);
        // Seen, and not Premium — a real answer, unlike the case below.
        expect(parsed.recognised).toBe(true);
    });

    it('separates "not Premium" from "could not see the badges"', () => {
        // A badge field that is present and empty: a real No.
        expect(extractBadges({ badgeSet: [] })).toEqual({
            badges: [], isPremium: false, recognised: true,
        });

        // No badge field under any known name: not an answer. The report shows
        // an em dash for this, never "No".
        for (const metadata of [{}, { name: 'Some doc', status: 'APPROVED' }, { badgeSet: null }]) {
            expect(extractBadges(metadata).recognised).toBe(false);
        }
    });

    it('survives the shapes a real response throws at it', () => {
        for (const junk of [undefined, null, 'a string', 42]) {
            expect(extractBadges(junk)).toEqual({ badges: [], isPremium: false, recognised: false });
        }

        // Empty and non-string entries are dropped, not turned into "" badges.
        expect(extractBadges({ badgeSet: ['PREMIUM', '', null, {}] }).badges).toEqual(['PREMIUM']);
    });
});
