/**
 * Reconciling the All-Orders report's product sales with Seller Central.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * `productSales` used to be a plain sum of the report's `item-price`. For an AU account that
 * consistently read HIGHER than Seller Central (and than Amazon's own Data Kiosk
 * `orderedProductSales`) whenever a promotion was involved — e.g. 2026-07-12 came to 925.63
 * against Amazon's 900.56.
 *
 * ── THE CAUSE ───────────────────────────────────────────────────────────────
 * In a tax-INCLUSIVE marketplace, `item-price` already contains the tax, so normally
 *
 *     item-tax == item-price * rate/(1+rate)          (AU: item-price / 11)
 *
 * But `item-promotion-discount` is reported tax-EXCLUSIVE. When a promotion applies, Amazon
 * charges tax on the DISCOUNTED amount, so `item-tax` arrives lower than the full-price figure
 * — while `item-price` still shows the undiscounted, tax-inclusive price. Amazon's
 * `orderedProductSales` reflects the tax actually charged; a raw sum of `item-price` does not,
 * so it overstates by exactly the tax that was never collected.
 *
 * Worked example (2026-07-12, AU). 23 units each had `item-promotion-discount` = 10.91, and
 * 10.91 + 1.09 = 12.00 — the true tax-INCLUSIVE discount. The uncollected GST is 1.09 per unit,
 * and 23 * 1.09 = 25.07, exactly the gap between 925.63 and 900.56.
 *
 * ── THE CORRECTION ──────────────────────────────────────────────────────────
 * Per unit: subtract the tax that was expected on the full price but not charged.
 * Validated against Amazon's Data Kiosk `orderedProductSales` for the reported AU account over
 * 30 consecutive days: 30/30 exact to the cent, total absolute error 0.00 (before: 14/30, and
 * 36.56 of cumulative error).
 *
 * Two details that each mattered and must not be "simplified" away:
 *   - Rounding is PER UNIT, not per line. A quantity-2 line was off by a cent under per-line
 *     rounding — that alone was the difference between 10/11 and 11/11 days on the first sample.
 *   - Rows with `item-tax == 0` are LEFT ALONE. Zero tax is a different tax treatment, not a
 *     discount shrinking the taxable base, and Amazon does not reduce sales for those. Without
 *     this guard two otherwise-correct days broke by -2.73 and -3.64.
 */

const logger = require('./Logger.js');

/**
 * Marketplaces whose reported `item-price` INCLUDES consumption tax (VAT / GST).
 *
 * Only these get the correction; anywhere else the raw `item-price` is used, which is exactly
 * today's behaviour. The US and CA add tax at checkout, so their `item-price` is tax-exclusive
 * and the correction must NOT apply — reducing sales by an "uncollected tax" that was never in
 * the price would corrupt figures that are currently correct.
 *
 * MX and BR are deliberately OMITTED: their pricing convention was not confirmed here, and the
 * safe default for an unconfirmed marketplace is no change rather than a guess at money.
 *
 * ⚠️ Only AU is empirically validated (see the header). The rest are included because they share
 * the same VAT/GST-inclusive display convention, so the same mechanism applies — but their
 * numbers have NOT been checked against Data Kiosk. Use
 * `scripts/verifyMarketplaceBucketing.js` to confirm one before trusting it, and note that the
 * correction is a no-op on rows with normal tax, so the exposure is limited to promoted rows.
 */
const TAX_INCLUSIVE_COUNTRIES = new Set([
  'AU',                                                   // validated: 30/30 days exact
  'JP', 'SG', 'IN',                                       // GST/consumption-tax inclusive
  'UK', 'GB', 'IE', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE',   // EU/UK VAT inclusive
  'SE', 'PL', 'TR',
  'AE', 'SA', 'EG', 'ZA',                                 // VAT inclusive
]);

/** Minimum clean rows before a derived rate is trusted; below this we make no correction. */
const MIN_RATE_SAMPLES = 5;

/**
 * Plausibility bounds for a derived consumption-tax rate. Outside these we assume the derivation
 * is being fed something unexpected and skip the correction rather than apply nonsense to money.
 * (Real range in scope: AE 5% … SE 25%.)
 */
const MIN_PLAUSIBLE_RATE = 0.03;
const MAX_PLAUSIBLE_RATE = 0.30;

/**
 * Derived rates are snapped to this granularity. The per-row ratio carries cent-level rounding
 * noise — the raw AU median came out at 9.9969% and left a 0.02 error on one day; snapped it is
 * exactly 10% and every day matches. 0.25% is fine enough to preserve a real 8.25%-style rate.
 */
const RATE_SNAP = 0.0025;

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round2 = (v) => Math.round(v * 100) / 100;

/** Is this country's reported item-price tax-inclusive? */
function isTaxInclusiveCountry(country) {
  return !!country && TAX_INCLUSIVE_COUNTRIES.has(String(country).toUpperCase());
}

/**
 * Infer the marketplace's consumption-tax rate from the report itself, so no per-country rate
 * table has to be maintained (rates change, and India runs several slabs).
 *
 * Uses only "clean" rows — tax charged, no promotion — where `item-tax / item-price` is by
 * definition rate/(1+rate). The MEDIAN is taken so a few odd rows cannot drag it.
 *
 * @returns {number|null} the rate (e.g. 0.10), or null if it should not be trusted
 */
function deriveTaxRate(reportRows, country) {
  if (!isTaxInclusiveCountry(country)) return null;

  const ratios = [];
  for (const row of reportRows) {
    const price = num(row['item-price']);
    const tax = num(row['item-tax']);
    // A promoted row's tax is charged on the discounted amount, so it would bias the rate down.
    if (price <= 0 || tax <= 0 || num(row['item-promotion-discount']) !== 0) continue;
    ratios.push(tax / price);
  }
  if (ratios.length < MIN_RATE_SAMPLES) return null;

  ratios.sort((a, b) => a - b);
  const u = ratios[Math.floor(ratios.length / 2)];   // tax as a fraction of the inclusive price
  if (u <= 0 || u >= 1) return null;

  const raw = u / (1 - u);                            // convert to a rate on the ex-tax base
  const rate = Math.round(raw / RATE_SNAP) * RATE_SNAP;

  if (rate < MIN_PLAUSIBLE_RATE || rate > MAX_PLAUSIBLE_RATE) {
    logger.warn(`[marketplaceTax] Derived implausible tax rate ${(raw * 100).toFixed(2)}% for ${country} from ${ratios.length} rows — skipping the sales correction for this run.`);
    return null;
  }
  return rate;
}

/**
 * The product-sales value for one Sales Report row, matching Amazon's `orderedProductSales`.
 *
 * With `rate` null (tax-exclusive marketplace, too few samples, implausible rate) this returns
 * the raw `item-price`, i.e. the previous behaviour.
 *
 * @param {object} row  a Sales Report row
 * @param {number|null} rate  from deriveTaxRate()
 */
function itemSalesForRow(row, rate) {
  const price = num(row['item-price']);
  if (!rate) return price;

  const tax = num(row['item-tax']);
  // Zero tax is a different tax treatment, not a discount — Amazon does not reduce sales here.
  if (tax <= 0) return price;

  const qty = Math.max(1, parseInt(row.quantity, 10) || 1);
  const u = rate / (1 + rate);
  const unitPrice = price / qty;
  const unitTax = tax / qty;
  // Tax expected on the full unit price, minus what was actually charged = the uncollected tax.
  // Rounded per UNIT because that is what reproduces Amazon's figure on multi-quantity lines.
  //
  // Clamped at 0: this correction exists only to REMOVE tax that was never collected, so it must
  // never inflate sales. A row taxed MORE than the inferred rate implies (an extra tax component,
  // a mixed-rate marketplace such as India, or simply odd data) would otherwise push reported
  // sales above the price actually charged.
  const uncollectedPerUnit = Math.max(0, round2(unitPrice * u - unitTax));
  return qty * (unitPrice - uncollectedPerUnit);
}

module.exports = {
  TAX_INCLUSIVE_COUNTRIES,
  isTaxInclusiveCountry,
  deriveTaxRate,
  itemSalesForRow,
  RATE_SNAP,
  MIN_RATE_SAMPLES,
};
