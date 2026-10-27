/**
 * Review Requests page numbers: new ratings between two weekly snapshots.
 */
const { newRatingsBetween } = require('../../../controllers/review/RecentOrdersController.js');

const snap = (pairs) => ({ Products: pairs.map(([asin, n]) => ({ asin, product_num_ratings: n })) });

describe('newRatingsBetween', () => {
    it('counts a rating count shared by variations once', () => {
        // Three variations of one listing, 180 -> 193: 13 new ratings, not 39.
        expect(newRatingsBetween(snap([['A', 180], ['B', 180], ['C', 180], ['D', 50]]), snap([['A', 193], ['B', 193], ['C', 193], ['D', 52]]))).toBe(15);
    });

    it('skips products missing from a snapshot, at 0 before, or with an impossible jump', () => {
        expect(newRatingsBetween(snap([['A', 0], ['B', 214]]), snap([['A', 40], ['B', 32887], ['C', 9]]))).toBe(0);
    });

    it('ignores counts that went down', () => {
        expect(newRatingsBetween(snap([['A', 100]]), snap([['A', 90]]))).toBe(0);
    });
});

describe('reviewIneligibleReason', () => {
    const { reviewIneligibleReason: why } = require('../../../controllers/review/RecentOrdersController.js');
    const now = new Date('2026-10-27T12:00:00Z');
    const daysAgo = (d) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
    const base = { reviewRequestStatus: 'not_requested', canRequestReview: null, purchaseDate: daysAgo(10) };

    it('is null when a request can be sent', () => {
        expect(why({ ...base, canRequestReview: true }, { now })).toBeNull();
    });

    it('says when it was already sent, or why sending failed', () => {
        expect(why({ ...base, reviewRequestStatus: 'sent', reviewRequestLastSentAt: '2026-10-20T08:00:00Z' }, { now })).toBe('Already requested on 2026-10-20');
        expect(why({ ...base, reviewRequestStatus: 'failed', reviewRequestError: 'QuotaExceeded' }, { now })).toBe('Sending failed: QuotaExceeded');
    });

    it('uses Amazon\'s own error when there is one (live messages)', () => {
        expect(why({ ...base, eligibilityResponse: { errors: [{ message: 'Attempted to access a multi-channel fulfillment order' }] } }, { now })).toContain('Multi-channel');
        expect(why({ ...base, eligibilityResponse: { errors: [{ message: 'Access to requested resource is denied.' }] } }, { now })).toBe('Amazon refused access for this account');
    });

    it('explains by age, then by whether Amazon was asked', () => {
        expect(why({ ...base, purchaseDate: daysAgo(2) }, { now })).toContain('Too early');
        expect(why({ ...base, purchaseDate: daysAgo(40) }, { now })).toBe('Past the 30-day request window');
        expect(why({ ...base, eligibilityLastCheckedAt: daysAgo(1) }, { now })).toContain('Amazon allows no request');
        expect(why(base, { now, autoSend: false })).toContain('turn on Auto review requests');
        expect(why(base, { now, autoSend: true })).toBe("Waiting for SellerQI's next check with Amazon");
    });
});
