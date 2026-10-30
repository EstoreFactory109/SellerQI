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

/** The kinds of live update, and which are on for this account. */
const notificationSubscriptions = handle(async (req) => {
    const { TYPES } = require('../../Services/Actions/handlers/notifications.js');
    const Subscription = require('../../models/MCP/NotificationSubscriptionModel.js');
    const Destination = require('../../models/MCP/NotificationDestinationModel.js');
    const [subs, dest] = await Promise.all([
        Subscription.find({ userId: req.userId, region: req.region }).lean(),
        Destination.findOne({ region: req.region }).select('_id').lean()
    ]);
    const on = new Map(subs.map((s) => [s.notificationType, s]));
    return {
        available: !!dest || !!process.env.DESTINATION_ID,
        types: Object.entries(TYPES).map(([type, label]) => ({ type, label, on: on.has(type), lastEventAt: on.get(type)?.lastEventAt || null }))
    };
});

/** Product types that match the seller's words (for a new product). */
const listingProductTypes = handle(async (req) => {
    const { credentialsFor } = require('../../Services/Sp_API/spApiClient.js');
    const { searchProductTypes } = require('../../Services/Sp_API/ProductTypeDefinitionsService.js');
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return { productTypes: [] };
    const creds = await credentialsFor(req.userId, req.country, req.region);
    return { productTypes: await searchProductTypes(creds, q) };
});

/** The fields a product type needs, as simple form fields (and, for a SKU, its current values). */
const listingFields = handle(async (req) => {
    const { credentialsFor } = require('../../Services/Sp_API/spApiClient.js');
    const PTD = require('../../Services/Sp_API/ProductTypeDefinitionsService.js');
    const creds = await credentialsFor(req.userId, req.country, req.region);
    let productType = String(req.query.productType || '').trim().toUpperCase();
    let current = null;
    if (req.query.sku) {
        const { readLiveListing } = require('../../Services/Sp_API/UpdateProductContentService.js');
        const live = await readLiveListing({ sku: String(req.query.sku), userId: req.userId, country: req.country, region: req.region });
        productType = live.productType || productType;
        current = live.listing?.attributes || {};
    }
    if (!productType) throw Object.assign(new Error('Choose the product type.'), { statusCode: 400 });
    const def = await PTD.getDefinition(creds, productType, 'LISTING', req.country);
    const { fields, unsupportedRequired } = PTD.formFields(def.schema);
    const values = current ? Object.fromEntries(fields.filter((f) => current[f.name]).map((f) => {
        const list = current[f.name];
        if (f.kind === 'measure') return [f.name, { value: list[0]?.value, unit: list[0]?.unit }];
        return [f.name, f.multiple ? list.map((e) => e.value) : list[0]?.value];
    })) : {};
    return { productType, displayName: def.displayName, fields, unsupportedRequired, values };
});

// ---- Inbound shipments (reads, and preparing options: nothing is committed) ----

const inboundCreds = (req) => require('../../Services/Sp_API/spApiClient.js').credentialsFor(req.userId, req.country, req.region);
const inboundApi = () => require('../../Services/Sp_API/InboundV2024Service.js');
const awdRefusal = (error) => error.response?.status === 400 && /Warehousing and Distribution/i.test(JSON.stringify(error.response?.data || ''));

const inboundPlans = handle(async (req) => {
    const plans = await inboundApi().listPlans(await inboundCreds(req));
    return { plans: plans.map((p) => ({ inboundPlanId: p.inboundPlanId, name: p.name || '', status: p.status, createdAt: p.createdAt, lastUpdatedAt: p.lastUpdatedAt })) };
});

const inboundPlanDetail = handle(async (req) => {
    const c = await inboundCreds(req);
    const A = inboundApi();
    const planId = req.params.planId;
    let plan;
    try {
        plan = await A.getPlan(c, planId);
    } catch (error) {
        if (awdRefusal(error)) return { awd: true, plan: { inboundPlanId: planId } };
        throw error;
    }
    const [items, packingOptions, placementOptions] = await Promise.all([
        A.listPlanItems(c, planId).catch(() => []),
        A.listPackingOptions(c, planId).catch(() => []),
        A.listPlacementOptions(c, planId).catch(() => [])
    ]);
    const shipments = await Promise.all((plan.shipments || []).slice(0, 30).map((s) => A.getShipment(c, planId, s.shipmentId).catch(() => s)));
    return {
        plan: { inboundPlanId: plan.inboundPlanId, name: plan.name || '', status: plan.status, createdAt: plan.createdAt, sourceAddress: plan.sourceAddress ? { city: plan.sourceAddress.city, countryCode: plan.sourceAddress.countryCode } : null },
        items: items.map((i) => ({ msku: i.msku, asin: i.asin, quantity: i.quantity, labelOwner: i.labelOwner })),
        packingOptions: packingOptions.map((o) => ({ packingOptionId: o.packingOptionId, status: o.status, packingGroups: o.packingGroups || [], fees: o.fees || [], discounts: o.discounts || [] })),
        placementOptions: placementOptions.map((o) => ({ placementOptionId: o.placementOptionId, status: o.status, shipmentIds: o.shipmentIds || [], fees: o.fees || [] })),
        shipments: shipments.map((s) => ({
            shipmentId: s.shipmentId, name: s.name || '', status: s.status || '', amazonReferenceId: s.amazonReferenceId || null,
            shipmentConfirmationId: s.shipmentConfirmationId || null, warehouseId: s.destination?.warehouseId || null,
            selectedTransportationOptionId: s.selectedTransportationOptionId || null, selectedDeliveryWindow: s.selectedDeliveryWindow || null
        }))
    };
});

/** Ask Amazon to prepare options (packing, placement, shipping, delivery windows, a quantity change). */
const inboundPrepare = handle(async (req) => {
    const c = await inboundCreds(req);
    const A = inboundApi();
    const planId = req.params.planId;
    const { what, shipmentId, readyToShipDate, placementOptionId, items } = req.body || {};
    let out;
    if (what === 'packing') out = await A.generatePackingOptions(c, planId);
    else if (what === 'placement') out = await A.generatePlacementOptions(c, planId);
    else if (what === 'delivery' && shipmentId) out = await A.generateDeliveryWindowOptions(c, planId, shipmentId);
    else if (what === 'transport' && placementOptionId) {
        const start = readyToShipDate ? new Date(readyToShipDate) : new Date(Date.now() + 864e5);
        const plan = await A.getPlan(c, planId);
        out = await A.generateTransportationOptions(c, planId, {
            placementOptionId,
            shipmentTransportationConfigurations: (plan.shipments || []).map((s) => ({ shipmentId: s.shipmentId, readyToShipWindow: { start: start.toISOString() } }))
        });
    } else if (what === 'content' && shipmentId && Array.isArray(items)) {
        const boxes = await A.listShipmentBoxes(c, planId, shipmentId);
        out = await A.generateShipmentContentUpdatePreviews(c, planId, shipmentId, {
            items: items.map((i) => ({ msku: String(i.msku), quantity: Number(i.quantity), prepOwner: i.prepOwner || 'NONE', labelOwner: i.labelOwner || 'SELLER' })),
            boxes: boxes.map((b) => ({ contentInformationSource: b.contentInformationSource || 'BOX_CONTENT_PROVIDED', dimensions: b.dimensions, weight: b.weight, quantity: b.quantity || 1, items: b.items || [] }))
        });
    } else {
        throw Object.assign(new Error('Nothing to prepare.'), { statusCode: 400 });
    }
    return { operationId: out.operationId || null };
});

const inboundOperation = handle(async (req) => {
    const op = await inboundApi().getOperation(await inboundCreds(req), req.params.operationId);
    return { status: op.operationStatus, problems: (op.operationProblems || []).map((p) => p.message || p.code) };
});

const inboundShipmentOptions = handle(async (req) => {
    const c = await inboundCreds(req);
    const A = inboundApi();
    const { planId, shipmentId } = req.params;
    const [transport, windows, previews] = await Promise.all([
        A.listTransportationOptions(c, planId, shipmentId).catch(() => []),
        A.listDeliveryWindowOptions(c, planId, shipmentId).catch(() => []),
        A.listShipmentContentUpdatePreviews(c, planId, shipmentId).catch(() => [])
    ]);
    return {
        transportationOptions: transport.map((o) => ({ transportationOptionId: o.transportationOptionId, carrier: o.carrier?.name || '', shippingMode: o.shippingMode, shippingSolution: o.shippingSolution, preconditions: o.preconditions || [], cost: o.quote?.cost || null })),
        deliveryWindowOptions: windows.map((w) => ({ deliveryWindowOptionId: w.deliveryWindowOptionId, startDate: w.startDate, endDate: w.endDate, availabilityType: w.availabilityType, validUntil: w.validUntil })),
        contentUpdatePreviews: previews.map((p) => ({ contentUpdatePreviewId: p.contentUpdatePreviewId, expiration: p.expiration, items: p.requestedUpdates?.items || [], cost: p.transportationOption?.quote?.cost || null }))
    };
});

const inboundLabels = handle(async (req) => {
    const c = await inboundCreds(req);
    const A = inboundApi();
    const shipment = await A.getShipment(c, req.params.planId, req.params.shipmentId);
    if (!shipment.shipmentConfirmationId) throw Object.assign(new Error('Labels are ready once the shipping is confirmed.'), { statusCode: 409 });
    return { url: await A.getLabels(c, shipment.shipmentConfirmationId, { numberOfPackages: Math.min(Math.max(Number(req.query.boxes) || 1, 1), 999) }) };
});

module.exports = {
    inboundPlans, inboundPlanDetail, inboundPrepare, inboundOperation, inboundShipmentOptions, inboundLabels,
    listingProductTypes, listingFields,
    notificationSubscriptions,
    unshippedOrders, orderDetail,
    pendingReports,
    getCapabilities, getHistory, preview, approve, approveMany, getOne, cancel, approverOf,
    adsCampaigns, adsCampaignAdGroups, adsNewCampaignOptions
};
