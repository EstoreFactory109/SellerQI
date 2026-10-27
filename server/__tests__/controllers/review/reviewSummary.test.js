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
