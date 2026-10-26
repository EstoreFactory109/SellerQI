/**
 * Wave 3 of the tasks-logics.xlsx tasks: the ones that needed pipeline work first.
 *
 *   inventory:listing_warnings        Listing warnings (active SKUs' issues are now stored)
 *   account:invoice_defect_rate       Invoice defect rate (Amazon Business)
 *   inventory:low_inventory_fee_risk  Low-inventory-level fee risk
 *   inventory:fba_fee_increase        FBA fee increase or size tier change
 *
 * Same contract as Wave1Detectors: pure, `now` injected, `{ tasks, covered }`.
 */

const crypto = require('crypto');
const R = require('./KpiRules.js');

const PENDING = 'pending';
const hashOf = (text) => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 16);
const nameOf = (productsByAsin, asin) => {
    const p = productsByAsin.get(asin);
    return (p?.itemName || p?.title || p?.productName || asin || 'Unknown Product').substring(0, 100);
};
const ageDays = (iso, now) => {
    const t = Date.parse(iso || '');
    return Number.isFinite(t) ? (now.getTime() - t) / R.DAY_MS : Infinity;
};
const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
};

/**
 * Amazon's own issues on listings, grouped: shared by listing warnings (severity
 * WARNING) and listing errors (severity ERROR). Read from the catalogue rows, where
 * the listing syncs store each SKU's issues (active SKUs weekly, inactive daily).
 * Covered once any SKU in the marketplace carries the field.
 *
 * One cause, one task: the same message on LISTING_WARNING_GROUP_MIN+ listings (seen:
 * one rejected compliance document behind 2,041 listings' warnings) is a single
 * grouped task naming how many listings carry it.
 */
function detectListingIssues({ products = [], productsByAsin = new Map(), severity, errorCategory, errorType, text, skip = () => false }) {
    const synced = (products || []).some(p => Array.isArray(p?.listingIssues));
    if (!synced) return { tasks: [], covered: false };
    const byAsin = new Map();
    const asinsByMessage = new Map();
    for (const p of products || []) {
        if (!p?.asin || !Array.isArray(p.listingIssues)) continue;
        const issues = p.listingIssues.filter(i => String(i?.severity || '').toUpperCase() === severity && !skip(i));
        if (issues.length === 0) continue;
        const e = byAsin.get(p.asin) || { skus: new Set(), messages: new Set() };
        e.skus.add(p.sku);
        for (const w of issues) {
            if (!w.message) continue;
            const message = String(w.message).trim();
            e.messages.add(message);
            const set = asinsByMessage.get(message) || new Set();
            set.add(p.asin);
            asinsByMessage.set(message, set);
        }
        byAsin.set(p.asin, e);
    }

    const grouped = new Set([...asinsByMessage].filter(([, asins]) => asins.size >= R.LISTING_WARNING_GROUP_MIN).map(([m]) => m));
    const tasks = [];
    for (const message of grouped) {
        const asins = [...asinsByMessage.get(message)];
        tasks.push({
            asin: `${severity}:${hashOf(message)}`,
            productName: `${asins.length} listings`,
            errorCategory,
            errorType,
            error: `${text.label}: Amazon has the same ${text.noun} on ${asins.length} of your listings: ${message}`,
            solution: 'This is one issue repeated across listings, so fix it once at the source: upload or correct the document or attribute Amazon asks for (Seller Central > Account Health or Inventory > Fix Your Listings), then check a few of the listings below.',
            renderData: { listings: asins.length, asins: asins.slice(0, 50), messages: [message] },
            status: PENDING
        });
    }

    for (const [asin, e] of byAsin) {
        const messages = [...e.messages].filter(m => !grouped.has(m));
        if (messages.length === 0) continue;
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory,
            errorType,
            error: `${text.label}: Amazon has ${messages.length === 1 ? `a ${text.noun}` : `${messages.length} ${text.noun}s`} on this listing: ${messages.slice(0, 3).join(' | ') || 'see the listing in Seller Central'}.`,
            solution: text.solution,
            renderData: { skus: [...e.skus], messages: messages.slice(0, 10) },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * Listing warnings. Spreadsheet: any issue with severity WARNING (non-blocking, can
 * turn into a block).
 */
function detectListingWarnings({ products = [], productsByAsin = new Map() }) {
    return detectListingIssues({
        products, productsByAsin,
        severity: 'WARNING', errorCategory: 'inventory', errorType: 'listing_warnings',
        text: {
            label: 'Listing Warning',
            noun: 'warning',
            solution: 'Open the listing in Seller Central (Inventory > Manage All Inventory > Edit) and update the flagged field before Amazon turns the warning into a block.'
        }
    });
}

/**
 * Restricted words and claims (title, bullets, description). Spreadsheet: any listing
 * issue with severity ERROR is the task; our own claims list is only a review flag.
 * Issues that ARE the suppression are left to the suppressed-listing task.
 */
function detectListingErrors({ products = [], productsByAsin = new Map() }) {
    return detectListingIssues({
        products, productsByAsin,
        severity: 'ERROR', errorCategory: 'ranking', errorType: 'listing_errors',
        skip: (issue) => issue?.isSuppression === true,
        text: {
            label: 'Listing Error',
            noun: 'flag',
            solution: 'Update the flagged field so it meets Amazon\'s policy, following Amazon\'s message (Inventory > Fix Your Listings). Unfixed errors can lead to the listing being suppressed.'
        }
    });
}

/**
 * Invoice defect rate (Amazon Business). Spreadsheet: status not GOOD. Blank or NONE
 * is "does not apply", not a failure. A report saved before the field was read has
 * no answer, so it is not judged.
 */
function detectInvoiceDefectRate({ v2 }) {
    if (!v2 || !Object.prototype.hasOwnProperty.call(v2, 'invoiceDefectRateStatus')) return { tasks: [], covered: false };
    const status = String(v2.invoiceDefectRateStatus || '').trim().toUpperCase();
    if (!status || status === 'NONE' || status === 'GOOD') return { tasks: [], covered: true };
    const rate = v2.invoiceDefectRatePct;
    return {
        tasks: [{
            asin: 'ACCOUNT',
            productName: 'Account Health',
            errorCategory: 'account',
            errorType: 'invoice_defect_rate',
            error: `Account | Invoice Defect Rate: Some Amazon Business orders are missing invoices or had them uploaded late${Number.isFinite(rate) ? ` (invoice defect rate ${Math.round(rate * 100) / 100}%)` : ''}. Amazon rates this as ${status.toLowerCase().replace(/_/g, ' ')}.`,
            solution: 'Upload the missing invoices in Seller Central (Orders > Manage Orders, Business orders) and set up automatic invoice upload, or enable VAT Calculation Service where it is available.',
            renderData: { status, ratePct: Number.isFinite(rate) ? rate : null },
            status: PENDING
        }],
        covered: true
    };
}

/**
 * Low-inventory-level fee risk. Amazon rule: the fee applies when historical days of
 * supply is under 28 on both the short-term and long-term measures (per FNSKU since
 * Jan 2026). Early warning under 35 is internal. Amazon's flag, when present, wins.
 * Covered only when the planning report actually carries these columns; their
 * names are not documented, so until a live report confirms them this stays off.
 */
function detectLowInventoryFeeRisk({ planning, salesByAsin = {}, productsByAsin = new Map() }) {
    const rows = planning?.rows || [];
    const readable = rows.some(r => r.short !== null || r.long !== null || r.feeApplied !== null);
    if (!readable) return { tasks: [], covered: false };

    const byAsin = new Map();
    for (const r of rows) {
        if (!r.asin) continue;
        const flag = String(r.feeApplied ?? '').trim().toLowerCase();
        const applied = ['yes', 'y', 'true', '1'].includes(flag);
        const short = r.short;
        const long = r.long;
        const bothUnder = (limit) => short !== null && long !== null && short < limit && long < limit;
        let level = null;
        if (applied || bothUnder(R.LOW_INVENTORY_FEE_DAYS)) level = 'applies';
        else if (bothUnder(R.LOW_INVENTORY_WARNING_DAYS)) level = 'warning';
        if (!level) continue;
        // Days of supply means nothing for a product that is not selling.
        if (!((Number(salesByAsin[r.asin]?.unitsSold) || 0) > 0)) continue;
        const e = byAsin.get(r.asin);
        if (!e || (level === 'applies' && e.level !== 'applies')) byAsin.set(r.asin, { level, short, long });
    }

    const tasks = [];
    for (const [asin, e] of byAsin) {
        const days = Math.round(Math.max(e.short ?? 0, e.long ?? 0));
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'inventory',
            errorType: 'low_inventory_fee_risk',
            error: e.level === 'applies'
                ? `Low-Inventory Fee: This product's stock is low enough for its sales that Amazon adds a low-inventory-level fee to every unit sold (about ${days} days of supply, under Amazon's ${R.LOW_INVENTORY_FEE_DAYS}).`
                : `Low-Inventory Fee Warning: This product has about ${days} days of supply, close to the ${R.LOW_INVENTORY_FEE_DAYS} days below which Amazon adds a low-inventory-level fee to every unit sold.`,
            solution: `Send more stock so you hold at least ${R.LOW_INVENTORY_FEE_DAYS} days of sales at Amazon on both the 30-day and 90-day measures.`,
            renderData: { level: e.level, shortTermDays: e.short, longTermDays: e.long },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * FBA fee increase or size tier change. Spreadsheet: expected fulfilment fee or size
 * tier higher than the last snapshot. Compares this week's fee-estimate snapshot with
 * the previous one per SKU. A change the seller made themselves (new packaging) also
 * shows here; the text says to check measurements first. Amazon's yearly fee change
 * will also show once, which is accurate: the seller does pay more.
 */
function detectFbaFeeIncrease({ fbaFees, salesByAsin = {}, productsByAsin = new Map(), now }) {
    if (!fbaFees?.newest || !fbaFees.previous || ageDays(fbaFees.newest.at, now) > R.FBA_FEE_SNAPSHOT_MAX_AGE_DAYS) {
        return { tasks: [], covered: false };
    }
    const byAsin = new Map();
    for (const [sku, cur] of Object.entries(fbaFees.newest.bySku || {})) {
        const old = fbaFees.previous.bySku?.[sku];
        if (!old || !cur.asin) continue;
        const feeUp = cur.fee !== null && old.fee !== null && old.fee > 0 && (cur.fee - old.fee) / old.fee >= R.FBA_FEE_MIN_INCREASE_SHARE;
        const tierChanged = !!cur.sizeTier && !!old.sizeTier && cur.sizeTier !== old.sizeTier
            && (cur.fee === null || old.fee === null || cur.fee >= old.fee);
        if (!feeUp && !tierChanged) continue;
        const prev = byAsin.get(cur.asin);
        const delta = cur.fee !== null && old.fee !== null ? cur.fee - old.fee : 0;
        if (!prev || delta > prev.delta) byAsin.set(cur.asin, { sku, old, cur, delta, tierChanged });
    }

    const tasks = [];
    for (const [asin, e] of byAsin) {
        const units = Number(salesByAsin[asin]?.unitsSold) || 0;
        const feeText = e.cur.fee !== null && e.old.fee !== null
            ? `${e.cur.fee.toFixed(2)} per unit to fulfil, up from ${e.old.fee.toFixed(2)}`
            : 'a higher fulfilment fee';
        const tierText = e.tierChanged ? ` Its size tier changed from "${e.old.sizeTier}" to "${e.cur.sizeTier}".` : '';
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'inventory',
            errorType: 'fba_fee_increase',
            error: `FBA Fee Increase: Amazon now charges ${feeText}.${tierText}`,
            solution: 'Check the dimensions and weight Amazon holds for this product (Seller Central > Inventory > Fee Preview) against the real package. If Amazon measured it wrong, open a case asking for a re-measure and a refund of the extra fees.',
            // A month of the extra fee at the window's sales rate.
            amount: Math.round(Math.max(0, e.delta) * units * 100) / 100,
            amountIsEstimated: true,
            renderData: { sku: e.sku, oldFee: e.old.fee, newFee: e.cur.fee, oldSizeTier: e.old.sizeTier, newSizeTier: e.cur.sizeTier },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * Handling time (FBM). Spreadsheet: handling time over 2 days (P4) on seller-fulfilled
 * SKUs. Read from the catalogue rows the weekly listing sync fills; covered once any
 * SKU carries a fulfilment channel, i.e. that sync has run since it began storing it.
 */
function detectLongHandlingTime({ products = [], productsByAsin = new Map() }) {
    const synced = (products || []).some(p => p?.fulfillmentChannel);
    if (!synced) return { tasks: [], covered: false };
    const byAsin = new Map();
    for (const p of products || []) {
        if (!p?.asin || p.status !== 'Active' || p.fulfillmentChannel !== 'DEFAULT') continue;
        const days = Number(p.handlingTimeDays);
        if (!Number.isFinite(days) || days <= R.HANDLING_TIME_MAX_DAYS) continue;
        const prev = byAsin.get(p.asin);
        if (!prev || days > prev.days) byAsin.set(p.asin, { days, sku: p.sku });
    }
    const tasks = [];
    for (const [asin, e] of byAsin) {
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'inventory',
            errorType: 'handling_time_long',
            error: `Long Handling Time: This product, shipped by you, has a ${e.days}-day handling time, so Amazon shows shoppers a later delivery date.`,
            solution: `If your team can ship faster, lower the handling time on this offer (Inventory > Manage All Inventory > Edit > Offer > Handling time) to ${R.HANDLING_TIME_MAX_DAYS} days or less. Only promise what you can meet: late shipments hurt account health more.`,
            renderData: { handlingTimeDays: e.days, sku: e.sku },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * New seller on brand listing. Spreadsheet: a seller ID not seen before appears on a
 * brand-registered ASIN; exclude sellers the client has whitelisted. Compares this
 * week's brand-offer check with last week's, ASIN by ASIN, and only where both checks
 * got an answer for that ASIN and Amazon returned seller IDs at all — an ASIN or a
 * fetch without identities is "unknown", never "new seller".
 */
function detectNewSellerOnBrand({ brandOffers, productsByAsin = new Map(), now }) {
    const b = brandOffers;
    if (!b?.newest || !b.previous || ageDays(b.newest.at, now) > R.BRAND_OFFERS_MAX_AGE_DAYS
        || !b.newest.sellerIdsReturned || !b.previous.sellerIdsReturned) {
        return { tasks: [], covered: false };
    }
    const authorized = new Set(b.authorized || []);
    const tasks = [];
    for (const [asin, cur] of Object.entries(b.newest.byAsin || {})) {
        const old = b.previous.byAsin?.[asin];
        if (!old || cur.error || old.error) continue;
        const known = new Set(old.sellerIds);
        const fresh = cur.sellerIds.filter(id => !known.has(id) && !authorized.has(id));
        if (fresh.length === 0) continue;
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'inventory',
            errorType: 'new_seller_on_brand',
            error: `New Seller on Your Brand Listing: ${fresh.length === 1 ? 'A new seller' : `${fresh.length} new sellers`} started offering this product since last week (seller ${fresh.join(', ')}). It can be an unauthorised reseller or a counterfeit.`,
            solution: 'Check whether they are your authorised reseller; if so, mark them as one below. If not, place a test buy, and report the listing through Brand Registry (Report a Violation) with the evidence if the item is counterfeit or infringes your brand.',
            renderData: { sellerIds: fresh },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

module.exports = {
    detectListingErrors,
    detectListingIssues,
    detectNewSellerOnBrand,
    detectLongHandlingTime,
    detectListingWarnings,
    detectInvoiceDefectRate,
    detectLowInventoryFeeRisk,
    detectFbaFeeIncrease,
    num
};
