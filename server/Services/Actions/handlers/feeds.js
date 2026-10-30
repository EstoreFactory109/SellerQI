/**
 * Bulk changes through SP-API feeds, and cancelling a feed or a report request.
 * tasks-logics.xlsx "Post Fn" (Feeds, Reports). Feeds are processed by Amazon over
 * minutes: the change waits as awaiting_amazon and is followed up (poll) until
 * Amazon's result says, per SKU, what was accepted.
 *
 *   feeds.bulk_fbm_stock   stock for many FBM SKUs in one JSON_LISTINGS_FEED
 *   feeds.cancel_feed      cancel a feed SellerQI sent, while Amazon has not started it
 *   reports.cancel_report  cancel a stuck report request (staff only)
 *
 * Bulk stock takes only SKUs SellerQI knows the seller ships (fulfillment channel
 * DEFAULT from the daily listings report): sending seller-fulfilled stock for an
 * Amazon-fulfilled SKU could switch how it is fulfilled. Bulk business pricing is
 * not offered: each listing's regular price would have to be read and sent back.
 */
const { userError, staleError } = require('../errors.js');

const MAX_FEED_ITEMS = 10000;
const SAMPLE_CHECKS = 3;

function spApi() { return require('../../Sp_API/spApiClient.js'); }
function feeds() { return require('../../Sp_API/FeedsService.js'); }

async function catalogue(ctx) {
    const Seller = require('../../../models/user-auth/sellerCentralModel.js');
    const seller = await Seller.findOne({ User: ctx.userId }).select('sellerAccount.country sellerAccount.region sellerAccount.products.sku sellerAccount.products.itemName sellerAccount.products.fulfillmentChannel sellerAccount.products.fbmQuantity').lean();
    const account = (seller?.sellerAccount || []).find((a) => a.country === ctx.country && a.region === ctx.region);
    return new Map((account?.products || []).filter((p) => p.sku).map((p) => [p.sku, p]));
}

async function storeQuantities(ctx, items) {
    try {
        const Seller = require('../../../models/user-auth/sellerCentralModel.js');
        await Seller.bulkWrite(items.slice(0, 5000).map((it) => ({
            updateOne: {
                filter: { User: ctx.userId },
                update: { $set: { 'sellerAccount.$[a].products.$[p].fbmQuantity': it.quantity } },
                arrayFilters: [{ 'a.country': ctx.country, 'a.region': ctx.region }, { 'p.sku': it.sku }]
            }
        })), { ordered: false });
    } catch (_) { /* the next daily sync stores it anyway */ }
}

const bulkFbmStock = {
    actionType: 'feeds.bulk_fbm_stock',
    feature: 'feeds',
    flag: 'AMAZON_ACTIONS_FEEDS',
    idempotent: false, // a second feed is a second submission
    validate(input) {
        const raw = Array.isArray(input?.items) ? input.items : [];
        if (raw.length === 0) throw userError('Add at least one SKU and its stock.');
        if (raw.length > MAX_FEED_ITEMS) throw userError(`At most ${MAX_FEED_ITEMS} SKUs in one update.`);
        const seen = new Set();
        const items = raw.map((r) => {
            const sku = String(r?.sku || '').trim();
            const quantity = Number(r?.quantity);
            if (!sku) throw userError('Every row needs a SKU.');
            if (!Number.isInteger(quantity) || quantity < 0) throw userError(`The stock for ${sku} must be a whole number, 0 or more.`);
            if (seen.has(sku)) throw userError(`${sku} is listed twice.`);
            seen.add(sku);
            return { sku, quantity };
        });
        return { items };
    },
    async preview(input, ctx) {
        const ChangeRequest = require('../../../models/MCP/AmazonChangeRequestModel.js');
        const inFlight = await ChangeRequest.findOne({ userId: ctx.userId, country: ctx.country, region: ctx.region, actionType: 'feeds.bulk_fbm_stock', status: { $in: ['running', 'awaiting_amazon'] } }).select('_id').lean();
        if (inFlight) throw userError('A bulk stock update is still being processed by Amazon. Wait for it to finish first.');

        const products = await catalogue(ctx);
        const fbm = input.items.filter((it) => products.get(it.sku)?.fulfillmentChannel === 'DEFAULT');
        const left = input.items.filter((it) => products.get(it.sku)?.fulfillmentChannel !== 'DEFAULT');
        if (fbm.length === 0) throw userError('None of these SKUs are ones you ship yourself (FBM), so there is no stock to update here.');

        const W = require('../../Sp_API/ListingsWriteService.js');
        const amazonIssues = [];
        for (const it of fbm.slice(0, SAMPLE_CHECKS)) {
            try {
                const live = await W.readLiveListing({ sku: it.sku, userId: ctx.userId, country: ctx.country, region: ctx.region });
                if (!W.fbmAvailability(live.listing)) { amazonIssues.push(`${it.sku}: Amazon fulfils this listing, so it was left out.`); continue; }
                const check = W.issuesOf(await W.patchListing({ ...ctx, sku: it.sku, patches: W.buildFulfillmentAvailabilityPatch({ quantity: it.quantity }), validateOnly: true, live }));
                check.messages.forEach((m) => amazonIssues.push(`${it.sku}: ${m}`));
            } catch (error) {
                amazonIssues.push(`${it.sku}: could not be checked (${error.message})`);
            }
        }
        const amazonFulfilled = new Set(amazonIssues.filter((m) => m.includes('Amazon fulfils this listing')).map((m) => m.split(':')[0]));
        const send = fbm.filter((it) => !amazonFulfilled.has(it.sku));
        if (send.length === 0) throw userError('Amazon fulfils these listings, so there is no stock to update here.');

        const warnings = [];
        if (left.length) warnings.push(`${left.length} SKU${left.length === 1 ? ' is' : 's are'} left out because SellerQI does not know you ship ${left.length === 1 ? 'it' : 'them'} yourself: ${left.slice(0, 5).map((x) => x.sku).join(', ')}${left.length > 5 ? '...' : ''}.`);
        const zero = send.filter((it) => it.quantity === 0).length;
        if (zero) warnings.push(`${zero} SKU${zero === 1 ? '' : 's'} go to 0 stock and stop being buyable.`);
        warnings.push(`Amazon processes a bulk update in a few minutes; SellerQI checked ${Math.min(SAMPLE_CHECKS, fbm.length)} of them with Amazon first and shows the result for each SKU once Amazon has finished.`);
        return {
            title: `Update stock for ${send.length} SKU${send.length === 1 ? '' : 's'}`,
            target: 'Your listings on Amazon (you ship them)',
            lines: send.map((it) => {
                const p = products.get(it.sku);
                return { label: `${it.sku}${p?.itemName ? ` (${String(p.itemName).slice(0, 40)})` : ''}`, before: p?.fbmQuantity !== undefined && p?.fbmQuantity !== null ? String(p.fbmQuantity) : '(not known)', after: String(it.quantity) };
            }),
            warnings,
            amazonIssues: amazonIssues.filter((m) => !m.includes('Amazon fulfils this listing')),
            blocking: false,
            payload: { messages: send.map((it) => ({ sku: it.sku, quantity: it.quantity, patches: W.buildFulfillmentAvailabilityPatch({ quantity: it.quantity }) })) }
        };
    },
    async execute(payload, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        if (!creds.sellerId) throw new Error('The seller id for this account is not known, so a feed cannot be sent.');
        const F = feeds();
        const feed = F.buildListingsFeed({ sellerId: creds.sellerId, messages: payload.messages });
        const sent = await F.submitListingsFeed({ ...creds, feed });
        return { pending: true, amazon: { ...sent, count: payload.messages.length } };
    },
    async poll(doc, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const F = feeds();
        const feed = await F.getFeed({ ...creds, feedId: doc.amazon.feedId });
        const status = feed.processingStatus;
        if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') return { status: 'pending' };
        if (status === 'CANCELLED') return { status: 'cancelled', error: 'The update was cancelled before Amazon processed it; nothing changed.' };
        if (status !== 'DONE' || !feed.resultFeedDocumentId) return { status: 'failed', error: `Amazon could not process the update (${status || 'no status'}).`, response: feed };
        const result = F.summarizeFeedResult(await F.getFeedResult({ ...creds, resultFeedDocumentId: feed.resultFeedDocumentId }), doc.payload.messages);
        const failed = new Set(result.errors.map((e) => e.sku));
        await storeQuantities(ctx, doc.payload.messages.filter((m) => !failed.has(m.sku)));
        if (result.accepted === 0) return { status: 'failed', error: `Amazon refused every SKU${result.errors[0] ? `: ${result.errors[0].message}` : '.'}`, response: result };
        return { status: 'succeeded', response: result, note: result.invalid ? `${result.accepted} updated, ${result.invalid} refused by Amazon.` : `${result.accepted} updated.` };
    }
};

const cancelFeed = {
    actionType: 'feeds.cancel_feed',
    feature: 'feeds',
    flag: 'AMAZON_ACTIONS_FEEDS',
    idempotent: true,
    validate(input) {
        if (!input?.changeRequestId) throw userError('Choose the update to cancel.');
        return { changeRequestId: String(input.changeRequestId) };
    },
    async preview(input, ctx) {
        const ChangeRequest = require('../../../models/MCP/AmazonChangeRequestModel.js');
        const original = await ChangeRequest.findOne({ _id: input.changeRequestId, userId: ctx.userId, country: ctx.country, region: ctx.region, feature: 'feeds', status: 'awaiting_amazon' }).lean();
        if (!original?.amazon?.feedId) throw userError('Only an update Amazon is still waiting to process can be cancelled.');
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const feed = await feeds().getFeed({ ...creds, feedId: original.amazon.feedId });
        if (feed.processingStatus !== 'IN_QUEUE') throw userError('Amazon has already started processing this update, so it can no longer be cancelled.');
        return {
            title: 'Cancel the bulk update',
            target: `Amazon feed ${original.amazon.feedId}`,
            lines: [{ label: original.preview?.title || 'Bulk update', before: 'Waiting for Amazon', after: 'Cancelled, nothing changes' }],
            warnings: [],
            payload: { changeRequestId: input.changeRequestId, feedId: original.amazon.feedId }
        };
    },
    async staleCheck(doc, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const feed = await feeds().getFeed({ ...creds, feedId: doc.payload.feedId });
        if (feed.processingStatus !== 'IN_QUEUE') throw staleError('Amazon started processing this update, so it can no longer be cancelled.');
    },
    async execute(payload, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const result = await feeds().cancelFeed({ ...creds, feedId: payload.feedId });
        const ChangeRequest = require('../../../models/MCP/AmazonChangeRequestModel.js');
        await ChangeRequest.updateOne({ _id: payload.changeRequestId, status: 'awaiting_amazon' }, { $set: { status: 'cancelled', error: 'Cancelled by the seller before Amazon processed it; nothing changed.', nextPollAt: null } });
        return result;
    }
};

const cancelReport = {
    actionType: 'reports.cancel_report',
    feature: 'reports',
    // SellerQI's own report requests: housekeeping for the team, not for sellers.
    staffOnly: true,
    idempotent: true,
    validate(input) {
        const reportId = String(input?.reportId || '').trim();
        if (!/^\d+$/.test(reportId)) throw userError('Enter the report id.');
        return { reportId };
    },
    async preview(input, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const { getSpApiReport } = require('../../Sp_API/spApiReportAdapter.js');
        const report = await getSpApiReport(creds.accessToken, creds.host, input.reportId);
        if (report.processingStatus !== 'IN_QUEUE') throw userError(`Amazon can cancel only a report that has not started; this one is ${String(report.processingStatus || 'unknown').toLowerCase().replace('_', ' ')}.`);
        return {
            title: 'Cancel a report request',
            target: `Amazon report ${input.reportId}`,
            lines: [{ label: report.reportType || 'Report', before: 'Waiting in Amazon\'s queue', after: 'Cancelled' }],
            warnings: ['SellerQI requests this report again on its next scheduled run.'],
            payload: input
        };
    },
    async staleCheck(doc, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const { getSpApiReport } = require('../../Sp_API/spApiReportAdapter.js');
        const report = await getSpApiReport(creds.accessToken, creds.host, doc.payload.reportId);
        if (report.processingStatus !== 'IN_QUEUE') throw staleError('Amazon started this report, so it can no longer be cancelled.');
    },
    async execute(payload, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const { cancelSpApiReport } = require('../../Sp_API/spApiReportAdapter.js');
        return cancelSpApiReport(creds.accessToken, creds.host, payload.reportId);
    }
};

module.exports = { handlers: [bulkFbmStock, cancelFeed, cancelReport] };
