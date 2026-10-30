/**
 * Confirming FBM shipments and messaging buyers: the checks before anything is
 * sent (shapes as Amazon returned them live, Oct 2026).
 */
const mock = { order: null, items: [], options: [], sentBefore: null };
jest.mock('../../../Services/Sp_API/spApiClient.js', () => ({
    credentialsFor: async () => ({ accessToken: 't', host: 'https://sp', marketplaceId: 'ATVPDKIKX0DER', sellerId: 'S1' })
}));
jest.mock('../../../Services/Sp_API/OrderFulfillmentService.js', () => ({
    getOrder: async () => mock.order,
    getOrderItems: async () => mock.items,
    confirmShipment: async (creds, orderId, packageDetail) => ({ orderId, packageDetail })
}));
jest.mock('../../../Services/Sp_API/FeedbackRequest.js', () => ({
    messageOptions: async () => mock.options,
    sendMessage: async (args) => ({ sent: true, args })
}));
jest.mock('../../../models/MCP/AmazonChangeRequestModel.js', () => ({
    findOne: () => ({ select: () => ({ lean: async () => mock.sentBefore }) })
}));

const registry = require('../../../Services/Actions/registry.js');
const ctx = { userId: 'U1', country: 'US', region: 'NA' };
const ORDER = '111-6109557-4108220';

beforeEach(() => {
    mock.order = { orderId: ORDER, status: 'Unshipped', fulfillmentChannel: 'MFN', purchaseDate: '2026-10-28T10:00:00Z', latestShipDate: '2099-10-31T06:59:59Z', itemsShipped: 0 };
    mock.items = [
        { orderItemId: '1736', sku: 'BC-16-500-ORG', title: 'Automotive wire', quantityOrdered: 2, quantityShipped: 0 },
        { orderItemId: '1737', sku: 'BC-16-500-BLK', title: 'Automotive wire', quantityOrdered: 1, quantityShipped: 1 }
    ];
    mock.options = [
        { name: 'confirmOrderDetails', title: 'Confirm order details', required: ['rawMessageBody'], fields: { rawMessageBody: { type: 'string', maxLength: 20 } } },
        { name: 'confirmCustomizationDetails', title: 'Confirm customization details', required: ['attachments', 'rawMessageBody'], fields: { rawMessageBody: { type: 'string', maxLength: 800 } } }
    ];
    mock.sentBefore = null;
});

describe('orders.confirm_shipment', () => {
    const h = registry.get('orders.confirm_shipment');
    const input = (over = {}) => h.validate({ orderId: ORDER, carrierCode: 'USPS', trackingNumber: '9400 1112 0206', ...over });

    it('needs a known carrier (and a name for Other), a sane tracking number, no future date', () => {
        expect(() => input({ carrierCode: 'Pigeon' })).toThrow('Choose the carrier');
        expect(() => input({ carrierCode: 'Other' })).toThrow("carrier's name");
        expect(() => input({ trackingNumber: '12' })).toThrow('tracking number');
        expect(() => input({ shipDate: '2099-01-01' })).toThrow('future');
        expect(input().trackingNumber).toBe('940011120206');
    });

    it('ships what is left by default and builds Amazon\'s package detail', async () => {
        const p = await h.preview(input(), ctx);
        expect(p.payload.packageDetail).toMatchObject({ packageReferenceId: '1', carrierCode: 'USPS', trackingNumber: '940011120206', orderItems: [{ orderItemId: '1736', quantity: 2 }] });
        expect(p.lines.map((l) => l.label)).toEqual(['Carrier and tracking', 'Ship date', 'BC-16-500-ORG - Automotive wire']);
        expect(p.expected).toEqual({ status: 'Unshipped', itemsShipped: 0 });
    });

    it('refuses FBA orders, shipped orders, and more than is left', async () => {
        mock.order.fulfillmentChannel = 'AFN';
        await expect(h.preview(input(), ctx)).rejects.toThrow('FBA');
        mock.order.fulfillmentChannel = 'MFN';
        mock.order.status = 'Shipped';
        await expect(h.preview(input(), ctx)).rejects.toThrow('shipped');
        mock.order.status = 'Unshipped';
        await expect(h.preview(input({ items: [{ orderItemId: '1736', quantity: 3 }] }), ctx)).rejects.toThrow('At most 2');
    });

    it('warns when it ships late, and goes stale if confirmed elsewhere meanwhile', async () => {
        mock.order.latestShipDate = '2026-10-29T06:59:59Z';
        const p = await h.preview(input({ shipDate: new Date().toISOString() }), ctx);
        expect(p.warnings[0]).toContain('late shipment');
        mock.order.status = 'Shipped';
        await expect(h.staleCheck({ payload: p.payload, expected: p.expected }, ctx)).rejects.toMatchObject({ isStale: true });
    });

    it('after a timeout, counts it as done only if Amazon shows more items shipped', async () => {
        expect(await h.reconcile({ payload: { orderId: ORDER }, expected: { itemsShipped: 0 } }, ctx)).toBe('unknown');
        mock.order.itemsShipped = 2;
        expect(await h.reconcile({ payload: { orderId: ORDER }, expected: { itemsShipped: 0 } }, ctx)).toBe('succeeded');
    });
});

describe('messaging.send_message', () => {
    const h = registry.get('messaging.send_message');

    it("keeps to Amazon's messaging rules", () => {
        const v = (text) => () => h.validate({ orderId: ORDER, action: 'confirmOrderDetails', text });
        expect(v('See www.example.com')).toThrow('links');
        expect(v('Mail me at a@b.co')).toThrow('email');
        expect(v('Call +1 415 555 0100')).toThrow('phone');
        expect(v('Use coupon SAVE10')).toThrow('marketing');
        expect(v('Please leave a 5-star review')).toThrow('reviews');
        expect(v('Your order ships Monday.')).not.toThrow();
    });

    it('sends only messages Amazon allows now, text-only, within the length, once', async () => {
        const p = await h.preview(h.validate({ orderId: ORDER, action: 'confirmOrderDetails', text: 'Ships Monday.' }), ctx);
        expect(p.payload).toEqual({ orderId: ORDER, action: 'confirmOrderDetails', body: { rawMessageBody: 'Ships Monday.' } });
        await expect(h.preview(h.validate({ orderId: ORDER, action: 'confirmOrderDetails', text: 'This is far too long a message.' }), ctx)).rejects.toThrow('at most 20');
        await expect(h.preview(h.validate({ orderId: ORDER, action: 'confirmCustomizationDetails', text: 'x' }), ctx)).rejects.toThrow('cannot attach');
        await expect(h.preview(h.validate({ orderId: ORDER, action: 'warranty', text: 'x' }), ctx)).rejects.toThrow('does not allow');
        mock.sentBefore = { _id: 'X' };
        await expect(h.preview(h.validate({ orderId: ORDER, action: 'confirmOrderDetails', text: 'Ships Monday.' }), ctx)).rejects.toThrow('already sent');
    });

    it('is never resent after a timeout', () => {
        expect(h.idempotent).toBe(false);
        expect(registry.get('orders.confirm_shipment').idempotent).toBe(false);
    });
});
