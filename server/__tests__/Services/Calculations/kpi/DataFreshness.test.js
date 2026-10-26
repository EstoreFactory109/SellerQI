/**
 * The internal stale-data guard: which inputs are behind their own schedule.
 */
const { staleSources } = require('../../../../Services/Calculations/kpi/DataFreshness.js');

const NOW = new Date('2026-10-24T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

describe('staleSources', () => {
    it('flags a daily source past 36 hours and a weekly one past 8 days, nothing fresher', () => {
        const stale = staleSources({
            stock: { fetchedAt: hoursAgo(40) },
            suppressed: { createdAt: hoursAgo(10) },
            removals: { createdAt: hoursAgo(24 * 9) },
            reviews: { newest: { at: hoursAgo(24 * 5) } }
        }, NOW);
        expect(stale.map(s => s.source)).toEqual(['stock', 'removals']);
        expect(stale[0]).toMatchObject({ ageHours: 40, maxHours: 36 });
    });

    it('allows Sales & Traffic its two-day lag', () => {
        expect(staleSources({ traffic: { newestDate: '2026-10-21' } }, NOW)).toEqual([]);
        expect(staleSources({ traffic: { newestDate: '2026-10-19' } }, NOW).map(s => s.source)).toEqual(['traffic']);
    });

    it('ignores inputs not loaded for this run, and reports an undatable one as stale', () => {
        expect(staleSources({ stock: null, restock: undefined }, NOW)).toEqual([]);
        expect(staleSources({ stock: { fetchedAt: null } }, NOW)[0]).toMatchObject({ source: 'stock', ageHours: null });
        expect(staleSources(null, NOW)).toEqual([]);
    });
});
