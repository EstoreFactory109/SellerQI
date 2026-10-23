/**
 * MarketplaceComparisonService — the Dashboard's "All marketplaces" view.
 *
 * Shows every connected marketplace SIDE BY SIDE, each in its own currency. Nothing is converted
 * or added up across marketplaces: sellers are paid, report and reconcile per marketplace, so a
 * blended total in one currency would be an estimate on a moving rate that matches nothing they
 * can check in Seller Central.
 *
 * ── HOW ──
 *   1. buildMarketplaceSnapshot: for each marketplace, the same sources its single Dashboard uses
 *      (phase 1/2 summary, PPC KPI summary, wasted spend, reimbursements, finance P&L + COGS,
 *      top opportunities), reduced to native-currency numbers and cached per marketplace.
 *   2. toComparisonRow (pure): turns a snapshot into the table's metrics, with every ratio
 *      (margin, ACoS, TACoS, ROAS, CTR, CPC) computed from that marketplace's own figures.
 *   3. An optional "≈ hint" rate per marketplace (FxService, latest ECB rate) lets the page show a
 *      faint "≈ $1,234" beside money figures so they can be compared by eye. The hint is never
 *      summed or used as the figure itself, and is simply absent when no rate is available.
 *
 * Each marketplace keeps its own default date window (as its single Dashboard does) unless the
 * caller passes a custom range, which then applies to all.
 */
const logger = require('../../utils/Logger.js');
const { getCurrencyCode } = require('../../utils/marketplaceCurrency.js');
const { listOwnedMarketplaces } = require('../../utils/marketplaceAccess.js');
const FxService = require('../Finance/FxService.js');
const {
    computeDashboardPieSlices,
    computeDailyGrossProfit,
    computeTotalCogsFromAsinWise,
} = require('../../shared/financeCalculations.js');

const SNAPSHOT_TTL_SECONDS = 60 * 60;
const COMPARISON_TTL_SECONDS = 15 * 60;
const MAX_PARALLEL_MARKETPLACES = 3;

const tryGetRedis = () => {
    try {
        const { getRedisClient } = require('../../config/redisConn.js');
        return getRedisClient();
    } catch (_) {
        return null;
    }
};

const cacheGet = async (key) => {
    const redis = tryGetRedis();
    if (!redis) return null;
    try {
        const raw = await redis.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
};

const cacheSet = async (key, ttl, value) => {
    const redis = tryGetRedis();
    if (!redis) return;
    try { await redis.setEx(key, ttl, JSON.stringify(value)); } catch (_) { /* fail open */ }
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Runs async tasks with at most `limit` in flight; never rejects. */
const mapLimited = async (items, limit, fn) => {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            try {
                results[i] = { ok: true, value: await fn(items[i], i) };
            } catch (error) {
                results[i] = { ok: false, error };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
};

/** Value of a settled promise, or `fallback` (and the failure noted) when it rejected. */
const settledValue = (result, fallback, label, failures) => {
    if (result.status === 'fulfilled') return result.value;
    failures.push(label);
    logger.warn(`[MarketplaceComparison] ${label} failed: ${result.reason?.message || result.reason}`);
    return fallback;
};

/**
 * The single Dashboard's "money Amazon owes you": every shipment discrepancy (all time) plus
 * lost/damaged/disposed items dated in the last 30 days (undated items count). Mirrors the
 * expectedReimbursement block in Dashboard.jsx — but over ALL rows, where the page only had the
 * first 20 per category.
 */
const isWithinLast30Days = (dateValue, now = new Date()) => {
    if (!dateValue || dateValue === 'N/A' || dateValue === '') return true;
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const mmYYYY = String(dateValue).match(/^(\d{1,2})\/(\d{4})$/);
    if (mmYYYY) {
        const month = parseInt(mmYYYY[1], 10);
        const year = parseInt(mmYYYY[2], 10);
        const first = new Date(year, month - 1, 1);
        const last = new Date(year, month, 0);
        return last >= thirtyDaysAgo && first <= now;
    }
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return true;
    return d >= thirtyDaysAgo && d <= now;
};

const sumRecent = (result, now) => (result?.data || [])
    .filter((item) => (item.expectedAmount || 0) > 0 && isWithinLast30Days(item.date, now))
    .reduce((sum, item) => sum + (item.expectedAmount || 0), 0);

const getExpectedReimbursements = async (userId, country, region, now = new Date()) => {
    const R = require('./Reimbursement.js');
    const [shipment, lost, damaged, disposed] = await Promise.all([
        R.calculateShipmentDiscrepancy(userId, country, region),
        R.calculateLostInventoryReimbursement(userId, country, region),
        R.calculateDamagedInventoryReimbursement(userId, country, region),
        R.calculateDisposedInventoryReimbursement(userId, country, region),
    ]);
    const parts = {
        shipment: num(shipment?.totalReimbursement),
        lost: sumRecent(lost, now),
        damaged: sumRecent(damaged, now),
        disposed: sumRecent(disposed, now),
    };
    return { ...parts, total: parts.shipment + parts.lost + parts.damaged + parts.disposed };
};

/**
 * Product costs (COGS) that belong to THIS marketplace, and only this one.
 *
 * COGS rows are saved under a key that is either the marketplace's country ('UK') or its currency
 * code ('GBP') — the write and read paths historically disagree (see CogsService.getCogs). Both
 * keys identify a marketplace, so both are accepted; a COGS document saved for another currency is
 * never used. FinanceEngine.fetchCogsForUser falls back to ANY of the user's documents when this
 * marketplace has none, which would subtract US-dollar costs from GBP sales — wrong on a page whose
 * whole point is that each marketplace's figures are its own.
 *
 * @returns {Promise<{ entries: Array<{asin:string, sku:?string, cogs:number}> }>}
 */
const loadMarketplaceCogs = async (userId, country) => {
    const Cogs = require('../../models/finance/CogsModel.js');
    const keys = [...new Set([String(country).toUpperCase(), getCurrencyCode(country)])];
    const doc = await Cogs.findOne({ userId, $or: [{ country: { $in: keys } }, { countryCode: { $in: keys } }] })
        .select('cogsEntries')
        .lean();
    const entries = (doc?.cogsEntries || []).map((e) => ({ asin: e.asin, sku: e.sku || null, cogs: num(e.cogs) }));
    return { entries };
};

/** Finance P&L for the window, reduced to the Dashboard's pie slices (native currency). */
const getFinanceSlices = async (userId, country, region, window) => {
    if (!window?.startDate || !window?.endDate) return { hasFinanceData: false };
    const FinanceRead = require('../Finance/FinanceDashboardReadService.js');
    const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
    const ctx = { userId, country, region, startDate: window.startDate, endDate: window.endDate };

    const [totals, asinWise, overheadResult, cogs, ppc, dailySku, dailyOverhead] = await Promise.all([
        FinanceRead.getTotals(ctx),
        FinanceRead.getAsinWisePL(ctx),
        FinanceRead.getOverhead(ctx),
        loadMarketplaceCogs(userId, country),
        PPCMetrics.calculateMetricsForDateRange(userId, country, region, window.startDate, window.endDate).catch(() => null),
        FinanceRead.getDailyAsinTotals(ctx),
        FinanceRead.getDailyOverheadRows(ctx),
    ]);

    const hasFinanceData = Boolean(totals) && num(totals.productSales) !== 0;
    // Same order as TotalSales.jsx: PPC daily spend in the window, else the finance adsSpend.
    const ppcSpend = num(ppc?.summary?.totalSpend) > 0 ? num(ppc.summary.totalSpend) : num(totals?.adsSpend);
    const overhead = overheadResult?.items || overheadResult || [];
    const totalCogs = computeTotalCogsFromAsinWise(asinWise || [], { entries: cogs?.entries || [] });

    const costedAsins = new Set((cogs?.entries || []).filter((e) => num(e.cogs) > 0).map((e) => e.asin));
    const soldAsins = new Set((asinWise || []).map((r) => r?.asin).filter(Boolean));

    // Day-by-day sales and gross profit for the chart, from the same sources and formulas as the
    // headline. The headline falls back to the finance `adsSpend` when PPC has no spend in the
    // window, and that figure has no per-day breakdown — so in that case there is no honest daily
    // profit, and the daily series is withheld rather than shown overstated.
    const adSpendFromPpc = num(ppc?.summary?.totalSpend) > 0;
    const adSpendByDate = {};
    if (adSpendFromPpc) {
        for (const d of ppc.dateWiseMetrics || []) adSpendByDate[d.date] = (adSpendByDate[d.date] || 0) + num(d.spend);
    }
    const cogsByAsin = Object.fromEntries((cogs?.entries || []).map((e) => [e.asin, num(e.cogs)]));
    const dailyAvailable = hasFinanceData && (adSpendFromPpc || num(totals?.adsSpend) === 0);
    const daily = dailyAvailable
        ? computeDailyGrossProfit({ skuRows: dailySku || [], overheadRows: dailyOverhead || [], adSpendByDate, cogsByAsin })
        : [];

    return {
        hasFinanceData,
        window,
        daily,
        dailyUnavailable: hasFinanceData && !dailyAvailable ? 'ad_spend_not_daily' : null,
        ...computeDashboardPieSlices(totals, overhead, totalCogs, ppcSpend),
        cogsCoverage: {
            productsWithCogs: [...soldAsins].filter((a) => costedAsins.has(a)).length,
            productsSold: soldAsins.size,
        },
    };
};

const rangeKeyOf = (range) => (range?.startDate && range?.endDate ? `${range.startDate}_${range.endDate}` : 'default');

/**
 * Everything the Dashboard shows for one marketplace, in its own currency. One failing source
 * doesn't sink the rest: its figures read as empty and its name goes into `failedSources`.
 */
const buildMarketplaceSnapshot = async (userId, country, region, range = null, { useCache = true } = {}) => {
    // `:v2` — snapshots now carry daily series; older cached ones must not be served.
    const cacheKey = `dash_snapshot:${userId}:${country}:${region}:${rangeKeyOf(range)}:v2`;
    if (useCache) {
        const hit = await cacheGet(cacheKey);
        if (hit) return hit;
    }

    const startedAt = Date.now();
    const DashboardSummary = require('./DashboardSummaryService.js');
    const PPCAnalysis = require('./PPCCampaignAnalysisService.js');
    const { getTopOpportunitiesForMarketplace } = require('./TopOpportunitiesResolver.js');
    const failures = [];

    // ONE window per marketplace, used by every figure that has a period (finance, ad spend, ad
    // sales, wasted spend, ...). It is the caller's custom range, else the marketplace's own data
    // window (DataFetchTracking, as its single Dashboard uses for finance), else none (each source's
    // own default of the last 30 days). Without this, a marketplace whose data stopped syncing weeks
    // ago showed last month's sales next to this month's ad spend of zero.
    const phase1Res = await Promise.allSettled([DashboardSummary.getDashboardPhase1(userId, country, region)]);
    const phase1 = settledValue(phase1Res[0], null, 'phase1', failures)?.data || {};
    const financeWindow = range?.startDate && range?.endDate
        ? { startDate: range.startDate, endDate: range.endDate }
        : (phase1.startDate && phase1.endDate ? { startDate: phase1.startDate, endDate: phase1.endDate } : null);
    const start = financeWindow?.startDate || null;
    const end = financeWindow?.endDate || null;

    const [phase2Res, ppcRes, wastedRes, reimbRes, oppRes, financeRes] = await Promise.allSettled([
        DashboardSummary.getDashboardPhase2(userId, country, region),
        PPCAnalysis.getPPCKPISummary(userId, country, region, start, end),
        PPCAnalysis.getWastedSpendKeywords(userId, country, region, 1, 1, start, end),
        getExpectedReimbursements(userId, country, region),
        getTopOpportunitiesForMarketplace(userId, country, region),
        getFinanceSlices(userId, country, region, financeWindow),
    ]);

    const phase2 = settledValue(phase2Res, null, 'phase2', failures)?.data || {};
    const ppc = settledValue(ppcRes, {}, 'ppc', failures) || {};
    const wasted = settledValue(wastedRes, {}, 'wastedSpend', failures) || {};
    const reimbursement = settledValue(reimbRes, { shipment: 0, lost: 0, damaged: 0, disposed: 0, total: 0 }, 'reimbursements', failures);
    const opportunities = settledValue(oppRes, { data: {} }, 'topOpportunities', failures)?.data || {};
    const finance = settledValue(financeRes, { hasFinanceData: false }, 'finance', failures);

    const snapshot = {
        country,
        region,
        currencyCode: getCurrencyCode(country),
        window: financeWindow,
        counts: {
            TotalRankingerrors: num(phase1.TotalRankingerrors),
            totalErrorInConversion: num(phase1.totalErrorInConversion),
            totalInventoryErrors: num(phase1.totalInventoryErrors),
            totalProfitabilityErrors: num(phase1.totalProfitabilityErrors),
            totalSponsoredAdsErrors: num(phase1.totalSponsoredAdsErrors),
            totalErrorInAccount: num(phase1.totalErrorInAccount),
            totalIssues: num(phase1.totalIssues),
            numberOfProductsWithIssues: num(phase1.numberOfProductsWithIssues),
            totalProductCount: num(phase1.totalProductCount),
            activeProductCount: num(phase1.activeProductCount),
        },
        health: phase2.accountHealthPercentage || null,
        ppc: {
            spend: num(ppc.spend),
            sales: num(ppc.sales),
            totalSales: num(ppc.totalSales),
            impressions: num(ppc.impressions),
            clicks: num(ppc.clicks),
            unitsSold: num(ppc.unitsSold),
            orders: num(ppc.orders),
            daysWithData: num(ppc.dataAvailability?.ppcDaysWithData),
            dateRange: ppc.dateRange || null,
            timeseries: (ppc.timeseries || []).map((d) => ({
                date: d.date,
                sales: num(d.sales),
                spend: num(d.spend),
                impressions: num(d.impressions),
                clicks: num(d.clicks),
            })),
        },
        wastedSpend: num(wasted.totalWastedSpend),
        reimbursement,
        finance,
        opportunities: {
            list: (opportunities.opportunities || []).map((o) => ({ ...o })),
            potentialProfitImpact: num(opportunities.potentialProfitImpact),
            capitalTiedUp: num(opportunities.capitalTiedUp),
        },
        failedSources: failures,
        builtInMs: Date.now() - startedAt,
    };

    logger.info(`[MarketplaceComparison] snapshot ${country}:${region} built in ${snapshot.builtInMs}ms${failures.length ? ` (failed: ${failures.join(', ')})` : ''}`);
    await cacheSet(cacheKey, SNAPSHOT_TTL_SECONDS, snapshot);
    return snapshot;
};

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const round4 = (v) => Math.round((Number(v) || 0) * 10000) / 10000;
const ratio = (a, b, scale = 1) => (b > 0 ? (a / b) * scale : null);

/**
 * Pure: the comparison table's metrics for one marketplace, in its own currency.
 * A ratio is null when its denominator is zero, so the page shows "—" rather than a fake 0%.
 */
const toComparisonRow = (s, hint = null) => {
    const f = s.finance || {};
    const p = s.ppc || {};
    const hasFinance = Boolean(f.hasFinanceData);
    const topFix = (s.opportunities?.list || [])
        .filter((o) => num(o.amount) > 0)
        .sort((a, b) => num(b.amount) - num(a.amount))[0] || null;

    return {
        country: s.country,
        region: s.region,
        currencyCode: s.currencyCode,
        window: s.window,
        failedSources: s.failedSources || [],
        hint: hint && hint.rate > 0 ? { rate: hint.rate, asOf: hint.asOf || null, stale: Boolean(hint.stale) } : null,
        metrics: {
            totalSales: hasFinance ? round2(f.productSales) : null,
            grossProfit: hasFinance ? round2(f.grossProfitRaw) : null,
            marginPct: hasFinance ? ratio(num(f.grossProfitRaw), num(f.productSales), 100) : null,
            productsCosted: hasFinance ? num(f.cogsCoverage?.productsWithCogs) : null,
            productsSold: hasFinance ? num(f.cogsCoverage?.productsSold) : null,
            moneyOwed: round2(s.reimbursement?.total),
            ppcSales: round2(p.sales),
            adSalesSharePct: ratio(num(p.sales), num(p.totalSales), 100),
            adSpend: round2(p.spend),
            acos: ratio(num(p.spend), num(p.sales), 100),
            tacos: ratio(num(p.spend), num(p.totalSales), 100),
            roas: ratio(num(p.sales), num(p.spend)),
            wastedSpend: round2(s.wastedSpend),
            unitsFromAds: num(p.unitsSold),
            ctr: ratio(num(p.clicks), num(p.impressions), 100),
            cpc: ratio(num(p.spend), num(p.clicks)),
            healthPct: num(s.health?.Percentage) > 0 ? num(s.health.Percentage) : null,
            healthStatus: s.health?.status || null,
            totalIssues: num(s.counts?.totalIssues),
            productsWithIssues: num(s.counts?.numberOfProductsWithIssues),
            profitInPlay: round2(s.opportunities?.potentialProfitImpact),
            topFix: topFix ? { title: topFix.title || null, amount: round2(topFix.amount), category: topFix.category || null, issueType: topFix.issueType || null } : null,
        },
    };
};

/**
 * Pure: Total Sales and Gross Profit of every marketplace, added together in USD.
 *
 * The US marketplace's amount is used as-is; every other marketplace is converted at its latest
 * rate (`row.hint.rate`, units of USD per 1 unit of its currency) and then added. A marketplace
 * only counts when it has BOTH a finance figure and a usable rate, and sales and profit use that
 * same set — so the combined margin is profit over the sales it actually covers. Anything left out
 * is listed with the reason rather than silently treated as zero or 1:1.
 *
 * PPC sales and ad spend are added the same way, but they don't depend on finance data, so a
 * marketplace counts for them as soon as it has a usable rate (`ads` / `adsExcluded`).
 *
 * @param {Array} rows  toComparisonRow() results
 * @returns {Object|null} null when there are no rows
 */
const computeUsdTotals = (rows) => {
    if (!rows?.length) return null;
    const included = [];
    const excluded = [];
    const ads = [];
    const adsExcluded = [];

    for (const r of rows) {
        // Ads figures: only a rate is needed.
        const adsRate = r.currencyCode === 'USD' ? 1 : (r.hint?.rate > 0 ? r.hint.rate : null);
        if (adsRate) {
            ads.push({
                country: r.country,
                currencyCode: r.currencyCode,
                rate: adsRate,
                asOf: r.currencyCode === 'USD' ? null : (r.hint?.asOf || null),
                stale: r.currencyCode === 'USD' ? false : Boolean(r.hint?.stale),
                ppcSalesLocal: round2(r.metrics?.ppcSales),
                adSpendLocal: round2(r.metrics?.adSpend),
                ppcSalesUsd: num(r.metrics?.ppcSales) * adsRate,
                adSpendUsd: num(r.metrics?.adSpend) * adsRate,
            });
        } else {
            adsExcluded.push({ country: r.country, currencyCode: r.currencyCode, reason: 'fx_unavailable' });
        }

        const sales = r.metrics?.totalSales;
        const profit = r.metrics?.grossProfit;
        if (sales === null || sales === undefined || profit === null || profit === undefined) {
            excluded.push({ country: r.country, currencyCode: r.currencyCode, reason: 'no_finance_data' });
            continue;
        }
        const rate = r.currencyCode === 'USD' ? 1 : (r.hint?.rate > 0 ? r.hint.rate : null);
        if (!rate) {
            excluded.push({ country: r.country, currencyCode: r.currencyCode, reason: 'fx_unavailable' });
            continue;
        }
        included.push({
            country: r.country,
            currencyCode: r.currencyCode,
            rate,
            salesLocal: round2(sales),
            profitLocal: round2(profit),
            salesUsd: sales * rate,
            profitUsd: profit * rate,
            asOf: r.currencyCode === 'USD' ? null : (r.hint?.asOf || null),
            stale: r.currencyCode === 'USD' ? false : Boolean(r.hint?.stale),
            costsIncomplete: num(r.metrics?.productsSold) > 0 && num(r.metrics?.productsCosted) < num(r.metrics?.productsSold),
        });
    }

    const totalSales = included.reduce((sum, m) => sum + m.salesUsd, 0);
    const grossProfit = included.reduce((sum, m) => sum + m.profitUsd, 0);
    const ppcSales = ads.reduce((sum, m) => sum + m.ppcSalesUsd, 0);
    const adSpend = ads.reduce((sum, m) => sum + m.adSpendUsd, 0);

    return {
        currency: 'USD',
        totalSales: included.length ? round2(totalSales) : null,
        grossProfit: included.length ? round2(grossProfit) : null,
        marginPct: included.length && totalSales > 0 ? (grossProfit / totalSales) * 100 : null,
        included: included.map((m) => ({ ...m, salesUsd: round2(m.salesUsd), profitUsd: round2(m.profitUsd) })),
        excluded,
        ppcSales: ads.length ? round2(ppcSales) : null,
        adSpend: ads.length ? round2(adSpend) : null,
        // Recomputed from the converted sums, never averaged across marketplaces.
        acos: ads.length && ppcSales > 0 ? (adSpend / ppcSales) * 100 : null,
        ads: ads.map((m) => ({ ...m, ppcSalesUsd: round2(m.ppcSalesUsd), adSpendUsd: round2(m.adSpendUsd) })),
        adsExcluded,
        ratesAsOf: [...included, ...ads].map((m) => m.asOf).filter(Boolean).sort()[0] || null,
        anyStaleRate: [...included, ...ads].some((m) => m.stale),
        costsIncompleteFor: included.filter((m) => m.costsIncomplete).map((m) => m.country),
    };
};

/**
 * Pure: the four headline measures for each day, all marketplaces added together in USD.
 *
 * Each marketplace's day is converted at its latest rate (US as-is) and added to the same day of
 * the others; dates are the union across marketplaces, and a marketplace with nothing on a given day
 * simply adds nothing. The same marketplaces count here as in the headline boxes — sales/profit need
 * finance data and a rate, PPC sales/ad spend need only a rate — so the daily series adds up to the
 * headline (tested). A marketplace whose daily profit can't be computed honestly is listed in
 * `dailyExcluded` and left out of the sales/profit series.
 *
 * @param {Array} snapshots  buildMarketplaceSnapshot() results
 * @param {Array} rows       toComparisonRow() results, same order (they carry the USD rate)
 * @returns {{ daily: Array<{date,totalSales,grossProfit,ppcSales,adSpend}>, dailyExcluded: Array }}
 */
const computeUsdDaily = (snapshots, rows) => {
    const byDate = new Map();
    const dailyExcluded = [];
    const slot = (date) => {
        if (!byDate.has(date)) byDate.set(date, { date, totalSales: 0, grossProfit: 0, ppcSales: 0, adSpend: 0 });
        return byDate.get(date);
    };

    snapshots.forEach((snap, i) => {
        const row = rows[i];
        const rate = row.currencyCode === 'USD' ? 1 : (row.hint?.rate > 0 ? row.hint.rate : null);
        if (!rate) return;

        for (const d of snap.ppc?.timeseries || []) {
            const t = slot(d.date);
            t.ppcSales += num(d.sales) * rate;
            t.adSpend += num(d.spend) * rate;
        }

        if (!snap.finance?.hasFinanceData) return;
        if (snap.finance.dailyUnavailable) {
            dailyExcluded.push({ country: snap.country, currencyCode: snap.currencyCode, reason: snap.finance.dailyUnavailable });
            return;
        }
        for (const d of snap.finance.daily || []) {
            const t = slot(d.date);
            t.totalSales += num(d.sales) * rate;
            t.grossProfit += num(d.profit) * rate;
        }
    });

    const daily = [...byDate.values()]
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        // 4 decimals, not cents: rounding every day to cents drifts the sum of 30 days away from the
        // headline (which rounds once). The chart and export format to cents when they display.
        .map((d) => ({ date: d.date, totalSales: round4(d.totalSales), grossProfit: round4(d.grossProfit), ppcSales: round4(d.ppcSales), adSpend: round4(d.adSpend) }));
    return { daily, dailyExcluded };
};

/**
 * Every connected marketplace's Dashboard figures, side by side.
 *
 * @param {string} userId
 * @param {{ hintCurrency?: string|null, range?: {startDate,endDate}|null }} opts
 */
// The headline totals plus their day-by-day series (null stays null: no rows, nothing to chart).
const withDaily = (totals, snapshots, rows) => (totals ? { ...totals, ...computeUsdDaily(snapshots, rows) } : null);

const getMarketplaceComparison = async (userId, { hintCurrency = 'USD', range = null } = {}) => {
    const owned = (await listOwnedMarketplaces(userId)).filter((m) => m.isConnected);
    const mpKey = owned.map((m) => `${m.country}:${m.region}`).sort().join(',') || 'none';
    const cacheKey = `analyse_data:dashboard-marketplaces:${userId}:${hintCurrency || 'none'}:${mpKey}:${rangeKeyOf(range)}`;
    const hit = await cacheGet(cacheKey);
    if (hit) return hit;

    const startedAt = Date.now();
    const results = await mapLimited(owned, MAX_PARALLEL_MARKETPLACES, (m) => buildMarketplaceSnapshot(userId, m.country, m.region, range));

    const snapshots = [];
    const failedMarketplaces = [];
    results.forEach((r, i) => {
        if (r.ok) snapshots.push(r.value);
        else {
            failedMarketplaces.push({ country: owned[i].country, region: owned[i].region });
            logger.error(`[MarketplaceComparison] snapshot failed for ${owned[i].country}: ${r.error?.message}`);
        }
    });

    const hints = {};
    if (hintCurrency) {
        const codes = [...new Set(snapshots.map((s) => s.currencyCode).filter((c) => c !== hintCurrency))];
        await Promise.all(codes.map(async (code) => {
            try { hints[code] = await FxService.getRate(code, hintCurrency); } catch (_) { hints[code] = null; }
        }));
    }

    const rows = snapshots.map((s) => toComparisonRow(s, s.currencyCode === hintCurrency ? null : hints[s.currencyCode]));
    const ratesAsOf = Object.values(hints).map((h) => h?.asOf).filter(Boolean).sort()[0] || null;

    const comparison = {
        hintCurrency: hintCurrency || null,
        ratesAsOf,
        marketplaces: rows,
        // Only offered in USD terms — that is the currency the page adds everything up in.
        totals: hintCurrency === 'USD' ? withDaily(computeUsdTotals(rows), snapshots, rows) : null,
        failedMarketplaces,
        windowsDiffer: new Set(snapshots.map((s) => `${s.window?.startDate}_${s.window?.endDate}`)).size > 1,
        generatedAt: new Date().toISOString(),
        builtInMs: Date.now() - startedAt,
    };
    logger.info(`[MarketplaceComparison] ${rows.length} marketplace(s) in ${comparison.builtInMs}ms`);
    await cacheSet(cacheKey, COMPARISON_TTL_SECONDS, comparison);
    return comparison;
};

module.exports = {
    getMarketplaceComparison,
    buildMarketplaceSnapshot,
    // exported for tests
    toComparisonRow,
    computeUsdTotals,
    computeUsdDaily,
    loadMarketplaceCogs,
    isWithinLast30Days,
    mapLimited,
};
