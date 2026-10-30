/**
 * /api/actions - changes on Amazon from SellerQI's screens, always previewed first
 * and sent only after the seller approves (Services/Actions/ChangeRequestService.js).
 *
 *   GET    /api/actions/capabilities           which changes this account can make
 *   GET    /api/actions/history?feature=        recent changes
 *   POST   /api/actions/:feature/preview        { actionType, input, source? } -> draft
 *   POST   /api/actions/:feature/:id/approve    send it
 *   POST   /api/actions/:feature/approve-many   { ids }
 *   GET    /api/actions/:feature/:id            status (pending changes are polled)
 *   DELETE /api/actions/:feature/:id            cancel a draft
 *
 * The feature is part of the path so the page guards (esfPageGuard, memberPageGuard)
 * apply: approving needs the "amazon-changes" page (Services/User/esfPages.js).
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const ChangeRequestService = require('../../Services/Actions/ChangeRequestService.js');

const approverOf = (req) => ({
    userId: req.userId, memberId: req.memberId, adminId: req.adminId,
    superAdminId: req.superAdminId, esfUserId: req.esfUserId
});
const scope = (req) => ({ userId: req.userId, country: req.country, region: req.region });

/** Runs a handler; refusals become their HTTP status with a readable message. */
const handle = (fn) => asyncHandler(async (req, res) => {
    try {
        const data = await fn(req);
        return res.status(200).json(new ApiResponse(200, data, 'OK'));
    } catch (error) {
        const status = error.statusCode || (error.isUserError ? 400 : 500);
        if (status >= 500) logger.error('[AmazonActions] request failed', { path: req.originalUrl, error: error.message });
        return res.status(status).json(new ApiResponse(status, null, status >= 500 ? 'Something went wrong preparing this change.' : error.message));
    }
});

const getCapabilities = handle(async (req) => ChangeRequestService.capabilities(req.userId, approverOf(req)));

const getHistory = handle(async (req) => ({
    changes: await ChangeRequestService.list({ ...scope(req), feature: req.query.feature || null, limit: req.query.limit })
}));

const preview = handle(async (req) => {
    const { actionType, input, source } = req.body || {};
    if (!actionType) throw Object.assign(new Error('actionType is required'), { statusCode: 400 });
    return ChangeRequestService.createPreview({
        ...scope(req), feature: req.params.feature, actionType, input: input || {},
        source: ['screen', 'qmate', 'bulk'].includes(source) ? source : 'screen',
        createdBy: approverOf(req)
    });
});

const approve = handle(async (req) => ChangeRequestService.approve({
    ...scope(req), id: req.params.id, feature: req.params.feature, approvedBy: approverOf(req)
}));

const approveMany = handle(async (req) => ({
    results: await ChangeRequestService.approveMany({
        ...scope(req), ids: req.body?.ids, feature: req.params.feature, approvedBy: approverOf(req)
    })
}));

const getOne = handle(async (req) => ChangeRequestService.get({ ...scope(req), id: req.params.id }));

const cancel = handle(async (req) => ChangeRequestService.cancelDraft({ ...scope(req), id: req.params.id }));

// ---- Reads the advertising screens need (nothing changes on Amazon) ----

/** Live campaigns in every state (the daily snapshot keeps enabled ones only). */
const adsCampaigns = handle(async (req) => {
    const { adsCreds } = require('../../Services/Actions/handlers/ads.js');
    const SpWrites = require('../../Services/AmazonAds/SpWrites.js');
    const creds = await adsCreds(scope(req));
    const states = req.query.includeArchived === 'true' ? SpWrites.ALL_STATES : ['ENABLED', 'PAUSED'];
    const campaigns = await SpWrites.listCampaigns(creds, { states });
    return {
        campaigns: campaigns.slice(0, 500).map((c) => ({
            campaignId: String(c.campaignId), name: c.name, state: c.state, targetingType: c.targetingType,
            dailyBudget: Number(c.budget?.budget) || null, startDate: c.startDate || null,
            biddingStrategy: c.dynamicBidding?.strategy || null
        })),
        total: campaigns.length
    };
});

/** One campaign's ad groups (live). */
const adsCampaignAdGroups = handle(async (req) => {
    const { adsCreds } = require('../../Services/Actions/handlers/ads.js');
    const SpWrites = require('../../Services/AmazonAds/SpWrites.js');
    const creds = await adsCreds(scope(req));
    const groups = await SpWrites.listAdGroups(creds, { campaignIds: [req.params.campaignId], states: ['ENABLED', 'PAUSED'] });
    return { adGroups: groups.map((g) => ({ adGroupId: String(g.adGroupId), campaignId: String(g.campaignId), name: g.name, state: g.state, defaultBid: Number(g.defaultBid) || null })) };
});

/** Products to advertise, and Amazon's keyword suggestions for one of them. */
const adsNewCampaignOptions = handle(async (req) => {
    const Seller = require('../../models/user-auth/sellerCentralModel.js');
    const seller = await Seller.findOne({ User: req.userId }).select('sellerAccount.country sellerAccount.region sellerAccount.products.asin sellerAccount.products.sku sellerAccount.products.status sellerAccount.products.itemName').lean();
    const account = (seller?.sellerAccount || []).find((a) => a.country === req.country && a.region === req.region);
    const products = (account?.products || []).filter((p) => p.sku && p.asin && p.status === 'Active')
        .map((p) => ({ sku: p.sku, asin: p.asin, name: p.itemName || '' })).slice(0, 2000);
    let suggestions = [];
    const asin = String(req.query.asin || '').trim().toUpperCase();
    if (asin) {
        const { AsinKeywordRecommendations } = require('../../models/amazon-ads/KeywordRecommendationsModel.js');
        const doc = await AsinKeywordRecommendations.findOne({ userId: String(req.userId), country: req.country, region: req.region, asin }).lean();
        suggestions = (doc?.keywordTargetList || []).slice(0, 100).map((k) => {
            const best = (k.bidInfo || []).find((b) => b.matchType === 'EXACT') || (k.bidInfo || [])[0] || {};
            return { keywordText: k.keyword, matchType: best.matchType || 'EXACT', suggestedBid: Number(best.suggestedBid?.rangeMedian || best.bid) || null };
        });
    }
    return { products, suggestions };
});

// Every report type SellerQI requests (Services/Sp_API/*).
const SELLERQI_REPORT_TYPES = [
    'GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA', 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA', 'GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA',
    'GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA', 'GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA', 'GET_FBA_INVENTORY_PLANNING_DATA',
    'GET_FBA_REIMBURSEMENTS_DATA', 'GET_FBA_STORAGE_FEE_CHARGES_DATA', 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',
    'GET_LEDGER_DETAIL_VIEW_DATA', 'GET_LEDGER_SUMMARY_VIEW_DATA', 'GET_MERCHANTS_LISTINGS_FYP_REPORT', 'GET_MERCHANT_LISTINGS_ALL_DATA',
    'GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT', 'GET_SELLER_FEEDBACK_DATA', 'GET_STRANDED_INVENTORY_UI_DATA',
    'GET_V1_SELLER_PERFORMANCE_REPORT', 'GET_V2_SELLER_PERFORMANCE_REPORT'
];

/** SellerQI's own report requests still waiting at Amazon (staff only: housekeeping). */
const pendingReports = handle(async (req) => {
    const by = approverOf(req);
    if (!(by.superAdminId || by.esfUserId || by.adminId)) throw Object.assign(new Error('Only the SellerQI team can see this.'), { statusCode: 403 });
    const axios = require('axios');
    const { credentialsFor } = require('../../Services/Sp_API/spApiClient.js');
    const creds = await credentialsFor(req.userId, req.country, req.region);
    // Amazon lists reports only by type (at most 10 types per request).
    const found = [];
    for (let i = 0; i < SELLERQI_REPORT_TYPES.length; i += 10) {
        const res = await axios.get(`${creds.host}/reports/2021-06-30/reports`, {
            headers: { 'x-amz-access-token': creds.accessToken },
            params: { reportTypes: SELLERQI_REPORT_TYPES.slice(i, i + 10).join(','), processingStatuses: 'IN_QUEUE,IN_PROGRESS', pageSize: 100 },
            timeout: 30000
        });
        found.push(...(res.data?.reports || []));
    }
    return {
        reports: found.map((r) => ({
            reportId: String(r.reportId), reportType: r.reportType, status: r.processingStatus,
            createdTime: r.createdTime, processingStartTime: r.processingStartTime || null
        }))
    };
});

/** Unshipped orders you ship yourself (FBM), live. */
const unshippedOrders = handle(async (req) => {
    const { credentialsFor } = require('../../Services/Sp_API/spApiClient.js');
    const { listUnshippedMfnOrders } = require('../../Services/Sp_API/OrderFulfillmentService.js');
    const creds = await credentialsFor(req.userId, req.country, req.region);
    const orders = await listUnshippedMfnOrders(creds, { days: Math.min(Math.max(Number(req.query.days) || 30, 1), 90) });
    return { orders: orders.sort((a, b) => String(a.latestShipDate).localeCompare(String(b.latestShipDate))) };
});

/** One order: its items and the messages Amazon allows for it now. */
const orderDetail = handle(async (req) => {
    const { credentialsFor } = require('../../Services/Sp_API/spApiClient.js');
    const O = require('../../Services/Sp_API/OrderFulfillmentService.js');
    const { messageOptions } = require('../../Services/Sp_API/FeedbackRequest.js');
    const creds = await credentialsFor(req.userId, req.country, req.region);
    const [order, items, messages] = await Promise.all([
        O.getOrder(creds, req.params.orderId),
        O.getOrderItems(creds, req.params.orderId),
        messageOptions({ ...creds, orderId: req.params.orderId }).catch(() => [])
    ]);
    if (!order) throw Object.assign(new Error('Order not found.'), { statusCode: 404 });
    const { CARRIERS } = require('../../Services/Actions/handlers/orders.js');
    return {
        order, items, carriers: CARRIERS,
        messages: messages.filter((m) => m.name !== 'updateFeedback').map((m) => ({
            name: m.name, title: m.title, description: m.description,
            maxLength: m.fields.rawMessageBody?.maxLength || null,
            // Only text messages can be sent from SellerQI for now.
            supported: m.required.every((f) => f === 'rawMessageBody') && !!m.fields.rawMessageBody
        }))
    };
});

module.exports = {
    unshippedOrders, orderDetail,
    pendingReports,
    getCapabilities, getHistory, preview, approve, approveMany, getOne, cancel, approverOf,
    adsCampaigns, adsCampaignAdGroups, adsNewCampaignOptions
};
