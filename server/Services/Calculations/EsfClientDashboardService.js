/**
 * ESF Client Dashboard Service
 *
 * Powers the ESF-only "Client Dashboard" page inside a client's own account:
 * Total Sales / PPC Sales / ACOS, charted and tabled by day, with the selected
 * window compared against a previous window.
 *
 * Deliberately thin: the KPI roll-up (spend, PPC sales, total sales, ACOS,
 * TACOS) is delegated to getPPCKPISummary — the same function the Campaign
 * Audit page uses — so this page can never disagree with the rest of the app.
 * The only query added here is a per-day total-sales aggregation, which is the
 * one piece the existing services do not expose.
 */
const mongoose = require('mongoose');
const SalesOnlyMetrics = require('../../models/MCP/SalesOnlyMetricsModel');
const { getPPCKPISummary } = require('./PPCCampaignAnalysisService');
const logger = require('../../utils/Logger');

/** YYYY-MM-DD for a Date, in UTC (matches how metric dates are stored). */
const toYmd = (date) => date.toISOString().slice(0, 10);

/** Parse YYYY-MM-DD as a UTC date. Returns null when malformed. */
const parseYmd = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
};

const addDays = (date, days) => new Date(date.getTime() + days * 86400000);

/** Inclusive day count between two YYYY-MM-DD dates. */
const dayspan = (start, end) => Math.round((end - start) / 86400000) + 1;

/**
 * Resolve the requested window and the window it is compared against.
 *
 * When no comparison window is supplied, the immediately preceding period of
 * equal length is used, so "last 30 days" always compares to the 30 days before
 * it without the caller doing date maths.
 */
const resolveWindows = ({ startDate, endDate, compareStartDate, compareEndDate }) => {
    let start = parseYmd(startDate);
    let end = parseYmd(endDate);

    // Default: the 30 days ending yesterday (yesterday, because the current day
    // is still partial in Amazon's reporting).
    if (!start || !end || start > end) {
        const yesterday = addDays(new Date(`${toYmd(new Date())}T00:00:00.000Z`), -1);
        end = yesterday;
        start = addDays(yesterday, -29);
    }

    const length = dayspan(start, end);

    let compareStart = parseYmd(compareStartDate);
    let compareEnd = parseYmd(compareEndDate);
    if (!compareStart || !compareEnd || compareStart > compareEnd) {
        compareEnd = addDays(start, -1);
        compareStart = addDays(compareEnd, -(length - 1));
    }

    return {
        current: { startDate: toYmd(start), endDate: toYmd(end), days: length },
        previous: {
            startDate: toYmd(compareStart),
            endDate: toYmd(compareEnd),
            days: dayspan(compareStart, compareEnd),
        },
    };
};

/**
 * Per-day total sales for the window. Mirrors aggregateTotalSales in
 * PPCCampaignAnalysisService, grouped by date instead of rolled up.
 */
const aggregateDailySales = async (userId, country, region, startDate, endDate) => {
    let userObjectId;
    try {
        userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    } catch (_) {
        return [];
    }

    return SalesOnlyMetrics.aggregate([
        {
            $match: {
                User: userObjectId,
                region,
                country,
                date: { $gte: startDate, $lte: endDate },
            },
        },
        {
            $group: {
                _id: '$date',
                totalSales: { $sum: { $ifNull: ['$sales.amount', 0] } },
                unitsSold: { $sum: { $ifNull: ['$unitsSold', 0] } },
            },
        },
        { $sort: { _id: 1 } },
        {
            $project: {
                _id: 0,
                date: '$_id',
                totalSales: { $round: ['$totalSales', 2] },
                unitsSold: 1,
            },
        },
    ]);
};

/** Percent change, guarding against a zero baseline. */
const pctChange = (current, previous) => {
    if (!previous) return current ? null : 0; // null = "no baseline to compare"
    return Math.round(((current - previous) / previous) * 100 * 100) / 100;
};

/** Build the delta block the UI renders next to each KPI. */
const buildDeltas = (current, previous) => ({
    totalSales: { absolute: Math.round((current.totalSales - previous.totalSales) * 100) / 100, percent: pctChange(current.totalSales, previous.totalSales) },
    ppcSales: { absolute: Math.round((current.ppcSales - previous.ppcSales) * 100) / 100, percent: pctChange(current.ppcSales, previous.ppcSales) },
    adSpend: { absolute: Math.round((current.adSpend - previous.adSpend) * 100) / 100, percent: pctChange(current.adSpend, previous.adSpend) },
    unitsSold: { absolute: current.unitsSold - previous.unitsSold, percent: pctChange(current.unitsSold, previous.unitsSold) },
    // ACOS/TACOS are already percentages — report the change in percentage
    // POINTS, which is how ad performance is normally discussed.
    acos: { points: Math.round((current.acos - previous.acos) * 100) / 100 },
    tacos: { points: Math.round((current.tacos - previous.tacos) * 100) / 100 },
});

/** Flatten a KPI summary into the shape the dashboard renders. */
const toKpis = (summary) => ({
    totalSales: summary.totalSales || 0,
    ppcSales: summary.sales || 0,
    adSpend: summary.spend || 0,
    acos: summary.acos || 0,
    tacos: summary.tacos || 0,
    roas: summary.roas || 0,
    unitsSold: summary.unitsSold || 0,
    orders: summary.orders || 0,
    currencyCode: summary.currencyCode || 'USD',
});

/**
 * Merge the daily PPC series with the daily sales series into one row per day,
 * covering every day in the window (missing days become zeroes so the chart has
 * no gaps and the table has no holes).
 */
const buildTimeseries = (ppcDaily, salesDaily, startDate, endDate) => {
    const ppcByDate = new Map((ppcDaily || []).map((row) => [row.date, row]));
    const salesByDate = new Map((salesDaily || []).map((row) => [row.date, row]));

    const rows = [];
    const start = parseYmd(startDate);
    const end = parseYmd(endDate);
    if (!start || !end) return rows;

    for (let day = start; day <= end; day = addDays(day, 1)) {
        const date = toYmd(day);
        const ppc = ppcByDate.get(date);
        const sales = salesByDate.get(date);

        const totalSales = Math.round((sales?.totalSales || 0) * 100) / 100;
        const ppcSales = Math.round((ppc?.sales || 0) * 100) / 100;
        const adSpend = Math.round((ppc?.spend || 0) * 100) / 100;

        rows.push({
            date,
            totalSales,
            ppcSales,
            adSpend,
            unitsSold: sales?.unitsSold || 0,
            // Recomputed per day with the same formulas as the roll-up.
            acos: ppcSales > 0 ? Math.round((adSpend / ppcSales) * 100 * 100) / 100 : 0,
            tacos: totalSales > 0 ? Math.round((adSpend / totalSales) * 100 * 100) / 100 : 0,
        });
    }

    return rows;
};

/**
 * Build the full ESF client dashboard payload.
 *
 * @param {string} userId  The client whose account is being viewed.
 * @param {string} country
 * @param {string} region
 * @param {object} query   { startDate, endDate, compareStartDate, compareEndDate }
 */
const getClientDashboard = async (userId, country, region, query = {}) => {
    const startTime = Date.now();
    const windows = resolveWindows(query);

    const [currentSummary, previousSummary, currentSales] = await Promise.all([
        getPPCKPISummary(userId, country, region, windows.current.startDate, windows.current.endDate),
        getPPCKPISummary(userId, country, region, windows.previous.startDate, windows.previous.endDate),
        aggregateDailySales(userId, country, region, windows.current.startDate, windows.current.endDate),
    ]);

    const current = toKpis(currentSummary);
    const previous = toKpis(previousSummary);

    const timeseries = buildTimeseries(
        currentSummary.timeseries,
        currentSales,
        windows.current.startDate,
        windows.current.endDate
    );

    logger.info(
        `[EsfClientDashboard] user=${userId} ${windows.current.startDate}→${windows.current.endDate} ` +
            `vs ${windows.previous.startDate}→${windows.previous.endDate} in ${Date.now() - startTime}ms`
    );

    return {
        range: windows.current,
        compareRange: windows.previous,
        current,
        previous,
        deltas: buildDeltas(current, previous),
        // Chart series and table rows are the same data — one fetch, two views.
        timeseries,
        dataAvailability: currentSummary.dataAvailability || null,
    };
};

module.exports = {
    getClientDashboard,
    // exported for tests
    resolveWindows,
    buildTimeseries,
    buildDeltas,
    pctChange,
};
