/**
 * tasks-logics.xlsx "Detail page changed without us": recorded changes, minus our
 * own edits, the seller's confirmed ones and repricer price moves.
 */
const { diffDailyListings, diffWeeklyListing, hashBullets } = require('../../../../Services/Calculations/ListingChanges.js');
const { detectDetailPageChanged } = require('../../../../Services/Calculations/kpi/Wave3Detectors.js');

const NOW = new Date('2026-10-26T12:00:00Z');
const at = (daysAgo) => new Date(NOW.getTime() - daysAgo * 86400000);
const ev = (field, oldValue, newValue, daysAgo = 1, over = {}) => ({ _id: `${field}${daysAgo}${oldValue}`, asin: 'A1', sku: 'S1', field, oldValue, newValue, createdAt: at(daysAgo), ...over });

describe('diffs', () => {
    it('finds daily title and price changes, ignoring spacing and new listings', () => {
        const events = diffDailyListings(
            [{ asin: 'A1', sku: 'S1', itemName: 'Garlic  Press', price: '19.99' }, { asin: 'A2', sku: 'S2', itemName: 'Same', price: '5' }],
            [{ asin: 'A1', sku: 'S1', itemName: 'Garlic Press Pro', price: '24.99' }, { asin: 'A2', sku: 'S2', itemName: 'Same ', price: '5.00' }, { asin: 'A3', sku: 'S3', itemName: 'New' }]
        );
        expect(events.map(e => [e.asin, e.field, e.oldValue, e.newValue])).toEqual([['A1', 'title', 'Garlic Press', 'Garlic Press Pro'], ['A1', 'price', 19.99, 24.99]]);
    });

    it('finds weekly bullet, image and brand changes, not a first reading', () => {
        const product = { asin: 'A1', sku: 'S1', bulletsHash: hashBullets(['a', 'b']), mainImage: 'img1', brand: 'Acme' };
        const facts = { bullets: ['a', 'c'], bulletsHash: hashBullets(['a', 'c']), mainImage: 'img2', brand: 'ACME' };
        expect(diffWeeklyListing(product, facts).map(e => e.field)).toEqual(['bulletpoints', 'main_image']);
        expect(diffWeeklyListing({ asin: 'A1' }, facts)).toEqual([]);
    });
});

describe('detectDetailPageChanged', () => {
    const run = (events, ourFixes = []) => detectDetailPageChanged({ listingChanges: { events, ourFixes }, now: NOW });

    it('reports an unexplained change, one task per product', () => {
        const { tasks, covered } = run([ev('title', 'Old', 'New'), ev('main_image', 'a', 'b')]);
        expect(covered).toBe(true);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ errorType: 'detail_page_changed', errorCategory: 'ranking' });
        expect(tasks[0].error).toContain('title changed from "Old" to "New"; main image changed');
    });

    it("leaves out our own edits, the seller's confirmed changes and old changes", () => {
        expect(run([ev('title', 'Old', 'New')], [{ asin: 'A1', attribute: 'title', fixedAt: at(1.5) }]).tasks).toHaveLength(0);
        expect(run([ev('title', 'Old', 'New', 1, { sellerConfirmed: true })]).tasks).toHaveLength(0);
        expect(run([ev('title', 'Old', 'New', 9)]).tasks).toHaveLength(0);
    });

    it('ignores a repricer: price changed on 3+ of the last 7 days', () => {
        expect(run([ev('price', 10, 11, 1), ev('price', 11, 12, 2), ev('price', 12, 10, 3)]).tasks).toHaveLength(0);
        expect(run([ev('price', 10, 12, 1)]).tasks).toHaveLength(1);
    });

    it('makes no verdict without the change history', () => {
        expect(detectDetailPageChanged({ listingChanges: null, now: NOW }).covered).toBe(false);
    });
});
