/**
 * ESF Reports Service
 *
 * Powers Estore Factory > Reports. Each card on that page is one recurring
 * report type, and this service builds every card from the collection that
 * already backs it — there is still no recurring-report model, no generated
 * files, and no publishing schedule, so what this returns is "the latest
 * edition of this report, computed live from the data we hold".
 *
 * THE RULE THIS FILE FOLLOWS
 * A report with no data behind it returns `available: false` and no numbers.
 * It is never given invented figures to look complete — the same rule the ESF
 * Overview page already follows (see the header of Pages/ESF/ClientDashboard.jsx).
 * Partial coverage is declared through `caveats`, which the UI shows verbatim,
 * so a half-backed report says which half is missing instead of implying it is
 * whole. The two standing caveats today:
 *   - Buy Box has no competing-seller price. The SP-API Product Pricing feed is
 *     not integrated; an ANY_OFFER_CHANGED subscription exists only in
 *     server/dispriciated/ and is wired to nothing.
 *   - FBA aged inventory has no 0-90 or 91-180 day bands. Amazon sends them,
 *     but GET_FBA_INVENTORY_PLANNING_DATA.js only parses the fee-bearing
 *     `quantity_to_be_charged_ais_*` columns, so they are never stored.
 *
 * Every builder is run through `settle` so one empty or broken collection
 * degrades a single card rather than failing the page.
 */
const mongoose = require('mongoose');

const RestockInventoryRecommendations = require('../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
const FbaInventoryPlanningData = require('../../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js');
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
const AccountHistory = require('../../models/user-auth/AccountHistory.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const FbaInventoryApiDetail = require('../../models/inventory/FbaInventoryApiDetailModel.js');
const ProductWiseFBADataItem = require('../../models/inventory/ProductWiseFBADataItemModel.js');
const NumberOfProductReviews = require('../../models/seller-performance/NumberOfProductReviewsModel.js');
const APlusContent = require('../../models/seller-performance/APlusContentModel.js');
const ReviewOrder = require('../../models/review/ReviewOrderModel.js');
const SalesOnlyMetrics = require('../../models/MCP/SalesOnlyMetricsModel.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const logger = require('../../utils/Logger.js');

/* ------------------------------------------------------------------ helpers */

/** Many SP-API report fields land as strings ("0", "", "--"). Coerce safely. */
const num = (value) => {
    if (value === null || value === undefined) return 0;
    const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
};

const round = (value, places = 2) => {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
};

/** YYYY-MM-DD in UTC — the form every metric date is stored in. */
const toYmd = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86400000);

/** Midnight-UTC today, the anchor all windows are measured from. */
const utcToday = () => new Date(`${toYmd(new Date())}T00:00:00.000Z`);

const toObjectId = (userId) => {
    try {
        return typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    } catch {
        return null;
    }
};

/** "12 Mar 2026" — the label under each card's cadence chip. */
const formatDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** "February 2026" — for the reports whose edition is a whole month. */
const formatMonth = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** "1 SKU" / "2 SKUs" — every insight line is a sentence a client reads. */
const plural = (count, singular, pluralForm = `${singular}s`) =>
    `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;

/**
 * Does this marketplace hold any FBA stock at all?
 *
 * Both FBA reports below are absent for two very different reasons, and the
 * client deserves to be told which. Amazon answers DONE_NO_DATA when there is
 * nothing to report, and the fetcher then returns before writing any document
 * (GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT.js, the DONE_NO_DATA case) — so
 * "no document" means either "no FBA inventory" or "Amazon did not supply it",
 * never "our sync is behind". Saying "not fetched yet" for either one reads as
 * a platform fault we would be wrong to imply.
 */
const hasFbaStock = async (userId, country, region) => {
    // Two independent sources, because a single empty collection cannot tell
    // "this seller is FBM" apart from "that one sync has not run". Only when
    // BOTH are empty do we state the seller has no FBA inventory.
    const [withStock, feeRows] = await Promise.all([
        FbaInventoryApiDetail.countDocuments({ User: userId, country, region, totalQuantity: { $gt: 0 } }),
        ProductWiseFBADataItem.countDocuments({ userId, country, region }),
    ]);
    return withStock > 0 || feeRows > 0;
};

/** Percent change guarding a zero baseline. null = "no baseline to compare". */
const pctChange = (current, previous) => {
    if (!previous) return current ? null : 0;
    return round(((current - previous) / previous) * 100);
};

/**
 * A report that exists but has nothing behind it yet.
 * `reason` is shown to the client, so it says what is missing in their terms.
 */
const unavailable = (meta, reason) => ({ ...meta, available: false, reason, insight: '', tone: 'neutral' });

/**
 * Run a builder without letting it take the page down. A report that throws is
 * logged and returned as unavailable, exactly like one with no data.
 */
const settle = async (meta, builder) => {
    try {
        return await builder();
    } catch (error) {
        logger.error(`[EsfReports] ${meta.key} failed to build: ${error.message}`, { stack: error.stack });
        return unavailable(meta, 'This report could not be built from the current data.');
    }
};

/* ----------------------------------------------------- 1. inventory restock */

const REPORT_RESTOCK = { key: 'inventory-restock', name: 'Inventory Restock', cadence: 'BI-WEEKLY', format: 'xlsx' };

/**
 * Straight off GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT, which carries every
 * column this report needs. Two values are derived rather than stored: weeks of
 * cover (Amazon gives days) and reorder value (qty x price).
 */
const buildRestock = async (userId, country, region) => {
    const latest = await RestockInventoryRecommendations.findOne({ User: userId, country, region })
        .sort({ createdAt: -1 })
        .lean();

    const products = latest?.Products || [];
    if (!products.length) {
        // Distinguished because they mean opposite things to the client: one is
        // "nothing to do", the other "Amazon does not offer this report here".
        // Confirmed live: four India accounts hold FBA stock and ageing data yet
        // have never received a single restock report.
        const stocked = await hasFbaStock(userId, country, region);
        return unavailable(
            REPORT_RESTOCK,
            stocked
                ? 'Amazon has not supplied restock recommendations for this marketplace. It does not publish this report for every marketplace.'
                : 'No FBA inventory in this marketplace, so Amazon has no restock recommendations to give.'
        );
    }

    let urgent = 0;
    let needsRestock = 0;
    let reorderValue = 0;
    let outOfStock = 0;

    const rows = [];
    for (const product of products) {
        const replenishQty = num(product.recommendedReplenishmentQty);
        const available = num(product.available);
        const alert = String(product.alert || '').trim();

        // Amazon's own `alert` column is the priority flag — "Urgent - Out of
        // Stock" and friends. Trusted as-is rather than re-derived from stock
        // levels, so the report agrees with Seller Central.
        const isUrgent = /urgent|out of stock/i.test(alert);
        if (isUrgent) urgent += 1;
        if (available <= 0) outOfStock += 1;

        if (replenishQty > 0) {
            needsRestock += 1;
            reorderValue += replenishQty * num(product.price);
        }

        rows.push({
            asin: product.asin || '',
            sku: product.merchantSku || '',
            productName: product.productName || '',
            price: num(product.price),
            unitsSoldLast30Days: num(product.unitsSoldLast30Days),
            available,
            inbound: num(product.inbound),
            // Amazon reports cover in days; the report is read in weeks.
            weeksOfCover: product.totalDaysOfSupply ? round(num(product.totalDaysOfSupply) / 7, 1) : null,
            recommendedQty: replenishQty,
            reorderValue: round(replenishQty * num(product.price)),
            alert,
            isUrgent,
        });
    }

    // Most urgent first, then by the size of the reorder — the order someone
    // actually works the list in.
    rows.sort((a, b) => Number(b.isUrgent) - Number(a.isUrgent) || b.reorderValue - a.reorderValue);

    return {
        ...REPORT_RESTOCK,
        available: true,
        date: `Fetched ${formatDate(latest.createdAt)}`,
        generatedAt: latest.createdAt,
        tone: urgent > 0 ? 'watch' : 'good',
        insight: urgent > 0
            ? `${plural(urgent, 'SKU')} urgent, ${needsRestock} need restock`
            : `${plural(needsRestock, 'SKU')} need restock, none urgent`,
        summary: {
            headline: `${products.length} SKUs tracked across this marketplace`,
            stats: [
                { label: 'SKUs tracked', value: products.length },
                { label: 'Urgent', value: urgent, tone: urgent > 0 ? 'watch' : 'good' },
                { label: 'Need restock', value: needsRestock },
                { label: 'Out of stock', value: outOfStock, tone: outOfStock > 0 ? 'watch' : 'good' },
                { label: 'Est. reorder value', value: round(reorderValue), format: 'currency' },
            ],
            columns: [
                { key: 'sku', label: 'SKU' },
                { key: 'productName', label: 'Product' },
                { key: 'available', label: 'Available', format: 'number' },
                { key: 'weeksOfCover', label: 'Weeks left', format: 'number' },
                { key: 'recommendedQty', label: 'Reorder qty', format: 'number' },
                { key: 'reorderValue', label: 'Reorder value', format: 'currency' },
                { key: 'alert', label: 'Priority' },
            ],
            rows,
        },
        caveats: [],
    };
};

/* ------------------------------------------------- 2. weekly account overview */

const REPORT_ACCOUNT = { key: 'account-overview', name: 'Weekly Account Overview', cadence: 'WEEKLY', format: 'xlsx' };

/**
 * Listing counts come from the Seller catalogue (status + quantity), and the
 * week-over-week spine from AccountHistory — which stores only health score,
 * product counts and issue counts, hence the caveat.
 */
const buildAccountOverview = async (userId, country, region) => {
    const [seller, history] = await Promise.all([
        Seller.findOne({ User: userId }).select('sellerAccount').lean(),
        AccountHistory.findOne({ User: userId, country, region }).lean(),
    ]);

    const account = (seller?.sellerAccount || []).find((acc) => acc.region === region && acc.country === country);
    const products = account?.products || [];

    if (!products.length) {
        return unavailable(REPORT_ACCOUNT, 'No listings have been synced for this marketplace yet.');
    }

    let active = 0;
    let activeWithStock = 0;
    let outOfStock = 0;
    for (const product of products) {
        const isActive = String(product.status || '').toLowerCase() === 'active';
        if (!isActive) continue;
        active += 1;
        if (num(product.quantity) > 0) activeWithStock += 1;
        else outOfStock += 1;
    }

    // AccountHistory is an append-only array; the last two entries are this
    // period and the one it is compared against.
    const entries = [...(history?.accountHistory || [])]
        .filter((entry) => entry?.Date)
        .sort((a, b) => new Date(a.Date) - new Date(b.Date));
    const current = entries[entries.length - 1] || null;
    const previous = entries[entries.length - 2] || null;

    const stats = [
        { label: 'Total listings', value: products.length },
        { label: 'Active', value: active },
        { label: 'Active with stock', value: activeWithStock },
        { label: 'Out of stock', value: outOfStock, tone: outOfStock > 0 ? 'watch' : 'good' },
    ];

    if (current) {
        stats.push({
            label: 'Health score',
            value: num(current.HealthScore),
            delta: previous ? round(num(current.HealthScore) - num(previous.HealthScore), 1) : null,
        });
        stats.push({
            label: 'Open issues',
            value: num(current.TotalNumberOfIssues),
            delta: previous ? num(current.TotalNumberOfIssues) - num(previous.TotalNumberOfIssues) : null,
            deltaGoodWhen: 'down',
        });
    }

    const caveats = [];
    if (entries.length < 2) {
        caveats.push('Week-over-week comparison needs at least two weeks of history; only one has been recorded so far.');
    }
    caveats.push('History covers health score, listing counts and issue counts. Other account parameters are measured live and have no weekly history yet.');
    caveats.push('The "Checks" and "Observation / Remarks" columns are written by your account manager and are not part of this live view.');

    return {
        ...REPORT_ACCOUNT,
        available: true,
        date: current ? `Week of ${formatDate(current.Date)}` : `As of ${formatDate(new Date())}`,
        generatedAt: current?.Date || new Date(),
        tone: outOfStock > 0 ? 'watch' : 'good',
        insight: `${outOfStock} of ${products.length} listings out of stock`,
        summary: {
            headline: `${active} active listings, ${activeWithStock} with stock on hand`,
            stats,
            // History is the point of this report, so it is the table.
            columns: [
                { key: 'date', label: 'Week' },
                { key: 'healthScore', label: 'Health score', format: 'number' },
                { key: 'totalProducts', label: 'Listings', format: 'number' },
                { key: 'productsWithIssues', label: 'With issues', format: 'number' },
                { key: 'totalIssues', label: 'Total issues', format: 'number' },
            ],
            rows: [...entries].reverse().map((entry) => ({
                date: formatDate(entry.Date),
                healthScore: num(entry.HealthScore),
                totalProducts: num(entry.TotalProducts),
                productsWithIssues: num(entry.ProductsWithIssues),
                totalIssues: num(entry.TotalNumberOfIssues),
            })),

        },
        caveats,
    };
};

/* -------------------------------------------------------- 3. weekly buy box */

const REPORT_BUYBOX = { key: 'buybox', name: 'Weekly Buybox Report', cadence: 'WEEKLY', format: 'xlsx' };

/**
 * BuyBoxData holds a daily Data Kiosk snapshot per marketplace. Win/lose status
 * and the trend against last week come straight out of it; the competing
 * seller's identity and price do not exist anywhere in this system.
 */
const buildBuyBox = async (userId, country, region) => {
    const [snapshots, seller] = await Promise.all([
        BuyBoxData.find({ User: userId, country, region }).sort({ createdAt: -1 }).limit(8).lean(),
        Seller.findOne({ User: userId }).select('sellerAccount').lean(),
    ]);

    const latest = snapshots[0];
    if (!latest) {
        return unavailable(REPORT_BUYBOX, 'No Buy Box data has been fetched for this marketplace yet.');
    }

    // ASIN -> {sku, price} so the report reads per SKU, the way the buy box
    // alert service already joins these two collections.
    const account = (seller?.sellerAccount || []).find((acc) => acc.region === region && acc.country === country);
    const byAsin = new Map();
    for (const product of account?.products || []) {
        if (product.asin && !byAsin.has(product.asin)) {
            byAsin.set(product.asin, { sku: product.sku || '', price: num(product.price), title: product.itemName || '' });
        }
    }

    const losing = latest.asinBuyBoxData?.filter((row) => num(row.buyBoxPercentage) === 0) || [];
    const total = latest.totalProducts || latest.asinBuyBoxData?.length || 0;

    // ASIN -> buy box % for each snapshot, indexed once. Scanning the snapshot
    // arrays per losing ASIN instead would be O(losing x snapshots x catalogue),
    // which on a large catalogue is millions of comparisons per request.
    const snapshotIndex = snapshots.map((snapshot) => {
        const index = new Map();
        for (const row of snapshot.asinBuyBoxData || []) {
            index.set(row.childAsin || '', num(row.buyBoxPercentage));
        }
        return index;
    });

    // How many consecutive snapshots an ASIN has held 0% — the "weeks losing"
    // column. Extends the last-vs-second-last comparison the alert service does.
    // Stops at the first snapshot where it held the Buy Box, or where it is
    // absent: an unlisted ASIN breaks the run rather than silently extending it.
    const consecutiveLosing = (asin) => {
        let streak = 0;
        for (const index of snapshotIndex) {
            if (index.get(asin) === 0) streak += 1;
            else break;
        }
        return streak;
    };

    const rows = losing
        .map((row) => {
            const match = byAsin.get(row.childAsin) || {};
            return {
                asin: row.childAsin,
                sku: match.sku || '—',
                productName: match.title || '',
                ourPrice: match.price || null,
                status: 'Losing',
                periodsLosing: consecutiveLosing(row.childAsin),
                sessions: row.sessions || 0,
                // Named as the gap it is: we know we are losing, not to whom.
                competingSeller: null,
                competingPrice: null,
            };
        })
        .sort((a, b) => b.periodsLosing - a.periodsLosing || b.sessions - a.sessions);

    return {
        ...REPORT_BUYBOX,
        available: true,
        date: latest.date ? formatDate(latest.date) : formatDate(latest.createdAt),
        generatedAt: latest.createdAt,
        tone: losing.length > 0 ? 'watch' : 'good',
        insight: `${losing.length} of ${total} ASINs losing buy box`,
        summary: {
            headline: `${latest.productsWithBuyBox || 0} of ${total} ASINs currently hold the Buy Box`,
            stats: [
                { label: 'ASINs tracked', value: total },
                { label: 'Winning', value: latest.productsWithBuyBox || 0, tone: 'good' },
                { label: 'Losing', value: losing.length, tone: losing.length > 0 ? 'watch' : 'good' },
                { label: 'Below 50%', value: latest.productsWithLowBuyBox || 0, tone: (latest.productsWithLowBuyBox || 0) > 0 ? 'watch' : 'good' },
                { label: 'Snapshots on file', value: snapshots.length },
            ],
            columns: [
                { key: 'sku', label: 'SKU' },
                { key: 'asin', label: 'ASIN' },
                { key: 'ourPrice', label: 'Our price', format: 'currency' },
                { key: 'status', label: 'Status' },
                { key: 'periodsLosing', label: 'Snapshots losing', format: 'number' },
                { key: 'sessions', label: 'Sessions', format: 'number' },
            ],
            rows,
            // An empty table here is the GOOD outcome, not missing data. Say so,
            // otherwise the panel renders stats above blank space.
            emptyMessage: 'Every tracked ASIN currently holds the Buy Box. Nothing to action.',
        },
        caveats: [
            'The competing seller and their price are not tracked. Amazon\'s offer-level pricing feed is not connected, so "who is winning it and at what price" cannot be shown yet.',
        ],
    };
};

/* --------------------------------------------------- 4. FBA aged inventory */

const REPORT_AGED = { key: 'fba-aged-inventory', name: 'FBA Aged Inventory', cadence: 'MONTHLY', format: 'xlsx' };

/**
 * Age bands come from GET_FBA_INVENTORY_PLANNING_DATA. Only the fee-bearing
 * columns (181 days and older) are stored, so the two youngest bands the full
 * report wants are genuinely absent rather than zero — hence the caveat, and
 * hence "of the units we can see" in the headline.
 */
const buildAgedInventory = async (userId, country, region) => {
    const latest = await FbaInventoryPlanningData.findOne({ User: userId, country, region })
        .sort({ createdAt: -1 })
        .lean();

    const items = latest?.data || [];
    if (!items.length) {
        const stocked = await hasFbaStock(userId, country, region);
        return unavailable(
            REPORT_AGED,
            stocked
                ? 'No FBA stock in this marketplace has aged past 180 days, so Amazon has no ageing report to give.'
                : 'No FBA inventory in this marketplace, so there is nothing ageing.'
        );
    }

    // Amazon's narrow bands, recombined into the bands the report is read in.
    let band181to270 = 0;
    let band271to365 = 0;
    let band365plus = 0;
    let unfulfillable = 0;

    for (const item of items) {
        band181to270 += num(item.quantity_to_be_charged_ais_181_210_days)
            + num(item.quantity_to_be_charged_ais_211_240_days)
            + num(item.quantity_to_be_charged_ais_241_270_days);
        band271to365 += num(item.quantity_to_be_charged_ais_271_300_days)
            + num(item.quantity_to_be_charged_ais_301_330_days)
            + num(item.quantity_to_be_charged_ais_331_365_days);
        band365plus += num(item.quantity_to_be_charged_ais_365_plus_days);
        unfulfillable += num(item.unfulfillable_quantity);
    }

    const aged = band181to270 + band271to365 + band365plus;

    return {
        ...REPORT_AGED,
        available: true,
        date: formatMonth(latest.createdAt),
        generatedAt: latest.createdAt,
        tone: band365plus > 0 ? 'watch' : 'neutral',
        insight: `${plural(items.length, 'ASIN')} tracked, ${plural(band365plus, 'unit')} over 365 days`,
        summary: {
            headline: `${aged} ageing units across ${items.length} ASINs`,
            stats: [
                { label: 'ASINs tracked', value: items.length },
                { label: '181–270 days', value: band181to270 },
                { label: '271–365 days', value: band271to365, tone: band271to365 > 0 ? 'watch' : 'neutral' },
                { label: '365+ days', value: band365plus, tone: band365plus > 0 ? 'watch' : 'neutral' },
                { label: 'Unfulfillable', value: unfulfillable, tone: unfulfillable > 0 ? 'watch' : 'neutral' },
            ],
            columns: [
                { key: 'asin', label: 'ASIN' },
                { key: 'band181to270', label: '181–270', format: 'number' },
                { key: 'band271to365', label: '271–365', format: 'number' },
                { key: 'band365plus', label: '365+', format: 'number' },
                { key: 'unfulfillable', label: 'Unfulfillable', format: 'number' },
            ],
            rows: items
                .map((item) => ({
                    asin: item.asin,
                    band181to270: num(item.quantity_to_be_charged_ais_181_210_days)
                        + num(item.quantity_to_be_charged_ais_211_240_days)
                        + num(item.quantity_to_be_charged_ais_241_270_days),
                    band271to365: num(item.quantity_to_be_charged_ais_271_300_days)
                        + num(item.quantity_to_be_charged_ais_301_330_days)
                        + num(item.quantity_to_be_charged_ais_331_365_days),
                    band365plus: num(item.quantity_to_be_charged_ais_365_plus_days),
                    unfulfillable: num(item.unfulfillable_quantity),
                }))
                .filter((row) => row.band181to270 || row.band271to365 || row.band365plus || row.unfulfillable)
                .sort((a, b) => b.band365plus - a.band365plus || b.band271to365 - a.band271to365)
                ,
            // Also a good outcome: tracked stock exists, none of it is ageing.
            emptyMessage: 'No tracked ASIN is carrying stock older than 180 days.',
        },
        caveats: [
            'The 0–90 and 91–180 day bands are not shown. Amazon reports them, but only the storage-fee bands (181 days and older) are stored today, so younger stock is not counted here.',
        ],
    };
};

/* -------------------------------------------------------- 5. listings audit */

const REPORT_AUDIT = { key: 'listings-audit', name: 'Listings Audit', cadence: 'QUARTERLY', format: 'xlsx' };

/** Each listing is scored against these; completion is the share that pass. */
const AUDIT_CHECKS = [
    { key: 'bullets', label: 'Bullet points' },
    { key: 'description', label: 'Description' },
    { key: 'images', label: '5+ images' },
    { key: 'video', label: 'Video' },
    { key: 'aPlus', label: 'A+ Content' },
    { key: 'brandStory', label: 'Brand Story' },
];

/**
 * Joins the catalogue with the three content collections. Premium A+,
 * Storefront and content language have no source anywhere and are declared as
 * out of scope rather than scored as failures, which would understate the audit.
 */
const buildListingsAudit = async (userId, country, region) => {
    const [seller, content, aplus] = await Promise.all([
        Seller.findOne({ User: userId }).select('sellerAccount').lean(),
        NumberOfProductReviews.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
        APlusContent.findOne({ User: userId, country, region }).sort({ createdAt: -1 }).lean(),
    ]);

    const account = (seller?.sellerAccount || []).find((acc) => acc.region === region && acc.country === country);
    const products = account?.products || [];
    if (!products.length) {
        return unavailable(REPORT_AUDIT, 'No listings have been synced for this marketplace yet.');
    }

    const contentByAsin = new Map((content?.Products || []).map((item) => [item.asin, item]));
    const aplusByAsin = new Map(
        (aplus?.ApiContentDetails || []).map((item) => [item.Asins, String(item.status || '').toUpperCase()])
    );

    const marketplaces = (seller?.sellerAccount || []).filter((acc) => acc.country).length;
    const passCount = Object.fromEntries(AUDIT_CHECKS.map((check) => [check.key, 0]));

    let passed = 0;
    const rows = [];

    for (const product of products) {
        const detail = contentByAsin.get(product.asin);
        const aplusStatus = aplusByAsin.get(product.asin) || '';

        const checks = {
            bullets: Boolean(detail?.about_product?.length),
            description: Boolean(detail?.product_description?.length),
            images: (detail?.product_photos?.length || 0) >= 5,
            video: Boolean(detail?.video_url?.length),
            // Amazon reports A+ status per ASIN; anything approved counts.
            aPlus: aplusStatus === 'APPROVED' || aplusStatus === 'ACTIVE' || aplusStatus === 'SUBMITTED',
            brandStory: Boolean(detail?.has_brandstory),
        };

        let listingPassed = 0;
        for (const check of AUDIT_CHECKS) {
            if (checks[check.key]) {
                passCount[check.key] += 1;
                listingPassed += 1;
            }
        }
        passed += listingPassed;

        rows.push({
            asin: product.asin,
            sku: product.sku || '',
            productName: product.itemName || '',
            status: product.status || '',
            score: `${listingPassed}/${AUDIT_CHECKS.length}`,
            missing: AUDIT_CHECKS.filter((check) => !checks[check.key]).map((check) => check.label).join(', ') || '—',
            gaps: AUDIT_CHECKS.length - listingPassed,
        });
    }

    const completion = Math.round((passed / (products.length * AUDIT_CHECKS.length)) * 100);
    rows.sort((a, b) => b.gaps - a.gaps);

    return {
        ...REPORT_AUDIT,
        available: true,
        date: formatDate(content?.createdAt || new Date()),
        generatedAt: content?.createdAt || new Date(),
        tone: completion >= 80 ? 'good' : 'neutral',
        insight: `${completion}% completion across ${marketplaces} marketplace${marketplaces === 1 ? '' : 's'}`,
        summary: {
            headline: `${products.length} listings reviewed against ${AUDIT_CHECKS.length} content checks`,
            stats: [
                { label: 'Completion', value: completion, format: 'percent', tone: completion >= 80 ? 'good' : 'watch' },
                { label: 'Listings reviewed', value: products.length },
                ...AUDIT_CHECKS.map((check) => ({
                    label: check.label,
                    value: passCount[check.key],
                    tone: passCount[check.key] === products.length ? 'good' : 'watch',
                })),
            ],
            columns: [
                { key: 'sku', label: 'SKU' },
                { key: 'productName', label: 'Product' },
                { key: 'status', label: 'Status' },
                { key: 'score', label: 'Checks passed' },
                { key: 'missing', label: 'Missing' },
            ],
            rows,
        },
        caveats: [
            'Premium A+ is not distinguished from standard A+, and Storefront presence and content language are not audited — none of the three is available from the data we hold.',
        ],
    };
};

/* -------------------------------------------------------- 6. review requests */

const REPORT_REVIEWS = { key: 'review-requests', name: 'Review Requests', cadence: 'WEEKLY', format: 'docx' };

/**
 * The review funnel, counted over the last 7 days of orders. Every number here
 * is a count of ReviewOrder documents by reviewRequestStatus / canRequestReview,
 * which is exactly how the request processor records its own work.
 */
const buildReviewRequests = async (userId, country, region) => {
    // Anchor the week on the most recent order we hold, NOT on today. Review
    // ingestion is scheduled and rate-limited, and an account can easily go
    // weeks between runs — anchoring on today reported "no orders" for accounts
    // holding tens of thousands of them, purely because the newest was 8 days
    // old. This is the latest edition of a weekly report, not a live feed.
    const newest = await ReviewOrder.findOne({ User: userId, country, region })
        .sort({ purchaseDate: -1 })
        .select('purchaseDate')
        .lean();

    if (!newest?.purchaseDate) {
        return unavailable(REPORT_REVIEWS, 'No orders have been ingested for review requests yet.');
    }

    const anchor = new Date(`${toYmd(new Date(newest.purchaseDate))}T00:00:00.000Z`);
    const since = addDays(anchor, -7);
    // Flagged when the newest order is well behind today, so a stale edition is
    // never mistaken for this week's.
    const daysBehind = Math.round((utcToday() - anchor) / 86400000);

    const [counts, totalOrders] = await Promise.all([
        ReviewOrder.aggregate([
            { $match: { User: toObjectId(userId), country, region, purchaseDate: { $gte: since } } },
            {
                $group: {
                    _id: '$reviewRequestStatus',
                    count: { $sum: 1 },
                    eligible: { $sum: { $cond: [{ $eq: ['$canRequestReview', true] }, 1, 0] } },
                },
            },
        ]),
        ReviewOrder.countDocuments({ User: userId, country, region, purchaseDate: { $gte: since } }),
    ]);

    if (!totalOrders) {
        return unavailable(REPORT_REVIEWS, 'No orders have been ingested for review requests yet.');
    }

    const byStatus = Object.fromEntries(counts.map((row) => [row._id || 'not_requested', row.count]));
    const eligible = counts.reduce((sum, row) => sum + row.eligible, 0);

    const sent = byStatus.sent || 0;
    const queued = byStatus.queued || 0;
    const failed = byStatus.failed || 0;
    const notRequested = byStatus.not_requested || 0;
    // Everything Amazon would not accept a request for: checked, but ineligible.
    const ineligible = Math.max(totalOrders - eligible, 0);

    return {
        ...REPORT_REVIEWS,
        available: true,
        date: `Week of ${formatDate(since)}`,
        generatedAt: anchor,
        tone: failed > 0 ? 'watch' : 'neutral',
        insight: `${plural(sent, 'request')} sent, ${notRequested + failed} skipped`,
        summary: {
            headline: `${totalOrders} orders checked in the week to ${formatDate(anchor)}`,
            stats: [
                { label: 'Orders checked', value: totalOrders },
                { label: 'Eligible', value: eligible },
                { label: 'Requests sent', value: sent, tone: 'good' },
                { label: 'Queued', value: queued },
                { label: 'Ineligible', value: ineligible },
                { label: 'Failed', value: failed, tone: failed > 0 ? 'watch' : 'good' },
            ],
            columns: [
                { key: 'stage', label: 'Stage' },
                { key: 'orders', label: 'Orders', format: 'number' },
                { key: 'note', label: 'Note' },
            ],
            rows: [
                { stage: 'Orders checked', orders: totalOrders, note: 'Shipped orders inside the ingestion window' },
                { stage: 'Eligible to request', orders: eligible, note: 'Amazon accepted a solicitation for these' },
                { stage: 'Requests sent', orders: sent, note: 'Delivered to Amazon successfully' },
                { stage: 'Queued', orders: queued, note: 'Waiting for the next send window' },
                { stage: 'Ineligible', orders: ineligible, note: 'Outside the 5–30 day window, or already requested' },
                { stage: 'Failed', orders: failed, note: 'Rejected by Amazon or errored on send' },
            ],
        },
        caveats: daysBehind > 10
            ? [`This is the most recent week with order data. The newest order we hold is from ${formatDate(anchor)}, ${daysBehind} days ago — order ingestion has not run since.`]
            : [],
    };
};

/* --------------------------------------------------- 7. monthly performance */

const REPORT_MONTHLY = { key: 'monthly-performance', name: 'Monthly Performance Report', cadence: 'MONTHLY', format: 'docx' };

/** Sum sales and units over a date window. */
const sumSales = async (userId, country, region, startDate, endDate) => {
    const [result] = await SalesOnlyMetrics.aggregate([
        { $match: { User: toObjectId(userId), country, region, date: { $gte: startDate, $lte: endDate } } },
        {
            $group: {
                _id: null,
                totalSales: { $sum: { $ifNull: ['$sales.amount', 0] } },
                unitsSold: { $sum: { $ifNull: ['$unitsSold', 0] } },
            },
        },
    ]);
    return { totalSales: round(result?.totalSales || 0), unitsSold: result?.unitsSold || 0 };
};

/** Sum ad spend and ad sales over a window; ACOS is derived, never averaged. */
const sumPpc = async (userId, country, region, startDate, endDate) => {
    const [result] = await PPCMetrics.aggregate([
        // PPCMetrics stores userId as a string, unlike the ObjectId used elsewhere.
        { $match: { userId: String(userId), country, region, metricDate: { $gte: startDate, $lte: endDate } } },
        {
            $group: {
                _id: null,
                adSales: { $sum: { $ifNull: ['$summary.totalSales', 0] } },
                adSpend: { $sum: { $ifNull: ['$summary.totalSpend', 0] } },
            },
        },
    ]);
    const adSales = round(result?.adSales || 0);
    const adSpend = round(result?.adSpend || 0);
    return { adSales, adSpend, acos: adSales ? round((adSpend / adSales) * 100) : null };
};

const buildMonthlyPerformance = async (userId, country, region) => {
    // Anchor on the newest day we actually hold, NOT on the last complete
    // calendar month. Metric backfills run on a schedule and lag by weeks, so
    // asking for "last month" reported nothing for accounts holding months of
    // sales — the data was simply older than the window.
    const [latestSales, latestPpc] = await Promise.all([
        SalesOnlyMetrics.findOne({ User: userId, country, region }).sort({ date: -1 }).select('date').lean(),
        PPCMetrics.findOne({ userId: String(userId), country, region }).sort({ metricDate: -1 }).select('metricDate').lean(),
    ]);

    // Both are YYYY-MM-DD, so a plain string compare picks the later day.
    const latestYmd = [latestSales?.date, latestPpc?.metricDate].filter(Boolean).sort().pop();
    if (!latestYmd) {
        return unavailable(REPORT_MONTHLY, 'No sales or advertising data has been recorded for this marketplace yet.');
    }

    const anchor = new Date(`${latestYmd}T00:00:00.000Z`);
    const currentStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    // Day 0 of the next month is the last day of this one.
    const monthEnd = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    const currentEnd = anchor < monthEnd ? anchor : monthEnd;
    const partial = currentEnd < monthEnd;

    // A part-month must never be compared against a whole one — that alone
    // would read as a double-digit collapse in sales. Match the day count, the
    // same rule the ESF client dashboard uses for its comparison window.
    const spanDays = Math.round((currentEnd - currentStart) / 86400000);
    const previousStart = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - 1, 1));
    const previousEnd = addDays(previousStart, spanDays);

    const [current, previous, ppcCurrent, ppcPrevious] = await Promise.all([
        sumSales(userId, country, region, toYmd(currentStart), toYmd(currentEnd)),
        sumSales(userId, country, region, toYmd(previousStart), toYmd(previousEnd)),
        sumPpc(userId, country, region, toYmd(currentStart), toYmd(currentEnd)),
        sumPpc(userId, country, region, toYmd(previousStart), toYmd(previousEnd)),
    ]);

    if (!current.totalSales && !ppcCurrent.adSales) {
        // We got past the guard above, so metric days DO exist — they just sum
        // to nothing. "No data" would read as a sync failure when the truthful
        // answer is that the marketplace sold nothing, so say which it is.
        return unavailable(
            REPORT_MONTHLY,
            `No sales or ad spend recorded in ${formatMonth(currentStart)} — this marketplace was dormant.`
        );
    }

    // Both windows are the same length, so the label must say so — otherwise
    // "September" next to "August" implies whole months against each other.
    const periodLabel = partial
        ? `${formatMonth(currentStart)} to ${formatDate(currentEnd)}`
        : formatMonth(currentStart);
    const comparisonLabel = partial
        ? `the same ${spanDays + 1} days of ${formatMonth(previousStart)}`
        : formatMonth(previousStart);

    const salesChange = pctChange(current.totalSales, previous.totalSales);
    const acosDelta = ppcCurrent.acos !== null && ppcPrevious.acos !== null
        ? round(ppcCurrent.acos - ppcPrevious.acos, 1)
        : null;

    const insightParts = [];
    if (salesChange !== null) insightParts.push(`Sales ${salesChange >= 0 ? 'up' : 'down'} ${Math.abs(salesChange)}%`);
    if (ppcCurrent.acos !== null) insightParts.push(`ACOS ${ppcCurrent.acos}%`);

    return {
        ...REPORT_MONTHLY,
        available: true,
        date: periodLabel,
        generatedAt: currentEnd,
        tone: salesChange !== null && salesChange < 0 ? 'watch' : 'good',
        insight: insightParts.join(', ') || 'Performance recorded for the month',
        summary: {
            headline: `${periodLabel} against ${comparisonLabel}`,
            stats: [
                { label: 'Total sales', value: current.totalSales, format: 'currency', delta: salesChange, deltaFormat: 'percent' },
                { label: 'Units sold', value: current.unitsSold, delta: pctChange(current.unitsSold, previous.unitsSold), deltaFormat: 'percent' },
                { label: 'Ad sales', value: ppcCurrent.adSales, format: 'currency', delta: pctChange(ppcCurrent.adSales, ppcPrevious.adSales), deltaFormat: 'percent' },
                { label: 'Ad spend', value: ppcCurrent.adSpend, format: 'currency', delta: pctChange(ppcCurrent.adSpend, ppcPrevious.adSpend), deltaFormat: 'percent', deltaGoodWhen: 'down' },
                { label: 'ACOS', value: ppcCurrent.acos, format: 'percent', delta: acosDelta, deltaFormat: 'points', deltaGoodWhen: 'down' },
            ],
            columns: [
                { key: 'metric', label: 'Metric' },
                { key: 'current', label: periodLabel },
                { key: 'previous', label: partial ? `${formatMonth(previousStart)} (same days)` : formatMonth(previousStart) },
                { key: 'change', label: 'Change' },
            ],
            rows: [
                {
                    metric: 'Total sales',
                    current: current.totalSales,
                    previous: previous.totalSales,
                    change: salesChange === null ? '—' : `${salesChange >= 0 ? '+' : ''}${salesChange}%`,
                },
                {
                    metric: 'Units sold',
                    current: current.unitsSold,
                    previous: previous.unitsSold,
                    change: pctChange(current.unitsSold, previous.unitsSold) === null
                        ? '—'
                        : `${pctChange(current.unitsSold, previous.unitsSold) >= 0 ? '+' : ''}${pctChange(current.unitsSold, previous.unitsSold)}%`,
                },
                { metric: 'Ad sales', current: ppcCurrent.adSales, previous: ppcPrevious.adSales, change: '' },
                { metric: 'Ad spend', current: ppcCurrent.adSpend, previous: ppcPrevious.adSpend, change: '' },
                {
                    metric: 'ACOS',
                    current: ppcCurrent.acos === null ? '—' : `${ppcCurrent.acos}%`,
                    previous: ppcPrevious.acos === null ? '—' : `${ppcPrevious.acos}%`,
                    change: acosDelta === null ? '—' : `${acosDelta >= 0 ? '+' : ''}${acosDelta} pts`,
                },
            ],
        },
        caveats: [
            ...(partial
                ? [`${formatMonth(currentStart)} is still incomplete — this covers the ${spanDays + 1} days to ${formatDate(currentEnd)}, compared against the same ${spanDays + 1} days of ${formatMonth(previousStart)} so the two are like for like.`]
                : []),
            'Sessions and the per-marketplace narrative are not included yet. Actions taken and planned focus areas come from your account manager and are not part of this live view.',
        ],
    };
};

/* --------------------------------------------------------------- assembly */

/**
 * Build every report card for one marketplace.
 *
 * @param {string} userId  The client whose account is being viewed.
 * @param {string} country
 * @param {string} region
 */
const getEsfReports = async (userId, country, region) => {
    const startTime = Date.now();

    const reports = await Promise.all([
        settle(REPORT_RESTOCK, () => buildRestock(userId, country, region)),
        settle(REPORT_ACCOUNT, () => buildAccountOverview(userId, country, region)),
        settle(REPORT_BUYBOX, () => buildBuyBox(userId, country, region)),
        settle(REPORT_AGED, () => buildAgedInventory(userId, country, region)),
        settle(REPORT_AUDIT, () => buildListingsAudit(userId, country, region)),
        settle(REPORT_REVIEWS, () => buildReviewRequests(userId, country, region)),
        settle(REPORT_MONTHLY, () => buildMonthlyPerformance(userId, country, region)),
    ]);

    const available = reports.filter((report) => report.available);

    // The card the page opens on: the most recently generated one that has data.
    const featured = [...available].sort(
        (a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0)
    )[0] || null;

    logger.info(
        `[EsfReports] user=${userId} ${country}/${region} built ${available.length}/${reports.length} reports in ${Date.now() - startTime}ms`
    );

    return {
        marketplace: { country, region },
        reports,
        featuredKey: featured?.key || null,
        counts: { total: reports.length, available: available.length },
    };
};

module.exports = {
    getEsfReports,
    // exported for tests
    num,
    pctChange,
};
