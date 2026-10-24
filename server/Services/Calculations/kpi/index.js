/**
 * Runs the tasks-logics.xlsx detectors for one marketplace.
 *
 * Called from DashboardCalculation.analyseData with the Analyse message. Nothing
 * runs unless Analyse attached `KpiInputs` for an enabled wave (kpiGate), so an
 * account with every wave off gets no new tasks and no new coverage keys.
 *
 * Returns the tasks (already carrying their own text) and the coverage keys task
 * reconcile reads (TaskReconcilePlanner.SOURCE_BY_TYPE). A detector that throws
 * reports itself uncovered, so its stored tasks are held rather than resolved.
 */

const logger = require('../../../utils/Logger.js');
const W1 = require('./Wave1Detectors.js');
const { SALES_WINDOW_MAX_AGE_DAYS } = require('./KpiRules.js');

/** Coverage key per task type; mirrored in TaskReconcilePlanner.SOURCE_BY_TYPE. */
const KPI_SOURCES = Object.freeze({
    'inventory:listing_suppressed': 'kpi.suppressed',
    'inventory:out_of_stock': 'kpi.outOfStock',
    'sponsoredAds:ads_on_unbuyable': 'kpi.adsOnUnbuyable',
    'profitability:cogs_missing': 'kpi.cogsMissing',
    'account:ahr_early_warning': 'kpi.ahrEarlyWarning',
    'inventory:removal_shortfall': 'kpi.removalShortfall',
    // Same input as the shortfall: the removal report plus the seller's answers.
    'inventory:removal_confirm_receipt': 'kpi.removalShortfall'
});

const safely = (name, context, fn) => {
    try {
        return fn();
    } catch (error) {
        logger.error(`[KpiDetectors] ${name} failed`, { ...context, error: error.message });
        return { tasks: [], covered: false, asins: new Map() };
    }
};

const DAY_MS = 24 * 60 * 60 * 1000;
const parseDay = (value) => Date.parse(`${String(value || '').slice(0, 10)}T00:00:00Z`);

/**
 * Days covered by the dashboard window ('YYYY-MM-DD' strings, inclusive).
 * @returns {number} days, or 30 when the window is unreadable
 */
function windowDaysOf(startDate, endDate) {
    const start = parseDay(startDate);
    const end = parseDay(endDate);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 30;
    return Math.round((end - start) / DAY_MS) + 1;
}

/**
 * Whether the dashboard window ends recently enough for "sold recently" rules.
 * An unreadable end date is not recent.
 */
function windowIsRecent(endDate, now, maxAgeDays = SALES_WINDOW_MAX_AGE_DAYS) {
    const end = parseDay(endDate);
    return Number.isFinite(end) && (now.getTime() - end) / DAY_MS <= maxAgeDays + 1;
}

const shortDate = (value) => new Date(parseDay(value)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "in the last 30 days" for a recent window, else its dates, so old data never reads as current. */
function windowPhrase(startDate, endDate, days, recent) {
    if (recent) return `in the last ${days} days`;
    if (!Number.isFinite(parseDay(startDate)) || !Number.isFinite(parseDay(endDate))) return `in the ${days} days of data we have`;
    return `between ${shortDate(startDate)} and ${shortDate(endDate)}`;
}

/**
 * @param {Object} data - the Analyse message
 * @param {Object} ctx
 * @param {Object} ctx.salesByAsin - { [asin]: { sales, unitsSold } } for the dashboard window
 * @param {boolean} ctx.financeFresh - whether salesByAsin is trustworthy (resolveAsinFinance)
 * @param {string} ctx.country
 * @param {Date} [ctx.now]
 * @returns {{tasks: Array, coverage: Object}}
 */
function runKpiDetectors(data, { salesByAsin = {}, financeFresh = false, country = null, userId = null, now = new Date() } = {}) {
    const inputs = data?.KpiInputs;
    if (!inputs || !Array.isArray(inputs.waves) || !inputs.waves.includes(1)) {
        return { tasks: [], coverage: {} };
    }

    const products = Array.isArray(data.TotalProducts) ? data.TotalProducts : [];
    const productsByAsin = new Map();
    for (const p of products) if (p?.asin && !productsByAsin.has(p.asin)) productsByAsin.set(p.asin, p);
    const catalogue = W1.catalogueByAsin(products);
    const windowDays = windowDaysOf(data.startDate, data.endDate);
    // "Sold recently" needs a window that ends recently, not just finance rows for it.
    const salesRecent = financeFresh && windowIsRecent(data.endDate, now);
    const recentSales = salesRecent ? salesByAsin : {};
    const context = { userId, country };

    const suppressed = safely('listing_suppressed', context, () => W1.detectListingSuppressed({
        // The 60-day lookback ends yesterday, so it stands on its own when the window is old.
        suppressed: inputs.suppressed, stock: inputs.stock, salesByAsin: recentSales,
        salesLookback: inputs.salesLookback, catalogue, productsByAsin, now
    }));
    const outOfStock = safely('out_of_stock', context, () => W1.detectOutOfStock({
        stock: inputs.stock, salesByAsin: recentSales, financeFresh: salesRecent, windowDays, catalogue, productsByAsin, now
    }));
    const ads = safely('ads_on_unbuyable', context, () => W1.detectAdsOnUnbuyable({
        adsRows: data.ProductWiseSponsoredAds,
        unbuyable: new Map([...outOfStock.asins, ...suppressed.asins]),
        buyBoxRows: data.BuyBoxData?.asinBuyBoxData,
        // An ASIN can only be called "buyable" when both stock and suppression were judged.
        unbuyableCovered: outOfStock.covered && suppressed.covered,
        country, productsByAsin, now
    }));
    const cogs = safely('cogs_missing', context, () => W1.detectCogsMissing({
        // A product that sold without a cost on file is missing one however old the
        // window is; the text says which dates it means.
        cogsAsins: inputs.cogsAsins, salesByAsin, financeFresh, productsByAsin,
        windowText: windowPhrase(data.startDate, data.endDate, windowDays, windowIsRecent(data.endDate, now))
    }));
    const ahr = safely('ahr_early_warning', context, () => W1.detectAhrEarlyWarning({
        ahrHistory: inputs.ahrHistory, now
    }));
    const removals = safely('removal_shortfall', context, () => W1.detectRemovalShortfall({
        removals: inputs.removals, receipts: inputs.removalReceipts,
        reimbursements: inputs.removalReimbursements, products, productsByAsin, now
    }));

    const tasks = [
        ...suppressed.tasks, ...outOfStock.tasks, ...ads.tasks,
        ...cogs.tasks, ...ahr.tasks, ...removals.tasks
    ];
    const coverage = {
        [KPI_SOURCES['inventory:listing_suppressed']]: suppressed.covered,
        [KPI_SOURCES['inventory:out_of_stock']]: outOfStock.covered,
        [KPI_SOURCES['sponsoredAds:ads_on_unbuyable']]: ads.covered,
        [KPI_SOURCES['profitability:cogs_missing']]: cogs.covered,
        [KPI_SOURCES['account:ahr_early_warning']]: ahr.covered,
        [KPI_SOURCES['inventory:removal_shortfall']]: removals.covered
    };

    logger.info('[KpiDetectors] wave 1', {
        ...context,
        tasks: tasks.length,
        byType: tasks.reduce((acc, t) => ({ ...acc, [t.errorType]: (acc[t.errorType] || 0) + 1 }), {}),
        coverage
    });
    return { tasks, coverage };
}

module.exports = { runKpiDetectors, windowDaysOf, windowIsRecent, windowPhrase, KPI_SOURCES };
