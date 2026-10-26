/**
 * tasks-logics.xlsx "Returns processing fee risk": 3-month return rate at 80%+ of the
 * category threshold. The real thresholds are filled in by the team; this test uses a
 * stand-in table.
 */
jest.mock('../../../../Services/Calculations/kpi/ReturnThresholds.js', () => {
    const table = { marketplaces: ['US'], byProductGroup: { Home: 10 } };
    return {
        RETURN_THRESHOLDS: table,
        hasThresholds: (country) => country === 'US',
        thresholdFor: (g) => (String(g).toLowerCase() === 'home' ? 10 : null)
    };
});
const { detectReturnsFeeRisk } = require('../../../../Services/Calculations/kpi/Wave3Detectors.js');

const NOW = new Date('2026-10-26T12:00:00Z');
const returnsOf = (asin, n, date = '2026-09-15') => Array.from({ length: n }, () => ({ asin, quantity: 1, returnDate: date }));
const fbaFees = { newest: { bySku: { S1: { asin: 'A1', productGroup: 'Home' }, S2: { asin: 'A2', productGroup: 'Toys' } } } };
const run = (lines, shipped, country = 'US') => detectReturnsFeeRisk({
    returns: { lines, unreadable: false }, shipped90: shipped, fbaFees, country, now: NOW
});

it('warns at 80% of the threshold and says when it is over', () => {
    // 9 of 100 = 9%, threshold 10% -> warning. 12 of 100 -> over.
    expect(run(returnsOf('A1', 9), { A1: { unitsSold: 100 } }).tasks[0]).toMatchObject({ errorType: 'returns_fee_risk', renderData: { returnRatePct: 9, thresholdPct: 10, over: false } });
    expect(run(returnsOf('A1', 12), { A1: { unitsSold: 100 } }).tasks[0].renderData.over).toBe(true);
    expect(run(returnsOf('A1', 7), { A1: { unitsSold: 100 } }).tasks).toHaveLength(0);
});

it('skips unlisted categories, small sellers and returns older than 3 months', () => {
    expect(run(returnsOf('A2', 50), { A2: { unitsSold: 100 } }).tasks).toHaveLength(0);
    expect(run(returnsOf('A1', 10), { A1: { unitsSold: 24 } }).tasks).toHaveLength(0);
    expect(run(returnsOf('A1', 20, '2026-06-01'), { A1: { unitsSold: 100 } }).tasks).toHaveLength(0);
});

it('makes no verdict where the thresholds do not apply or data is missing', () => {
    expect(run(returnsOf('A1', 20), { A1: { unitsSold: 100 } }, 'UK').covered).toBe(false);
    expect(run(returnsOf('A1', 20), null).covered).toBe(false);
});

it('the real table ships empty, so nothing runs until the team fills it', () => {
    const real = jest.requireActual('../../../../Services/Calculations/kpi/ReturnThresholds.js');
    expect(real.hasThresholds('US')).toBe(false);
    expect(real.thresholdFor('Home', { byProductGroup: { home: 8.5 } })).toBe(8.5);
});
