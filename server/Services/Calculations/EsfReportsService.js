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
 * One bullet in a report's Performance Highlights block.
 *
 * `tone` maps onto the shared report stylesheet the whole family uses:
 *   good/neutral -> plain bullet, watch -> red "flag" text,
 *   fill -> blue italic, the account manager's own copy for this cycle.
 */
const highlight = (text, tone = 'neutral') => ({ text, tone });

/** Bullets every report ends on: what a person still has to write. */
const MANAGER_NOTE = highlight('[Account manager commentary for this cycle]', 'fill');

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
        highlights: [
            urgent
                ? highlight(`${plural(urgent, 'SKU')} flagged urgent by Amazon and ${outOfStock} already out of stock.`, 'watch')
                : highlight(`No SKU is flagged urgent; ${needsRestock} are due a routine replenishment.`, 'good'),
            highlight(`Replenishing everything Amazon recommends is about ${Math.round(reorderValue).toLocaleString()} at current prices.`),
            ...(rows[0]?.isUrgent
                ? [highlight(`${rows[0].sku || rows[0].asin} carries the largest urgent reorder at ${Math.round(rows[0].reorderValue).toLocaleString()}.`, 'watch')]
                : []),
            highlight('[Purchase orders raised this cycle]', 'fill'),
        ],
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
            emptyMessage: 'No weekly history has been recorded for this account yet.',
        },
        highlights: [
            outOfStock
                ? highlight(`${outOfStock} of ${products.length} listings are active but out of stock.`, 'watch')
                : highlight(`All ${active} active listings are carrying stock.`, 'good'),
            ...(current && previous
                ? [(() => {
                    const delta = num(current.TotalNumberOfIssues) - num(previous.TotalNumberOfIssues);
                    if (delta === 0) return highlight('Open issues are unchanged week on week.');
                    return highlight(
                        `Open issues ${delta < 0 ? 'fell' : 'rose'} by ${Math.abs(delta)} week on week.`,
                        delta < 0 ? 'good' : 'watch'
                    );
                })()]
                : []),
            highlight('[Observation / remarks for this week]', 'fill'),
        ],
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
        highlights: [
            losing.length
                ? highlight(`${plural(losing.length, 'ASIN')} of ${total} lost the Buy Box in the latest snapshot.`, 'watch')
                : highlight(`All ${total} tracked ASINs held the Buy Box in the latest snapshot.`, 'good'),
            ...(rows[0]?.periodsLosing > 1
                ? [highlight(`${rows[0].sku !== '—' ? rows[0].sku : rows[0].asin} has been losing for ${rows[0].periodsLosing} consecutive snapshots — the longest run on the account.`, 'watch')]
                : []),
            ...((latest.productsWithLowBuyBox || 0) > 0
                ? [highlight(`${plural(latest.productsWithLowBuyBox, 'ASIN')} held the Buy Box less than half the time.`, 'watch')]
                : []),
            highlight('[Pricing or fulfilment action taken on the contested listings]', 'fill'),
        ],
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
                .sort((a, b) => b.band365plus - a.band365plus || b.band271to365 - a.band271to365),
            // Also a good outcome: tracked stock exists, none of it is ageing.
            emptyMessage: 'No tracked ASIN is carrying stock older than 180 days.',
        },
        highlights: [
            band365plus
                ? highlight(`${plural(band365plus, 'unit')} have been in FBA for over a year and are accruing the highest storage rate.`, 'watch')
                : highlight('No stock has passed the 365-day mark.', 'good'),
            highlight(`${plural(aged, 'unit')} across ${items.length} ASINs are past 180 days and now incurring aged-storage fees.`, aged ? 'watch' : 'good'),
            ...(unfulfillable
                ? [highlight(`${plural(unfulfillable, 'unit')} are unfulfillable and should be removed or disposed of.`, 'watch')]
                : []),
            highlight('[Removal or liquidation plan for aged stock]', 'fill'),
        ],
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
        highlights: [
            highlight(
                `Catalogue is ${completion}% complete against the ${AUDIT_CHECKS.length} content checks.`,
                completion >= 80 ? 'good' : 'watch'
            ),
            // The check that fails most often is the single most useful line here.
            ...(() => {
                const worst = [...AUDIT_CHECKS]
                    .map((check) => ({ check, missing: products.length - passCount[check.key] }))
                    .sort((a, b) => b.missing - a.missing)[0];
                return worst && worst.missing > 0
                    ? [highlight(`${worst.check.label} is the widest gap — missing on ${worst.missing} of ${products.length} listings.`, 'watch')]
                    : [highlight('Every listing passes all content checks.', 'good')];
            })(),
            ...(rows[0]?.gaps
                ? [highlight(`${rows[0].sku || rows[0].asin} needs the most work, failing ${rows[0].gaps} of ${AUDIT_CHECKS.length} checks.`, 'watch')]
                : []),
            highlight('[Listings scheduled for content work this quarter]', 'fill'),
        ],
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
        highlights: [
            highlight(`${plural(sent, 'review request')} sent from ${totalOrders} orders checked in the week to ${formatDate(anchor)}.`, sent ? 'good' : 'neutral'),
            highlight(
                `${ineligible} orders were not eligible — typically outside Amazon's 5 to 30 day solicitation window, or already requested.`
            ),
            ...(failed
                ? [highlight(`${plural(failed, 'request')} failed on send and should be retried.`, 'watch')]
                : []),
            MANAGER_NOTE,
        ],
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
        highlights: [
            ...(salesChange !== null
                ? [highlight(
                    `Total sales ${salesChange >= 0 ? 'grew' : 'fell'} ${Math.abs(salesChange)}% against ${comparisonLabel}.`,
                    salesChange >= 0 ? 'good' : 'watch'
                )]
                : []),
            ...(acosDelta !== null
                ? [highlight(
                    `ACOS moved from ${ppcPrevious.acos}% to ${ppcCurrent.acos}% — ${acosDelta <= 0 ? 'an improvement' : 'a decline'} of ${Math.abs(acosDelta)} points.`,
                    acosDelta <= 0 ? 'good' : 'watch'
                )]
                : []),
            ...(ppcCurrent.adSales && current.totalSales
                ? [highlight(`Advertising drove ${round((ppcCurrent.adSales / current.totalSales) * 100, 1)}% of total sales this period.`)]
                : []),
            highlight('[Actions taken this month and focus areas planned for next]', 'fill'),
        ],
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
 * Rows sent with the card payload. The page shows one screenful and pages the
 * rest through getEsfReportRows — a catalogue of 27,000 listings must never be
 * serialised into a cached JSON blob just to fill a preview table.
 */
const PREVIEW_ROWS = 10;

/** Hard ceiling on a single page, so a crafted ?limit cannot dump the catalogue. */
const MAX_PAGE_ROWS = 100;

/** Builders keyed the way the route addresses them. */
const BUILDERS = {
    [REPORT_RESTOCK.key]: { meta: REPORT_RESTOCK, build: buildRestock },
    [REPORT_ACCOUNT.key]: { meta: REPORT_ACCOUNT, build: buildAccountOverview },
    [REPORT_BUYBOX.key]: { meta: REPORT_BUYBOX, build: buildBuyBox },
    [REPORT_AGED.key]: { meta: REPORT_AGED, build: buildAgedInventory },
    [REPORT_AUDIT.key]: { meta: REPORT_AUDIT, build: buildListingsAudit },
    [REPORT_REVIEWS.key]: { meta: REPORT_REVIEWS, build: buildReviewRequests },
    [REPORT_MONTHLY.key]: { meta: REPORT_MONTHLY, build: buildMonthlyPerformance },
};

/**
 * Trim a built report down to what the card payload carries.
 *
 * Builders return every row they found; this is the ONLY place that decides how
 * many travel, so the preview and the paged fetch can never disagree about the
 * total.
 */
const toCard = (report) => {
    if (!report.available || !report.summary) return report;
    const rows = report.summary.rows || [];
    return {
        ...report,
        summary: { ...report.summary, rows: rows.slice(0, PREVIEW_ROWS), totalRows: rows.length },
        pageSize: PREVIEW_ROWS,
    };
};

/**
 * Build every report card for one marketplace.
 *
 * @param {string} userId  The client whose account is being viewed.
 * @param {string} country
 * @param {string} region
 */
const getEsfReports = async (userId, country, region) => {
    const startTime = Date.now();

    const built = await Promise.all(
        Object.values(BUILDERS).map(({ meta, build }) => settle(meta, () => build(userId, country, region)))
    );
    const reports = built.map(toCard);

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

/**
 * One page of a single report's rows.
 *
 * Runs only that report's builder rather than all seven, then slices. The rows
 * are derived from snapshots already in Mongo, so rebuilding per page is
 * cheaper than holding tens of thousands of rows in the Redis-cached card
 * payload — and the route caches each page anyway.
 *
 * @returns {Promise<{rows, columns, page, pageSize, totalRows, totalPages}>}
 */
const getEsfReportRows = async (userId, country, region, reportKey, { page = 1, limit = PREVIEW_ROWS } = {}) => {
    const entry = BUILDERS[reportKey];
    if (!entry) return null;

    const report = await settle(entry.meta, () => entry.build(userId, country, region));
    if (!report.available || !report.summary) {
        return { key: reportKey, available: false, reason: report.reason, rows: [], columns: [], page: 1, pageSize: limit, totalRows: 0, totalPages: 0 };
    }

    const allRows = report.summary.rows || [];
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || PREVIEW_ROWS, 1), MAX_PAGE_ROWS);
    const totalPages = Math.max(Math.ceil(allRows.length / pageSize), 1);
    // Clamp rather than 404 on an out-of-range page: the row count can shrink
    // between the page being opened and a later page being asked for.
    const current = Math.min(Math.max(parseInt(page, 10) || 1, 1), totalPages);
    const start = (current - 1) * pageSize;

    return {
        key: reportKey,
        available: true,
        columns: report.summary.columns || [],
        rows: allRows.slice(start, start + pageSize),
        emptyMessage: report.summary.emptyMessage || null,
        page: current,
        pageSize,
        totalRows: allRows.length,
        totalPages,
    };
};

/* ----------------------------------------------------------------- history */

/**
 * Editions of one report over time.
 *
 * There is still no recurring-report model — nothing stores a "published
 * edition". What DOES exist is the snapshot trail: every fetcher writes a new
 * document per run with `.create()`, and none of those collections has a TTL or
 * a prune, so the history is genuinely there to be read. One snapshot is one
 * edition, and its date is when we captured it, not when anyone published it.
 *
 * That distinction is why nothing here says "Published 6:02 am": the editions
 * are as frequent as the underlying sync, which is hourly for some reports and
 * far rarer for others. Calling a capture a publication would be inventing a
 * schedule that does not exist.
 */
const HISTORY_LIMIT = 40;

/**
 * One row in the editions list.
 *
 * `when` is what the edition COVERS (a day, or a month); `capturedAt` is when
 * we actually took the snapshot, and the two are not the same thing. Several
 * captures can land on one day, and deriving the timestamp from the day would
 * collapse them into rows the reader cannot tell apart — which is exactly what
 * happened to Buy Box, where 23 of 35 editions rendered identically.
 *
 * A malformed date yields null rather than throwing: one bad row in a
 * collection must not take a whole history down (a single short `date` string
 * threw RangeError and made monthly performance unavailable for an account).
 */
const edition = (when, summary, tone = 'neutral', { capturedAt = null, showCapturedTime = true } = {}) => {
    const covers = new Date(when);
    if (Number.isNaN(covers.getTime())) return null;

    const captured = capturedAt ? new Date(capturedAt) : covers;
    const capturedValid = !Number.isNaN(captured.getTime());

    return {
        iso: covers.toISOString().slice(0, 10),
        date: formatDate(covers),
        capturedAt: capturedValid ? captured.toISOString() : null,
        // Only true where a clock time is meaningful. A month-grained edition
        // has no capture time worth printing, and printing 00:00 implies one.
        showCapturedTime: showCapturedTime && capturedValid,
        summary,
        tone,
    };
};

const historyBuilders = {
    [REPORT_BUYBOX.key]: async (userId, country, region) => {
        const snapshots = await BuyBoxData.find({ User: userId, country, region })
            .sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean();
        if (!snapshots.length) return null;

        const editions = snapshots.map((snapshot) => {
            const losing = snapshot.asinBuyBoxData?.filter((r) => num(r.buyBoxPercentage) === 0).length || 0;
            const total = snapshot.totalProducts || snapshot.asinBuyBoxData?.length || 0;
            return edition(
                snapshot.date ? `${snapshot.date}T00:00:00.000Z` : snapshot.createdAt,
                `${losing} of ${total} ASINs losing buy box`,
                losing > 0 ? 'watch' : 'good',
                // createdAt, not the covered day: several captures share a day.
                { capturedAt: snapshot.createdAt }
            );
        }).filter(Boolean);

        // Longest run of consecutive snapshots in which any one ASIN held 0%.
        const streaks = new Map();
        let longest = 0;
        for (const snapshot of snapshots) {
            const losingNow = new Set(
                (snapshot.asinBuyBoxData || []).filter((r) => num(r.buyBoxPercentage) === 0).map((r) => r.childAsin)
            );
            for (const asin of losingNow) {
                const next = (streaks.get(asin) || 0) + 1;
                streaks.set(asin, next);
                if (next > longest) longest = next;
            }
            for (const asin of [...streaks.keys()]) if (!losingNow.has(asin)) streaks.delete(asin);
        }

        const latest = snapshots[0];
        return {
            editions,
            stats: [
                { label: 'ASINs tracked', value: latest.totalProducts || 0 },
                { label: 'Currently losing', value: latest.asinBuyBoxData?.filter((r) => num(r.buyBoxPercentage) === 0).length || 0, tone: 'watch' },
                { label: 'Longest losing run', value: longest, suffix: longest === 1 ? 'snapshot' : 'snapshots' },
            ],
        };
    },

    [REPORT_RESTOCK.key]: async (userId, country, region) => {
        const snapshots = await RestockInventoryRecommendations.find({ User: userId, country, region })
            .sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean();
        if (!snapshots.length) return null;

        const editions = snapshots.map((snapshot) => {
            const products = snapshot.Products || [];
            const urgent = products.filter((p) => /urgent|out of stock/i.test(String(p.alert || ''))).length;
            const needed = products.filter((p) => num(p.recommendedReplenishmentQty) > 0).length;
            return edition(
                snapshot.createdAt,
                urgent ? `${urgent} urgent, ${needed} need restock` : `${needed} need restock, none urgent`,
                urgent > 0 ? 'watch' : 'good'
            );
        }).filter(Boolean);

        const latest = snapshots[0].Products || [];
        return {
            editions,
            stats: [
                { label: 'SKUs tracked', value: latest.length },
                { label: 'Urgent now', value: latest.filter((p) => /urgent|out of stock/i.test(String(p.alert || ''))).length, tone: 'watch' },
                { label: 'Editions on file', value: snapshots.length },
            ],
        };
    },

    [REPORT_AGED.key]: async (userId, country, region) => {
        const snapshots = await FbaInventoryPlanningData.find({ User: userId, country, region })
            .sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean();
        if (!snapshots.length) return null;

        const over365 = (snapshot) => (snapshot.data || [])
            .reduce((sum, item) => sum + num(item.quantity_to_be_charged_ais_365_plus_days), 0);

        const editions = snapshots.map((snapshot) => edition(
            snapshot.createdAt,
            `${plural(over365(snapshot), 'unit')} over 365 days across ${plural((snapshot.data || []).length, 'ASIN')}`,
            over365(snapshot) > 0 ? 'watch' : 'good'
        )).filter(Boolean);

        return {
            editions,
            stats: [
                { label: 'ASINs tracked', value: (snapshots[0].data || []).length },
                { label: 'Units over 365 days', value: over365(snapshots[0]), tone: over365(snapshots[0]) > 0 ? 'watch' : 'good' },
                { label: 'Editions on file', value: snapshots.length },
            ],
        };
    },

    [REPORT_ACCOUNT.key]: async (userId, country, region) => {
        const history = await AccountHistory.findOne({ User: userId, country, region }).lean();
        const entries = [...(history?.accountHistory || [])]
            .filter((entry) => entry?.Date)
            .sort((a, b) => new Date(b.Date) - new Date(a.Date))
            .slice(0, HISTORY_LIMIT);
        if (!entries.length) return null;

        const editions = entries.map((entry) => edition(
            entry.Date,
            `Health ${num(entry.HealthScore)}, ${plural(num(entry.TotalNumberOfIssues), 'issue')} across ${plural(num(entry.TotalProducts), 'listing')}`,
            num(entry.TotalNumberOfIssues) > 0 ? 'watch' : 'good'
        )).filter(Boolean);

        const current = entries[0];
        const previous = entries[1];
        return {
            editions,
            stats: [
                { label: 'Health score', value: num(current.HealthScore), delta: previous ? round(num(current.HealthScore) - num(previous.HealthScore), 1) : null },
                { label: 'Open issues', value: num(current.TotalNumberOfIssues), tone: 'watch', delta: previous ? num(current.TotalNumberOfIssues) - num(previous.TotalNumberOfIssues) : null, deltaGoodWhen: 'down' },
                { label: 'Weeks recorded', value: entries.length },
            ],
        };
    },

    [REPORT_AUDIT.key]: async (userId, country, region) => {
        const snapshots = await NumberOfProductReviews.find({ User: userId, country, region })
            .sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean();
        if (!snapshots.length) return null;

        // Scored against the five checks each snapshot carries on its own. A+ is
        // in a separate collection with no history of its own, so it is left out
        // here rather than scored as absent, which would understate every edition.
        const SNAPSHOT_CHECKS = 5;
        const completionOf = (snapshot) => {
            const products = snapshot.Products || [];
            if (!products.length) return 0;
            let passed = 0;
            for (const p of products) {
                if (p.about_product?.length) passed += 1;
                if (p.product_description?.length) passed += 1;
                if ((p.product_photos?.length || 0) >= 5) passed += 1;
                if (p.video_url?.length) passed += 1;
                if (p.has_brandstory) passed += 1;
            }
            return Math.round((passed / (products.length * SNAPSHOT_CHECKS)) * 100);
        };

        const editions = snapshots.map((snapshot) => edition(
            snapshot.createdAt,
            `${completionOf(snapshot)}% content completion across ${plural((snapshot.Products || []).length, 'listing')}`,
            completionOf(snapshot) >= 80 ? 'good' : 'neutral'
        )).filter(Boolean);

        return {
            editions,
            stats: [
                { label: 'Content completion', value: completionOf(snapshots[0]), format: 'percent' },
                { label: 'Listings captured', value: (snapshots[0].Products || []).length },
                { label: 'Editions on file', value: snapshots.length },
            ],
            note: 'Completion here covers the five checks each capture carries (bullets, description, images, video, Brand Story). A+ Content is stored separately with no history of its own, so it is not scored in these editions.',
        };
    },

    [REPORT_REVIEWS.key]: async (userId, country, region) => {
        // Orders grouped into weeks — one week is one edition.
        const rows = await ReviewOrder.aggregate([
            { $match: { User: toObjectId(userId), country, region, purchaseDate: { $ne: null } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%G-W%V', date: '$purchaseDate' } },
                    weekStart: { $min: '$purchaseDate' },
                    orders: { $sum: 1 },
                    sent: { $sum: { $cond: [{ $eq: ['$reviewRequestStatus', 'sent'] }, 1, 0] } },
                    failed: { $sum: { $cond: [{ $eq: ['$reviewRequestStatus', 'failed'] }, 1, 0] } },
                },
            },
            { $sort: { weekStart: -1 } },
            { $limit: HISTORY_LIMIT },
        ]);
        if (!rows.length) return null;

        const editions = rows.map((row) => edition(
            row.weekStart,
            `${plural(row.sent, 'request')} sent from ${plural(row.orders, 'order')} checked`,
            row.failed > 0 ? 'watch' : 'neutral'
        )).filter(Boolean);

        return {
            editions,
            stats: [
                { label: 'Requests sent', value: rows.reduce((n, r) => n + r.sent, 0) },
                { label: 'Orders checked', value: rows.reduce((n, r) => n + r.orders, 0) },
                { label: 'Weeks on file', value: rows.length },
            ],
        };
    },

    [REPORT_MONTHLY.key]: async (userId, country, region) => {
        const rows = await SalesOnlyMetrics.aggregate([
            { $match: { User: toObjectId(userId), country, region } },
            {
                $group: {
                    _id: { $substr: ['$date', 0, 7] },
                    sales: { $sum: { $ifNull: ['$sales.amount', 0] } },
                    units: { $sum: { $ifNull: ['$unitsSold', 0] } },
                    days: { $sum: 1 },
                },
            },
            { $sort: { _id: -1 } },
            { $limit: HISTORY_LIMIT },
        ]);
        if (!rows.length) return null;

        const editions = rows.map((row, index) => {
            // _id is a YYYY-MM slice of the stored date; a short or malformed
            // date string yields something that is not a month, and one such row
            // must not sink the whole history.
            if (!/^\d{4}-\d{2}$/.test(String(row._id || ''))) return null;
            const previous = rows[index + 1];
            const change = previous ? pctChange(row.sales, previous.sales) : null;
            return {
                ...edition(
                    `${row._id}-01T00:00:00.000Z`,
                    `${formatMonth(`${row._id}-01T00:00:00.000Z`)}: ${round(row.sales)} sales over ${plural(row.days, 'day')}`
                        + (change === null ? '' : `, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}%`),
                    change === null ? 'neutral' : change >= 0 ? 'good' : 'watch',
                    // A month has no capture time worth showing.
                    { showCapturedTime: false }
                ),
                // Whole months read better than a day for this one.
                date: formatMonth(`${row._id}-01T00:00:00.000Z`),
            };
        }).filter(Boolean);

        return {
            editions,
            stats: [
                { label: 'Latest month sales', value: round(rows[0].sales), format: 'currency' },
                { label: 'Units', value: rows[0].units },
                { label: 'Months on file', value: rows.length },
            ],
        };
    },
};

/**
 * Every recorded edition of one report.
 *
 * @returns {Promise<object|null>} null when the key is not a report we publish
 */
const getEsfReportHistory = async (userId, country, region, reportKey) => {
    const entry = BUILDERS[reportKey];
    if (!entry) return null;

    const meta = {
        key: entry.meta.key,
        name: entry.meta.name,
        cadence: entry.meta.cadence,
        marketplace: { country, region },
    };

    let built = null;
    try {
        built = await historyBuilders[reportKey]?.(userId, country, region);
    } catch (error) {
        logger.error(`[EsfReports] history for ${reportKey} failed: ${error.message}`, { stack: error.stack });
    }

    if (!built) {
        return { ...meta, available: false, editions: [], totalEditions: 0, stats: [], reason: 'No editions of this report have been captured for this marketplace yet.' };
    }

    return {
        ...meta,
        available: true,
        editions: built.editions,
        totalEditions: built.editions.length,
        stats: built.stats || [],
        note: built.note || null,
        // Said once, here, because every editions list is capture times rather
        // than publication times and the difference matters to a reader.
        capturedNote: 'Each edition is a capture of your account data at that moment. There is no separate publishing schedule behind these yet.',
    };
};

module.exports = {
    getEsfReports,
    getEsfReportRows,
    getEsfReportHistory,
    // exported for tests
    num,
    pctChange,
    PREVIEW_ROWS,
    MAX_PAGE_ROWS,
};
