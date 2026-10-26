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
        const yes = (v) => ['yes', 'y', 'true', '1'].includes(String(v ?? '').trim().toLowerCase());
        // Spreadsheet: respect Amazon's exemptions (shown in the report).
        if (yes(r.exempt)) continue;
        const applied = yes(r.feeApplied);
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

/**
 * Return reason spike. Spreadsheet: 'not as described', 'defective' or 'wrong item'
 * are 30%+ of a product's returns in the last 30 days. One task per ASIN.
 */
function detectReturnReasonSpike({ returns, productsByAsin = new Map(), now }) {
    const age = returns ? (now.getTime() - new Date(returns.fetchedAt).getTime()) / R.DAY_MS : Infinity;
    // Fetched weekly; older than two weeks is not judged. An unreadable file is no answer.
    if (!returns || returns.unreadable || !(age <= 14)) return { tasks: [], covered: false };
    const from = new Date(now.getTime() - R.RETURN_SPIKE_DAYS * R.DAY_MS).toISOString().slice(0, 10);
    const byAsin = new Map();
    for (const line of returns.lines || []) {
        if (!line?.asin || String(line.returnDate || '').slice(0, 10) < from) continue;
        const a = byAsin.get(line.asin) || { total: 0, fault: 0, reasons: {} };
        const qty = Number(line.quantity) || 1;
        a.total += qty;
        if (R.isProductFaultReturn(line.reason)) {
            a.fault += qty;
            a.reasons[line.reason] = (a.reasons[line.reason] || 0) + qty;
        }
        byAsin.set(line.asin, a);
    }
    const tasks = [];
    for (const [asin, a] of byAsin) {
        if (a.total < R.RETURN_SPIKE_MIN_RETURNS || a.fault / a.total < R.RETURN_SPIKE_SHARE) continue;
        const share = Math.round((a.fault / a.total) * 100);
        const top = Object.entries(a.reasons).sort((x, y) => y[1] - x[1])
            .map(([reason, n]) => `${reason.toLowerCase().replace(/_/g, ' ')} (${n})`).join(', ');
        const p = productsByAsin.get(asin);
        tasks.push({
            asin,
            productName: (p?.itemName || p?.title || asin).substring(0, 100),
            errorCategory: 'inventory',
            errorType: 'return_reason_spike',
            error: `Returns | Reason Spike: ${share}% of this product's ${a.total} returns in the last ${R.RETURN_SPIKE_DAYS} days say it was defective, not as described or the wrong item: ${top}.`,
            solution: 'Read the return comments in Seller Central (Reports > Fulfillment > Customer Returns), fix the listing if it misleads, and check the stock or supplier for a quality problem.',
            renderData: { returns: a.total, faultReturns: a.fault, sharePct: share, reasons: a.reasons },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

const FIELD_NAMES = { title: 'title', price: 'price', bulletpoints: 'bullet points', main_image: 'main image', brand: 'brand' };
const quote = (v) => `"${String(v).slice(0, 80)}${String(v).length > 80 ? '…' : ''}"`;

/**
 * Detail page changed without us. A change in the last 7 days to title, price,
 * bullet points, main image or brand that no recorded edit explains (Fix It or an
 * approved task fix, up to 3 days before), and that the seller has not said was
 * theirs. Repricer price moves (3+ days of the last 7) are left out. One task per ASIN.
 */
function detectDetailPageChanged({ listingChanges, productsByAsin = new Map(), now }) {
    if (!listingChanges) return { tasks: [], covered: false };
    const DAY = R.DAY_MS;
    const since = now.getTime() - R.DETAIL_CHANGE_DAYS * DAY;
    const events = (listingChanges.events || []).filter(e => e?.asin && new Date(e.createdAt).getTime() >= since);

    const priceDays = new Map();
    for (const e of events) {
        if (e.field !== 'price') continue;
        const key = `${e.asin}|${e.sku}`;
        if (!priceDays.has(key)) priceDays.set(key, new Set());
        priceDays.get(key).add(new Date(e.createdAt).toISOString().slice(0, 10));
    }
    const fixAttr = { title: 'title', bulletpoints: 'bulletpoints' };
    const ours = (e) => (listingChanges.ourFixes || []).some(f => f.asin === e.asin
        && fixAttr[e.field] === f.attribute
        && new Date(f.fixedAt).getTime() <= new Date(e.createdAt).getTime() + DAY
        && new Date(f.fixedAt).getTime() >= new Date(e.createdAt).getTime() - R.DETAIL_CHANGE_OURS_DAYS * DAY);

    const byAsin = new Map();
    for (const e of events) {
        if (e.sellerConfirmed || ours(e)) continue;
        if (e.field === 'price' && (priceDays.get(`${e.asin}|${e.sku}`)?.size || 0) >= R.REPRICER_PRICE_DAYS) continue;
        if (!byAsin.has(e.asin)) byAsin.set(e.asin, []);
        byAsin.get(e.asin).push(e);
    }

    const tasks = [];
    for (const [asin, list] of byAsin) {
        // The newest change per field.
        const latest = new Map();
        for (const e of list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) latest.set(e.field, e);
        const parts = [...latest.values()].map(e => {
            const name = FIELD_NAMES[e.field] || e.field;
            if (e.field === 'title' || e.field === 'brand' || e.field === 'price') return `${name} changed from ${quote(e.oldValue)} to ${quote(e.newValue)}`;
            return `${name} changed`;
        });
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'ranking',
            errorType: 'detail_page_changed',
            error: `Detail Page Changed: This listing changed in the last ${R.DETAIL_CHANGE_DAYS} days with no record of you or SellerQI making the change: ${parts.join('; ')}.`,
            solution: 'If you or your team made this change, mark it as yours. If not, check the listing in Seller Central, restore the correct content, and contact Brand Registry support if someone else changed it.',
            renderData: { eventIds: list.map(e => String(e._id)), fields: [...latest.keys()] },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * Returns processing fee risk. Spreadsheet: trailing 3-month return rate at 80%+ of
 * the category threshold. Thresholds come from kpi/ReturnThresholds.js (maintained
 * by hand); a product whose category is not listed gets no verdict.
 */
function detectReturnsFeeRisk({ returns, shipped90, fbaFees, country, productsByAsin = new Map(), now }) {
    const T = require('./ReturnThresholds.js');
    if (!T.hasThresholds(country) || !returns || returns.unreadable || !shipped90 || !fbaFees?.newest) {
        return { tasks: [], covered: false };
    }
    const groupOf = new Map();
    for (const row of Object.values(fbaFees.newest.bySku || {})) if (row?.asin && row.productGroup) groupOf.set(row.asin, row.productGroup);
    const from = new Date(now.getTime() - R.RETURNS_FEE_DAYS * R.DAY_MS).toISOString().slice(0, 10);
    const returned = new Map();
    for (const l of returns.lines || []) {
        if (!l?.asin || String(l.returnDate || '').slice(0, 10) < from) continue;
        returned.set(l.asin, (returned.get(l.asin) || 0) + (Number(l.quantity) || 1));
    }
    const tasks = [];
    for (const [asin, units] of returned) {
        const shipped = Number(shipped90[asin]?.unitsSold) || 0;
        const threshold = T.thresholdFor(groupOf.get(asin));
        if (threshold === null || shipped < R.RETURNS_FEE_MIN_SHIPPED) continue;
        const rate = (units / shipped) * 100;
        if (rate < threshold * R.RETURNS_FEE_WARN_SHARE) continue;
        const over = rate >= threshold;
        const rate1 = Math.round(rate * 10) / 10;
        tasks.push({
            asin,
            productName: nameOf(productsByAsin, asin),
            errorCategory: 'inventory',
            errorType: 'returns_fee_risk',
            error: over
                ? `Returns Fee: ${rate1}% of this product's units were returned in the last 3 months, over Amazon's ${threshold}% threshold for ${groupOf.get(asin)}, so Amazon charges a returns processing fee on each return.`
                : `Returns Fee Warning: ${rate1}% of this product's units were returned in the last 3 months, close to Amazon's ${threshold}% threshold for ${groupOf.get(asin)}. Above it, Amazon charges a fee on each return.`,
            solution: 'Read the return reasons and comments, fix what they point to (listing accuracy, sizing, quality or packaging), and check whether the product is worth keeping at this return rate.',
            renderData: { returnRatePct: rate1, thresholdPct: threshold, returned: units, shipped, productGroup: groupOf.get(asin), over },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

const usd = (n, cur) => `${cur && cur !== 'USD' ? cur + ' ' : '$'}${Number(n).toFixed(2)}`;

/**
 * Priced above featured offer expected price. Spreadsheet: own price above the price
 * Amazon expects to win the featured offer, and the product's Buy Box share under 80%.
 * Amazon gives the expected price only when there is a competing offer (VALID_FOEP).
 */
function detectPricedAboveFeaturedOffer({ weeklySignals, products = [], buyBoxRows = [], productsByAsin = new Map() }) {
    const rows = weeklySignals?.featuredOffers;
    if (!Array.isArray(rows)) return { tasks: [], covered: false };
    const priceBySku = new Map(products.filter(p => p?.sku).map(p => [String(p.sku), Number(p.price) || 0]));
    const shareByAsin = new Map();
    for (const r of buyBoxRows || []) {
        const asin = r?.childAsin || r?.asin;
        if (asin && Number.isFinite(Number(r.buyBoxPercentage))) shareByAsin.set(asin, Number(r.buyBoxPercentage));
    }
    const byAsin = new Map();
    for (const row of rows) {
        if (row?.status !== 'VALID_FOEP' || !(Number(row.expectedPrice) > 0) || !row.asin) continue;
        const ours = priceBySku.get(String(row.sku)) || 0;
        const share = shareByAsin.get(row.asin);
        if (!(ours > Number(row.expectedPrice) + 0.005) || !(share < 80)) continue;
        if (!byAsin.has(row.asin)) byAsin.set(row.asin, { ...row, ours, share });
    }
    const tasks = [...byAsin.values()].map(r => ({
        asin: r.asin,
        productName: nameOf(productsByAsin, r.asin),
        errorCategory: 'conversion',
        errorType: 'priced_above_featured_offer',
        error: `Pricing | Above Featured Offer Price: Your price (${usd(r.ours, r.currency)}) is above the level Amazon expects to win the Buy Box (${usd(r.expectedPrice, r.currency)}), and you hold the Buy Box on ${Math.round(r.share)}% of visits.`,
        solution: `Consider matching ${usd(r.expectedPrice, r.currency)} if your margin allows.`,
        renderData: { sku: r.sku, ourPrice: r.ours, expectedPrice: r.expectedPrice, buyBoxPct: r.share },
        status: PENDING
    }));
    return { tasks, covered: true };
}

/**
 * Subscribe & Save. Spreadsheet: eligible consumable ASIN not enrolled. Amazon's
 * Replenishment API lists only offers already in the program, so "eligible but not
 * enrolled" cannot be read; what it does show is an offer Amazon has suspended, which
 * stops serving its subscribers. That is the task here.
 */
function detectSubscribeSaveSuspended({ weeklySignals, productsByAsin = new Map() }) {
    const offers = weeklySignals?.subscribeSave;
    if (!Array.isArray(offers)) return { tasks: [], covered: false };
    const seen = new Set();
    const tasks = [];
    for (const o of offers) {
        if (o?.eligibility !== 'SUSPENDED' || !o.asin || seen.has(o.asin)) continue;
        seen.add(o.asin);
        tasks.push({
            asin: o.asin,
            productName: nameOf(productsByAsin, o.asin),
            errorCategory: 'inventory',
            errorType: 'subscribe_and_save',
            error: `Subscribe & Save | Offer Suspended: Amazon has suspended this product's Subscribe & Save offer${o.subscriptions ? `, which has ${o.subscriptions} subscriber${o.subscriptions === 1 ? '' : 's'}` : ''}, so subscribers cannot get their deliveries.`,
            solution: 'Check the reason in Seller Central (Programs > Subscribe & Save) — usually stock or price — and fix it to get the offer running again.',
            renderData: { sku: o.sku, subscriptions: o.subscriptions },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/** Inbound placement fees. Spreadsheet: placement fees in the last 30 days over $100. */
function detectInboundPlacementFees({ weeklySignals }) {
    const fees = weeklySignals?.placementFees;
    if (!fees) return { tasks: [], covered: false };
    if (!(Number(fees.total) > 100)) return { tasks: [], covered: true };
    return {
        tasks: [{
            asin: 'ACCOUNT',
            productName: 'Inbound shipments',
            errorCategory: 'inventory',
            errorType: 'inbound_placement_fees',
            error: `Inbound | Placement Fees: You paid ${usd(fees.total, fees.currency)} in inbound placement fees on ${fees.plans?.length || 0} shipment plan${fees.plans?.length === 1 ? '' : 's'} in the last ${fees.windowDays || 30} days.`,
            solution: "Choosing Amazon's optimised split on future shipments removes this fee.",
            amount: Math.round(Number(fees.total) * 100) / 100,
            amountIsEstimated: false,
            renderData: { total: fees.total, plans: (fees.plans || []).length },
            status: PENDING
        }],
        covered: true
    };
}

/**
 * Profitable campaigns running out of budget. Amazon's budget recommendations (weekly)
 * against the campaign's ACoS from the PPC page's campaign totals.
 */
function detectBudgetLimitedProfitable({ budgetRecs, campaignRows = [], now }) {
    const { TARGET_ACOS_PERCENT } = require('../TaskRules.js');
    if (!budgetRecs || !Array.isArray(budgetRecs.recs) || !(now.getTime() - new Date(budgetRecs.at).getTime() <= 10 * R.DAY_MS)) {
        return { tasks: [], covered: false };
    }
    const acosOf = new Map();
    for (const c of campaignRows || []) {
        const spend = Number(c?.totalSpend) || 0;
        const sales = Number(c?.totalSales) || 0;
        if (c?.campaignId && sales > 0) acosOf.set(String(c.campaignId), (spend / sales) * 100);
    }
    const tasks = [];
    for (const r of budgetRecs.recs) {
        const acos = acosOf.get(String(r.campaignId));
        // Amazon sends -1 when it does not know the time in budget: no verdict.
        if (!(r.percentTimeInBudget >= 0 && r.percentTimeInBudget < R.BUDGET_TIME_IN_BUDGET_MAX) || !(r.missedSalesUpper > 0)) continue;
        if (!(acos > 0 && acos < TARGET_ACOS_PERCENT)) continue;
        const pct = Math.round(r.percentTimeInBudget * 100);
        const raise = Number(r.suggestedBudget) > Number(r.budget);
        tasks.push({
            asin: `CAMPAIGN:${r.campaignId}`,
            productName: (r.name || `Campaign ${r.campaignId}`).substring(0, 100),
            errorCategory: 'sponsoredAds',
            errorType: 'budget_limited_profitable',
            error: `PPC | Budget Running Out: The campaign "${r.name || r.campaignId}" was within its budget only ${pct}% of the time over 7 days, while its ACoS is ${Math.round(acos * 10) / 10}% (under the ${TARGET_ACOS_PERCENT}% target). Amazon estimates $${Math.round(r.missedSalesLower)}–$${Math.round(r.missedSalesUpper)} in missed sales.`,
            solution: raise
                ? `Raise the budget so it runs all day. Amazon suggests $${Number(r.suggestedBudget).toFixed(2)} a day (now $${Number(r.budget).toFixed(2)}).`
                : 'Raise the budget so it runs all day.',
            amount: Math.round(Number(r.missedSalesLower) * 100) / 100,
            amountIsEstimated: true,
            renderData: { campaignId: String(r.campaignId), campaignName: r.name, budget: r.budget, suggestedBudget: r.suggestedBudget, percentTimeInBudget: r.percentTimeInBudget, acos: Math.round(acos * 10) / 10 },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

/**
 * Storage utilization surcharge risk. Spreadsheet: account ratio over 22 weeks
 * (surcharge), early warning over 18; only accounts the surcharge can apply to
 * (Amazon: 25+ cubic feet a day on average). The ratio is last month's (Amazon's
 * monthly storage fee report). Amazon also exempts sellers new to FBA, which no API
 * shows: over 22 weeks with no surcharge charged, the task says it may be exempt.
 */
function detectStorageUtilization({ weeklySignals }) {
    const su = weeklySignals?.storageUtilization;
    if (!su || su.ratio === null || su.ratio === undefined || !/week/i.test(String(su.ratioUnits || 'weeks'))) return { tasks: [], covered: false };
    const cubicFeet = /feet|ft/i.test(String(su.volumeUnits || ''));
    // Outside cubic-feet marketplaces the 25 cubic feet floor is not checked.
    if (cubicFeet && !(Number(su.totalVolume) >= R.STORAGE_UTILIZATION_MIN_CUBIC_FEET)) return { tasks: [], covered: true };
    const ratio = Number(su.ratio);
    if (!(ratio > R.STORAGE_UTILIZATION_WARN_WEEKS)) return { tasks: [], covered: true };
    const over = ratio > R.STORAGE_UTILIZATION_SURCHARGE_WEEKS;
    const surcharge = Number(su.estimatedSurcharge) || 0;
    const top = (su.topAsins || []).map(a => a.asin).join(', ');
    const weeks = Math.round(ratio * 10) / 10;
    return {
        tasks: [{
            asin: 'ACCOUNT',
            productName: 'Storage utilization',
            errorCategory: 'inventory',
            errorType: 'storage_utilization_risk',
            error: over
                ? `Inventory | Storage Utilization: Your account holds about ${weeks} weeks of stock (${su.month || 'last month'}), over Amazon's ${R.STORAGE_UTILIZATION_SURCHARGE_WEEKS} weeks, which adds a surcharge to all storage.${surcharge > 0 ? ` Amazon estimated the surcharge at ${usd(surcharge, su.currency)}.` : ' Amazon charged no surcharge, so the account may be exempt (new to FBA).'}`
                : `Inventory | Storage Utilization: Your account holds about ${weeks} weeks of stock (${su.month || 'last month'}). Over ${R.STORAGE_UTILIZATION_SURCHARGE_WEEKS} weeks, Amazon adds a surcharge to all storage.`,
            solution: `Pause big inbound shipments and clear slow movers until the ratio is under ${R.STORAGE_UTILIZATION_SURCHARGE_WEEKS} weeks.${top ? ` The products taking the most space: ${top}.` : ''}`,
            ...(over && surcharge > 0 ? { amount: surcharge, amountIsEstimated: true } : {}),
            renderData: { ratio: weeks, month: su.month, surcharge, totalVolume: su.totalVolume, topAsins: su.topAsins || [], level: over ? 'surcharge' : 'warning' },
            status: PENDING
        }],
        covered: true
    };
}

const FEEDBACK_NEW_DAYS = 30;
// Amazon removes feedback that is only about an Amazon-fulfilled delivery, or that is
// a product review rather than about the seller. A rough guide from the comment, so
// the task says "looks like", never that Amazon will remove it.
const DELIVERY_WORDS = /\b(deliver\w*|shipp\w*|arriv\w*|package|parcel|post office|carrier|courier|tracking|never (?:got|received|came)|lost in|late)\b/i;
const PRODUCT_WORDS = /\b(quality|broke|broken|defective|doesn'?t work|does not work|stopped working|flimsy|cheap(?:ly)?|smell\w*|taste\w*|too (?:small|big|large)|size|fit|waste of money)\b/i;

/** Pure: what a negative comment is mostly about. */
function feedbackTopic(comment) {
    const text = String(comment || '');
    if (DELIVERY_WORDS.test(text)) return 'delivery';
    if (PRODUCT_WORDS.test(text)) return 'product';
    return 'other';
}

/**
 * Negative seller feedback, one task per order. Spreadsheet: new 1 or 2 star feedback
 * since the last run, cooldown per order. The weekly report covers 60 days; feedback
 * from the last 30 days becomes a task (older feedback is past the useful time to
 * reach the buyer). Feedback the buyer or Amazon removed drops out of the report, and
 * the task resolves.
 */
function detectNegativeFeedbackOrders({ weeklySignals, now }) {
    const feedback = weeklySignals?.sellerFeedback;
    if (!feedback || !Array.isArray(feedback.negatives)) return { tasks: [], covered: false };
    const since = now.getTime() - FEEDBACK_NEW_DAYS * R.DAY_MS;
    const tasks = [];
    for (const f of feedback.negatives) {
        const at = f?.date ? Date.parse(`${f.date}T00:00:00Z`) : NaN;
        if (!f?.orderId || (Number.isFinite(at) && at < since)) continue;
        const topic = feedbackTopic(f.comment);
        const advice = {
            delivery: 'It looks like it is about delivery. If Amazon shipped this order (FBA), ask Amazon to remove it: Seller Central > Performance > Feedback > Request removal.',
            product: 'It looks like a product review rather than feedback on you as a seller; Amazon removes those on request: Seller Central > Performance > Feedback > Request removal.',
            other: 'Contact the buyer to put things right, then ask them to update their feedback.'
        }[topic];
        const quote = String(f.comment || '').trim();
        tasks.push({
            asin: `ORDER:${f.orderId}`,
            productName: `Order ${f.orderId}`,
            errorCategory: 'account',
            errorType: 'negative_feedback_order',
            error: `Account Health | Negative Feedback: You received ${f.rating}-star seller feedback on order ${f.orderId}${f.date ? ` (${f.date})` : ''}${quote ? `: "${quote.length > 200 ? `${quote.slice(0, 200)}…` : quote}"` : '.'}`,
            solution: `${advice} You can also send Amazon's standard request asking the buyer to update their feedback (once per order).`,
            renderData: { orderId: f.orderId, rating: f.rating, date: f.date, topic, responded: !!f.responded },
            status: PENDING
        });
    }
    return { tasks, covered: true };
}

module.exports = {
    detectStorageUtilization,
    detectNegativeFeedbackOrders,
    feedbackTopic,
    detectBudgetLimitedProfitable,
    detectPricedAboveFeaturedOffer,
    detectSubscribeSaveSuspended,
    detectInboundPlacementFees,
    detectReturnsFeeRisk,
    detectDetailPageChanged,
    detectReturnReasonSpike,
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
