/**
 * tasks-logics.xlsx "Fees at Risk" tile, partly: aged inventory surcharge and the
 * low-inventory-level fee from the newest planning report.
 */
const { feesAtRiskFromPlanning } = require('../../../Services/Calculations/FeesAtRisk.js');

const NOW = new Date('2026-10-27T12:00:00Z');
const doc = (data, createdAt = new Date('2026-10-27T03:00:00Z')) => ({ createdAt, data });

it('sums the aged surcharge estimate and counts products paying the low-inventory fee', () => {
    const r = feesAtRiskFromPlanning(doc([
        { asin: 'A', estimated_ais_total: 30.5, low_inventory_level_fee_applied: 'Yes', low_inventory_level_fee_exempt: 'No' },
        { asin: 'B', estimated_ais_total: 0, low_inventory_level_fee_applied: 'Yes', low_inventory_level_fee_exempt: 'Yes' },
        { asin: 'C', estimated_ais_total: 25.53, low_inventory_level_fee_applied: 'No', low_inventory_level_fee_exempt: 'No' }
    ]), NOW);
    expect(r).toMatchObject({ available: true, agedSurcharge: { amount: 56.03, products: 2 }, lowInventoryFee: { products: 1 } });
    expect(r.notIncluded).toEqual(['storage utilization surcharge', 'returns processing fee']);
});

it('says why it has nothing to show', () => {
    expect(feesAtRiskFromPlanning(null, NOW).reason).toBe('no_report');
    expect(feesAtRiskFromPlanning(doc([], new Date('2026-10-20T00:00:00Z')), NOW).reason).toBe('stale');
    // Saved before the parser read these columns.
    expect(feesAtRiskFromPlanning(doc([{ asin: 'A' }]), NOW)).toMatchObject({ available: false, reason: 'columns_missing' });
});
