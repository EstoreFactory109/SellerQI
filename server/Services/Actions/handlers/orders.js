/**
 * Seller-fulfilled orders: confirm a shipment with its tracking number, and send
 * the buyer a message Amazon allows for that order. tasks-logics.xlsx "Post Fn"
 * (Orders). Behind AMAZON_ACTIONS_ORDERS_ENABLED and AMAZON_ACTIONS_MESSAGING_ENABLED.
 *
 * Neither is sent twice: a timeout is settled by re-reading the order (shipment)
 * or left for the seller to check (message), never by resending.
 */
const { userError, staleError } = require('../errors.js');

const CARRIERS = [
    'USPS', 'UPS', 'FedEx', 'DHL', 'Amazon Shipping', 'OnTrac', 'LaserShip', 'Canada Post', 'Purolator',
    'Royal Mail', 'DPD', 'Hermes', 'GLS', 'India Post', 'Blue Dart', 'Delhivery', 'Australia Post',
    'Japan Post', 'Yamato', 'Sagawa', 'Other'
];
const SHIPPABLE = ['Unshipped', 'PartiallyShipped'];

function spApi() { return require('../../Sp_API/spApiClient.js'); }
function ordersApi() { return require('../../Sp_API/OrderFulfillmentService.js'); }
function messaging() { return require('../../Sp_API/FeedbackRequest.js'); }

const confirmShipment = {
    actionType: 'orders.confirm_shipment',
    feature: 'orders',
    flag: 'AMAZON_ACTIONS_ORDERS',
    idempotent: false,
    validate(input) {
        const orderId = String(input?.orderId || '').trim();
        if (!/^\d{3}-\d{7}-\d{7}$/.test(orderId)) throw userError('Choose the order.');
        const carrierCode = String(input?.carrierCode || '').trim();
        if (!CARRIERS.includes(carrierCode)) throw userError('Choose the carrier.');
        const carrierName = String(input?.carrierName || '').trim();
        if (carrierCode === 'Other' && !carrierName) throw userError('Enter the carrier\'s name.');
        const trackingNumber = String(input?.trackingNumber || '').replace(/\s+/g, '');
        if (!/^[A-Za-z0-9-]{5,40}$/.test(trackingNumber)) throw userError('The tracking number should be 5 to 40 letters and numbers.');
        const shipDate = input?.shipDate ? new Date(input.shipDate) : new Date();
        if (Number.isNaN(shipDate.getTime())) throw userError('The ship date is not a date.');
        if (shipDate.getTime() > Date.now() + 60 * 60 * 1000) throw userError('The ship date cannot be in the future.');
        const items = (Array.isArray(input?.items) ? input.items : []).map((i) => ({ orderItemId: String(i.orderItemId), quantity: Number(i.quantity) }))
            .filter((i) => i.orderItemId && i.quantity > 0);
        return { orderId, carrierCode, carrierName: carrierCode === 'Other' ? carrierName : '', shippingMethod: String(input?.shippingMethod || '').trim().slice(0, 50), trackingNumber, shipDate: shipDate.toISOString(), items };
    },
    async preview(input, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const [order, items] = await Promise.all([ordersApi().getOrder(creds, input.orderId), ordersApi().getOrderItems(creds, input.orderId)]);
        if (!order) throw userError('Amazon has no such order in this account.');
        if (order.fulfillmentChannel !== 'MFN') throw userError('Amazon ships this order (FBA), so there is nothing to confirm.');
        if (!SHIPPABLE.includes(order.status)) throw userError(`This order is ${order.status.toLowerCase()}, so a shipment cannot be confirmed.`);
        if (order.purchaseDate && new Date(input.shipDate) < new Date(order.purchaseDate)) throw userError('The ship date is before the order was placed.');
        const open = items.filter((i) => i.quantityOrdered > i.quantityShipped);
        const chosen = input.items.length
            ? input.items.map((c) => {
                const item = open.find((i) => i.orderItemId === c.orderItemId);
                if (!item) throw userError('An item is not in this order, or is already shipped.');
                if (c.quantity > item.quantityOrdered - item.quantityShipped) throw userError(`At most ${item.quantityOrdered - item.quantityShipped} of ${item.sku} are left to ship.`);
                return { ...c, item };
            })
            : open.map((item) => ({ orderItemId: item.orderItemId, quantity: item.quantityOrdered - item.quantityShipped, item }));
        if (chosen.length === 0) throw userError('Everything in this order is already shipped.');
        const warnings = [];
        if (order.latestShipDate && new Date(input.shipDate) > new Date(order.latestShipDate)) warnings.push('This is after the latest ship date, so Amazon counts it as a late shipment.');
        warnings.push('Amazon sends the buyer the tracking number. A wrong tracking number counts against your valid tracking rate.');
        const carrier = input.carrierCode === 'Other' ? input.carrierName : input.carrierCode;
        return {
            title: `Confirm shipment of order ${input.orderId}`,
            target: `Order ${input.orderId} on Amazon`,
            lines: [
                { label: 'Carrier and tracking', before: '', after: `${carrier} ${input.trackingNumber}${input.shippingMethod ? ` (${input.shippingMethod})` : ''}` },
                { label: 'Ship date', before: '', after: input.shipDate.slice(0, 10) },
                ...chosen.map((c) => ({ label: `${c.item.sku}${c.item.title ? ` - ${c.item.title.slice(0, 50)}` : ''}`, before: `${c.item.quantityOrdered - c.item.quantityShipped} to ship`, after: `${c.quantity} shipped` }))
            ],
            warnings,
            payload: {
                orderId: input.orderId,
                packageDetail: {
                    packageReferenceId: '1',
                    carrierCode: input.carrierCode,
                    ...(input.carrierCode === 'Other' ? { carrierName: input.carrierName } : {}),
                    ...(input.shippingMethod ? { shippingMethod: input.shippingMethod } : {}),
                    trackingNumber: input.trackingNumber,
                    shipDate: input.shipDate,
                    orderItems: chosen.map((c) => ({ orderItemId: c.orderItemId, quantity: c.quantity }))
                }
            },
            expected: { status: order.status, itemsShipped: order.itemsShipped }
        };
    },
    async staleCheck(doc, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const order = await ordersApi().getOrder(creds, doc.payload.orderId);
        if (!order || order.status !== doc.expected?.status || order.itemsShipped !== doc.expected?.itemsShipped) {
            throw staleError(`This order is now ${String(order?.status || 'changed').toLowerCase()} on Amazon (confirmed elsewhere or cancelled), so nothing was sent.`);
        }
    },
    async execute(payload, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        return ordersApi().confirmShipment(creds, payload.orderId, payload.packageDetail);
    },
    /** After a timeout: did Amazon record the shipment? */
    async reconcile(doc, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const order = await ordersApi().getOrder(creds, doc.payload.orderId);
        if (order && order.itemsShipped > (doc.expected?.itemsShipped || 0)) return 'succeeded';
        return 'unknown';
    }
};

// Amazon's buyer-seller messaging rules: no links, contact details, marketing or
// review requests in these messages.
const NOT_ALLOWED = [
    [/[^\s@]+@[^\s@]+\.[^\s@]+/, 'email addresses'],
    [/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|in|uk|de)\b/i, 'links or web addresses'],
    [/\+?\d[\d\s().-]{8,}\d/, 'phone numbers'],
    [/\b(coupon|discount|promo(tion)?|% ?off|sale|free gift|giveaway)\b/i, 'marketing or offers'],
    [/\b(review|5[- ]?star|five[- ]star|feedback)\b/i, 'asking for reviews or feedback (use the review request instead)']
];

const sendBuyerMessage = {
    actionType: 'messaging.send_message',
    feature: 'messaging',
    flag: 'AMAZON_ACTIONS_MESSAGING',
    idempotent: false,
    validate(input) {
        const orderId = String(input?.orderId || '').trim();
        if (!/^\d{3}-\d{7}-\d{7}$/.test(orderId)) throw userError('Choose the order.');
        const action = String(input?.action || '').trim();
        if (!action || action === 'updateFeedback') throw userError('Choose the kind of message.');
        const text = String(input?.text || '').trim();
        if (!text) throw userError('Write the message.');
        for (const [pattern, what] of NOT_ALLOWED) {
            if (pattern.test(text)) throw userError(`Amazon does not allow ${what} in buyer messages.`);
        }
        return { orderId, action, text };
    },
    async preview(input, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const options = await messaging().messageOptions({ ...creds, orderId: input.orderId });
        const option = options.find((o) => o.name === input.action);
        if (!option) throw userError('Amazon does not allow this message for this order now.');
        const needsMore = option.required.filter((f) => f !== 'rawMessageBody');
        if (needsMore.length) throw userError(`This message needs ${needsMore.join(', ')} (for example a file), which SellerQI cannot attach yet. Send it from Seller Central.`);
        const max = option.fields.rawMessageBody?.maxLength;
        if (max && input.text.length > max) throw userError(`This message can be at most ${max} characters (it is ${input.text.length}).`);
        const ChangeRequest = require('../../../models/MCP/AmazonChangeRequestModel.js');
        const sent = await ChangeRequest.findOne({ userId: ctx.userId, country: ctx.country, region: ctx.region, actionType: 'messaging.send_message', status: { $in: ['succeeded', 'unknown'] }, 'payload.orderId': input.orderId, 'payload.action': input.action }).select('_id').lean();
        if (sent) throw userError('This message was already sent for this order.');
        return {
            title: option.title,
            target: `Message to the buyer of order ${input.orderId}`,
            lines: [{ label: 'Message', before: '', after: input.text }],
            warnings: ['Amazon delivers it through Buyer-Seller Messaging and keeps a copy. It cannot be taken back.'],
            payload: { orderId: input.orderId, action: input.action, body: { rawMessageBody: input.text } }
        };
    },
    async staleCheck(doc, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        const options = await messaging().messageOptions({ ...creds, orderId: doc.payload.orderId });
        if (!options.some((o) => o.name === doc.payload.action)) throw staleError('Amazon no longer allows this message for this order, so it was not sent.');
    },
    async execute(payload, ctx) {
        const creds = await spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
        return messaging().sendMessage({ ...creds, orderId: payload.orderId, action: payload.action, body: payload.body });
    }
};

module.exports = { handlers: [confirmShipment, sendBuyerMessage], CARRIERS };
