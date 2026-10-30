/**
 * Sending stock to Amazon: each step's checks, the box-content split, and the
 * follow-up that waits for Amazon's operations and makes the next call in a chain.
 */
const mock = { ops: {}, calls: [], packing: [], groupItems: [], placement: [], products: [] };
jest.mock('../../../Services/Sp_API/spApiClient.js', () => ({ credentialsFor: async () => ({ accessToken: 't', host: 'https://sp', marketplaceId: 'ATVPDKIKX0DER' }) }));
jest.mock('../../../Services/Sp_API/InboundV2024Service.js', () => ({
    getOperation: async (c, id) => ({ operationStatus: mock.ops[id] || 'IN_PROGRESS', operationProblems: mock.ops[id] === 'FAILED' ? [{ message: 'Box too heavy' }] : [] }),
    listPackingOptions: async () => mock.packing,
    listPackingGroupItems: async () => mock.groupItems,
    listPlacementOptions: async () => mock.placement,
    createPlan: async (c, body) => { mock.calls.push(['createPlan', body]); return { inboundPlanId: 'wf11111111-2222', operationId: 'op-create' }; },
    generatePackingOptions: async () => { mock.calls.push(['generatePackingOptions']); return { operationId: 'op-gen-pack' }; },
    confirmPackingOption: async () => ({ operationId: 'op-confirm-pack' }),
    setPackingInformation: async (c, id, body) => { mock.calls.push(['setPackingInformation', body]); return { operationId: 'op-set-pack' }; },
    generatePlacementOptions: async () => ({ operationId: 'op-gen-place' })
}));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
    findOne: () => ({ select: () => ({ lean: async () => ({ sellerAccount: [{ country: 'US', region: 'NA', products: mock.products }] }) }) })
}));

const registry = require('../../../Services/Actions/registry.js');
const ctx = { userId: 'U1', country: 'US', region: 'NA' };
const PLAN = 'wf11111111-2222';
const ADDRESS = { name: 'Warehouse', addressLine1: '1 Main St', city: 'Austin', stateOrProvinceCode: 'TX', postalCode: '78701', countryCode: 'us', phoneNumber: '5125550100' };

beforeEach(() => {
    mock.ops = {}; mock.calls = [];
    mock.products = [{ sku: 'FBA-1', itemName: 'Wire' }, { sku: 'FBM-1', fulfillmentChannel: 'DEFAULT' }];
    mock.packing = [{ packingOptionId: 'po1', status: 'OFFERED', packingGroups: ['pg1'], fees: [{ type: 'FEE', value: { amount: 0, code: 'USD' } }] }];
    mock.groupItems = [{ msku: 'FBA-1', quantity: 24, labelOwner: 'SELLER', prepInstructions: [{ prepOwner: 'NONE' }] }];
    mock.placement = [{ placementOptionId: 'pl1', status: 'ACCEPTED', shipmentIds: ['sh1'], fees: [] }];
});

describe('inbound.create_plan', () => {
    const h = registry.get('inbound.create_plan');
    it('needs whole quantities and a full ship-from address', () => {
        expect(h.flag).toBe('AMAZON_ACTIONS_INBOUND');
        expect(() => h.validate({ items: [{ sku: 'FBA-1', quantity: 0 }], sourceAddress: ADDRESS })).toThrow('whole quantity');
        expect(() => h.validate({ items: [{ sku: 'FBA-1', quantity: 5 }], sourceAddress: { name: 'x' } })).toThrow('ship-from address');
        expect(h.validate({ items: [{ sku: 'FBA-1', quantity: 5 }], sourceAddress: ADDRESS }).sourceAddress.countryCode).toBe('US');
    });

    it('refuses SKUs the seller ships themselves, and unknown SKUs', async () => {
        await expect(h.preview(h.validate({ items: [{ sku: 'FBM-1', quantity: 5 }], sourceAddress: ADDRESS }), ctx)).rejects.toThrow('FBM');
        await expect(h.preview(h.validate({ items: [{ sku: 'NOPE', quantity: 5 }], sourceAddress: ADDRESS }), ctx)).rejects.toThrow('catalogue');
    });

    it('creates the plan, then asks Amazon for packing options once it exists', async () => {
        const out = await h.execute(h.validate({ items: [{ sku: 'FBA-1', quantity: 5 }], sourceAddress: ADDRESS }), ctx);
        expect(out).toMatchObject({ pending: true, amazon: { inboundPlanId: PLAN, ops: [{ name: 'createInboundPlan', operationId: 'op-create' }], rest: ['generatePackingOptions'] } });
        const doc = { payload: {}, amazon: out.amazon };
        expect(await h.poll(doc, ctx)).toEqual({ status: 'pending' });
        mock.ops['op-create'] = 'SUCCESS';
        const next = await h.poll(doc, ctx);
        expect(next.status).toBe('pending');
        expect(next.amazon.ops.map((o) => [o.name, o.status])).toEqual([['createInboundPlan', 'SUCCESS'], ['generatePackingOptions', 'IN_PROGRESS']]);
        mock.ops['op-gen-pack'] = 'SUCCESS';
        expect((await h.poll({ payload: {}, amazon: next.amazon }, ctx)).status).toBe('succeeded');
    });
});

describe('inbound.confirm_packing', () => {
    const h = registry.get('inbound.confirm_packing');
    const input = (boxCount) => h.validate({ inboundPlanId: PLAN, packingOptionId: 'po1', groups: [{ packingGroupId: 'pg1', boxCount, length: 20, width: 15, height: 10, weight: 30 }] });

    it('splits each item evenly across identical boxes, or says it cannot', async () => {
        const p = await h.preview(input(4), ctx);
        expect(p.payload.packingInformation.packageGroupings[0].boxes[0]).toMatchObject({ quantity: 4, items: [{ msku: 'FBA-1', quantity: 6 }], dimensions: { unitOfMeasurement: 'IN' }, weight: { unit: 'LB', value: 30 } });
        await expect(h.preview(input(5), ctx)).rejects.toThrow('does not split evenly');
    });

    it('confirms the option, then sends the box contents, then asks for placement options', async () => {
        const p = await h.preview(input(4), ctx);
        const out = await h.execute(p.payload, ctx);
        let doc = { payload: p.payload, amazon: out.amazon };
        mock.ops['op-confirm-pack'] = 'SUCCESS';
        let r = await h.poll(doc, ctx);
        expect(r.amazon.ops.map((o) => o.name)).toEqual(['confirmPackingOption', 'setPackingInformation']);
        expect(mock.calls.find((x) => x[0] === 'setPackingInformation')[1]).toEqual(p.payload.packingInformation);
        doc = { payload: p.payload, amazon: r.amazon };
        mock.ops['op-set-pack'] = 'FAILED';
        r = await h.poll(doc, ctx);
        expect(r).toMatchObject({ status: 'failed', error: 'Box too heavy' });
    });
});

describe('inbound.confirm_placement', () => {
    it('refuses an option Amazon no longer offers (seen live: already accepted)', async () => {
        const h = registry.get('inbound.confirm_placement');
        await expect(h.preview(h.validate({ inboundPlanId: PLAN, placementOptionId: 'pl1' }), ctx)).rejects.toThrow('no longer offered');
    });
});

describe('inbound.update_tracking', () => {
    it('needs a tracking number per box, or a bill of lading', () => {
        const h = registry.get('inbound.update_tracking');
        expect(() => h.validate({ inboundPlanId: PLAN, shipmentId: 'sh0d4b1f2e-869c', mode: 'SPD' })).toThrow('each box');
        expect(() => h.validate({ inboundPlanId: PLAN, shipmentId: 'sh0d4b1f2e-869c', mode: 'LTL' })).toThrow('bill of lading');
        expect(h.validate({ inboundPlanId: PLAN, shipmentId: 'sh0d4b1f2e-869c', trackingIds: '1Z1, 1Z2' }).trackingIds).toEqual(['1Z1', '1Z2']);
    });
});
