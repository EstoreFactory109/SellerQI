/**
 * Tests that wasted-spend-keyword errors carry real click/impression counts.
 *
 * The keyword aggregation used to drop `clicks`, so every generated task read
 * "has spent $X with 0 clicks but no sales" regardless of the real traffic —
 * a wrong number sitting directly beside the recoverable dollar figure.
 */

const { calculateSponsoredAdsErrors } = require('../../../Services/Calculations/DashboardCalculation.js');

// Rows are dated well outside the attribution window and ENABLED, so they are
// judgeable under the wasted-spend rule (AdsSignals.isWastedKeyword).
const NOW = new Date('2026-10-16T12:00:00Z');
const SETTLED_DAY = '2026-10-01';

const keywordRow = (over = {}) => ({
    date: SETTLED_DAY,
    adKeywordStatus: 'ENABLED',
    keyword: 'blue widget',
    keywordId: 'kw1',
    campaignName: 'Campaign A',
    campaignId: 'c1',
    adGroupName: 'ag1',
    adGroupId: 'ag1',
    cost: 50,
    attributedSales30d: 0,
    clicks: 20,
    impressions: 900,
    ...over
});

// A converting keyword from yesterday keeps the account's ads data current (not
// stale), as a live account's daily rows do; it is never itself flagged.
const CURRENT_ROW = {
    date: '2026-10-15', adKeywordStatus: 'ENABLED', keyword: 'converting', keywordId: 'kw-live',
    campaignId: 'c9', adGroupId: 'ag9', cost: 5, attributedSales30d: 40, clicks: 12, impressions: 300
};

const wastedSpend = (keywords) =>
    calculateSponsoredAdsErrors([], [...keywords, CURRENT_ROW], [], [], [], { country: 'US', now: NOW }).errorDetails
        .filter((e) => e.errorType === 'wasted_spend_keyword');

describe('wasted_spend_keyword clicks/impressions', () => {
    it('carries the real click and impression counts onto the error record', () => {
        const [err] = wastedSpend([keywordRow()]);
        expect(err).toBeDefined();
        expect(err.clicks).toBe(20);
        expect(err.impressions).toBe(900);
        expect(err.spend).toBe(50);
    });

    it('sums clicks and impressions when the same keyword appears in multiple rows', () => {
        const rows = [
            keywordRow({ cost: 30, clicks: 20, impressions: 900 }),
            keywordRow({ cost: 20, clicks: 14, impressions: 600 })
        ];
        const [err] = wastedSpend(rows);
        expect(err.clicks).toBe(34);
        expect(err.impressions).toBe(1500);
        expect(err.spend).toBe(50); // cost still aggregates as before
    });

    it('keeps rows for different keywords separate', () => {
        const errs = wastedSpend([
            keywordRow({ keyword: 'blue widget', clicks: 15 }),
            keywordRow({ keyword: 'red widget', keywordId: 'kw2', clicks: 19 })
        ]);
        expect(errs).toHaveLength(2);
        expect(errs.map((e) => e.clicks).sort((a, b) => a - b)).toEqual([15, 19]);
    });

    // No clicks means fewer than KEYWORD_MIN_CLICKS: not enough traffic to call the
    // spend wasted.
    it('does not flag a keyword with no click data', () => {
        const row = keywordRow();
        delete row.clicks;
        delete row.impressions;
        expect(wastedSpend([row])).toHaveLength(0);
    });

    it('coerces string counts from the report payload', () => {
        const [err] = wastedSpend([keywordRow({ clicks: '17', impressions: '450' })]);
        expect(err.clicks).toBe(17);
        expect(err.impressions).toBe(450);
    });

    it('still only flags keywords with spend and no sales', () => {
        expect(wastedSpend([keywordRow({ attributedSales30d: 25 })])).toHaveLength(0);
        expect(wastedSpend([keywordRow({ cost: 0 })])).toHaveLength(0);
    });
});
