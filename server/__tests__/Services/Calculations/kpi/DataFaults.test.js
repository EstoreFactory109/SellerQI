/**
 * tasks-logics.xlsx "Data fault guard": 0 rows, a key column empty on every row, or
 * two marketplaces identical -> internal alert, that source's tasks held.
 */
const { dataFaults, withoutFaultySources } = require('../../../../Services/Calculations/kpi/DataFaults.js');
const { runKpiDetectors } = require('../../../../Services/Calculations/kpi/index.js');

describe('dataFaults', () => {
    it('finds sources that cannot be true', () => {
        const faults = dataFaults({
            traffic: { newestDate: '2026-10-24', byAsin: { A: { rs: 0, bs: 0, s30: 0, u28: 4 }, B: { rs: 0, bs: 0, s30: 0 } } },
            restock: { rows: [{ asin: 'A', price: 0 }] },
            returns: { lines: [{ asin: 'A', reason: '' }] }
        });
        expect(faults.map(f => f.source)).toEqual(['traffic', 'restock', 'returns']);
    });

    it('flags a marketplace identical to another, and an empty restock report beside FBA stock', () => {
        const faults = dataFaults({
            traffic: { newestDate: '2026-10-24', sameAsMarketplace: 'CA-NA', byAsin: { A: { rs: 5 } } },
            stock: { byAsin: { A: { total: 4 } } },
            restock: { rows: [] }
        });
        expect(faults).toEqual([
            { source: 'traffic', fault: 'identical to CA-NA on 2026-10-24' },
            { source: 'restock', fault: '0 rows while 1 products hold FBA stock' }
        ]);
    });

    it('lets a few dead listings with no visits and no sales through', () => {
        expect(dataFaults({ traffic: { byAsin: { A: { rs: 0, bs: 0, s30: 0 } } } })).toEqual([]);
    });

    it('passes real-looking data', () => {
        expect(dataFaults({
            traffic: { byAsin: { A: { rs: 3 }, B: { rs: 0 } } },
            restock: { rows: [{ asin: 'A', price: 10 }] },
            returns: { lines: [{ reason: 'DEFECTIVE' }] }
        })).toEqual([]);
    });

    it('holds a faulty source by treating it as not arrived', () => {
        const inputs = { waves: [2], traffic: { x: 1 }, restock: { rows: [] } };
        expect(withoutFaultySources(inputs, [{ source: 'traffic' }])).toEqual({ waves: [2], traffic: null, restock: { rows: [] } });
        expect(inputs.traffic).toEqual({ x: 1 });
    });

    it('runKpiDetectors reports the faults and holds the trend tasks', () => {
        const NOW = new Date('2026-10-26T12:00:00Z');
        const r = runKpiDetectors({
            KpiInputs: { waves: [2], traffic: { newestDate: '2026-10-24', recent14Days: 14, baselineDays: 60, recent30Days: 30, byAsin: { A: { rs: 0, bs: 0, s30: 0, u7: 3 } } } }
        }, { now: NOW });
        expect(r.dataFaults.map(f => f.source)).toEqual(['traffic']);
        expect(r.coverage['kpi.trafficDrop']).toBe(false);
    });
});
