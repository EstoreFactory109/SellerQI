/**
 * Tests for the tax-inclusive product-sales correction.
 *
 * Why these matter more than usual:
 *  - This changes the sales figure sellers read, and everything derived from it (profit, margin,
 *    ASIN P&L). It exists because a raw sum of `item-price` read 925.63 for an AU day where
 *    Seller Central said 900.56.
 *  - The fixtures are REAL numbers from account 6a40e42712ce56d674f734a0: 23 units at item-price
 *    24.99 with item-promotion-discount 10.91, whose uncollected GST of 1.09/unit is the entire
 *    25.07 gap.
 *  - ★ DETERMINISM IS THE POINT. An earlier version inferred the rate from the current report
 *    batch. It scored 30/30 against Data Kiosk on a single 30-day batch, then shipped and produced
 *    269.71 for a day Seller Central had at 269.51 — because production fetches in 3-day chunks and
 *    the inferred rate moved with the chunk boundaries. Every test here therefore pins a value that
 *    depends only on ONE ROW, never on its neighbours.
 *
 * Style follows financeSyncWindow.test.js: real module, literal fixtures, zero mocks.
 */

const {
  COUNTRY_TAX_RATE,
  TAX_INCLUSIVE_COUNTRIES,
  isTaxInclusiveCountry,
  standardTaxRate,
  solveTaxFractionFromPromotedRow,
  taxFractionForRow,
  itemSalesForRow,
  REDUCED_RATE_TOLERANCE,
} = require('../../utils/marketplaceTax.js');

/** An AU row. Defaults are undiscounted with normal GST (24.99 / 11 = 2.27). */
const auRow = (o = {}) => ({
  'item-price': '24.99', 'item-tax': '2.27', 'item-promotion-discount': '0', quantity: '1', ...o,
});
/** The real promoted shape from 2026-07-12: GST charged on the discounted amount. */
const auPromoted = (o = {}) => auRow({ 'item-tax': '1.18', 'item-promotion-discount': '10.91', ...o });

describe('marketplace eligibility', () => {
  test('AU is corrected — the empirically validated marketplace', () => {
    expect(isTaxInclusiveCountry('AU')).toBe(true);
    expect(standardTaxRate('AU')).toBe(0.10);
  });

  test('★ US and CA are never corrected: their prices are tax-exclusive', () => {
    // The tax was never inside item-price, so removing "uncollected tax" would corrupt figures
    // that are correct today.
    for (const c of ['US', 'CA']) {
      expect(isTaxInclusiveCountry(c)).toBe(false);
      expect(standardTaxRate(c)).toBeNull();
      expect(taxFractionForRow(auPromoted(), c)).toBeNull();
    }
  });

  test('MX and BR are excluded deliberately — convention unconfirmed, so no change', () => {
    expect(isTaxInclusiveCountry('MX')).toBe(false);
    expect(isTaxInclusiveCountry('BR')).toBe(false);
  });

  test('IN is tax-inclusive but has NO standard rate, because GST runs slabs', () => {
    expect(isTaxInclusiveCountry('IN')).toBe(true);
    expect(standardTaxRate('IN')).toBeNull();
  });

  test('every rate-table entry is also flagged tax-inclusive', () => {
    for (const c of Object.keys(COUNTRY_TAX_RATE)) expect(TAX_INCLUSIVE_COUNTRIES.has(c)).toBe(true);
  });

  test('is case-insensitive and safe on missing input', () => {
    expect(isTaxInclusiveCountry('au')).toBe(true);
    for (const bad of [undefined, null, '']) {
      expect(isTaxInclusiveCountry(bad)).toBe(false);
      expect(standardTaxRate(bad)).toBeNull();
    }
  });
});

describe('solveTaxFractionFromPromotedRow — the rate from one row alone', () => {
  test('recovers 10% from the real AU promoted row', () => {
    const u = solveTaxFractionFromPromotedRow(24.99, 1.18, 10.91);
    expect(u / (1 - u)).toBeCloseTo(0.10, 2);
  });

  test('recovers a reduced 7% rate, so slab products are handled without a table', () => {
    // 107.00 incl 7% VAT, 50.00 ex-VAT discount → net 53.50, tax 3.50.
    const u = solveTaxFractionFromPromotedRow(107.00, 3.50, 50.00);
    expect(u / (1 - u)).toBeCloseTo(0.07, 2);
  });

  test('returns null on inputs it cannot solve rather than guessing', () => {
    expect(solveTaxFractionFromPromotedRow(0, 1, 1)).toBeNull();
    expect(solveTaxFractionFromPromotedRow(24.99, 0, 10.91)).toBeNull();
    expect(solveTaxFractionFromPromotedRow(24.99, 1.18, 0)).toBeNull();
    // An implausible root must be rejected, not returned.
    expect(solveTaxFractionFromPromotedRow(100, 60, 5)).toBeNull();
  });
});

describe('itemSalesForRow — AU, the validated case', () => {
  test('an undiscounted row is returned unchanged', () => {
    expect(itemSalesForRow(auRow(), 'AU')).toBeCloseTo(24.99, 10);
  });

  test('the reported case: 24.99 with a 10.91 discount yields 23.90', () => {
    // GST on the discounted amount is 1.18, not 2.27, so 1.09 was never collected.
    // 10.91 + 1.09 = 12.00 — the true tax-INCLUSIVE discount.
    expect(itemSalesForRow(auPromoted(), 'AU')).toBeCloseTo(23.90, 2);
    expect(24.99 - itemSalesForRow(auPromoted(), 'AU')).toBeCloseTo(1.09, 2);
  });

  test('23 such units reproduce the exact 25.07 gap from 2026-07-12', () => {
    const gap = 23 * (24.99 - itemSalesForRow(auPromoted(), 'AU'));
    expect(Math.round(gap * 100) / 100).toBeCloseTo(25.07, 2);
  });

  test('a small tax shortfall with no promotion is corrected', () => {
    // Real row from 2026-07-15: 24.99 taxed 2.16 instead of 2.27 — that day's whole 0.11 gap.
    expect(24.99 - itemSalesForRow(auRow({ 'item-tax': '2.16' }), 'AU')).toBeCloseTo(0.11, 2);
  });

  test('★ item-tax == 0 is LEFT ALONE — a tax treatment, not a discount', () => {
    // Without this guard two otherwise-correct real days broke by -2.73 and -3.64.
    expect(itemSalesForRow(auRow({ 'item-tax': '0' }), 'AU')).toBeCloseTo(24.99, 10);
    expect(itemSalesForRow({ 'item-price': '19.99', 'item-tax': '0', quantity: '1' }, 'AU')).toBeCloseTo(19.99, 10);
  });

  test('★ an UNPROMOTED multi-quantity line rounds PER UNIT', () => {
    // Real 2026-07-14 line: quantity 2, item-price 29.98, item-tax 2.32.
    // per unit → 2 * (14.99 - 0.20) = 29.58 ← matches Amazon
    // per line → 29.98 - 0.41       = 29.57 ← one cent low
    const row = { 'item-price': '29.98', 'item-tax': '2.32', 'item-promotion-discount': '0', quantity: '2' };
    expect(itemSalesForRow(row, 'AU')).toBeCloseTo(29.58, 2);
    expect(itemSalesForRow(row, 'AU')).not.toBeCloseTo(29.57, 2);
  });

  test('★ a PROMOTED multi-quantity line rounds PER LINE, the opposite of an unpromoted one', () => {
    // Real ES line: quantity 5, item-price 99.50, item-tax 15.54, item-promotion-discount 8.22.
    // item-promotion-discount is a LINE total, not naturally divisible by 5 — splitting it into
    // equal per-unit shares before rounding accumulated error and broke 5 of 30 real ES days.
    // per line → 99.50 - round2(99.50*u - 15.54) = 99.50 - 1.73 = 97.77 ← matches Amazon
    // per unit → 5 * (19.90 - round2(19.90*u - 3.108)) = 5 * 19.55 = 97.75 ← two cents low
    const row = { 'item-price': '99.50', 'item-tax': '15.54', 'item-promotion-discount': '8.22', quantity: '5' };
    expect(itemSalesForRow(row, 'ES')).toBeCloseTo(97.77, 2);
    expect(itemSalesForRow(row, 'ES')).not.toBeCloseTo(97.75, 2);
  });

  test('the correction never increases reported sales', () => {
    // Clamped at 0: it exists only to remove tax that was not collected.
    for (const tax of ['0.50', '1.18', '2.16', '2.27', '3.00', '5.00']) {
      expect(itemSalesForRow(auRow({ 'item-tax': tax }), 'AU')).toBeLessThanOrEqual(24.99 + 1e-9);
    }
  });
});

describe('reduced-rate and multi-slab products', () => {
  test('★ an unpromoted reduced-rate product is NOT corrected', () => {
    // A 7% German book against a 19% standard rate. Treating that gap as uncollected tax would
    // silently understate the product's sales by ~10%.
    const book = { 'item-price': '107.00', 'item-tax': '7.00', 'item-promotion-discount': '0', quantity: '1' };
    expect(itemSalesForRow(book, 'DE')).toBeCloseTo(107.00, 2);
    expect(taxFractionForRow(book, 'DE')).toBeNull();
  });

  test('a promoted reduced-rate product is corrected at ITS OWN solved rate', () => {
    const book = { 'item-price': '107.00', 'item-tax': '3.50', 'item-promotion-discount': '50.00', quantity: '1' };
    const u = taxFractionForRow(book, 'DE');
    expect(u / (1 - u)).toBeCloseTo(0.07, 2);       // not the 19% standard
  });

  test('an unpromoted Indian row is untouched — no standard rate to compare against', () => {
    const row = { 'item-price': '105.00', 'item-tax': '5.00', 'item-promotion-discount': '0', quantity: '1' };
    expect(itemSalesForRow(row, 'IN')).toBeCloseTo(105.00, 2);
  });

  test('a promoted Indian row IS corrected, via its own slab', () => {
    // 105.00 incl 5% GST, 50.00 ex-GST discount → net 52.50, tax 2.50.
    const row = { 'item-price': '105.00', 'item-tax': '2.50', 'item-promotion-discount': '50.00', quantity: '1' };
    expect(itemSalesForRow(row, 'IN')).toBeLessThan(105.00);
    const u = taxFractionForRow(row, 'IN');
    expect(u / (1 - u)).toBeCloseTo(0.05, 2);
  });

  test('the reduced-rate cutoff is a tolerance, not an exact match', () => {
    // Just inside → treated as an anomaly and corrected.
    const nearly = auRow({ 'item-tax': String((24.99 * (0.10 - REDUCED_RATE_TOLERANCE / 2) / 1.1).toFixed(2)) });
    expect(taxFractionForRow(nearly, 'AU')).not.toBeNull();
    // Far below → treated as a different rate and skipped.
    expect(taxFractionForRow(auRow({ 'item-tax': '0.80' }), 'AU')).toBeNull();
  });
});

describe('determinism — the property whose absence caused the 269.71 bug', () => {
  test('a row\'s value does not depend on any other row', () => {
    // Same row, evaluated alone and amid wildly different neighbours: identical.
    const target = auPromoted();
    const alone = itemSalesForRow(target, 'AU');
    const neighbours = [
      auRow({ 'item-price': '999.00', 'item-tax': '90.82' }),
      auRow({ 'item-tax': '0' }),
      { 'item-price': '5.00', 'item-tax': '0.45', 'item-promotion-discount': '1.00', quantity: '3' },
    ];
    for (const n of neighbours) {
      itemSalesForRow(n, 'AU');                         // evaluating others must not affect it
      expect(itemSalesForRow(target, 'AU')).toBe(alone);
    }
  });

  test('the function is referentially transparent across repeated calls', () => {
    const row = auPromoted();
    const first = itemSalesForRow(row, 'AU');
    for (let i = 0; i < 50; i++) expect(itemSalesForRow(row, 'AU')).toBe(first);
  });

  test('no argument carries batch state — the signature is (row, country)', () => {
    expect(itemSalesForRow.length).toBe(2);
  });
});

describe('malformed input', () => {
  test('missing, empty or non-numeric fields degrade to 0 rather than NaN', () => {
    // A NaN here would poison a whole day's total silently.
    expect(itemSalesForRow({}, 'AU')).toBe(0);
    expect(itemSalesForRow({ 'item-price': '' }, 'AU')).toBe(0);
    expect(itemSalesForRow({ 'item-price': 'abc', 'item-tax': 'xyz' }, 'AU')).toBe(0);
    expect(Number.isNaN(itemSalesForRow({ 'item-price': '10.00', 'item-tax': 'x', quantity: 'y' }, 'AU'))).toBe(false);
  });

  test('a zero or missing quantity does not divide by zero', () => {
    expect(itemSalesForRow({ 'item-price': '24.99', 'item-tax': '2.27', quantity: '0' }, 'AU')).toBeCloseTo(24.99, 2);
    expect(itemSalesForRow({ 'item-price': '24.99', 'item-tax': '2.27' }, 'AU')).toBeCloseTo(24.99, 2);
  });

  test('a negative price is not "corrected" into something stranger', () => {
    expect(itemSalesForRow({ 'item-price': '-5.00', 'item-tax': '1.00', quantity: '1' }, 'AU')).toBe(-5);
  });
});

describe('MIN_UNPROMOTED_SHORTFALL — cent-rounding must not invent money', () => {
  const { MIN_UNPROMOTED_SHORTFALL } = require('../../utils/marketplaceTax.js');

  // A real UK account's raw item-price sum already matched Amazon on 29 of 30 days. Correcting
  // rows whose shortfall was merely a rounded cent broke 10 of those days for 0.11 of invented
  // error. item-tax is rounded to cents, so a tiny shortfall is arithmetic, not lost tax.
  test('★ a 0.01 rounding shortfall is ignored (UK regression)', () => {
    // 24.99 at 20% VAT-inclusive: expected tax 4.165, reported 4.16 → shortfall 0.005 → 0.01.
    const row = { 'item-price': '24.99', 'item-tax': '4.16', 'item-promotion-discount': '0', quantity: '1' };
    expect(taxFractionForRow(row, 'UK')).toBeNull();
    expect(itemSalesForRow(row, 'UK')).toBeCloseTo(24.99, 10);
  });

  test('a genuine under-tax is still corrected (AU regression)', () => {
    // 24.99 at 10% GST-inclusive: expected 2.27, reported 2.16 → shortfall 0.11, well above noise.
    const row = { 'item-price': '24.99', 'item-tax': '2.16', 'item-promotion-discount': '0', quantity: '1' };
    expect(taxFractionForRow(row, 'AU')).not.toBeNull();
    expect(24.99 - itemSalesForRow(row, 'AU')).toBeCloseTo(0.11, 2);
  });

  test('the threshold sits above the largest possible rounding artifact', () => {
    // Half a cent is the worst case before rounding turns it into a full cent.
    expect(MIN_UNPROMOTED_SHORTFALL).toBeGreaterThan(0.01);
    // …and well below the smallest real shortfall observed (0.09/unit).
    expect(MIN_UNPROMOTED_SHORTFALL).toBeLessThan(0.09);
  });

  test('promoted rows are exempt — their shortfall comes from the discount', () => {
    // A promoted row can have a small shortfall and must still be corrected.
    const row = { 'item-price': '24.99', 'item-tax': '1.18', 'item-promotion-discount': '10.91', quantity: '1' };
    expect(taxFractionForRow(row, 'AU')).not.toBeNull();
  });

  test('the threshold is applied PER UNIT, not per line', () => {
    // A 10-unit line with a 0.01 per-unit artifact totals 0.10 — which must still be ignored.
    const row = { 'item-price': '249.90', 'item-tax': '41.60', 'item-promotion-discount': '0', quantity: '10' };
    expect(itemSalesForRow(row, 'UK')).toBeCloseTo(249.90, 2);
  });
});
