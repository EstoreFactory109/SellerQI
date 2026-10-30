/**
 * Sending stock to Amazon's warehouses (Fulfillment Inbound v2024-03-20).
 * tasks-logics.xlsx "Post Fn" (Inventory, Reimbursements & FBA). Behind
 * AMAZON_ACTIONS_INBOUND_ENABLED.
 *
 * Every step that commits anything is its own approval, with its fees shown:
 *   inbound.create_plan              the SKUs, quantities and ship-from address
 *   inbound.confirm_packing          a packing option + the box contents
 *   inbound.confirm_placement        where Amazon splits the stock (fees; fixed after)
 *   inbound.confirm_delivery_window  for transport that needs one
 *   inbound.confirm_transport        the carrier for each shipment (cost)
 *   inbound.update_tracking          tracking numbers for your own carrier
 *   inbound.update_quantities        a quantity change Amazon previewed (fee change)
 *   inbound.cancel_plan
 * Each returns an operationId that Amazon finishes later; the change waits as
 * awaiting_amazon and the poller follows the operation (and the next call in a
 * chain, e.g. box contents after the packing option).
 */
const { userError, staleError } = require('../errors.js');

const FLAG = 'AMAZON_ACTIONS_INBOUND';
const OWNERS = ['SELLER', 'AMAZON', 'NONE'];
const MAX_ITEMS = 200;

function spApi() { return require('../../Sp_API/spApiClient.js'); }
function api() { return require('../../Sp_API/InboundV2024Service.js'); }
const creds = (ctx) => spApi().credentialsFor(ctx.userId, ctx.country, ctx.region);
const planIdOf = (v) => {
    const s = String(v || '').trim();
    if (!/^wf[0-9a-f-]{10,}$/i.test(s)) throw userError('Choose the shipment plan.');
    return s;
};
const shipmentIdOf = (v) => {
    const s = String(v || '').trim();
    if (!/^sh[0-9a-f-]{10,}$/i.test(s)) throw userError('Choose the shipment.');
    return s;
};
const money = (fees = []) => {
    const total = (fees || []).filter((f) => f.type !== 'DISCOUNT').reduce((s, f) => s + (Number(f.value?.amount) || 0), 0)
        - (fees || []).filter((f) => f.type === 'DISCOUNT').reduce((s, f) => s + (Number(f.value?.amount) || 0), 0);
    const code = (fees || [])[0]?.value?.code || '';
    return `${code ? `${code} ` : ''}${total.toFixed(2)}`;
};

/** Pending on one operation; `rest` are the calls still to make after it, in order. */
const pending = (planId, operationId, name, rest = [], extra = {}) => ({
    pending: true,
    amazon: { inboundPlanId: planId, ops: [{ name, operationId, status: 'IN_PROGRESS' }], rest, ...extra }
});

/**
 * The shared follow-up: wait for the current operation; when it succeeds, make
 * the next call in the chain (`runNext(name, doc, creds)` returns its operationId).
 */
function followOperations(runNext = null) {
    return async (doc, ctx) => {
        const c = await creds(ctx);
        const ops = [...(doc.amazon?.ops || [])];
        const current = ops[ops.length - 1];
        if (!current?.operationId) return { status: 'failed', error: 'Amazon gave no operation to follow.' };
        const op = await api().getOperation(c, current.operationId);
        const status = op.operationStatus;
        if (status === 'IN_PROGRESS') return { status: 'pending' };
        if (status !== 'SUCCESS') {
            const problems = (op.operationProblems || []).map((p) => p.message || p.code).filter(Boolean);
            return { status: 'failed', error: problems[0] || `Amazon could not finish ${current.name}.`, response: op, amazon: { ...doc.amazon, ops: ops.map((o, i) => (i === ops.length - 1 ? { ...o, status } : o)) } };
        }
        ops[ops.length - 1] = { ...current, status: 'SUCCESS' };
        const rest = [...(doc.amazon?.rest || [])];
        if (rest.length && runNext) {
            const name = rest.shift();
            const operationId = await runNext(name, doc, c);
            return { status: 'pending', amazon: { ...doc.amazon, ops: [...ops, { name, operationId, status: 'IN_PROGRESS' }], rest } };
        }
        return { status: 'succeeded', amazon: { ...doc.amazon, ops, rest: [] }, response: op };
    };
}

// ------------------------------------------------------------------ create plan

const createPlan = {
    actionType: 'inbound.create_plan',
    feature: 'inbound',
    flag: FLAG,
    idempotent: false, // a second call creates a second plan
    validate(input) {
        const raw = Array.isArray(input?.items) ? input.items : [];
        if (raw.length === 0) throw userError('Add at least one SKU to send.');
        if (raw.length > MAX_ITEMS) throw userError(`At most ${MAX_ITEMS} SKUs in one plan.`);
        const labelOwner = OWNERS.includes(input?.labelOwner) ? input.labelOwner : 'SELLER';
        const prepOwner = OWNERS.includes(input?.prepOwner) ? input.prepOwner : 'NONE';
        const seen = new Set();
        const items = raw.map((i) => {
            const sku = String(i?.sku || '').trim();
            const quantity = Number(i?.quantity);
            if (!sku || !Number.isInteger(quantity) || quantity < 1) throw userError('Every SKU needs a whole quantity of 1 or more.');
            if (seen.has(sku)) throw userError(`${sku} is listed twice.`);
            seen.add(sku);
            return { sku, quantity };
        });
        const a = input?.sourceAddress || {};
        const address = {
            name: String(a.name || '').trim(), addressLine1: String(a.addressLine1 || '').trim(), addressLine2: String(a.addressLine2 || '').trim(),
            city: String(a.city || '').trim(), stateOrProvinceCode: String(a.stateOrProvinceCode || '').trim(), postalCode: String(a.postalCode || '').trim(),
            countryCode: String(a.countryCode || '').trim().toUpperCase(), phoneNumber: String(a.phoneNumber || '').trim(), email: String(a.email || '').trim()
        };
        for (const k of ['name', 'addressLine1', 'city', 'postalCode', 'countryCode', 'phoneNumber']) {
            if (!address[k]) throw userError('Fill in the ship-from address (name, street, city, postcode, country and phone).');
        }
        if (!/^[A-Z]{2}$/.test(address.countryCode)) throw userError('The country must be a 2-letter code, e.g. US.');
        return { name: String(input?.name || '').trim().slice(0, 40), items, labelOwner, prepOwner, sourceAddress: Object.fromEntries(Object.entries(address).filter(([, v]) => v)) };
    },
    async preview(input, ctx) {
        const Seller = require('../../../models/user-auth/sellerCentralModel.js');
        const seller = await Seller.findOne({ User: ctx.userId }).select('sellerAccount.country sellerAccount.region sellerAccount.products.sku sellerAccount.products.itemName sellerAccount.products.fulfillmentChannel').lean();
        const account = (seller?.sellerAccount || []).find((x) => x.country === ctx.country && x.region === ctx.region);
        const products = new Map((account?.products || []).map((p) => [p.sku, p]));
        const unknown = input.items.filter((i) => !products.has(i.sku));
        if (unknown.length) throw userError(`Not in this marketplace's catalogue: ${unknown.slice(0, 5).map((x) => x.sku).join(', ')}.`);
        const fbm = input.items.filter((i) => products.get(i.sku)?.fulfillmentChannel === 'DEFAULT');
        if (fbm.length) throw userError(`These SKUs are set up for you to ship yourself (FBM), so Amazon cannot receive them: ${fbm.slice(0, 5).map((x) => x.sku).join(', ')}.`);
        const units = input.items.reduce((s, i) => s + i.quantity, 0);
        const a = input.sourceAddress;
        return {
            title: `Create a shipment plan for ${units} unit${units === 1 ? '' : 's'}`,
            target: 'Send to Amazon (FBA)',
            lines: [
                ...input.items.map((i) => ({ label: `${i.sku}${products.get(i.sku)?.itemName ? ` - ${String(products.get(i.sku).itemName).slice(0, 50)}` : ''}`, before: '', after: `${i.quantity} units` })),
                { label: 'Ship from', before: '', after: [a.name, a.addressLine1, a.city, a.postalCode, a.countryCode].filter(Boolean).join(', ') },
                { label: 'Labels and prep', before: '', after: `Labels by ${input.labelOwner.toLowerCase()}, prep by ${input.prepOwner.toLowerCase()}` }
            ],
            warnings: ['Creating the plan is free. Amazon shows packing and placement options next, with their fees, for you to approve one by one.'],
            payload: input
        };
    },
    async execute(p, ctx) {
        const c = await creds(ctx);
        const out = await api().createPlan(c, {
            destinationMarketplaces: [c.marketplaceId],
            sourceAddress: p.sourceAddress,
            items: p.items.map((i) => ({ msku: i.sku, quantity: i.quantity, labelOwner: p.labelOwner, prepOwner: p.prepOwner })),
            ...(p.name ? { name: p.name } : {})
        });
        if (!out.inboundPlanId || !out.operationId) throw new Error('Amazon did not create the plan.');
        // After the plan exists, ask Amazon for packing options (free, commits nothing).
        return pending(out.inboundPlanId, out.operationId, 'createInboundPlan', ['generatePackingOptions']);
    },
    poll: followOperations(async (name, doc, c) => (await api().generatePackingOptions(c, doc.amazon.inboundPlanId)).operationId)
};

// ------------------------------------------------------------------ packing

const confirmPacking = {
    actionType: 'inbound.confirm_packing',
    feature: 'inbound',
    flag: FLAG,
    idempotent: true,
    validate(input) {
        const groups = (Array.isArray(input?.groups) ? input.groups : []).map((g) => ({
            packingGroupId: String(g?.packingGroupId || ''),
            boxCount: Number(g?.boxCount),
            length: Number(g?.length), width: Number(g?.width), height: Number(g?.height),
            dimUnit: g?.dimUnit === 'CM' ? 'CM' : 'IN',
            weight: Number(g?.weight),
            weightUnit: g?.weightUnit === 'KG' ? 'KG' : 'LB'
        }));
        if (!input?.packingOptionId) throw userError('Choose a packing option.');
        if (groups.length === 0) throw userError('Enter the boxes for each packing group.');
        for (const g of groups) {
            if (!g.packingGroupId || !Number.isInteger(g.boxCount) || g.boxCount < 1) throw userError('Each packing group needs a number of boxes.');
            if (!(g.length > 0 && g.width > 0 && g.height > 0 && g.weight > 0)) throw userError('Enter each box size and weight.');
        }
        return { inboundPlanId: planIdOf(input?.inboundPlanId), packingOptionId: String(input.packingOptionId), groups };
    },
    async preview(input, ctx) {
        const c = await creds(ctx);
        const options = await api().listPackingOptions(c, input.inboundPlanId);
        const option = options.find((o) => o.packingOptionId === input.packingOptionId);
        if (!option) throw userError('This packing option is no longer offered. Get the options again.');
        if (option.status !== 'OFFERED') throw userError(`This packing option is ${String(option.status).toLowerCase()}.`);
        const groupIds = option.packingGroups || [];
        const missing = groupIds.filter((g) => !input.groups.some((x) => x.packingGroupId === g));
        if (missing.length) throw userError('Enter the boxes for every packing group of this option.');
        const packageGroupings = [];
        const lines = [];
        for (const g of input.groups.filter((x) => groupIds.includes(x.packingGroupId))) {
            const items = await api().listPackingGroupItems(c, input.inboundPlanId, g.packingGroupId);
            const uneven = items.filter((i) => i.quantity % g.boxCount !== 0);
            if (uneven.length) throw userError(`${uneven[0].msku} (${uneven[0].quantity} units) does not split evenly into ${g.boxCount} boxes. Use a box count that divides every quantity, or set mixed boxes in Seller Central.`);
            packageGroupings.push({
                packingGroupId: g.packingGroupId,
                boxes: [{
                    contentInformationSource: 'BOX_CONTENT_PROVIDED',
                    dimensions: { length: g.length, width: g.width, height: g.height, unitOfMeasurement: g.dimUnit },
                    weight: { value: g.weight, unit: g.weightUnit },
                    quantity: g.boxCount,
                    items: items.map((i) => ({ msku: i.msku, quantity: i.quantity / g.boxCount, prepOwner: i.prepInstructions?.[0]?.prepOwner || 'NONE', labelOwner: i.labelOwner || 'SELLER' }))
                }]
            });
            lines.push({ label: `Packing group ${packageGroupings.length}`, before: '', after: `${g.boxCount} box${g.boxCount === 1 ? '' : 'es'} of ${g.length}x${g.width}x${g.height} ${g.dimUnit.toLowerCase()}, ${g.weight} ${g.weightUnit.toLowerCase()} each; ${items.map((i) => `${i.msku} x${i.quantity / g.boxCount}`).join(', ')} per box` });
        }
        return {
            title: 'Confirm packing and box contents',
            target: `Shipment plan ${input.inboundPlanId}`,
            lines: [{ label: 'Packing option fees', before: '', after: money(option.fees) }, ...lines],
            warnings: ['Amazon checks the box contents against the plan; wrong contents can mean fees or refused boxes.'],
            payload: { inboundPlanId: input.inboundPlanId, packingOptionId: input.packingOptionId, packingInformation: { packageGroupings } },
            expected: { status: option.status }
        };
    },
    async staleCheck(doc, ctx) {
        const option = (await api().listPackingOptions(await creds(ctx), doc.payload.inboundPlanId)).find((o) => o.packingOptionId === doc.payload.packingOptionId);
        if (!option || option.status !== 'OFFERED') throw staleError('This packing option is no longer offered, so nothing was sent.');
    },
    async execute(p, ctx) {
        const out = await api().confirmPackingOption(await creds(ctx), p.inboundPlanId, p.packingOptionId);
        return pending(p.inboundPlanId, out.operationId, 'confirmPackingOption', ['setPackingInformation', 'generatePlacementOptions'], { packingInformation: p.packingInformation });
    },
    poll: followOperations(async (name, doc, c) => {
        if (name === 'setPackingInformation') return (await api().setPackingInformation(c, doc.amazon.inboundPlanId, doc.payload.packingInformation)).operationId;
        return (await api().generatePlacementOptions(c, doc.amazon.inboundPlanId)).operationId;
    })
};

// ------------------------------------------------------------------ placement

const confirmPlacement = {
    actionType: 'inbound.confirm_placement',
    feature: 'inbound',
    flag: FLAG,
    idempotent: true,
    validate(input) {
        if (!input?.placementOptionId) throw userError('Choose a placement option.');
        return { inboundPlanId: planIdOf(input?.inboundPlanId), placementOptionId: String(input.placementOptionId) };
    },
    async preview(input, ctx) {
        const options = await api().listPlacementOptions(await creds(ctx), input.inboundPlanId);
        const option = options.find((o) => o.placementOptionId === input.placementOptionId);
        if (!option || option.status !== 'OFFERED') throw userError('This placement option is no longer offered. Get the options again.');
        const others = options.filter((o) => o.status === 'OFFERED' && o.placementOptionId !== input.placementOptionId);
        return {
            title: 'Confirm where Amazon receives the stock',
            target: `Shipment plan ${input.inboundPlanId}`,
            lines: [
                { label: 'Placement fee', before: '', after: money(option.fees) },
                { label: 'Shipments', before: '', after: `${(option.shipmentIds || []).length} shipment${(option.shipmentIds || []).length === 1 ? '' : 's'} to Amazon's warehouses` },
                ...(others.length ? [{ label: 'Other options', before: '', after: others.map((o) => `${money(o.fees)} for ${(o.shipmentIds || []).length} shipments`).join('; ') }] : [])
            ],
            warnings: ['This cannot be undone: once confirmed, the split and its fee are fixed for this plan.'],
            payload: input,
            expected: { status: option.status }
        };
    },
    async staleCheck(doc, ctx) {
        const option = (await api().listPlacementOptions(await creds(ctx), doc.payload.inboundPlanId)).find((o) => o.placementOptionId === doc.payload.placementOptionId);
        if (!option || option.status !== 'OFFERED') throw staleError('This placement option is no longer offered, so nothing was sent.');
    },
    async execute(p, ctx) {
        const out = await api().confirmPlacementOption(await creds(ctx), p.inboundPlanId, p.placementOptionId);
        return pending(p.inboundPlanId, out.operationId, 'confirmPlacementOption');
    },
    poll: followOperations()
};

// ------------------------------------------------------------------ delivery window and transport

const confirmDeliveryWindow = {
    actionType: 'inbound.confirm_delivery_window',
    feature: 'inbound',
    flag: FLAG,
    idempotent: true,
    validate(input) {
        if (!input?.deliveryWindowOptionId) throw userError('Choose a delivery window.');
        return { inboundPlanId: planIdOf(input?.inboundPlanId), shipmentId: shipmentIdOf(input?.shipmentId), deliveryWindowOptionId: String(input.deliveryWindowOptionId) };
    },
    async preview(input, ctx) {
        const options = await api().listDeliveryWindowOptions(await creds(ctx), input.inboundPlanId, input.shipmentId);
        const option = options.find((o) => o.deliveryWindowOptionId === input.deliveryWindowOptionId);
        if (!option) throw userError('This delivery window is no longer offered. Get the windows again.');
        return {
            title: 'Confirm the delivery window',
            target: `Shipment ${input.shipmentId}`,
            lines: [{ label: 'Arrives at Amazon', before: '', after: `${String(option.startDate).slice(0, 10)} to ${String(option.endDate).slice(0, 10)}` }],
            warnings: option.validUntil ? [`Amazon holds this window until ${String(option.validUntil).slice(0, 16).replace('T', ' ')}.`] : [],
            payload: input
        };
    },
    async execute(p, ctx) {
        const out = await api().confirmDeliveryWindowOptions(await creds(ctx), p.inboundPlanId, p.shipmentId, p.deliveryWindowOptionId);
        return pending(p.inboundPlanId, out.operationId, 'confirmDeliveryWindowOptions');
    },
    poll: followOperations()
};

const confirmTransport = {
    actionType: 'inbound.confirm_transport',
    feature: 'inbound',
    flag: FLAG,
    idempotent: true,
    validate(input) {
        const selections = (Array.isArray(input?.selections) ? input.selections : []).map((s) => ({ shipmentId: shipmentIdOf(s?.shipmentId), transportationOptionId: String(s?.transportationOptionId || '') }));
        if (selections.length === 0 || selections.some((s) => !s.transportationOptionId)) throw userError('Choose the carrier for each shipment.');
        return { inboundPlanId: planIdOf(input?.inboundPlanId), selections };
    },
    async preview(input, ctx) {
        const c = await creds(ctx);
        const lines = [];
        for (const s of input.selections) {
            const [options, shipment] = await Promise.all([api().listTransportationOptions(c, input.inboundPlanId, s.shipmentId), api().getShipment(c, input.inboundPlanId, s.shipmentId)]);
            const option = options.find((o) => o.transportationOptionId === s.transportationOptionId);
            if (!option) throw userError('A carrier option is no longer offered. Get the options again.');
            if ((option.preconditions || []).includes('CONFIRMED_DELIVERY_WINDOW') && !shipment.selectedDeliveryWindow) {
                throw userError(`Shipment ${shipment.name || s.shipmentId} needs a confirmed delivery window first.`);
            }
            const cost = option.quote?.cost ? `${option.quote.cost.code || ''} ${Number(option.quote.cost.amount).toFixed(2)}`.trim() : 'no Amazon charge (your own carrier)';
            lines.push({ label: shipment.name || s.shipmentId, before: '', after: `${option.carrier?.name || 'Carrier'}, ${String(option.shippingMode || '').replace(/_/g, ' ').toLowerCase()}, ${String(option.shippingSolution || '').replace(/_/g, ' ').toLowerCase()}: ${cost}` });
        }
        return {
            title: 'Confirm the shipping for each shipment',
            target: `Shipment plan ${input.inboundPlanId}`,
            lines,
            warnings: ['Amazon-partnered carrier costs are charged to your account.'],
            payload: input
        };
    },
    async execute(p, ctx) {
        const out = await api().confirmTransportationOptions(await creds(ctx), p.inboundPlanId, { transportationSelections: p.selections });
        return pending(p.inboundPlanId, out.operationId, 'confirmTransportationOptions');
    },
    poll: followOperations()
};

// ------------------------------------------------------------------ tracking, quantities, cancel

const updateTracking = {
    actionType: 'inbound.update_tracking',
    feature: 'inbound',
    flag: FLAG,
    idempotent: true,
    validate(input) {
        const mode = input?.mode === 'LTL' ? 'LTL' : 'SPD';
        const trackingIds = (Array.isArray(input?.trackingIds) ? input.trackingIds : String(input?.trackingIds || '').split(/[\s,]+/)).map((t) => String(t).trim()).filter(Boolean);
        if (mode === 'SPD' && trackingIds.length === 0) throw userError('Enter a tracking number for each box.');
        const billOfLadingNumber = String(input?.billOfLadingNumber || '').trim();
        if (mode === 'LTL' && !billOfLadingNumber) throw userError('Enter the bill of lading number.');
        return { inboundPlanId: planIdOf(input?.inboundPlanId), shipmentId: shipmentIdOf(input?.shipmentId), mode, trackingIds, billOfLadingNumber };
    },
    async preview(input, ctx) {
        let trackingDetails;
        let lines;
        if (input.mode === 'SPD') {
            const boxes = await api().listShipmentBoxes(await creds(ctx), input.inboundPlanId, input.shipmentId);
            if (boxes.length !== input.trackingIds.length) throw userError(`This shipment has ${boxes.length} box${boxes.length === 1 ? '' : 'es'}; enter one tracking number for each (you entered ${input.trackingIds.length}).`);
            trackingDetails = { spdTrackingDetail: { spdTrackingItems: boxes.map((b, i) => ({ boxId: b.boxId, trackingId: input.trackingIds[i] })) } };
            lines = boxes.map((b, i) => ({ label: `Box ${i + 1}`, before: '', after: input.trackingIds[i] }));
        } else {
            trackingDetails = { ltlTrackingDetail: { billOfLadingNumber: input.billOfLadingNumber } };
            lines = [{ label: 'Bill of lading', before: '', after: input.billOfLadingNumber }];
        }
        return { title: 'Add tracking for your carrier', target: `Shipment ${input.shipmentId}`, lines, warnings: [], payload: { inboundPlanId: input.inboundPlanId, shipmentId: input.shipmentId, body: { trackingDetails } } };
    },
    async execute(p, ctx) {
        await api().updateShipmentTrackingDetails(await creds(ctx), p.inboundPlanId, p.shipmentId, p.body);
        return { updated: true };
    }
};

const updateQuantities = {
    actionType: 'inbound.update_quantities',
    feature: 'inbound',
    flag: FLAG,
    idempotent: true,
    validate(input) {
        if (!input?.contentUpdatePreviewId) throw userError('Get Amazon\'s preview of the change first.');
        return { inboundPlanId: planIdOf(input?.inboundPlanId), shipmentId: shipmentIdOf(input?.shipmentId), contentUpdatePreviewId: String(input.contentUpdatePreviewId) };
    },
    async preview(input, ctx) {
        const previews = await api().listShipmentContentUpdatePreviews(await creds(ctx), input.inboundPlanId, input.shipmentId);
        const p = previews.find((x) => x.contentUpdatePreviewId === input.contentUpdatePreviewId);
        if (!p) throw userError('Amazon\'s preview of this change has expired. Get it again.');
        const items = p.requestedUpdates?.items || [];
        const quote = p.transportationOption?.quote?.cost;
        return {
            title: 'Change the quantities in this shipment',
            target: `Shipment ${input.shipmentId}`,
            lines: [
                ...items.map((i) => ({ label: i.msku, before: '', after: `${i.quantity} units` })),
                ...(quote ? [{ label: 'Shipping after the change', before: '', after: `${quote.code || ''} ${Number(quote.amount).toFixed(2)}`.trim() }] : [])
            ],
            warnings: p.expiration ? [`Amazon holds this preview until ${String(p.expiration).slice(0, 16).replace('T', ' ')}.`] : [],
            payload: input
        };
    },
    async execute(p, ctx) {
        const out = await api().confirmShipmentContentUpdatePreview(await creds(ctx), p.inboundPlanId, p.shipmentId, p.contentUpdatePreviewId);
        return pending(p.inboundPlanId, out.operationId, 'confirmShipmentContentUpdatePreview');
    },
    poll: followOperations()
};

const cancelPlan = {
    actionType: 'inbound.cancel_plan',
    feature: 'inbound',
    flag: FLAG,
    idempotent: true,
    validate(input) { return { inboundPlanId: planIdOf(input?.inboundPlanId) }; },
    async preview(input, ctx) {
        const plan = await api().getPlan(await creds(ctx), input.inboundPlanId);
        if (plan.status !== 'ACTIVE') throw userError(`This plan is ${String(plan.status || 'not active').toLowerCase()}.`);
        return {
            title: 'Cancel this shipment plan',
            target: `Shipment plan ${plan.name || input.inboundPlanId}`,
            lines: [{ label: 'Plan', before: 'Active', after: 'Cancelled' }],
            warnings: ['Fees already confirmed (for example an Amazon-partnered carrier) may still apply under Amazon\'s rules.'],
            payload: input
        };
    },
    async execute(p, ctx) {
        const out = await api().cancelPlan(await creds(ctx), p.inboundPlanId);
        return pending(p.inboundPlanId, out.operationId, 'cancelInboundPlan');
    },
    poll: followOperations()
};

module.exports = {
    handlers: [createPlan, confirmPacking, confirmPlacement, confirmDeliveryWindow, confirmTransport, updateTracking, updateQuantities, cancelPlan],
    followOperations, money
};
