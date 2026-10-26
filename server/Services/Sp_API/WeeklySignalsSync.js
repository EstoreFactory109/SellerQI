/**
 * Weekly SP-API reads for three tasks-logics.xlsx checks (all reads; nothing on
 * Amazon changes). Stored in WeeklySignals. Each part fails on its own: a failed part
 * is stored as null so its check makes no verdict, never "nothing found".
 *
 * - Featured offer expected price (Product Pricing 2022-05-01, batch): for SKUs whose
 *   Buy Box share was under 80% on the newest Sales & Traffic day. At most 200 SKUs,
 *   40 per request, one request per 30 seconds (Amazon's rate for this batch call).
 * - Subscribe & Save offers (Replenishment 2022-11-07 offers/search): every offer the
 *   seller has in the program, with eligibility.
 * - Inbound placement fees (Fulfillment Inbound 2024-03-20): inbound plans created in
 *   the last 30 days, and the fees of each plan's accepted placement option.
 * - Seller feedback (GET_SELLER_FEEDBACK_DATA report, last 60 days): the 1 and 2 star
 *   ratings only, with the order ID and comment (the rater email is not kept).
 */
const axios = require('axios');
const logger = require('../../utils/Logger.js');

const MAX_FOEP_SKUS = 200;
const FOEP_BATCH = 40;
const FOEP_PAUSE_MS = 31000;
const PLACEMENT_WINDOW_DAYS = 30;
const FEEDBACK_WINDOW_DAYS = 60;
// Report dates are short dates in the marketplace's own order: month first in North
// America ("10/5/26" seen live on US), day first elsewhere.
const MONTH_FIRST = new Set(['US', 'CA', 'MX']);

const hostOf = (baseUri) => `https://${String(baseUri).replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Pure: one FOEP batch response -> stored rows. Exported for tests. */
function parseFoepResponses(responses = []) {
    const rows = [];
    for (const res of responses || []) {
        const body = res?.body || {};
        const sku = body.offerIdentifier?.sku || res?.request?.sku || '';
        const result = (body.featuredOfferExpectedPriceResults || [])[0] || {};
        rows.push({
            sku,
            asin: body.offerIdentifier?.asin || '',
            status: String(result.resultStatus || (res?.status?.statusCode === 200 ? '' : 'ERROR')),
            expectedPrice: Number.isFinite(Number(result.featuredOfferExpectedPrice?.listingPrice?.amount))
                ? Number(result.featuredOfferExpectedPrice.listingPrice.amount) : null,
            currency: result.featuredOfferExpectedPrice?.listingPrice?.currencyCode || '',
            weAreFeatured: !!result.currentFeaturedOffer && result.currentFeaturedOffer.offerIdentifier?.sellerId === body.offerIdentifier?.sellerId
        });
    }
    return rows;
}

/** Pure: a feedback report date ("10/5/26", "10/05/2026" or ISO) -> 'YYYY-MM-DD', or null. */
function feedbackDay(value, country) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const m = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/);
    if (!m) return null;
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [month, day] = MONTH_FIRST.has(String(country || '').toUpperCase()) ? [a, b] : [b, a];
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Pure: parsed report rows -> the 1-2 star feedback, one per order. Exported for tests. */
function negativeFeedbackRows(records = [], country) {
    const byOrder = new Map();
    for (const r of records || []) {
        const rating = Number(r?.Rating ?? r?.rating);
        const orderId = String(r?.['Order ID'] ?? r?.['order-id'] ?? '').trim();
        if (!(rating >= 1 && rating <= 2) || !orderId) continue;
        byOrder.set(orderId, {
            orderId,
            rating,
            date: feedbackDay(r.Date ?? r.date, country),
            comment: String(r.Comments ?? r.comments ?? '').slice(0, 1000),
            responded: String(r['Your Response'] ?? '').trim().length > 0
        });
    }
    return [...byOrder.values()];
}

async function readSellerFeedback({ accessToken, baseUri, marketplaceId, country, now }) {
    const { runSpApiReportInline } = require('./spApiReportAdapter.js');
    const { parseAsync } = require('../../utils/asyncCsvParser');
    const result = await runSpApiReportInline({
        accessToken,
        baseuri: String(baseUri).replace(/^https?:\/\//, '').replace(/\/$/, ''),
        body: {
            reportType: 'GET_SELLER_FEEDBACK_DATA',
            marketplaceIds: [marketplaceId],
            dataStartTime: new Date(now.getTime() - FEEDBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
            dataEndTime: now.toISOString()
        },
        retries: 1
    });
    if (result.status === 'NO_DATA') return { windowDays: FEEDBACK_WINDOW_DAYS, negatives: [] };
    if (result.status !== 'DONE') throw new Error(`feedback report ${result.status}: ${result.note || ''}`);
    const records = await parseAsync(result.buffer, { delimiter: '\t', columns: true, reportType: 'GET_SELLER_FEEDBACK_DATA' });
    return { windowDays: FEEDBACK_WINDOW_DAYS, total: records.length, negatives: negativeFeedbackRows(records, country) };
}

async function readFeaturedOffers({ host, headers, marketplaceId, skus }) {
    const rows = [];
    for (let i = 0; i < skus.length; i += FOEP_BATCH) {
        if (i > 0) await sleep(FOEP_PAUSE_MS);
        const requests = skus.slice(i, i + FOEP_BATCH).map(sku => ({ uri: '/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice', method: 'GET', marketplaceId, sku }));
        const res = await axios.post(`${host}/batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice`, { requests }, { headers, timeout: 60000 });
        rows.push(...parseFoepResponses(res.data?.responses));
    }
    return rows;
}

async function readSubscribeSave({ host, headers, marketplaceId }) {
    const offers = [];
    for (let offset = 0; offset < 5000; offset += 100) {
        const res = await axios.post(`${host}/replenishment/2022-11-07/offers/search`,
            { filters: { marketplaceId, programTypes: ['SUBSCRIBE_AND_SAVE'] }, pagination: { limit: 100, offset } }, { headers, timeout: 60000 });
        const page = res.data?.offers || [];
        for (const o of page) offers.push({ asin: o.asin, sku: o.sku, eligibility: String(o.eligibility || ''), subscriptions: Number(o.subscriptions) || 0 });
        if (page.length < 100) break;
    }
    return offers;
}

async function readPlacementFees({ host, headers, now }) {
    const since = now.getTime() - PLACEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const plans = [];
    let paginationToken = null;
    do {
        const q = `pageSize=30&sortBy=CREATION_TIME&sortOrder=DESC${paginationToken ? `&paginationToken=${encodeURIComponent(paginationToken)}` : ''}`;
        const res = await axios.get(`${host}/inbound/fba/2024-03-20/inboundPlans?${q}`, { headers, timeout: 60000 });
        const page = res.data?.inboundPlans || [];
        const recent = page.filter(p => Date.parse(p.createdAt) >= since);
        plans.push(...recent);
        paginationToken = recent.length === page.length ? res.data?.pagination?.nextToken : null;
    } while (paginationToken);

    let total = 0;
    let currency = '';
    const perPlan = [];
    for (const plan of plans) {
        await sleep(600); // listPlacementOptions allows 2 per second
        const res = await axios.get(`${host}/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(plan.inboundPlanId)}/placementOptions`, { headers, timeout: 60000 });
        const accepted = (res.data?.placementOptions || []).find(o => o.status === 'ACCEPTED');
        const fee = (accepted?.fees || []).filter(f => f.type === 'FEE').reduce((s, f) => s + (Number(f.value?.amount) || 0), 0);
        if (accepted?.fees?.[0]?.value?.code) currency = accepted.fees[0].value.code;
        total += fee;
        perPlan.push({ inboundPlanId: plan.inboundPlanId, createdAt: plan.createdAt, fee });
    }
    return { windowDays: PLACEMENT_WINDOW_DAYS, plans: perPlan, total: Math.round(total * 100) / 100, currency };
}

const syncWeeklySignals = async (accessToken, marketplaceIds, userId, baseUri, country, region) => {
    const marketplaceId = Array.isArray(marketplaceIds) ? marketplaceIds[0] : marketplaceIds;
    const host = hostOf(baseUri);
    const headers = { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' };
    const now = new Date();
    const part = async (name, fn) => {
        try { return await fn(); } catch (error) {
            logger.warn(`[WeeklySignals] ${name} unavailable`, { userId: String(userId), country, region, status: error.response?.status, error: error.message });
            return null;
        }
    };

    // SKUs losing the Buy Box on the newest Sales & Traffic day.
    const skus = await part('Buy Box candidates', async () => {
        const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
        const Seller = require('../../models/user-auth/sellerCentralModel.js');
        const [day, seller] = await Promise.all([
            BuyBoxData.findOne({ User: userId, country, region, date: { $type: 'string' } }).sort({ date: -1 }).select('asinBuyBoxData.childAsin asinBuyBoxData.buyBoxPercentage asinBuyBoxData.sessions').lean(),
            Seller.findOne({ User: userId }).select('sellerAccount.country sellerAccount.region sellerAccount.products.asin sellerAccount.products.sku sellerAccount.products.status').lean()
        ]);
        const losing = new Set((day?.asinBuyBoxData || []).filter(r => (Number(r.sessions) || 0) > 0 && Number(r.buyBoxPercentage) < 80).map(r => r.childAsin));
        const account = (seller?.sellerAccount || []).find(a => a.country === country && a.region === region);
        return (account?.products || []).filter(p => p.status === 'Active' && p.sku && losing.has(p.asin)).map(p => p.sku).slice(0, MAX_FOEP_SKUS);
    });

    const doc = {
        User: userId, country, region,
        featuredOffers: skus ? await part('Featured offer expected price', () => readFeaturedOffers({ host, headers, marketplaceId, skus })) : null,
        subscribeSave: await part('Subscribe & Save offers', () => readSubscribeSave({ host, headers, marketplaceId })),
        placementFees: await part('Inbound placement fees', () => readPlacementFees({ host, headers, now })),
        sellerFeedback: await part('Seller feedback', () => readSellerFeedback({ accessToken, baseUri, marketplaceId, country, now }))
    };
    const WeeklySignals = require('../../models/products/WeeklySignalsModel.js');
    const saved = await WeeklySignals.create(doc);
    logger.info('[WeeklySignals] stored', {
        userId: String(userId), country, region,
        featuredOffers: doc.featuredOffers?.length ?? null, subscribeSave: doc.subscribeSave?.length ?? null, placementFeesTotal: doc.placementFees?.total ?? null,
        negativeFeedback: doc.sellerFeedback?.negatives?.length ?? null
    });
    return saved;
};

module.exports = syncWeeklySignals;
module.exports.parseFoepResponses = parseFoepResponses;
// The reads alone (no save), for tests and read-only checks.
module.exports.readFeaturedOffers = readFeaturedOffers;
module.exports.readSubscribeSave = readSubscribeSave;
module.exports.readPlacementFees = readPlacementFees;
module.exports.readSellerFeedback = readSellerFeedback;
module.exports.negativeFeedbackRows = negativeFeedbackRows;
module.exports.feedbackDay = feedbackDay;
