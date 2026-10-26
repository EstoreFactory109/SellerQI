/**
 * Amazon's return-rate thresholds per category for the FBA returns processing fee
 * (tasks-logics.xlsx "Returns processing fee risk").
 *
 * Amazon publishes these on a Seller Central help page, not in any API, so this table
 * is maintained by hand (user decision, 2026-10-26). THE TEAM FILLS IN AND CONFIRMS
 * THE VALUES: until a category is listed here, products in it get no verdict, and with
 * the table empty the check makes no verdict at all.
 *
 * To fill in: copy each category's threshold (as a percent, e.g. 8.6 for 8.6%) from
 * Amazon's "Returns processing fee for high-return-rate items" help page, keyed by the
 * category name exactly as the FBA fee estimate report's `product-group` column writes
 * it (e.g. "Home", "Kitchen", "Sports"). Update `source` and `checkedOn` with it.
 */
const RETURN_THRESHOLDS = Object.freeze({
    source: '',
    checkedOn: '',
    // The fee applies in these marketplaces; others get no verdict.
    marketplaces: ['US'],
    // product-group -> threshold, percent of units shipped. Empty until confirmed.
    byProductGroup: {}
});

const normGroup = (g) => String(g || '').trim().toLowerCase();

/** Threshold percent for a product group, or null when not listed. */
function thresholdFor(productGroup, table = RETURN_THRESHOLDS) {
    const wanted = normGroup(productGroup);
    for (const [group, pct] of Object.entries(table.byProductGroup || {})) {
        if (normGroup(group) === wanted && Number(pct) > 0) return Number(pct);
    }
    return null;
}

const hasThresholds = (country, table = RETURN_THRESHOLDS) =>
    Object.keys(table.byProductGroup || {}).length > 0
    && (table.marketplaces || []).includes(String(country || '').toUpperCase());

module.exports = { RETURN_THRESHOLDS, thresholdFor, hasThresholds };
