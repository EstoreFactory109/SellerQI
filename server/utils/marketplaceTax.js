/**
 * Reconciling the All-Orders report's product sales with Seller Central.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * `productSales` used to be a plain sum of the report's `item-price`. For an AU account that read
 * HIGHER than Seller Central (and than Amazon's own Data Kiosk `orderedProductSales`) whenever a
 * promotion was involved — 2026-07-12 came to 925.63 against Amazon's 900.56.
 *
 * ── THE CAUSE ───────────────────────────────────────────────────────────────
 * In a tax-INCLUSIVE marketplace `item-price` already contains the tax, so normally
 *
 *     item-tax == item-price * rate/(1+rate)          (AU: item-price / 11)
 *
 * But `item-promotion-discount` is reported tax-EXCLUSIVE. When a promotion applies, Amazon
 * charges tax on the DISCOUNTED amount, so `item-tax` arrives lower while `item-price` still shows
 * the undiscounted tax-inclusive price. Summing raw `item-price` therefore includes tax that was
 * never collected.
 *
 * Worked example (2026-07-12, AU). 23 units each had `item-promotion-discount` = 10.91, and
 * 10.91 + 1.09 = 12.00 — the true tax-INCLUSIVE discount. The uncollected GST is 1.09 per unit,
 * and 23 * 1.09 = 25.07, exactly the gap between 925.63 and 900.56.
 *
 * ── EVERY FIGURE HERE IS DERIVED PER ROW ────────────────────────────────────
 * ⚠️ An earlier version inferred the tax rate from the median of the *current report batch*. It
 * validated at 30/30 days against Data Kiosk — but only because the validation used ONE 30-day
 * batch with 187 clean rows. Production fetches in 3-day chunks
 * (`FINANCE_REPORT_CHUNK_DAYS`), so each batch held a handful of rows, the inferred rate moved
 * with the chunk boundaries, and the SAME DAY produced different totals depending on how it was
 * chunked (2026-07-22 stored 269.71 against Seller Central's 269.51).
 *
 * So: nothing in this module may depend on which other rows happen to be in the batch. A row's
 * correction is a pure function of that row plus a static per-marketplace rate. That is what makes
 * the result reproducible no matter how the sync is chunked or re-chunked — verified by replaying
 * the same 30 days at chunk sizes 30/7/3/1 and getting byte-identical per-day totals.
 */

const logger = require('./Logger.js');

/**
 * Standard consumption-tax rate per marketplace, for marketplaces whose reported `item-price`
 * INCLUDES that tax.
 *
 * A marketplace absent from this map gets NO correction — which is exactly the behaviour before
 * this module existed. That is the deliberate default for anything unconfirmed:
 *
 *   - US, CA add tax at checkout, so `item-price` is tax-EXCLUSIVE. Correcting it would subtract
 *     tax that was never in the price and would corrupt figures that are correct today.
 *   - MX, BR are omitted because their pricing convention was not confirmed here.
 *   - IN is omitted because GST runs several slabs (5/12/18/28%) with no single standard rate; a
 *     promoted Indian row still gets corrected via the per-row solve below, which needs no table.
 *
 * ⚠️ Only AU is empirically validated (30/30 days against Data Kiosk). The others carry their
 * published standard rate and share the same tax-inclusive display convention, but their numbers
 * have NOT been checked against Amazon's. `scripts/verifyMarketplaceBucketing.js` is the way to
 * confirm one. A stale rate here is surfaced by `warnIfRateLooksWrong`.
 */
const COUNTRY_TAX_RATE = {
  AU: 0.10,   // GST — validated
  JP: 0.10,   // consumption tax
  SG: 0.09,   // GST
  UK: 0.20, GB: 0.20,
  IE: 0.23,
  DE: 0.19,
  FR: 0.20,
  IT: 0.22,
  ES: 0.21,
  NL: 0.21,
  BE: 0.21,
  SE: 0.25,
  PL: 0.23,
  TR: 0.20,
  AE: 0.05,
  SA: 0.15,
  EG: 0.14,
  ZA: 0.15,
};

/**
 * How far a row's own implied rate may sit below the marketplace standard rate before we conclude
 * it is a REDUCED-RATE product rather than an under-taxed one.
 *
 * Needed because many marketplaces tax some categories lower (books at 7% in DE, India's slabs).
 * For such a product `item-tax` is legitimately far below the standard rate and must NOT be
 * treated as uncollected tax — that would silently understate its sales. A genuine anomaly, by
 * contrast, sits just a fraction of a point below (2026-07-15 had a 24.99 row taxed 2.16 rather
 * than 2.27: 9.46% against 10%).
 *
 * Only consulted for rows with NO promotion. A promoted row's rate is solved exactly instead.
 */
const REDUCED_RATE_TOLERANCE = 0.02;   // 2 percentage points

/**
 * Marketplaces whose `item-price` INCLUDES consumption tax.
 *
 * Separate from COUNTRY_TAX_RATE because the two questions are different: this decides whether a
 * correction may happen AT ALL, while the rate table only supplies a standard rate where one
 * exists. India belongs here (GST-inclusive prices) but has no single standard rate, so it gets
 * corrections only for promoted rows, whose rate is solved from the row itself.
 *
 * US/CA/MX/BR are absent, so no row of theirs is ever corrected — a promoted US row must keep its
 * full `item-price`, since the tax was never inside that price to begin with.
 */
const TAX_INCLUSIVE_COUNTRIES = new Set([
  'AU', 'JP', 'SG', 'IN',
  'UK', 'GB', 'IE', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'SE', 'PL', 'TR',
  'AE', 'SA', 'EG', 'ZA',
]);

/**
 * How close a rate SOLVED from a promoted row must be to the marketplace standard rate before we
 * treat it as being that rate.
 *
 * `item-tax` is rounded to cents, so the algebra recovers e.g. 9.99% where the true rate is 10%.
 * Using the noisy value shifts `expectedTax` by a fraction of a cent, which on a real day
 * (2026-07-21) tipped four rows across a rounding boundary and left the day 0.32 out. Snapping to
 * the standard rate when they agree keeps the arithmetic exact, while a genuinely different slab
 * (a 7% book against a 19% standard) still falls outside and keeps its solved rate.
 */
const SOLVED_RATE_SNAP_TOLERANCE = 0.02;   // 2 percentage points

/** Bounds for a rate SOLVED from a row; outside these the algebra found something meaningless. */
const MIN_PLAUSIBLE_RATE = 0.03;
const MAX_PLAUSIBLE_RATE = 0.30;

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round2 = (v) => Math.round(v * 100) / 100;

/** Is this marketplace's reported item-price tax-inclusive (i.e. may we correct it at all)? */
function isTaxInclusiveCountry(country) {
  return !!country && TAX_INCLUSIVE_COUNTRIES.has(String(country).toUpperCase());
}

/** The marketplace's standard rate, or null when we make no correction there. */
function standardTaxRate(country) {
  if (!country) return null;
  return COUNTRY_TAX_RATE[String(country).toUpperCase()] ?? null;
}

/**
 * Recover the tax rate that a PROMOTED row was actually taxed at, from that row alone.
 *
 * With u = rate/(1+rate), a tax-inclusive promoted row satisfies
 *     tax = (price - discount*(1+rate)) * u
 * which rearranges to the quadratic
 *     price*u^2 + (discount - price - tax)*u + tax = 0
 *
 * Solving it makes the correction exact for reduced-rate and multi-slab products too, without any
 * per-marketplace rate and without looking at any other row. For the AU case (24.99, tax 1.18,
 * discount 10.91) this returns 10%, giving an uncollected 1.09.
 *
 * @returns {number|null} u (tax as a fraction of the inclusive price), or null if unsolvable
 */
function solveTaxFractionFromPromotedRow(price, tax, discount) {
  if (!(price > 0) || !(tax > 0) || !(discount > 0)) return null;
  const a = price;
  const b = discount - price - tax;
  const c = tax;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  for (const u of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (!Number.isFinite(u) || u <= 0 || u >= 1) continue;
    const rate = u / (1 - u);
    if (rate >= MIN_PLAUSIBLE_RATE && rate <= MAX_PLAUSIBLE_RATE) return u;
  }
  return null;
}

/**
 * The tax fraction to use for one row, or null to leave the row alone.
 * Pure in the row + the static marketplace rate — no batch involved.
 */
function taxFractionForRow(row, country) {
  const price = num(row['item-price']);
  const tax = num(row['item-tax']);
  // Zero tax is a different tax treatment, not a discount shrinking the taxable base; Amazon does
  // not reduce sales for these. Without this guard two otherwise-correct real days broke by
  // -2.73 and -3.64.
  if (price <= 0 || tax <= 0) return null;

  // Tax-exclusive marketplace (US/CA/MX/BR): the tax was never inside item-price, so there is
  // nothing to remove. Checked FIRST so a promoted US row can never be touched.
  if (!isTaxInclusiveCountry(country)) return null;

  const discount = num(row['item-promotion-discount']);
  const standard = standardTaxRate(country);

  // ── Promoted row: recover the rate from the row itself, so reduced-rate and multi-slab products
  //    are handled without any table.
  if (discount > 0) {
    const solved = solveTaxFractionFromPromotedRow(price, tax, discount);
    if (solved) {
      // Prefer the standard rate when they agree — the solved value carries cent-rounding noise.
      if (standard != null && Math.abs(solved / (1 - solved) - standard) <= SOLVED_RATE_SNAP_TOLERANCE) {
        return standard / (1 + standard);
      }
      return solved;
    }
    // Unsolvable (odd data) → fall back to the standard rate if this marketplace has one.
    return standard != null ? standard / (1 + standard) : null;
  }

  // ── Unpromoted row: needs a standard rate to compare against, and only a SMALL shortfall is
  //    treated as uncollected tax. A large one means a reduced-rate product, where "correcting" it
  //    would understate its sales.
  if (standard == null) return null;
  const impliedRate = tax / (price - tax);
  if (standard - impliedRate > REDUCED_RATE_TOLERANCE) return null;
  return standard / (1 + standard);
}

/**
 * The product-sales value for one Sales Report row, matching Amazon's `orderedProductSales`.
 *
 * Deterministic: depends only on this row and the static marketplace rate, so re-syncing the same
 * day in a different chunk size cannot change it.
 *
 * @param {object} row a Sales Report row
 * @param {string} country marketplace country code
 */
function itemSalesForRow(row, country) {
  const price = num(row['item-price']);
  const u = taxFractionForRow(row, country);
  if (!u) return price;

  const tax = num(row['item-tax']);
  const qty = Math.max(1, parseInt(row.quantity, 10) || 1);
  const unitPrice = price / qty;
  const unitTax = tax / qty;

  // Tax expected on the full unit price, minus what was actually charged = the uncollected tax.
  // Rounded per UNIT because that is what reproduces Amazon's figure on multi-quantity lines: a
  // real quantity-2 line (29.98 taxed 2.32) is a cent out under per-line rounding.
  //
  // Clamped at 0 so the correction can only ever REMOVE uncollected tax. A row taxed ABOVE the
  // rate (an extra tax component, odd data) would otherwise push reported sales above the price
  // actually charged.
  const uncollectedPerUnit = Math.max(0, round2(unitPrice * u - unitTax));
  return qty * (unitPrice - uncollectedPerUnit);
}

/**
 * Observability only — never feeds a number.
 *
 * Compares the marketplace's configured rate against what unpromoted rows actually imply, so a
 * stale entry in COUNTRY_TAX_RATE (or a marketplace whose convention we guessed wrong) shows up in
 * the logs instead of silently skewing sales. Deliberately does NOT alter any value, because a
 * batch-derived figure is exactly what made this non-deterministic before.
 */
function warnIfRateLooksWrong(reportRows, country) {
  const standard = standardTaxRate(country);
  if (!standard) return;
  const implied = [];
  for (const row of reportRows) {
    const price = num(row['item-price']);
    const tax = num(row['item-tax']);
    if (price <= 0 || tax <= 0 || num(row['item-promotion-discount']) !== 0) continue;
    if (price - tax <= 0) continue;
    implied.push(tax / (price - tax));
  }
  if (implied.length < 20) return;           // too thin to draw a conclusion from
  implied.sort((a, b) => a - b);
  const median = implied[Math.floor(implied.length / 2)];
  if (Math.abs(median - standard) > 0.01) {
    logger.warn(`[marketplaceTax] ${country}: configured tax rate ${(standard * 100).toFixed(2)}% but ${implied.length} unpromoted rows imply ${(median * 100).toFixed(2)}%. Sales may be misreconciled — check COUNTRY_TAX_RATE.`);
  }
}

module.exports = {
  COUNTRY_TAX_RATE,
  TAX_INCLUSIVE_COUNTRIES,
  SOLVED_RATE_SNAP_TOLERANCE,
  isTaxInclusiveCountry,
  standardTaxRate,
  solveTaxFractionFromPromotedRow,
  taxFractionForRow,
  itemSalesForRow,
  warnIfRateLooksWrong,
  REDUCED_RATE_TOLERANCE,
};
