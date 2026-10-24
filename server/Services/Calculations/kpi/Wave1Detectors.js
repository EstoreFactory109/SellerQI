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
const { receiptKey, isReturnShippedLine, receiptsByKey, linesAwaitingConfirmation } = require('./RemovalReceipts.js');

const PENDING = 'pending';

const ageDays = (isoString, now) => {
    const t = Date.parse(isoString || '');
    return Number.isFinite(t) ? (now.getTime() - t) / R.DAY_MS : Infinity;
};

const unique = (values) => [...new Set(values.filter(Boolean))];

/**
 * Catalogue SKUs per ASIN, from the merchant listings sync (TotalProducts). For an
 * FBA SKU `quantity` mirrors FBA fulfillable stock; for a seller-fulfilled SKU it
 * is the seller's own stock, which is how one ASIN can have no FBA units and still
 * be buyable (seen: 69,967 units on an active self-shipped SKU next to empty FBA ones).
 * @returns {Map<string, Array<{sku, status, quantity}>>}
 */
function catalogueByAsin(products = []) {
    const out = new Map();
    for (const p of products || []) {
        if (!p?.asin) continue;
        const list = out.get(p.asin) || [];
        list.push({ sku: p.sku || '', status: p.status || '', quantity: Number(p.quantity) || 0 });
        out.set(p.asin, list);
    }
    return out;
}

/** Units on the ASIN's active SKUs, leaving out any SKU in `exceptSkus`. */
const buyableUnits = (skus = [], exceptSkus = new Set()) => skus
    .filter(s => s.status === 'Active' && s.quantity > 0 && !exceptSkus.has(s.sku))
    .reduce((sum, s) => sum + s.quantity, 0);

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
function detectListingSuppressed({ suppressed, stock, salesByAsin = {}, salesLookback = null, catalogue = new Map(), productsByAsin = new Map(), now }) {
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
        const skus = catalogue.get(asin) || [];
        const fbaUnits = stock?.byAsin?.[asin]?.total || 0;
        // Seller-fulfilled stock lives on the catalogue rows (merchant listings report).
        const ownUnits = skus.reduce((sum, s) => sum + s.quantity, 0);
        const sales = salesByAsin[asin] || {};
        const lookback = (salesLookback && salesLookback[asin]) || sales;
        const sold = (Number(lookback.unitsSold) || 0) > 0 || (Number(lookback.sales) || 0) > 0;
        if (fbaUnits + ownUnits <= 0 && !sold) continue;

        const status = unique(entry.statuses).join(', ') || 'Suppressed';
        const reason = unique(entry.reasons).join('; ') || 'Amazon did not give a reason in the report';
        // The SKU is still worth a task, but the product is only unbuyable (for the
        // ads rule) when no other active SKU of it has stock.
        if (buyableUnits(skus, new Set(entry.skus)) <= 0) asins.set(asin, 'the listing is suppressed');
        tasks.push({
            asin,
            productName: productNameOf(productsByAsin, asin),
            errorCategory: 'inventory',
            errorType: 'listing_suppressed',
            // "Search Suppressed" hides the listing from search (shoppers can still reach it
            // by direct link); the other statuses stop it selling at all.
            error: entry.statuses.every(s => /search\s*suppressed/i.test(s))
                ? `Listing Blocked | ${status}: Amazon is hiding this product from search results, so shoppers cannot find it, because: ${reason}.`
                : `Listing Blocked | ${status}: This product cannot be bought on Amazon right now because: ${reason}.`,
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
function detectOutOfStock({ stock, salesByAsin = {}, financeFresh, windowDays, catalogue = new Map(), productsByAsin = new Map(), now }) {
    if (!stock || ageDays(stock.fetchedAt, now) > R.FBA_STOCK_MAX_AGE_DAYS || !financeFresh) {
        return { tasks: [], covered: false, asins: new Map() };
    }

    const days = windowDays > 0 ? windowDays : 30;
    const tasks = [];
    const asins = new Map();
    for (const [asin, s] of Object.entries(stock.byAsin || {})) {
        if (s.fulfillable > 0 || s.inbound > 0) continue;
        // Not in the catalogue at all: a closed or deleted listing, where "send stock" is the wrong advice.
        if (!catalogue.has(asin)) continue;
        // Still buyable through another active SKU (typically one the seller ships themselves).
        if (buyableUnits(catalogue.get(asin)) > 0) continue;
        const units = Number(salesByAsin[asin]?.unitsSold) || 0;
        const sales = Number(salesByAsin[asin]?.sales) || 0;
        if (units <= 0) continue;

        const unitsPerDay = units / days;
        const salesPerDay = sales / days;
        const pace = unitsPerDay >= 1
            ? `, so it is losing about ${Math.round(unitsPerDay)} ${Math.round(unitsPerDay) === 1 ? 'sale' : 'sales'} a day`
            : unitsPerDay >= 1 / 7
                ? `, so it is losing about ${Math.round(unitsPerDay * 7)} ${Math.round(unitsPerDay * 7) === 1 ? 'sale' : 'sales'} a week`
                : '';
        asins.set(asin, 'it is out of stock');
        tasks.push({
            asin,
            productName: productNameOf(productsByAsin, asin),
            errorCategory: 'inventory',
            errorType: 'out_of_stock',
            error: `Out of Stock: This product has no sellable units in Amazon's warehouses, nothing on the way, and no other active listing with stock. It sold ${units} ${units === 1 ? 'unit' : 'units'} in the last ${days} days${pace}.`,
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
 * Spreadsheet: score down 20+ points in 7 days, or below 250 (an internal buffer).
 * Below 200 is At Risk, which the account-status task already reports.
 *
 * The floor rule fires only when the score CROSSED below 250 inside the window:
 * 200 is where most accounts rest (on 24 Oct 2026, 56 of 81 fresh marketplaces
 * sat at 200-249, one at exactly 200 every day for a month), so "below 250" as
 * a level would warn most sellers permanently about nothing that changed. A
 * report without a score is never judged.
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
    const nearFloor = newest.score >= 200 && newest.score < R.AHR_WARNING_FLOOR
        && !!baseline && baseline.score >= R.AHR_WARNING_FLOOR;
    if (!dropped && !nearFloor) return { tasks: [], covered: true };

    const days = baseline ? Math.max(1, Math.round((newestAt - Date.parse(baseline.at)) / R.DAY_MS)) : 0;
    const parts = [];
    if (dropped) parts.push(`Your Account Health Rating dropped ${Math.round(drop)} points in the last ${days} ${days === 1 ? 'day' : 'days'}, from ${baseline.score} to ${newest.score}.`);
    if (nearFloor) parts.push(`It fell below ${R.AHR_WARNING_FLOOR} this week and at ${newest.score} is close to Amazon's At Risk cutoff of 200.`);

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
 * Spreadsheet: part of a removal order did not arrive back; "Client action to
 * confirm what was received". Amazon's report cannot show this — units lost by
 * the carrier still count as shipped, and on 24 Oct 2026 none of 8,913 removal
 * lines was short — so the seller is asked:
 *
 *   inventory:removal_confirm_receipt  one task per marketplace while any Return
 *                                      order line shipped back in the claim window
 *                                      has no answer yet (kpi/RemovalReceipts.js)
 *   inventory:removal_shortfall        per product, where the seller received fewer
 *                                      units than Amazon shipped, less any units
 *                                      Amazon already reimbursed against the order
 *                                      (`reimbursements`, keyed order id then SKU)
 *
 * `receipts` are the seller's answers (RemovalReceipt documents); null when they
 * could not be read, which leaves the whole rule uncovered.
 */
function detectRemovalShortfall({ removals, receipts = null, reimbursements = null, products = [], productsByAsin = new Map(), now }) {
    if (!removals || ageDays(removals.createdAt, now) > R.REMOVAL_REPORT_MAX_AGE_DAYS || !Array.isArray(receipts)) {
        return { tasks: [], covered: false };
    }
    const confirmed = receiptsByKey(receipts);
    const tasks = [];

    const awaiting = linesAwaitingConfirmation(removals.lines, confirmed, now);
    if (awaiting.length > 0) {
        const orders = unique(awaiting.map(l => l.orderId));
        const units = awaiting.reduce((sum, l) => sum + l.shippedQuantity, 0);
        tasks.push({
            asin: 'REMOVALS',
            productName: 'Removal orders',
            errorCategory: 'inventory',
            errorType: 'removal_confirm_receipt',
            error: `Removal Orders | Confirm What Arrived: Amazon says it shipped ${units} ${units === 1 ? 'unit' : 'units'} back to you on ${orders.length} removal ${orders.length === 1 ? 'order' : 'orders'} in the last ${R.REMOVAL_CLAIM_WINDOW_DAYS} days. Amazon's report cannot show units lost on the way, so tell us how many actually arrived.`,
            solution: `Click "Confirm what arrived" and enter the units you received for each order. If any are missing, a task to claim them from Amazon will appear here, inside the ${R.REMOVAL_CLAIM_WINDOW_DAYS}-day claim window.`,
            renderData: { orders: orders.length, lines: awaiting.length, units },
            status: PENDING
        });
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

    const byEntity = new Map();
    for (const line of removals.lines || []) {
        // Only answered lines still inside the claim window can become a claim.
        if (!isReturnShippedLine(line, now)) continue;
        const receipt = confirmed.get(receiptKey(line.orderId, line.sku));
        if (!receipt) continue;
        const received = Math.max(0, Number(receipt.receivedQuantity) || 0);
        const short = line.shippedQuantity - received;
        if (short <= 0) continue;
        const reimbursed = takeReimbursed(line.orderId, line.sku, short);
        const missing = short - reimbursed;
        if (missing <= 0) continue;

        const asin = asinBySku.get(line.sku) || null;
        // The task's identity: the ASIN when the SKU is in the catalogue, else the SKU.
        const key = asin || `SKU:${line.sku}`.substring(0, 100);
        const entry = byEntity.get(key) || { asin, sku: line.sku, units: 0, orders: [] };
        entry.units += missing;
        entry.orders.push({
            orderId: line.orderId,
            sku: line.sku,
            shipped: line.shippedQuantity,
            received,
            reimbursed,
            missing
        });
        byEntity.set(key, entry);
    }

    for (const [key, entry] of byEntity) {
        const ids = unique(entry.orders.map(o => o.orderId));
        const o = entry.orders[0];
        const headline = entry.orders.length === 1
            ? `You received ${o.received} of the ${o.shipped} units Amazon shipped back to you on removal order ${o.orderId}${o.reimbursed ? `, and Amazon has reimbursed ${o.reimbursed}` : ''}, so ${o.missing} ${o.missing === 1 ? 'unit is' : 'units are'} still missing.`
            : `${entry.units} units Amazon shipped back to you on removal orders ${ids.join(', ')} did not arrive and have not been reimbursed.`;
        tasks.push({
            asin: key,
            productName: entry.asin ? productNameOf(productsByAsin, entry.asin) : `SKU ${entry.sku}`.substring(0, 100),
            errorCategory: 'inventory',
            errorType: 'removal_shortfall',
            error: `Removal Order Shortfall: ${headline}`,
            solution: `Open a case with Seller Support (Fulfillment by Amazon > Removal orders) with the order ID, the units you received and any delivery photos, and ask Amazon to reimburse the missing units. Claims are accepted for about ${R.REMOVAL_CLAIM_WINDOW_DAYS} days after the order.`,
            renderData: { units: entry.units, orders: entry.orders.slice(0, 20), sku: entry.sku },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

module.exports = {
    catalogueByAsin,
    buyableUnits,
    topRevenueAsins,
    detectListingSuppressed,
    detectOutOfStock,
    detectAdsOnUnbuyable,
    detectCogsMissing,
    detectAhrEarlyWarning,
    detectRemovalShortfall
};
