/**
 * Wave 2 of the tasks-logics.xlsx tasks: trends and coverage.
 *
 *   conversion:sales_drop                 Sales drop
 *   conversion:conversion_rate_drop       Conversion rate drop
 *   conversion:traffic_drop               Traffic drop
 *   sponsoredAds:tacos_rising             TACoS
 *   sponsoredAds:top_seller_not_advertised Top seller not advertised
 *   conversion:rating_drop                Rating drop
 *   conversion:insufficient_reviews       Number of reviews (an existing, retired type
 *                                         whose weights and copy are reused)
 *   inventory:weeks_of_cover              Weeks of cover
 *
 * Same contract as Wave1Detectors: pure, `now` injected, `{ tasks, covered }`, and
 * covered only when the input arrived fresh enough to judge.
 */

const { rowDay, shiftDay, newestRowDay, isAdsDataStale } = require('../AdsSignals.js');
const R = require('./KpiRules.js');

const PENDING = 'pending';
const pct1 = (n) => `${Math.round(n * 10) / 10}%`;
const dayAge = (yyyyMmDd, now) => {
    const t = Date.parse(`${String(yyyyMmDd || '').slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(t) ? (now.getTime() - t) / R.DAY_MS : Infinity;
};
const ageDays = (iso, now) => {
    const t = Date.parse(iso || '');
    return Number.isFinite(t) ? (now.getTime() - t) / R.DAY_MS : Infinity;
};
const nameOf = (productsByAsin, asin) => {
    const p = productsByAsin.get(asin);
    return (p?.itemName || p?.title || p?.productName || asin || 'Unknown Product').substring(0, 100);
};

/** Whether the per-ASIN traffic input can be judged at all. */
function trafficUsable(traffic, now) {
    return !!traffic && dayAge(traffic.newestDate, now) <= R.TRAFFIC_MAX_AGE_DAYS;
}

/**
 * Sales drop. Spreadsheet: units in the last 7 days down 30%+ against the average
 * 7-day units of the prior 28 days; baseline 20+ units a week; skipped where out of
 * stock, suppressed or without the Buy Box already explains it.
 */
function detectSalesDrop({ traffic, skipAsins = new Map(), productsByAsin = new Map(), now }) {
    if (!trafficUsable(traffic, now) || traffic.recent7Days < R.SALES_RECENT_DAYS - 1
        || traffic.prior28Days < R.SALES_BASELINE_DAYS - 3) {
        return { tasks: [], covered: false };
    }
    const tasks = [];
    for (const [asin, t] of Object.entries(traffic.byAsin || {})) {
        if (skipAsins.has(asin)) continue;
        const baselineWeek = (t.u28 / traffic.prior28Days) * 7;
        if (baselineWeek < R.SALES_MIN_BASELINE_UNITS_WEEK) continue;
        const recentWeek = (t.u7 / traffic.recent7Days) * 7;
        const drop = 1 - recentWeek / baselineWeek;
        if (drop < R.SALES_DROP_SHARE) continue;
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'conversion',
            errorType: 'sales_drop',
            error: `Sales Drop: Sales of this product fell ${Math.round(drop * 100)}% this week compared with its recent average (${Math.round(recentWeek)} units in the last 7 days against about ${Math.round(baselineWeek)} a week before).`,
            solution: 'Check what changed: price, Buy Box, reviews, listing edits, ad spend and competitor offers. Fix the cause before the lower sales rate hurts organic rank.',
            renderData: { dropPct: Math.round(drop * 100), recentWeekUnits: Math.round(recentWeek), baselineWeekUnits: Math.round(baselineWeek) },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/** Recent-vs-baseline windows the conversion and traffic rules share. */
function trendWindows(traffic, now) {
    if (!trafficUsable(traffic, now)) return null;
    if (traffic.recent14Days < R.TRAFFIC_RECENT_DAYS - 2 || traffic.baselineDays < R.TRAFFIC_MIN_BASELINE_DAYS) return null;
    return { recentDays: traffic.recent14Days, baselineDays: traffic.baselineDays };
}

const baselineText = (days) => (days >= R.TRAFFIC_BASELINE_DAYS ? `the ${R.TRAFFIC_BASELINE_DAYS} days before` : `the ${days} days of history before`);

/**
 * Conversion rate drop. Spreadsheet: conversion in the last 14 days down 25%+
 * (relative) against the prior 60 days; 200+ sessions in the 14 days. Conversion is
 * units over sessions, summed over each window.
 */
function detectConversionRateDrop({ traffic, skipAsins = new Map(), productsByAsin = new Map(), now }) {
    const w = trendWindows(traffic, now);
    if (!w) return { tasks: [], covered: false };
    const tasks = [];
    for (const [asin, t] of Object.entries(traffic.byAsin || {})) {
        if (skipAsins.has(asin) || t.rs < R.CVR_MIN_RECENT_SESSIONS || t.bs <= 0) continue;
        const recent = t.ru / t.rs;
        const base = t.bu / t.bs;
        if (!(base > 0)) continue;
        const drop = 1 - recent / base;
        if (drop < R.CVR_DROP_SHARE) continue;
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'conversion',
            errorType: 'conversion_rate_drop',
            error: `Conversion Rate Drop: Fewer visitors are buying this product. Conversion fell from ${pct1(base * 100)} to ${pct1(recent * 100)} (last ${w.recentDays} days against ${baselineText(w.baselineDays)}).`,
            solution: 'Look for what changed on the page: price against competitors, main image, recent low reviews, a lost Buy Box or a listing edit. Fix the change that matches the timing.',
            renderData: { recentCvr: Math.round(recent * 1000) / 10, baselineCvr: Math.round(base * 1000) / 10, recentSessions: t.rs, baselineDays: w.baselineDays },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * Traffic drop. Spreadsheet: sessions in the last 14 days down 30%+ against the
 * prior 60-day daily average; baseline 300+ sessions per 14 days.
 */
function detectTrafficDrop({ traffic, skipAsins = new Map(), productsByAsin = new Map(), now }) {
    const w = trendWindows(traffic, now);
    if (!w) return { tasks: [], covered: false };
    const tasks = [];
    for (const [asin, t] of Object.entries(traffic.byAsin || {})) {
        if (skipAsins.has(asin)) continue;
        const baseDaily = t.bs / w.baselineDays;
        if (baseDaily * 14 < R.TRAFFIC_MIN_BASELINE_SESSIONS_14D) continue;
        const recentDaily = t.rs / w.recentDays;
        const drop = 1 - recentDaily / baseDaily;
        if (drop < R.TRAFFIC_DROP_SHARE) continue;
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'conversion',
            errorType: 'traffic_drop',
            error: `Traffic Drop: Visits to this product page fell ${Math.round(drop * 100)}% in the last ${w.recentDays} days (about ${Math.round(recentDaily)} a day against ${Math.round(baseDaily)} in ${baselineText(w.baselineDays)}).`,
            solution: 'Check whether search ranking dropped, ad spend or bids changed, the listing was suppressed or lost the Buy Box, or this is a seasonal dip.',
            renderData: { dropPct: Math.round(drop * 100), recentDailySessions: Math.round(recentDaily), baselineDailySessions: Math.round(baseDaily), baselineDays: w.baselineDays },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * TACoS rising. Spreadsheet: 30-day TACoS up 3+ points against the prior 30 days
 * while total sales moved less than 5%; $1,000+ sales in 30 days. Account level.
 */
function detectTacosRising({ tacos, now }) {
    if (!tacos || dayAge(tacos.newestDate, now) > 7) return { tasks: [], covered: false };
    const end = tacos.newestDate;
    const recentFrom = shiftDay(end, -(R.TACOS_WINDOW_DAYS - 1));
    const priorFrom = shiftDay(recentFrom, -R.TACOS_WINDOW_DAYS);
    const sum = (byDay, from, to) => {
        let total = 0;
        let days = 0;
        for (const [day, v] of Object.entries(byDay || {})) {
            if (day >= from && day <= to) { total += Number(v) || 0; days += 1; }
        }
        return { total, days };
    };
    const priorTo = shiftDay(recentFrom, -1);
    const salesRecent = sum(tacos.salesByDay, recentFrom, end);
    const salesPrior = sum(tacos.salesByDay, priorFrom, priorTo);
    const spendRecent = sum(tacos.spendByDay, recentFrom, end);
    const spendPrior = sum(tacos.spendByDay, priorFrom, priorTo);
    if ([salesRecent, salesPrior, spendRecent, spendPrior].some(w => w.days < R.TACOS_MIN_DAYS_PER_WINDOW)) {
        return { tasks: [], covered: false };
    }
    if (salesRecent.total < R.TACOS_MIN_SALES || salesPrior.total <= 0) return { tasks: [], covered: true };

    // Rounded before comparing: summed daily figures land a hair under exact
    // thresholds (a 3.00-point rise read as 2.9999...).
    const round2 = (n) => Math.round(n * 100) / 100;
    const tacosRecent = round2((spendRecent.total / salesRecent.total) * 100);
    const tacosPrior = round2((spendPrior.total / salesPrior.total) * 100);
    const salesMove = round2(Math.abs(salesRecent.total / salesPrior.total - 1) * 100) / 100;
    if (round2(tacosRecent - tacosPrior) < R.TACOS_RISE_POINTS || salesMove >= R.TACOS_SALES_FLAT_SHARE) return { tasks: [], covered: true };

    return {
        tasks: [{
            asin: 'ACCOUNT',
            productName: 'Advertising',
            errorCategory: 'sponsoredAds',
            errorType: 'tacos_rising',
            error: `PPC | TACoS Rising: You are spending more on ads for the same total sales. TACoS rose from ${pct1(tacosPrior)} to ${pct1(tacosRecent)} over the last 30 days while total sales moved only ${pct1(salesMove * 100)}.`,
            solution: 'Review campaigns that grew spend without growing sales, cut bids on low-converting targets, and check whether organic rank slipped so ads are covering for it.',
            amount: Math.round(Math.max(0, spendRecent.total - (tacosPrior / 100) * salesRecent.total) * 100) / 100,
            amountIsEstimated: true,
            renderData: { tacosRecent: Math.round(tacosRecent * 10) / 10, tacosPrior: Math.round(tacosPrior * 10) / 10, salesMovePct: Math.round(salesMove * 1000) / 10 },
            status: PENDING
        }],
        covered: true
    };
}

/**
 * Top seller not advertised. Spreadsheet: ASIN in the top 20% of revenue with no
 * active ads for 14 days; must be in stock and buyable. Only judged on an account
 * whose ads data is current and reaches back 14 days, so "no rows" means "no ads".
 */
function detectTopSellerNotAdvertised({ adsRows, topAsins = new Set(), buyable = () => false, country, productsByAsin = new Map(), salesByAsin = {}, now }) {
    const newest = newestRowDay(adsRows || []);
    if (!Array.isArray(adsRows) || adsRows.length === 0 || isAdsDataStale(newest, country, now)) {
        return { tasks: [], covered: false };
    }
    const from = shiftDay(newest, -(R.TOP_SELLER_NO_ADS_DAYS - 1));
    let oldest = null;
    const advertised = new Set();
    for (const row of adsRows) {
        const day = rowDay(row);
        if (!day) continue;
        if (!oldest || day < oldest) oldest = day;
        if (day >= from && row.asin && ((Number(row.spend) || 0) > 0 || (Number(row.impressions) || 0) > 0)) advertised.add(row.asin);
    }
    if (!oldest || oldest > from) return { tasks: [], covered: false };

    const tasks = [];
    for (const asin of topAsins) {
        if (advertised.has(asin) || !buyable(asin)) continue;
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'sponsoredAds',
            errorType: 'top_seller_not_advertised',
            error: `PPC | Top Seller Not Advertised: This is one of your best-selling products, but it has had no active ads for the last ${R.TOP_SELLER_NO_ADS_DAYS} days.`,
            solution: 'Launch a Sponsored Products campaign for it (start with an automatic campaign to find converting search terms) to protect and grow its sales against competitors bidding on its searches.',
            renderData: { sales: Math.round((Number(salesByAsin[asin]?.sales) || 0) * 100) / 100 },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * Rating drop. Spreadsheet: rating down 0.2+ within 30 days; 20+ ratings. Compares
 * the newest weekly scrape with the one closest to 30 days before it.
 */
function detectRatingDrop({ reviews, productsByAsin = new Map(), now }) {
    if (!reviews?.newest || !reviews.older || ageDays(reviews.newest.at, now) > R.REVIEW_SCRAPE_MAX_AGE_DAYS) {
        return { tasks: [], covered: false };
    }
    const tasks = [];
    for (const [asin, cur] of Object.entries(reviews.newest.byAsin || {})) {
        const old = reviews.older.byAsin?.[asin];
        if (!old || !(cur.count >= R.RATING_MIN_COUNT) || !(cur.rating > 0) || !(old.rating > 0)) continue;
        const drop = Math.round((old.rating - cur.rating) * 100) / 100;
        if (drop < R.RATING_DROP) continue;
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'conversion',
            errorType: 'rating_drop',
            error: `Rating Drop: This product's rating dropped from ${old.rating} to ${cur.rating} in the last month (${cur.count} ratings).`,
            solution: 'Read the recent 1- and 2-star reviews for a common complaint and fix it, whether that is the listing, the packaging or the product. A rating under 4 stars drops it out of the "4 stars & up" filter.',
            renderData: { oldRating: old.rating, newRating: cur.rating, ratings: cur.count },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * Number of reviews. Spreadsheet: under 50 reviews (P4). Active catalogue products
 * only. Stored under the retired `insufficient_reviews` type, whose effort, weight
 * and dashboard copy already exist.
 */
function detectLowReviewCount({ reviews, activeAsins = new Set(), productsByAsin = new Map(), now }) {
    if (!reviews?.newest || ageDays(reviews.newest.at, now) > R.REVIEW_SCRAPE_MAX_AGE_DAYS) {
        return { tasks: [], covered: false };
    }
    const tasks = [];
    for (const [asin, cur] of Object.entries(reviews.newest.byAsin || {})) {
        if (!activeAsins.has(asin) || !Number.isFinite(cur.count) || cur.count >= R.LOW_REVIEW_COUNT) continue;
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'conversion',
            errorType: 'insufficient_reviews',
            error: `Low Review Count: This product has ${cur.count} ${cur.count === 1 ? 'review' : 'reviews'}. More reviews build trust and help shoppers decide.`,
            solution: 'Use SellerQI review requests on every eligible order, and make sure the product and packaging give buyers a reason to leave a good review.',
            renderData: { ratings: cur.count },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * Weeks of cover. Spreadsheet: weeks of cover over 26 and stock value over $200;
 * sold at least 1 unit (zero sellers belong to the aged-inventory rule). Per ASIN
 * over its SKUs, from Amazon's restock report.
 */
function detectWeeksOfCover({ restock, productsByAsin = new Map() }) {
    if (!restock) return { tasks: [], covered: false };
    const byAsin = new Map();
    for (const row of restock.rows || []) {
        if (!row.asin) continue;
        const e = byAsin.get(row.asin) || { units: 0, sold30: 0, price: 0 };
        e.units += row.available + row.inbound;
        e.sold30 += row.unitsSold30;
        e.price = Math.max(e.price, row.price);
        byAsin.set(row.asin, e);
    }
    const tasks = [];
    for (const [asin, e] of byAsin) {
        if (e.sold30 <= 0 || e.units <= 0) continue;
        const perWeek = (e.sold30 / 30) * 7;
        const weeks = e.units / perWeek;
        const value = e.units * e.price;
        if (weeks <= R.WEEKS_OF_COVER_MAX || value <= R.WEEKS_OF_COVER_MIN_VALUE) continue;
        const excessUnits = Math.max(0, Math.round(e.units - perWeek * R.WEEKS_OF_COVER_TARGET));
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'inventory',
            errorType: 'weeks_of_cover',
            error: `Excess Stock: You hold about ${Math.round(weeks)} weeks of stock for this product (${e.units} units against ${Math.round(perWeek * 10) / 10} sold a week), far more than needed.`,
            solution: `Pause new shipments and use a coupon, deal or price drop to bring stock closer to 8-12 weeks of sales (about ${excessUnits} units too many). Removal is the last resort before aged-inventory surcharges start at 181 days.`,
            // Capital tied up above a 12-week holding: stock value, not monthly profit.
            capitalAmount: Math.round(excessUnits * e.price * 100) / 100,
            amountIsEstimated: true,
            renderData: { weeks: Math.round(weeks), units: e.units, unitsPerWeek: Math.round(perWeek * 10) / 10, excessUnits },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/** Value at share p (0..1) of a sorted ascending list. */
const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];

/**
 * High traffic / low conversion and low traffic / high conversion, judged against
 * this account's own products over the last 30 days. One pass, two results.
 * Products that out of stock, suppression or a lost Buy Box already explain are
 * skipped, as for the other trend tasks.
 */
function detectTrafficMix({ traffic, skipAsins = new Map(), productsByAsin = new Map(), now }) {
    const none = { tasks: [], covered: false };
    if (!trafficUsable(traffic, now) || !(traffic.recent30Days >= R.TRAFFIC_MIX_MIN_DAYS)) return { high: none, low: none };

    const rows = Object.entries(traffic.byAsin || {})
        .map(([asin, t]) => ({ asin, sessions: Number(t.s30) || 0, units: Number(t.u30) || 0, orders: Number(t.o30) || 0 }))
        .filter(r => r.sessions > 0)
        .map(r => ({ ...r, cvr: (r.units / r.sessions) * 100 }));
    if (rows.length < R.TRAFFIC_MIX_MIN_ASINS) return { high: { tasks: [], covered: true }, low: { tasks: [], covered: true } };

    const sessionsSorted = rows.map(r => r.sessions).sort((a, b) => a - b);
    const cvrSorted = rows.map(r => r.cvr).sort((a, b) => a - b);
    const topCut = quantile(sessionsSorted, 1 - R.TRAFFIC_MIX_TOP_SHARE);
    const bottomCut = quantile(sessionsSorted, R.TRAFFIC_MIX_TOP_SHARE);
    const mid = Math.floor(cvrSorted.length / 2);
    const medianCvr = cvrSorted.length % 2 ? cvrSorted[mid] : (cvrSorted[mid - 1] + cvrSorted[mid]) / 2;
    const days = traffic.recent30Days;

    const high = [];
    const low = [];
    for (const r of rows) {
        if (skipAsins.has(r.asin)) continue;
        const base = {
            asin: r.asin,
            productName: nameOf(productsByAsin, r.asin),
            errorCategory: 'conversion',
            renderData: { sessions: r.sessions, units: r.units, orders: r.orders, cvrPct: Math.round(r.cvr * 10) / 10, medianCvrPct: Math.round(medianCvr * 10) / 10, days },
            status: PENDING
        };
        if (r.sessions >= R.HIGH_TRAFFIC_MIN_SESSIONS && r.sessions >= topCut && medianCvr > 0 && r.cvr < medianCvr * R.HIGH_TRAFFIC_CVR_RATIO) {
            high.push({
                ...base,
                errorType: 'high_traffic_low_conversion',
                error: `High Traffic, Low Conversion: This product gets plenty of visits (${r.sessions.toLocaleString('en-US')} in the last ${days} days, among your top 30%) but converts at only ${pct1(r.cvr)}, under half your account's typical ${pct1(medianCvr)}.`,
                solution: 'Improve images, price position and A+ content to turn more visits into sales.'
            });
        } else if (r.orders >= R.LOW_TRAFFIC_MIN_ORDERS && r.sessions <= bottomCut && medianCvr > 0 && r.cvr >= medianCvr * R.LOW_TRAFFIC_CVR_RATIO) {
            low.push({
                ...base,
                errorType: 'low_traffic_high_conversion',
                error: `Low Traffic, High Conversion: This product converts well (${pct1(r.cvr)}, against your account's typical ${pct1(medianCvr)}) but gets few visitors (${r.sessions.toLocaleString('en-US')} in the last ${days} days, among your bottom 30%).`,
                solution: 'Send more traffic to it through ads and better keywords.'
            });
        }
    }
    return { high: { tasks: high, covered: true }, low: { tasks: low, covered: true } };
}

module.exports = {
    detectSalesDrop,
    detectTrafficMix,
    detectConversionRateDrop,
    detectTrafficDrop,
    detectTacosRising,
    detectTopSellerNotAdvertised,
    detectRatingDrop,
    detectLowReviewCount,
    detectWeeksOfCover
};
