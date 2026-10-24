/**
 * Wave 1 of the tasks-logics.xlsx tasks: money and buyability.
 *
 *   inventory:listing_suppressed      Listing blocked / suppressed / inactive
 *   inventory:out_of_stock            Out of stock
 *   sponsoredAds:ads_on_unbuyable     Ads running on products that cannot sell
 *   profitability:cogs_missing        Cost of goods missing
 *   account:ahr_early_warning         Account Health early warning
 *   inventory:removal_shortfall       Potential reimbursement: removal order shortfall
 *
 * Every detector is pure (no DB, no network, `now` injected) and returns
 * `{ tasks, covered }`. `covered` is true only when the detector's input arrived
 * and was fresh enough to judge: task reconcile resolves a stored task only when
 * its source is covered, so "no input" must never read as "nothing wrong".
 *
 * Tasks carry their own error/solution text (renderTaskIfNeeded passes baked-in
 * text through), and money stays in `amount` so the client formats it in the
 * marketplace's currency.
 */

const { rowDay, shiftDay, newestRowDay, isAdsDataStale } = require('../AdsSignals.js');
const R = require('./KpiRules.js');

const PENDING = 'pending';

const ageDays = (isoString, now) => {
    const t = Date.parse(isoString || '');
    return Number.isFinite(t) ? (now.getTime() - t) / R.DAY_MS : Infinity;
};

const unique = (values) => [...new Set(values.filter(Boolean))];

const productNameOf = (productsByAsin, asin, fallback) => {
    const p = productsByAsin.get(asin);
    const name = p?.itemName || p?.title || p?.productName || p?.name;
    return (name || fallback || asin || 'Unknown Product').substring(0, 100);
};

/**
 * ASINs in the top TOP_REVENUE_SHARE of account revenue, among ASINs that sold.
 * @param {Object} salesByAsin - { [asin]: { sales } }
 * @returns {Set<string>}
 */
function topRevenueAsins(salesByAsin = {}) {
    const ranked = Object.entries(salesByAsin)
        .filter(([, v]) => (Number(v?.sales) || 0) > 0)
        .sort((a, b) => b[1].sales - a[1].sales)
        .map(([asin]) => asin);
    return new Set(ranked.slice(0, Math.ceil(ranked.length * R.TOP_REVENUE_SHARE)));
}

/**
 * Listing blocked / suppressed / inactive.
 * Spreadsheet: SKU with stock or sales in the last 60 days that is not buyable.
 * Source here is Amazon's Suppressed Listings report, "at risk" rows excluded
 * (still visible). `salesLookback` is the 60-day sales; without it the dashboard
 * window's sales stand in. The amount stays on the dashboard window, like every
 * other task's.
 */
function detectListingSuppressed({ suppressed, stock, salesByAsin = {}, salesLookback = null, productsByAsin = new Map(), now }) {
    if (!suppressed || ageDays(suppressed.createdAt, now) > R.SUPPRESSED_REPORT_MAX_AGE_DAYS) {
        return { tasks: [], covered: false, asins: new Map() };
    }

    const top = topRevenueAsins(salesByAsin);
    const byAsin = new Map();
    for (const item of suppressed.items || []) {
        const entry = byAsin.get(item.asin) || { skus: [], statuses: [], reasons: [] };
        entry.skus.push(item.sku);
        entry.statuses.push(item.status);
        entry.reasons.push(item.issueDescription || item.reason);
        byAsin.set(item.asin, entry);
    }

    const tasks = [];
    const asins = new Map();
    for (const [asin, entry] of byAsin) {
        const fbaUnits = stock?.byAsin?.[asin]?.total || 0;
        // Seller-fulfilled stock lives on the catalogue row (merchant listings report).
        const ownUnits = Number(productsByAsin.get(asin)?.quantity) || 0;
        const sales = salesByAsin[asin] || {};
        const lookback = (salesLookback && salesLookback[asin]) || sales;
        const sold = (Number(lookback.unitsSold) || 0) > 0 || (Number(lookback.sales) || 0) > 0;
        if (fbaUnits + ownUnits <= 0 && !sold) continue;

        const status = unique(entry.statuses).join(', ') || 'Suppressed';
        const reason = unique(entry.reasons).join('; ') || 'Amazon did not give a reason in the report';
        asins.set(asin, 'the listing is suppressed');
        tasks.push({
            asin,
            productName: productNameOf(productsByAsin, asin),
            errorCategory: 'inventory',
            errorType: 'listing_suppressed',
            error: `Listing Blocked | ${status}: This product cannot be bought on Amazon right now because: ${reason}.`,
            solution: 'Fix the issue Amazon has flagged so the listing becomes active again. In Seller Central go to Inventory > Fix Your Listings, open this SKU, correct the field or upload the document Amazon asks for, and resubmit. Open a case with Seller Support if the reason is unclear.',
            // Sales that ran through this listing in the window: what is at stake while it is hidden.
            amount: Math.round((Number(sales.sales) || 0) * 100) / 100,
            amountIsEstimated: true,
            renderData: {
                skus: unique(entry.skus),
                status,
                reason,
                topSeller: top.has(asin),
                units: fbaUnits + ownUnits
            },
            status: PENDING
        });
    }
    return { tasks, covered: true, asins };
}

/**
 * Out of stock.
 * Spreadsheet: fulfillable = 0, inbound = 0, and the SKU sold in the last 30 days.
 * FBA only: the FBA Inventory API is the only stock source that says "nothing inbound".
 */
function detectOutOfStock({ stock, salesByAsin = {}, financeFresh, windowDays, productsByAsin = new Map(), now }) {
    if (!stock || ageDays(stock.fetchedAt, now) > R.FBA_STOCK_MAX_AGE_DAYS || !financeFresh) {
        return { tasks: [], covered: false, asins: new Map() };
    }

    const days = windowDays > 0 ? windowDays : 30;
    const tasks = [];
    const asins = new Map();
    for (const [asin, s] of Object.entries(stock.byAsin || {})) {
        if (s.fulfillable > 0 || s.inbound > 0) continue;
        const units = Number(salesByAsin[asin]?.unitsSold) || 0;
        const sales = Number(salesByAsin[asin]?.sales) || 0;
        if (units <= 0) continue;

        const unitsPerDay = units / days;
        const salesPerDay = sales / days;
        asins.set(asin, 'it is out of stock');
        tasks.push({
            asin,
            productName: productNameOf(productsByAsin, asin),
            errorCategory: 'inventory',
            errorType: 'out_of_stock',
            error: `Out of Stock: This product has no sellable units in Amazon's warehouses and nothing on the way. It sold ${units} units in the last ${days} days, so it is losing about ${unitsPerDay < 1 ? unitsPerDay.toFixed(1) : Math.round(unitsPerDay)} ${unitsPerDay === 1 ? 'unit' : 'units'} of sales a day.`,
            solution: 'Send new stock as soon as possible: create an FBA shipment (Send to Amazon) using the restock recommendation as a guide. If you also ship orders yourself, switch the listing to seller-fulfilled until the shipment is received.',
            // A month of the sales it was making: estimated, from the window's own run rate.
            amount: Math.round(salesPerDay * 30 * 100) / 100,
            amountIsEstimated: true,
            renderData: {
                unitsSold: units,
                windowDays: days,
                unitsPerDay: Math.round(unitsPerDay * 10) / 10,
                salesPerDay: Math.round(salesPerDay * 100) / 100,
                skus: s.skus || []
            },
            status: PENDING
        });
    }
    return { tasks, covered: true, asins };
}

/**
 * Ads running on products that cannot sell.
 * Spreadsheet: active ads on an ASIN that is out of stock, not buyable, or under
 * 50% Featured Offer. "Active" = spend in the newest ADS_ACTIVE_LOOKBACK_DAYS of
 * ads data; the amount is the spend over the newest ADS_SPEND_MEASURE_DAYS.
 */
function detectAdsOnUnbuyable({ adsRows, unbuyable, buyBoxRows, unbuyableCovered, country, productsByAsin = new Map(), now }) {
    const newestDay = newestRowDay(adsRows || []);
    if (!Array.isArray(adsRows) || adsRows.length === 0 || isAdsDataStale(newestDay, country, now) || !unbuyableCovered) {
        return { tasks: [], covered: false };
    }

    const reasons = new Map(unbuyable);
    for (const row of buyBoxRows || []) {
        const asin = row?.childAsin || row?.asin;
        const pct = row?.buyBoxPercentage;
        if (!asin || pct === null || pct === undefined || pct === '') continue;
        if (Number(pct) < R.ADS_UNBUYABLE_BUYBOX_PCT && !reasons.has(asin)) {
            reasons.set(asin, `it wins the Buy Box on only ${Math.round(Number(pct))}% of visits`);
        }
    }
    if (reasons.size === 0) return { tasks: [], covered: true };

    const activeFrom = shiftDay(newestDay, -(R.ADS_ACTIVE_LOOKBACK_DAYS - 1));
    const measureFrom = shiftDay(newestDay, -(R.ADS_SPEND_MEASURE_DAYS - 1));
    const spend = new Map();
    for (const row of adsRows) {
        const asin = row?.asin;
        const day = rowDay(row);
        if (!asin || !day || !reasons.has(asin) || day < measureFrom) continue;
        const s = spend.get(asin) || { active: 0, measured: 0 };
        const value = Number(row.spend) || 0;
        s.measured += value;
        if (day >= activeFrom) s.active += value;
        spend.set(asin, s);
    }

    const tasks = [];
    for (const [asin, s] of spend) {
        if (s.active <= 0) continue;
        const reason = reasons.get(asin);
        tasks.push({
            asin,
            productName: productNameOf(productsByAsin, asin),
            errorCategory: 'sponsoredAds',
            errorType: 'ads_on_unbuyable',
            error: `PPC | Ads on a Product That Cannot Sell: Ads are still spending on this product, but shoppers cannot buy it right now because ${reason}. Clicks it gets until then cannot turn into sales.`,
            solution: 'Pause the campaigns or ad groups advertising this product until it can sell again, then turn them back on. Fix the underlying problem (stock, listing or Buy Box) first.',
            amount: Math.round(s.measured * 100) / 100,
            amountIsEstimated: false,
            renderData: {
                reason,
                spend: Math.round(s.measured * 100) / 100,
                spendDays: R.ADS_SPEND_MEASURE_DAYS,
                newestAdsDay: newestDay
            },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * Cost of goods missing. One account-level task.
 * Spreadsheet: SKUs with sales but no COGS on file.
 */
function detectCogsMissing({ cogsAsins, salesByAsin = {}, financeFresh, windowText = 'in the last 30 days', productsByAsin = new Map() }) {
    if (!Array.isArray(cogsAsins) || !financeFresh) return { tasks: [], covered: false };

    const withCost = new Set(cogsAsins);
    const missing = Object.entries(salesByAsin)
        .filter(([asin, v]) => asin && (Number(v?.sales) || 0) > 0 && !withCost.has(asin))
        .sort((a, b) => b[1].sales - a[1].sales)
        .map(([asin]) => asin);
    if (missing.length === 0) return { tasks: [], covered: true };

    const named = missing.slice(0, 5).map(asin => {
        const name = productNameOf(productsByAsin, asin, '');
        return name && name !== asin ? `${asin} (${name.substring(0, 40)})` : asin;
    });
    return {
        tasks: [{
            asin: 'ACCOUNT',
            productName: 'Product costs',
            errorCategory: 'profitability',
            errorType: 'cogs_missing',
            error: `Profitability | Cost of Goods Missing: ${missing.length} ${missing.length === 1 ? 'product that sold' : 'products that sold'} ${windowText} ${missing.length === 1 ? 'has' : 'have'} no product cost on file, so ${missing.length === 1 ? 'its' : 'their'} true profit cannot be worked out.`,
            solution: `Enter the cost per unit on the Profitability page (Cost of goods). Start with your best sellers: ${named.join(', ')}.`,
            amount: 0,
            renderData: { count: missing.length, asins: missing.slice(0, 50) },
            status: PENDING
        }],
        covered: true
    };
}

/**
 * Account Health early warning.
 * Spreadsheet: score down 20+ points in 7 days, or below 250. Below 200 is At
 * Risk, which the account-status task already reports, so the floor rule here
 * covers 200-249 only. A report without a score is never judged.
 */
function detectAhrEarlyWarning({ ahrHistory, now }) {
    if (!Array.isArray(ahrHistory) || ahrHistory.length === 0) return { tasks: [], covered: false };
    const newest = ahrHistory[ahrHistory.length - 1];
    if (newest.score === null || !Number.isFinite(newest.score)) return { tasks: [], covered: false };

    const since = now.getTime() - R.AHR_LOOKBACK_DAYS * R.DAY_MS;
    const newestAt = Date.parse(newest.at);
    // Baseline: the oldest scored report in the window that is at least a day older than the newest.
    const baseline = ahrHistory.find(row =>
        row.score !== null && Number.isFinite(row.score)
        && Date.parse(row.at) >= since
        && newestAt - Date.parse(row.at) >= R.DAY_MS * 0.8
    );

    const drop = baseline ? baseline.score - newest.score : 0;
    const dropped = drop >= R.AHR_DROP_POINTS;
    const nearFloor = newest.score >= 200 && newest.score < R.AHR_WARNING_FLOOR;
    if (!dropped && !nearFloor) return { tasks: [], covered: true };

    const days = baseline ? Math.max(1, Math.round((newestAt - Date.parse(baseline.at)) / R.DAY_MS)) : 0;
    const parts = [];
    if (dropped) parts.push(`Your Account Health Rating dropped ${Math.round(drop)} points in the last ${days} ${days === 1 ? 'day' : 'days'}, from ${baseline.score} to ${newest.score}.`);
    if (nearFloor) parts.push(`At ${newest.score} it is close to Amazon's At Risk cutoff of 200.`);

    return {
        tasks: [{
            asin: 'ACCOUNT',
            productName: 'Account Health',
            errorCategory: 'account',
            errorType: 'ahr_early_warning',
            error: `Account | Account Health Early Warning: ${parts.join(' ')}`,
            solution: 'Open Account Health in Seller Central, find the metric or policy item that moved the score this week, and resolve it before the rating reaches 200 (At Risk).',
            renderData: {
                score: newest.score,
                baselineScore: baseline ? baseline.score : null,
                drop: dropped ? Math.round(drop) : 0,
                days
            },
            status: PENDING
        }],
        covered: true
    };
}

/**
 * Potential reimbursement: removal order shortfall.
 * Spreadsheet: shipped quantity below requested with no cancellation or
 * reimbursement, within about 60 days. Here: a completed line whose shipped +
 * disposed + cancelled units fall short of what was requested, less any units
 * Amazon already reimbursed against that order (`reimbursements`, keyed order id
 * then SKU, '' for rows without one).
 */
function detectRemovalShortfall({ removals, reimbursements = null, products = [], productsByAsin = new Map(), now }) {
    if (!removals || ageDays(removals.createdAt, now) > R.REMOVAL_REPORT_MAX_AGE_DAYS) {
        return { tasks: [], covered: false };
    }

    const asinBySku = new Map();
    for (const p of products || []) if (p?.sku && p?.asin) asinBySku.set(p.sku, p.asin);

    // Reimbursed units per order are spent once: a SKU's own rows first, then the
    // order's SKU-less rows, across that order's lines in report order.
    const remaining = {};
    for (const [orderId, bySku] of Object.entries(reimbursements || {})) remaining[orderId] = { ...bySku };
    const takeReimbursed = (orderId, sku, wanted) => {
        const pool = remaining[orderId];
        if (!pool) return 0;
        let taken = 0;
        for (const key of [sku, '']) {
            const available = Math.max(0, pool[key] || 0);
            const take = Math.min(available, wanted - taken);
            pool[key] = available - take;
            taken += take;
        }
        return taken;
    };

    const since = now.getTime() - R.REMOVAL_CLAIM_WINDOW_DAYS * R.DAY_MS;
    const byEntity = new Map();
    for (const line of removals.lines || []) {
        if (!/^completed$/i.test(String(line.orderStatus || '').trim())) continue;
        const short = line.requestedQuantity - line.shippedQuantity - line.disposedQuantity - line.cancelledQuantity;
        if (short <= 0) continue;
        const reimbursed = takeReimbursed(line.orderId, line.sku, short);
        const missing = short - reimbursed;
        if (missing <= 0) continue;
        const updated = Date.parse(line.lastUpdatedDate || line.requestDate || '');
        if (!Number.isFinite(updated) || updated < since) continue;

        const asin = asinBySku.get(line.sku) || null;
        // The task's identity: the ASIN when the SKU is in the catalogue, else the SKU.
        const key = asin || `SKU:${line.sku}`.substring(0, 100);
        const entry = byEntity.get(key) || { asin, sku: line.sku, units: 0, orders: [] };
        entry.units += missing;
        entry.orders.push({
            orderId: line.orderId,
            orderType: line.orderType,
            sku: line.sku,
            requested: line.requestedQuantity,
            shipped: line.shippedQuantity,
            disposed: line.disposedQuantity,
            cancelled: line.cancelledQuantity,
            reimbursed,
            missing
        });
        byEntity.set(key, entry);
    }

    const tasks = [];
    for (const [key, entry] of byEntity) {
        const ids = unique(entry.orders.map(o => o.orderId));
        const o = entry.orders[0];
        const detail = entry.orders.length === 1
            ? ` (requested ${o.requested}, shipped ${o.shipped}, disposed ${o.disposed}, cancelled ${o.cancelled}${o.reimbursed ? `, already reimbursed ${o.reimbursed}` : ''})`
            : '';
        tasks.push({
            asin: key,
            productName: entry.asin ? productNameOf(productsByAsin, entry.asin) : `SKU ${entry.sku}`.substring(0, 100),
            errorCategory: 'inventory',
            errorType: 'removal_shortfall',
            error: `Removal Order Shortfall: ${ids.length === 1 ? `Removal order ${ids[0]} was` : `Removal orders ${ids.join(', ')} were`} completed with ${entry.units} ${entry.units === 1 ? 'unit' : 'units'} not accounted for${detail}.`,
            solution: 'Check what you actually received from this removal. If units are missing, open a case with Seller Support under FBA inventory > removal orders and ask Amazon to reimburse them, before the claim window (about 60 days) closes.',
            renderData: { units: entry.units, orders: entry.orders.slice(0, 20), sku: entry.sku },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

module.exports = {
    topRevenueAsins,
    detectListingSuppressed,
    detectOutOfStock,
    detectAdsOnUnbuyable,
    detectCogsMissing,
    detectAhrEarlyWarning,
    detectRemovalShortfall
};
