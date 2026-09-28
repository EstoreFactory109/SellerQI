/**
 * Account-wide ESF reports: every connected marketplace in one report.
 *
 * WHAT CHANGED
 * Reports used to follow the marketplace selected in the app — switching from
 * US to IN changed the Reports page, and the email carried a separate PDF per
 * report per marketplace. A client with two marketplaces now gets ONE report of
 * each type, the same wherever they are in the app, laid out like the hand-made
 * reference report:
 *
 *   Executive Summary   led by the PRIMARY marketplace (highest sales), with
 *                       counts summed across every marketplace
 *   All Marketplaces    one comparison row per marketplace
 *   Amazon XX           a full section per marketplace: tiles, tables
 *   Highlights, Notes   every marketplace's, each line naming its market
 *
 * A single-marketplace account gets exactly the report it always did.
 *
 * WHAT IS NOT DONE, DELIBERATELY
 * Money is never added across marketplaces. $3,250 and ₹9,488 do not sum to a
 * figure anyone can use, and converting them needs exchange rates this system
 * does not hold. So only counts (sessions, units, listings) are totalled; every
 * money figure stays in its own marketplace's currency. The one place rates are
 * used is choosing the primary marketplace — a ranking that is never printed.
 *
 * Every per-marketplace figure still comes from the unchanged builders in
 * EsfReportsService.js, so nothing verified there is recomputed differently here.
 */
const mongoose = require('mongoose');

const Seller = require('../../models/user-auth/sellerCentralModel.js');
const SalesOnlyMetrics = require('../../models/MCP/SalesOnlyMetricsModel.js');
const logger = require('../../utils/Logger.js');
const { getCurrencySymbol, getCurrencyCode } = require('../../utils/marketplaceCurrency.js');
const {
    BUILDERS, settle, toCard, takeawayOf, pctChange, PREVIEW_ROWS,
} = require('./EsfReportsService.js');

/* ------------------------------------------------------------- marketplaces */

/** Every connected marketplace, in connection order, once each. */
const listMarketplaces = async (userId) => {
    const seller = await Seller.findOne({ User: userId }).select('sellerAccount.country sellerAccount.region').lean();
    const seen = new Set();
    const out = [];
    for (const account of seller?.sellerAccount || []) {
        if (!account.country || !account.region) continue;
        const key = `${account.country}|${account.region}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ country: account.country, region: account.region, currency: getCurrencySymbol(account.country) });
    }
    return out;
};

const sameMarketplace = (a, b) => Boolean(a && b) && a.country === b.country && a.region === b.region;

/**
 * Rough USD value of one unit of each currency. FOR RANKING ONLY — deciding
 * which marketplace leads the report — and never printed or summed into a
 * figure. Being out by a few percent cannot change which of two markets sells
 * more in any case that matters; being in the wrong currency always would.
 */
const APPROX_USD = {
    USD: 1, CAD: 0.73, MXN: 0.055, BRL: 0.18, GBP: 1.27, EUR: 1.08, SEK: 0.095, PLN: 0.25, TRY: 0.03,
    JPY: 0.0067, AUD: 0.66, SGD: 0.74, INR: 0.012, AED: 0.27, SAR: 0.27, EGP: 0.02,
};

/**
 * The primary marketplace: the one with the highest sales over the last 60
 * days, compared in approximate USD. With no sales anywhere, the first one
 * connected.
 */
const pickPrimary = async (userId, marketplaces) => {
    if (marketplaces.length < 2) return marketplaces[0] || null;
    const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    let totals = [];
    try {
        totals = await SalesOnlyMetrics.aggregate([
            { $match: { User: new mongoose.Types.ObjectId(String(userId)), date: { $gte: since } } },
            { $group: { _id: { country: '$country', region: '$region' }, sales: { $sum: { $ifNull: ['$sales.amount', 0] } } } },
        ]);
    } catch (error) {
        logger.warn(`[EsfAccountReports] primary marketplace ranking failed: ${error.message}`);
    }
    let best = null;
    for (const marketplace of marketplaces) {
        const row = totals.find((t) => t._id?.country === marketplace.country && t._id?.region === marketplace.region);
        const usd = (row?.sales || 0) * (APPROX_USD[getCurrencyCode(marketplace.country)] ?? 1);
        if (!best || usd > best.usd) best = { marketplace, usd };
    }
    return best && best.usd > 0 ? best.marketplace : marketplaces[0];
};

/* ------------------------------------------------------- per-report config */

/**
 * The counts each report sums across marketplaces for its executive summary.
 * Counts only: a money or rate tile is never totalled across currencies.
 */
const SUMMED_TILES = {
    'inventory-restock': ['SKUs tracked', 'Urgent', 'Out of stock'],
    'account-overview': ['Total listings', 'Out of stock', 'Suppressed'],
    buybox: ['ASINs tracked', 'Losing', 'Suppressed listings'],
    'fba-aged-inventory': ['365+ days', 'Unfulfillable', 'Units pending removal'],
    'listings-audit': ['Listings reviewed'],
    'review-requests': ['Orders checked', 'Requests sent', 'Failed'],
    'monthly-performance': ['Sessions', 'Units sold'],
};

/** The tiles, in order, that make up each report's All Marketplaces row. */
const COMPARISON_TILES = {
    'inventory-restock': ['SKUs tracked', 'Urgent', 'Need restock', 'Out of stock', 'Est. reorder value'],
    'account-overview': ['Total listings', 'Active', 'Out of stock', 'Suppressed', 'Amazon AHR', 'Open issues'],
    buybox: ['ASINs tracked', 'Winning', 'Losing', 'Buy Box ownership', 'Suppressed listings', 'Priced above Buy Box'],
    'fba-aged-inventory': ['ASINs tracked', '181–270 days', '271–365 days', '365+ days', 'Unfulfillable', 'Units pending removal'],
    'listings-audit': ['Listings reviewed', 'Completion', 'Video', 'A+ Content', 'Brand Story', 'A+ Premium'],
    'review-requests': ['Orders checked', 'Eligible', 'Requests sent', 'Failed'],
    'monthly-performance': ['Sessions', 'Units sold', 'Total sales', 'Ad spend', 'Ad sales', 'Organic sales', 'ACOS', 'TACOS'],
};

/** How many of the primary's own tiles lead the executive summary. */
const LEAD_TILES = 5;

/* --------------------------------------------------------------- formatting */

/** A stat as text, in its OWN marketplace's currency — what a comparison cell holds. */
const formatStat = (stat, currency) => {
    if (!stat || stat.value === null || stat.value === undefined || stat.value === '') return '—';
    const { value, format } = stat;
    if (typeof value !== 'number') return String(value);
    const sign = value < 0 ? '-' : '';
    if (format === 'money') return `${sign}${currency}${Math.abs(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (format === 'currency') return `${sign}${currency}${Math.abs(value).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
    if (format === 'percent') return `${value}%`;
    return value.toLocaleString('en-GB');
};

/** "+35.8%" / "-2.1%" / "New" — the reference report's Sales Δ column. */
const changeCell = (stat) => {
    if (!stat || stat.value === null || stat.value === undefined) return '—';
    if (stat.delta === null || stat.delta === undefined) return stat.value ? 'New' : '—';
    return `${stat.delta >= 0 ? '+' : ''}${stat.delta}%`;
};

const marketLabel = (marketplace) => `Amazon ${marketplace.country}`;

/* ---------------------------------------------------------------- combining */

const statOf = (report, label) => (report?.summary?.stats || []).find((stat) => stat.label === label);

/**
 * The executive summary's tiles: counts summed across every marketplace that
 * reports them, then the primary's own leading tiles, each label naming its
 * scope as the reference report does ("SESSIONS · ALL MARKETPLACES").
 */
const executiveTiles = (key, lead, available) => {
    const tiles = [];
    for (const label of SUMMED_TILES[key] || []) {
        const parts = available.map((section) => statOf(section.report, label)).filter((stat) => stat && typeof stat.value === 'number');
        if (!parts.length) continue;
        const value = parts.reduce((sum, stat) => sum + stat.value, 0);
        // A change only when every contributing marketplace carried its
        // previous figure; a change built from some of them would mislead.
        const previous = parts.every((stat) => typeof stat.previous === 'number')
            ? parts.reduce((sum, stat) => sum + stat.previous, 0)
            : null;
        const template = parts[0];
        tiles.push({
            label: `${label} · All marketplaces`,
            value,
            ...(previous !== null ? { delta: pctChange(value, previous), deltaFormat: 'percent' } : {}),
            ...(template.deltaGoodWhen ? { deltaGoodWhen: template.deltaGoodWhen } : {}),
            // Summed tiles are counts; a tone would need a threshold per market.
        });
    }
    const summed = new Set(SUMMED_TILES[key] || []);
    const own = (lead.report.summary?.stats || []).filter((stat) => !summed.has(stat.label)).slice(0, LEAD_TILES);
    for (const stat of own) tiles.push({ ...stat, label: `${stat.label} · ${marketLabel(lead.marketplace)}` });
    return tiles;
};

/** The All Marketplaces table, one row per marketplace, cells pre-formatted in each one's currency. */
const comparisonTable = (key, sections) => {
    const labels = COMPARISON_TILES[key] || [];
    const withChange = key === 'monthly-performance';
    const columns = [
        { key: 'market', label: 'Market' },
        ...labels.flatMap((label, i) => {
            const column = { key: `c${i}`, label, align: 'right' };
            // The reference report's Sales Δ sits right after Total sales.
            return withChange && label === 'Total sales' ? [column, { key: 'salesChange', label: 'Sales change', align: 'right' }] : [column];
        }),
    ];
    const rows = sections.map((section) => {
        const row = { market: section.marketplace.country };
        labels.forEach((label, i) => {
            row[`c${i}`] = section.report.available ? formatStat(statOf(section.report, label), section.marketplace.currency) : '—';
        });
        if (withChange) row.salesChange = section.report.available ? changeCell(statOf(section.report, 'Total sales')) : '—';
        return row;
    });
    return { title: 'All Marketplaces', columns, rows };
};

/**
 * One line per written highlight, each naming its market; the account
 * manager's placeholders once, not once per marketplace.
 */
const mergedHighlights = (available) => {
    const written = available.flatMap((section) => (section.report.highlights || [])
        .filter((item) => item.tone !== 'fill')
        .map((item) => ({ ...item, text: `${marketLabel(section.marketplace)}: ${item.text}` })));
    const seen = new Set();
    const fill = available.flatMap((section) => (section.report.highlights || []).filter((item) => item.tone === 'fill'))
        .filter((item) => (seen.has(item.text) ? false : seen.add(item.text)));
    return [...written, ...fill];
};

/**
 * Notes: a caveat every marketplace shares is said once, plainly; one that
 * applies to some is prefixed with the markets it applies to. A marketplace
 * with no data says why.
 */
const mergedCaveats = (sections) => {
    const available = sections.filter((section) => section.report.available);
    const byText = new Map();
    for (const section of available) {
        for (const caveat of section.report.caveats || []) {
            if (!byText.has(caveat)) byText.set(caveat, []);
            byText.get(caveat).push(section.marketplace.country);
        }
    }
    const notes = [...byText.entries()].map(([text, markets]) => (markets.length === available.length
        ? text
        : `Amazon ${markets.join(', ')}: ${text}`));
    for (const section of sections.filter((s) => !s.report.available)) {
        notes.push(`${marketLabel(section.marketplace)}: ${section.report.reason || 'no data for this report yet.'}`);
    }
    return notes;
};

/**
 * The Key Takeaway: the primary's own, then the first flagged line from each
 * other marketplace (two at most), then a pointer to the breakdown.
 */
const accountTakeaway = (lead, others) => {
    const parts = [takeawayOf(lead.report.highlights)];
    for (const section of others.slice(0, 2)) {
        const flagged = (section.report.highlights || []).find((item) => item.tone === 'watch');
        if (flagged) parts.push(`${marketLabel(section.marketplace)}: ${flagged.text}`);
    }
    parts.push('The breakdown for every marketplace follows.');
    return parts.filter(Boolean).join(' ');
};

/** A section as the renderers need it: that marketplace's card, trimmed. */
const sectionOf = (section, rowLimit) => ({
    marketplace: section.marketplace,
    available: Boolean(section.report.available),
    reason: section.report.reason || '',
    date: section.report.date || '',
    tableTitle: section.report.tableTitle,
    summary: section.report.available ? toCard(section.report, rowLimit).summary : null,
    pageSize: section.report.available ? toCard(section.report, rowLimit).pageSize : undefined,
});

/**
 * Combine one report type across every marketplace.
 *
 * `sections` holds the full (untrimmed) report per marketplace; the lead is
 * the primary where it has data, else the first marketplace that does.
 */
const combine = (key, sections, primary, rowLimit) => {
    const meta = BUILDERS[key].meta;

    if (sections.length === 1) {
        const [only] = sections;
        return { ...toCard(only.report, rowLimit), marketplace: only.marketplace, multi: false };
    }

    const available = sections.filter((section) => section.report.available);
    const lead = available.find((section) => sameMarketplace(section.marketplace, primary)) || available[0];

    if (!lead) {
        return {
            ...meta,
            available: false,
            multi: true,
            marketplace: primary,
            insight: '',
            tone: 'neutral',
            reason: sections.map((section) => `${marketLabel(section.marketplace)}: ${section.report.reason}`).join(' '),
            sections: sections.map((section) => sectionOf(section, rowLimit)),
        };
    }

    // Primary first, then the rest in connection order.
    const ordered = [lead, ...sections.filter((section) => section !== lead)];
    const others = ordered.slice(1).filter((section) => section.report.available);
    const leadCard = toCard(lead.report, rowLimit);

    return {
        ...leadCard,
        multi: true,
        marketplace: lead.marketplace,
        isPrimary: sameMarketplace(lead.marketplace, primary),
        insight: `${leadCard.insight}${others.length ? ` · +${others.length} more marketplace${others.length === 1 ? '' : 's'}` : ''}`,
        tone: available.some((section) => section.report.tone === 'watch') ? 'watch' : leadCard.tone,
        overview: {
            stats: executiveTiles(key, lead, available),
            takeaway: accountTakeaway(lead, others),
            charts: leadCard.summary?.charts || [],
            comparisonLabel: leadCard.summary?.comparisonLabel,
        },
        comparison: comparisonTable(key, ordered),
        sections: ordered.map((section) => sectionOf(section, rowLimit)),
        highlights: mergedHighlights(ordered.filter((section) => section.report.available)),
        caveats: mergedCaveats(ordered),
    };
};

/**
 * Build report types for every connected marketplace.
 *
 * @param {string} userId
 * @param {object} [opts]
 * @param {string[]} [opts.keys]    report keys to build; all by default
 * @param {number}   [opts.rowLimit] table rows kept per section (page preview
 *                                   by default; the PDF depth for email/download)
 */
const buildAccountReports = async (userId, { keys = Object.keys(BUILDERS), rowLimit = PREVIEW_ROWS } = {}) => {
    const marketplaces = await listMarketplaces(userId);
    if (!marketplaces.length) return { marketplaces: [], primary: null, reports: [] };

    const [primary, built] = await Promise.all([
        pickPrimary(userId, marketplaces),
        Promise.all(marketplaces.map(async (marketplace) => {
            const reports = await Promise.all(keys.map((key) => {
                const { meta, build } = BUILDERS[key];
                return settle(meta, () => build(userId, marketplace.country, marketplace.region));
            }));
            return { marketplace, reports };
        })),
    ]);

    const reports = keys.map((key, i) => combine(
        key,
        built.map(({ marketplace, reports: list }) => ({ marketplace, report: list[i] })),
        primary,
        rowLimit
    ));
    return { marketplaces, primary, reports };
};

/**
 * Every report for the whole account — the Reports page payload. Not tied to
 * the marketplace selected in the app: the page reads the same everywhere.
 */
const getEsfAccountReports = async (userId, opts = {}) => {
    const startTime = Date.now();
    const { marketplaces, primary, reports } = await buildAccountReports(userId, opts);
    const available = reports.filter((report) => report.available);
    const featured = [...available].sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0))[0] || null;

    logger.info(`[EsfAccountReports] user=${userId} ${marketplaces.length} marketplace(s), ${available.length}/${reports.length} reports in ${Date.now() - startTime}ms`);

    return {
        // `marketplace` kept for older readers: the primary.
        marketplace: primary ? { country: primary.country, region: primary.region } : null,
        primary,
        marketplaces,
        reports,
        featuredKey: featured?.key || null,
        counts: { total: reports.length, available: available.length },
    };
};

/** One report type for the whole account, at the depth a document needs. */
const getEsfAccountReport = async (userId, reportKey, opts = {}) => {
    if (!BUILDERS[reportKey]) return null;
    const { marketplaces, primary, reports } = await buildAccountReports(userId, { ...opts, keys: [reportKey] });
    return { marketplace: primary, primary, marketplaces, report: reports[0] || null };
};

/** Is this marketplace one of the user's own? Guards the per-marketplace endpoints. */
const ownsMarketplace = async (userId, country, region) => (await listMarketplaces(userId))
    .some((marketplace) => marketplace.country === country && marketplace.region === region);

module.exports = {
    getEsfAccountReports,
    getEsfAccountReport,
    listMarketplaces,
    ownsMarketplace,
    pickPrimary,
    // exported for tests
    combine,
    formatStat,
    SUMMED_TILES,
    COMPARISON_TILES,
};
