/**
 * FBM stock and business pricing: the patches sent to Amazon (live shapes, Oct 2026)
 * and the checks before anything is sent.
 */
const W = require('../../../Services/Sp_API/ListingsWriteService.js');

// A seller-fulfilled listing as Amazon returned it (CA, Oct 2026).
const LISTING = {
    fulfillmentAvailability: [{ fulfillmentChannelCode: 'DEFAULT', quantity: 1 }],
    attributes: {
        fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: 1 }],
        purchasable_offer: [{ currency: 'CAD', audience: 'ALL', our_price: [{ schedule: [{ value_with_tax: 19 }] }], marketplace_id: 'A2EUQ1WTGCTBG2' }]
    }
};

describe('ListingsWriteService (pure parts)', () => {
    it('reads FBM stock, and nothing for an Amazon-fulfilled listing', () => {
        expect(W.fbmAvailability(LISTING)).toEqual({ quantity: 1, handlingTime: null });
        expect(W.fbmAvailability({ fulfillmentAvailability: [{ fulfillmentChannelCode: 'AMAZON_NA', quantity: 40 }] })).toBeNull();
    });

    it('builds the stock patch', () => {
        expect(W.buildFulfillmentAvailabilityPatch({ quantity: 3, handlingTime: 2 })).toEqual([
            { op: 'replace', path: '/attributes/fulfillment_availability', value: [{ fulfillment_channel_code: 'DEFAULT', quantity: 3, lead_time_to_ship_max_days: 2 }] }
        ]);
    });

    it('sends the regular price back unchanged next to the business offer', () => {
        const { others } = W.splitOffers(LISTING);
        const [patch] = W.buildB2BOfferPatch({ others, marketplaceId: 'A2EUQ1WTGCTBG2', currency: 'CAD', price: 18, tiers: [{ minQuantity: 5, value: 17 }] });
        expect(patch.op).toBe('replace');
        expect(patch.value).toHaveLength(2);
        expect(patch.value[0]).toEqual(LISTING.attributes.purchasable_offer[0]);
        expect(patch.value[1]).toEqual({
            marketplace_id: 'A2EUQ1WTGCTBG2', currency: 'CAD', audience: 'B2B',
            our_price: [{ schedule: [{ value_with_tax: 18 }] }],
            quantity_discount_plan: [{ schedule: [{ discount_type: 'fixed', levels: [{ lower_bound: 5, value: 17 }] }] }]
        });
    });

    it('reads a business offer back the way SellerQI shows it', () => {
        const [patch] = W.buildB2BOfferPatch({ others: [], marketplaceId: 'M', currency: 'USD', price: 10, discountType: 'percent', tiers: [{ minQuantity: 10, value: 5 }], salePrice: 9, saleStart: '2026-11-01T00:00:00.000Z', saleEnd: '2026-11-30T00:00:00.000Z' });
        expect(W.readB2BOffer(patch.value[0])).toEqual({ price: 10, currency: 'USD', discountType: 'percent', tiers: [{ minQuantity: 10, value: 5 }], salePrice: 9, saleStart: '2026-11-01T00:00:00.000Z', saleEnd: '2026-11-30T00:00:00.000Z' });
    });

    it('treats Amazon ERROR issues as blocking', () => {
        expect(W.issuesOf({ status: 'VALID', issues: [] })).toEqual({ messages: [], blocking: false });
        expect(W.issuesOf({ status: 'INVALID', issues: [{ severity: 'ERROR', message: 'Price below minimum' }] })).toEqual({ messages: ['Price below minimum'], blocking: true });
    });
});

describe('offer handlers', () => {
    const registry = require('../../../Services/Actions/registry.js');

    it('stock: whole numbers only, and a sane handling time', () => {
        const h = registry.get('listings.update_fbm_stock');
        expect(h.flag).toBe('AMAZON_ACTIONS_FBM_STOCK');
        expect(() => h.validate({ sku: 'S', quantity: 2.5 })).toThrow('whole number');
        expect(() => h.validate({ sku: 'S', quantity: 5, handlingTime: 45 })).toThrow('1 to 30 days');
        expect(h.validate({ sku: ' S ', quantity: '7' })).toEqual({ sku: 'S', quantity: 7, handlingTime: null });
    });

    it('business pricing: tiers go up in quantity and down in price, sale below the price', () => {
        const h = registry.get('listings.set_b2b_pricing');
        expect(h.flag).toBe('AMAZON_ACTIONS_B2B');
        expect(() => h.validate({ sku: 'S', price: 10, tiers: [{ minQuantity: 10, value: 9 }, { minQuantity: 5, value: 8 }] })).toThrow('must go up');
        expect(() => h.validate({ sku: 'S', price: 10, tiers: [{ minQuantity: 5, value: 9 }, { minQuantity: 10, value: 9.5 }] })).toThrow('cheaper');
        expect(() => h.validate({ sku: 'S', price: 10, tiers: [{ minQuantity: 5, value: 12 }] })).toThrow('below the business price');
        expect(() => h.validate({ sku: 'S', price: 10, salePrice: 9 })).toThrow('start and an end');
        expect(h.validate({ sku: 'S', price: 10, discountType: 'percent', tiers: [{ minQuantity: 5, value: 5 }, { minQuantity: 10, value: 10 }] }).tiers).toHaveLength(2);
    });
});
