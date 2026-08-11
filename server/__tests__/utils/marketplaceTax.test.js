/**
 * Tests for the tax-inclusive product-sales correction.
 *
 * Why these matter more than usual:
 *  - This changes the sales figure sellers read, and everything derived from it (profit, margin,
 *    ASIN P&L). It exists because a raw sum of `item-price` read 925.63 for an AU day where
 *    Seller Central said 900.56.
 *  - The fixtures below are REAL numbers from that day (account 6a40e42712ce56d674f734a0,
 *    2026-07-12): 23 units at item-price 24.99 with item-promotion-discount 10.91, whose
 *    uncollected GST of 1.09/unit accounts for the whole 25.07 gap.
 *  - Two guards here were each discovered by a failing day and must not be relaxed: per-UNIT
 *    rounding, and leaving item-tax == 0 rows alone.
 *
 * Style follows financeSyncWindow.test.js: real module, literal fixtures, zero mocks.
 */

const {
  TAX_INCLUSIVE_COUNTRIES,
  isTaxInclusiveCountry,
  deriveTaxRate,
  itemSalesForRow,
} = require('../../utils/marketplaceTax.js');

/** A tax-inclusive AU row. Defaults are undiscounted, normal GST (24.99 / 11 = 2.27). */
const auRow = (o = {}) => ({
  'item-price': '24.99', 'item-tax': '2.27', 'item-promotion-discount': '0', quantity: '1', ...o,
});
/** Enough clean rows for the rate derivation to engage. */
const cleanAuRows = (n = 10) => Array.from({ length: n }, () => auRow());

describe('isTaxInclusiveCountry', () => {
  test('AU is included — it is the empirically validated marketplace', () => {
    expect(isTaxInclusiveCountry('AU')).toBe(true);
  });

  test('US and CA are excluded: their prices are tax-exclusive', () => {
    // Applying the correction there would subtract tax that was never in the price,
    // corrupting figures that are correct today.
    expect(isTaxInclusiveCountry('US')).toBe(false);
    expect(isTaxInclusiveCountry('CA')).toBe(false);
  });

  test('MX and BR are excluded deliberately — convention unconfirmed, so no change', () => {
    expect(isTaxInclusiveCountry('MX')).toBe(false);
    expect(isTaxInclusiveCountry('BR')).toBe(false);
  });

  test('VAT/GST-inclusive marketplaces are included', () => {
    for (const c of ['UK', 'GB', 'IE', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'SE', 'PL', 'JP', 'SG', 'IN', 'AE', 'SA', 'EG', 'TR', 'ZA']) {
      expect(TAX_INCLUSIVE_COUNTRIES.has(c)).toBe(true);
    }
  });

  test('is case-insensitive and safe on missing input', () => {
    expect(isTaxInclusiveCountry('au')).toBe(true);
    expect(isTaxInclusiveCountry(undefined)).toBe(false);
    expect(isTaxInclusiveCountry(null)).toBe(false);
    expect(isTaxInclusiveCountry('')).toBe(false);
  });
});

describe('deriveTaxRate', () => {
  test('infers 10% for AU from clean rows, with no rate table', () => {
    // 2.27 / 24.99 = 0.09084 → rate 0.09996 → snapped to exactly 0.10.
    expect(deriveTaxRate(cleanAuRows(), 'AU')).toBeCloseTo(0.10, 10);
  });

  test('snapping removes cent-rounding noise', () => {
    // Unsnapped this derives 9.9969%, which left a 2-cent error on one real day.
    const rate = deriveTaxRate(cleanAuRows(30), 'AU');
    expect(rate).toBe(0.10);
  });

  test('infers 20% for a UK-style VAT-inclusive marketplace', () => {
    // 20% VAT inclusive: tax = price/6. 30.00 → 5.00.
    const rows = Array.from({ length: 10 }, () => ({ 'item-price': '30.00', 'item-tax': '5.00', 'item-promotion-discount': '0', quantity: '1' }));
    expect(deriveTaxRate(rows, 'UK')).toBeCloseTo(0.20, 10);
  });

  test('returns null for tax-exclusive marketplaces, whatever the data looks like', () => {
    // The critical safety property: US must never get a rate, so it is never corrected.
    const usRows = Array.from({ length: 20 }, () => ({ 'item-price': '24.99', 'item-tax': '2.06', 'item-promotion-discount': '0', quantity: '1' }));
    expect(deriveTaxRate(usRows, 'US')).toBeNull();
    expect(deriveTaxRate(usRows, 'CA')).toBeNull();
    expect(deriveTaxRate(usRows, 'MX')).toBeNull();
  });

  test('returns null on too few clean samples rather than guessing', () => {
    expect(deriveTaxRate(cleanAuRows(4), 'AU')).toBeNull();
    expect(deriveTaxRate([], 'AU')).toBeNull();
  });

  test('ignores promoted rows, which would bias the rate downward', () => {
    // Promoted rows carry tax on the DISCOUNTED amount. If they leaked into the derivation the
    // inferred rate would come out too low and the correction would be wrong for everyone.
    const rows = [
      ...cleanAuRows(6),
      ...Array.from({ length: 20 }, () => auRow({ 'item-tax': '1.18', 'item-promotion-discount': '10.91' })),
    ];
    expect(deriveTaxRate(rows, 'AU')).toBeCloseTo(0.10, 10);
  });

  test('ignores zero-tax rows', () => {
    const rows = [...cleanAuRows(6), ...Array.from({ length: 20 }, () => auRow({ 'item-tax': '0' }))];
    expect(deriveTaxRate(rows, 'AU')).toBeCloseTo(0.10, 10);
  });

  test('rejects an implausible rate instead of applying nonsense to money', () => {
    const absurd = Array.from({ length: 10 }, () => ({ 'item-price': '100.00', 'item-tax': '60.00', 'item-promotion-discount': '0', quantity: '1' }));
    expect(deriveTaxRate(absurd, 'AU')).toBeNull();
    const tiny = Array.from({ length: 10 }, () => ({ 'item-price': '100.00', 'item-tax': '0.50', 'item-promotion-discount': '0', quantity: '1' }));
    expect(deriveTaxRate(tiny, 'AU')).toBeNull();
  });

  test('a few odd rows cannot drag the median', () => {
    const rows = [...cleanAuRows(20), { 'item-price': '100.00', 'item-tax': '50.00', 'item-promotion-discount': '0', quantity: '1' }];
    expect(deriveTaxRate(rows, 'AU')).toBeCloseTo(0.10, 10);
  });
});

describe('itemSalesForRow', () => {
  const RATE = 0.10;

  test('an undiscounted row is returned unchanged', () => {
    // The correction must be a no-op on normal rows, or every seller's history would shift.
    expect(itemSalesForRow(auRow(), RATE)).toBeCloseTo(24.99, 10);
  });

  test('the reported AU case: 24.99 with a 10.91 discount yields 23.90', () => {
    // GST charged on the discounted amount is 1.18, not 2.27, so 1.09 was never collected.
    // 10.91 + 1.09 = 12.00 — the true tax-INCLUSIVE discount.
    const row = auRow({ 'item-tax': '1.18', 'item-promotion-discount': '10.91' });
    expect(itemSalesForRow(row, RATE)).toBeCloseTo(23.90, 2);
    expect(24.99 - itemSalesForRow(row, RATE)).toBeCloseTo(1.09, 2);
  });

  test('23 such units reproduce the exact 25.07 gap from 2026-07-12', () => {
    const row = auRow({ 'item-tax': '1.18', 'item-promotion-discount': '10.91' });
    const gap = 23 * (24.99 - itemSalesForRow(row, RATE));
    expect(Math.round(gap * 100) / 100).toBeCloseTo(25.07, 2);
  });

  test('a row whose tax is merely short is corrected by the shortfall', () => {
    // Real row from 2026-07-15: 24.99 taxed 2.16 instead of 2.27 — that day's whole 0.11 gap.
    const row = auRow({ 'item-tax': '2.16' });
    expect(24.99 - itemSalesForRow(row, RATE)).toBeCloseTo(0.11, 2);
  });

  test('★ item-tax == 0 is LEFT ALONE — a tax treatment, not a discount', () => {
    // Without this guard two otherwise-correct real days broke by -2.73 and -3.64.
    expect(itemSalesForRow(auRow({ 'item-tax': '0' }), RATE)).toBeCloseTo(24.99, 10);
    expect(itemSalesForRow({ 'item-price': '19.99', 'item-tax': '0', quantity: '1' }, RATE)).toBeCloseTo(19.99, 10);
  });

  test('★ rounding is PER UNIT, which multi-quantity lines depend on', () => {
    // Real 2026-07-14 line: quantity 2, item-price 29.98, item-tax 2.32.
    // Per unit  → 2 * (14.99 - 0.20) = 29.58  ← matches Amazon
    // Per line  → 29.98 - 0.41       = 29.57  ← one cent low
    const row = { 'item-price': '29.98', 'item-tax': '2.32', 'item-promotion-discount': '0', quantity: '2' };
    expect(itemSalesForRow(row, RATE)).toBeCloseTo(29.58, 2);
    expect(itemSalesForRow(row, RATE)).not.toBeCloseTo(29.57, 2);
  });

  test('with a null rate the raw item-price is returned (previous behaviour)', () => {
    // This is the path US/CA and thin-data runs take.
    expect(itemSalesForRow(auRow({ 'item-tax': '1.18', 'item-promotion-discount': '10.91' }), null)).toBeCloseTo(24.99, 10);
    expect(itemSalesForRow(auRow(), null)).toBeCloseTo(24.99, 10);
  });

  test('missing, empty or malformed fields degrade to 0 rather than NaN', () => {
    // A NaN here would poison a whole day's total silently.
    expect(itemSalesForRow({}, RATE)).toBe(0);
    expect(itemSalesForRow({ 'item-price': '' }, RATE)).toBe(0);
    expect(itemSalesForRow({ 'item-price': 'abc', 'item-tax': 'xyz' }, RATE)).toBe(0);
    expect(Number.isNaN(itemSalesForRow({ 'item-price': '10.00', 'item-tax': 'x', quantity: 'y' }, RATE))).toBe(false);
  });

  test('a zero or missing quantity does not divide by zero', () => {
    expect(itemSalesForRow({ 'item-price': '24.99', 'item-tax': '2.27', quantity: '0' }, RATE)).toBeCloseTo(24.99, 2);
    expect(itemSalesForRow({ 'item-price': '24.99', 'item-tax': '2.27' }, RATE)).toBeCloseTo(24.99, 2);
  });

  test('the correction never increases reported sales', () => {
    // It only ever removes tax that was not collected.
    for (const tax of ['0.50', '1.18', '2.16', '2.27', '3.00']) {
      expect(itemSalesForRow(auRow({ 'item-tax': tax }), RATE)).toBeLessThanOrEqual(24.99 + 1e-9);
    }
  });
});
