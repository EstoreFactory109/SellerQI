/**
 * Issues-by-Product's `buyBoxDetails` was always undefined: the map was keyed on
 * `item.asin`, but effective-doc rows (classifyBuyBoxLoss) only carry
 * childAsin/parentAsin. These pin that it is keyed by childAsin.
 */
const { buildBuyBoxDetailsMap } = require('../../../Services/Calculations/IssuesPaginationService.js');

describe('buildBuyBoxDetailsMap', () => {
    it('keys effective-doc rows by childAsin', () => {
        const rows = [
            { childAsin: 'B001', parentAsin: 'P1', buyBoxPercentage: 0, buyBoxLost: true },
            { childAsin: 'B002', parentAsin: 'P1', buyBoxPercentage: null, buyBoxLost: false }
        ];
        const map = buildBuyBoxDetailsMap(rows);

        expect(map.get('B001')).toBe(rows[0]);
        expect(map.get('B002')).toBe(rows[1]);
        expect(map.has(undefined)).toBe(false);
    });

    it('falls back to `asin` for an older row shape and skips keyless rows', () => {
        const map = buildBuyBoxDetailsMap([{ asin: 'B003', buyBoxPercentage: 80 }, { buyBoxPercentage: 0 }, null]);

        expect([...map.keys()]).toEqual(['B003']);
    });

    it('tolerates a missing array', () => {
        expect(buildBuyBoxDetailsMap(undefined).size).toBe(0);
    });
});
