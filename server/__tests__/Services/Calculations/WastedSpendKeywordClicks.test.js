/**
 * Tests that wasted-spend-keyword errors carry real click/impression counts.
 *
 * The keyword aggregation used to drop `clicks`, so every generated task read
 * "has spent $X with 0 clicks but no sales" regardless of the real traffic —
 * a wrong number sitting directly beside the recoverable dollar figure.
 */

const { calculateSponsoredAdsErrors } = require('../../../Services/Calculations/DashboardCalculation.js');

const keywordRow = (over = {}) => ({
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

const wastedSpend = (keywords) =>
    calculateSponsoredAdsErrors([], keywords, [], [], []).errorDetails
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
            keywordRow({ keyword: 'blue widget', clicks: 5 }),
            keywordRow({ keyword: 'red widget', keywordId: 'kw2', clicks: 9 })
        ]);
        expect(errs).toHaveLength(2);
        expect(errs.map((e) => e.clicks).sort((a, b) => a - b)).toEqual([5, 9]);
    });

    it('defaults to 0 when the source row genuinely has no click data', () => {
        const row = keywordRow();
        delete row.clicks;
        delete row.impressions;
        const [err] = wastedSpend([row]);
        expect(err.clicks).toBe(0);
        expect(err.impressions).toBe(0);
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
