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
const W2 = require('./Wave2Detectors.js');
const W3 = require('./Wave3Detectors.js');
const Aligned = require('./AlignedDetectors.js');
const { staleSources } = require('./DataFreshness.js');
const { dataFaults, withoutFaultySources } = require('./DataFaults.js');
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
    'inventory:removal_confirm_receipt': 'kpi.removalShortfall',
    'inventory:lost_damaged_unreimbursed': 'kpi.lostDamaged',
    'inventory:inbound_shortage': 'kpi.inboundShortage',
    'inventory:refund_not_returned': 'kpi.refundNotReturned',
    // Wave 2
    'conversion:sales_drop': 'kpi.salesDrop',
    'conversion:conversion_rate_drop': 'kpi.conversionDrop',
    'conversion:traffic_drop': 'kpi.trafficDrop',
    'sponsoredAds:tacos_rising': 'kpi.tacos',
    'sponsoredAds:top_seller_not_advertised': 'kpi.topSellerAds',
    'conversion:rating_drop': 'kpi.ratingDrop',
    'inventory:weeks_of_cover': 'kpi.weeksOfCover',
    'conversion:high_traffic_low_conversion': 'kpi.trafficMix',
    'conversion:low_traffic_high_conversion': 'kpi.trafficMix',
    // Wave 3
    'inventory:listing_warnings': 'kpi.listingWarnings',
    'account:invoice_defect_rate': 'kpi.invoiceDefect',
    'inventory:low_inventory_fee_risk': 'kpi.lowInventoryFee',
    'inventory:fba_fee_increase': 'kpi.fbaFeeIncrease',
    'inventory:handling_time_long': 'kpi.handlingTime',
    'inventory:new_seller_on_brand': 'kpi.newSellerOnBrand',
    'inventory:return_reason_spike': 'kpi.returnReasons',
    'ranking:detail_page_changed': 'kpi.detailPageChanged',
    'inventory:returns_fee_risk': 'kpi.returnsFee',
    // Alignment of an existing check (runs without a wave flag)
    'ranking:listing_errors': 'kpi.listingErrors',
    'sponsoredAds:product_acos_above_breakeven': 'kpi.productAcos'
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
 * @param {Array} [ctx.profitRows] - 30-day profitability rows, for break-even ACoS
 * @param {Object} [ctx.cogsMap] - per-unit COGS by ASIN
 * @param {string} ctx.country
 * @param {Date} [ctx.now]
 * @returns {{tasks: Array, coverage: Object}}
 */
function runKpiDetectors(data, { salesByAsin = {}, financeFresh = false, profitRows = [], cogsMap = {}, country = null, userId = null, now = new Date() } = {}) {
    // Spreadsheet alignment of existing checks: these replace an older check, so they
    // run for every account, waves or not. Amazon's own ERROR flags on listings take
    // over from our restricted-word list (now a review flag only).
    const allProducts = Array.isArray(data?.TotalProducts) ? data.TotalProducts : [];
    const allByAsin = new Map();
    for (const p of allProducts) if (p?.asin && !allByAsin.has(p.asin)) allByAsin.set(p.asin, p);
    const aligned = safely('listing_errors', { userId, country }, () => W3.detectListingErrors({ products: allProducts, productsByAsin: allByAsin }));
    // Break-even needs fresh finance; without it the product ACoS check holds its tasks.
    const productAcos = financeFresh
        ? safely('product_acos_above_breakeven', { userId, country }, () => Aligned.detectProductAcos({
            adsRows: data?.ProductWiseSponsoredAds, profitRows, cogsMap, country, productsByAsin: allByAsin, now,
            adGroupsByAsin: data?.AdGroupsByAsin, keywordRows: data?.adsKeywordsPerformanceData, keywordSnapshot: data?.keywords
        }))
        : { tasks: [], covered: false };
    const alignedResult = {
        tasks: [...aligned.tasks, ...productAcos.tasks],
        coverage: {
            [KPI_SOURCES['ranking:listing_errors']]: aligned.covered,
            [KPI_SOURCES['sponsoredAds:product_acos_above_breakeven']]: productAcos.covered
        }
    };

    const rawInputs = data?.KpiInputs;
    if (!rawInputs || !Array.isArray(rawInputs.waves) || rawInputs.waves.length === 0) {
        return { ...alignedResult, staleSources: [], dataFaults: [] };
    }
    // Data fault guard: a source that cannot be true is held for this run (internal
    // alert only; its detectors see it as not arrived).
    let faults = [];
    try {
        faults = dataFaults(rawInputs);
    } catch (error) {
        logger.error('[KpiDetectors] data fault check failed', { userId, country, error: error.message });
    }
    if (faults.length > 0) {
        logger.warn('[DataFault] source looks broken; its tasks are held this run', { userId, country, faults });
    }
    const inputs = withoutFaultySources(rawInputs, faults);
    const waveOn = (n) => inputs.waves.includes(n);

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

    // Wave 1 always runs (its out-of-stock and suppression verdicts feed the waves
    // after it) but only adds tasks and coverage when wave 1 itself is on.
    const tasks = [...alignedResult.tasks];
    const coverage = { ...alignedResult.coverage };
    const add = (result, ...types) => {
        tasks.push(...result.tasks);
        for (const type of types) coverage[KPI_SOURCES[type]] = result.covered;
    };
    if (waveOn(1)) {
        add(suppressed, 'inventory:listing_suppressed');
        add(outOfStock, 'inventory:out_of_stock');
        add(ads, 'sponsoredAds:ads_on_unbuyable');
        add(cogs, 'profitability:cogs_missing');
        add(ahr, 'account:ahr_early_warning');
        add(removals, 'inventory:removal_shortfall', 'inventory:removal_confirm_receipt');
        add(safely('lost_damaged_unreimbursed', context, () => W1.detectLostDamagedUnreimbursed({ lostDamaged: inputs.lostDamaged, productsByAsin, now })), 'inventory:lost_damaged_unreimbursed');
        add(safely('refund_not_returned', context, () => W1.detectRefundNotReturned({ refundCheck: inputs.refundCheck, stock: inputs.stock, products, productsByAsin, now })), 'inventory:refund_not_returned');
        add(safely('inbound_shortage', context, () => W1.detectInboundShortage({ inboundShortage: inputs.inboundShortage, products, now })), 'inventory:inbound_shortage');
    }

    if (waveOn(2)) {
        // A drop that out of stock, suppression or a lost Buy Box already explains is
        // that task's, not a trend task (spreadsheet: Sales drop skip rule).
        const skipAsins = new Map([...outOfStock.asins, ...suppressed.asins]);
        for (const row of data.BuyBoxData?.asinBuyBoxData || []) {
            const asin = row?.childAsin || row?.asin;
            if (asin && (row.buyBoxLost === true || (Number.isFinite(row.buyBoxPercentage) && row.buyBoxPercentage < 80))) {
                skipAsins.set(asin, 'no Buy Box');
            }
        }
        const suppressedAsins = new Set(suppressed.tasks.map(t => t.asin));
        const buyable = (asin) => !suppressedAsins.has(asin)
            && (W1.buyableUnits(catalogue.get(asin)) > 0 || (inputs.stock?.byAsin?.[asin]?.fulfillable || 0) > 0);
        const activeAsins = new Set(products.filter(p => p?.status === 'Active' && p.asin).map(p => p.asin));

        add(safely('sales_drop', context, () => W2.detectSalesDrop({ traffic: inputs.traffic, skipAsins, productsByAsin, now })), 'conversion:sales_drop');
        add(safely('conversion_rate_drop', context, () => W2.detectConversionRateDrop({ traffic: inputs.traffic, skipAsins, productsByAsin, now })), 'conversion:conversion_rate_drop');
        add(safely('traffic_drop', context, () => W2.detectTrafficDrop({ traffic: inputs.traffic, skipAsins, productsByAsin, now })), 'conversion:traffic_drop');
        add(safely('tacos_rising', context, () => W2.detectTacosRising({ tacos: inputs.tacos, now })), 'sponsoredAds:tacos_rising');
        add(safely('top_seller_not_advertised', context, () => (salesRecent
            ? W2.detectTopSellerNotAdvertised({
                adsRows: data.ProductWiseSponsoredAds, topAsins: W1.topRevenueAsins(recentSales), buyable,
                country, productsByAsin, salesByAsin: recentSales, now
            })
            : { tasks: [], covered: false })), 'sponsoredAds:top_seller_not_advertised');
        const mix = (() => {
            try {
                return W2.detectTrafficMix({ traffic: inputs.traffic, skipAsins, productsByAsin, now });
            } catch (error) {
                logger.error('[KpiDetectors] traffic_mix failed', { ...context, error: error.message });
                return { high: { tasks: [], covered: false }, low: { tasks: [], covered: false } };
            }
        })();
        tasks.push(...mix.high.tasks, ...mix.low.tasks);
        // One source for both: covered only when both halves were judged.
        coverage[KPI_SOURCES['conversion:high_traffic_low_conversion']] = mix.high.covered && mix.low.covered;
        add(safely('rating_drop', context, () => W2.detectRatingDrop({ reviews: inputs.reviews, productsByAsin, now })), 'conversion:rating_drop');
        // No coverage key of its own: thousands of stored tasks of this retired type
        // resolve on the 'conversion' source (the listing scrape), and a key that only
        // exists while wave 2 is on would hold them forever when it is off.
        add(safely('insufficient_reviews', context, () => W2.detectLowReviewCount({ reviews: inputs.reviews, activeAsins, productsByAsin, now })));
        add(safely('weeks_of_cover', context, () => W2.detectWeeksOfCover({ restock: inputs.restock, productsByAsin })), 'inventory:weeks_of_cover');
    }

    if (waveOn(3)) {
        add(safely('listing_warnings', context, () => W3.detectListingWarnings({ products, productsByAsin })), 'inventory:listing_warnings');
        add(safely('invoice_defect_rate', context, () => W3.detectInvoiceDefectRate({ v2: inputs.invoice })), 'account:invoice_defect_rate');
        add(safely('low_inventory_fee_risk', context, () => (salesRecent
            ? W3.detectLowInventoryFeeRisk({ planning: inputs.planning, salesByAsin: recentSales, productsByAsin })
            : { tasks: [], covered: false })), 'inventory:low_inventory_fee_risk');
        add(safely('fba_fee_increase', context, () => W3.detectFbaFeeIncrease({ fbaFees: inputs.fbaFees, salesByAsin: recentSales, productsByAsin, now })), 'inventory:fba_fee_increase');
        add(safely('handling_time_long', context, () => W3.detectLongHandlingTime({ products, productsByAsin })), 'inventory:handling_time_long');
        add(safely('returns_fee_risk', context, () => W3.detectReturnsFeeRisk({ returns: inputs.returns, shipped90: inputs.shipped90, fbaFees: inputs.fbaFees, country, productsByAsin, now })), 'inventory:returns_fee_risk');
        add(safely('detail_page_changed', context, () => W3.detectDetailPageChanged({ listingChanges: inputs.listingChanges, productsByAsin, now })), 'ranking:detail_page_changed');
        add(safely('return_reason_spike', context, () => W3.detectReturnReasonSpike({ returns: inputs.returns, productsByAsin, now })), 'inventory:return_reason_spike');
        add(safely('new_seller_on_brand', context, () => W3.detectNewSellerOnBrand({ brandOffers: inputs.brandOffers, productsByAsin, now })), 'inventory:new_seller_on_brand');
    }

    // Internal stale-data guard: never a client task, only the alert.
    let stale = [];
    try {
        stale = staleSources(inputs, now);
    } catch (error) {
        logger.error('[KpiDetectors] stale-data check failed', { ...context, error: error.message });
    }
    if (stale.length > 0) {
        logger.warn('[DataFreshness] inputs behind schedule; their tasks are held this run', { ...context, stale });
    }

    logger.info('[KpiDetectors] run', {
        waves: inputs.waves,
        ...context,
        tasks: tasks.length,
        byType: tasks.reduce((acc, t) => ({ ...acc, [t.errorType]: (acc[t.errorType] || 0) + 1 }), {}),
        coverage
    });
    return { tasks, coverage, staleSources: stale, dataFaults: faults };
}

module.exports = { runKpiDetectors, windowDaysOf, windowIsRecent, windowPhrase, KPI_SOURCES };
