/**
 * Listing creation: turning Amazon's product type schema (live shapes, Oct 2026)
 * into form fields and back into attributes, and the checks on each change.
 */
const PTD = require('../../../Services/Sp_API/ProductTypeDefinitionsService.js');

const text = (max) => ({ type: 'array', items: { type: 'object', required: ['language_tag', 'value'], properties: { value: { type: 'string', maxLength: max }, language_tag: {}, marketplace_id: {} } } });
const SCHEMA = {
    required: ['brand', 'bullet_point', 'country_of_origin', 'item_package_weight', 'complex_thing'],
    properties: {
        brand: { title: 'Brand Name', maxItems: 1, ...text(100) },
        bullet_point: { title: 'Bullet Point', maxItems: 5, ...text(700) },
        country_of_origin: { title: 'Country of Origin', type: 'array', items: { type: 'object', required: ['value'], properties: { value: { type: 'string', enum: ['US', 'CN'], enumNames: ['United States', 'China'] }, marketplace_id: {} } } },
        item_package_weight: { title: 'Package Weight', type: 'array', maxItems: 1, items: { type: 'object', properties: { value: { type: 'number' }, unit: { enum: ['pounds', 'kilograms'] }, marketplace_id: {} } } },
        batteries_required: { title: 'Are batteries required?', type: 'array', items: { type: 'object', properties: { value: { type: 'boolean' }, marketplace_id: {} } } },
        complex_thing: { title: 'Complex', type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, part: { type: 'object' } } } }
    }
};

describe('ProductTypeDefinitionsService (pure)', () => {
    it('turns the common shapes into fields, required first, and names what it cannot show', () => {
        const { fields, unsupportedRequired } = PTD.formFields(SCHEMA);
        expect(fields.map((f) => [f.name, f.kind, f.required])).toEqual([
            ['brand', 'text', true], ['bullet_point', 'text', true], ['country_of_origin', 'choice', true], ['item_package_weight', 'measure', true],
            ['batteries_required', 'boolean', false]
        ]);
        expect(fields[0]).toMatchObject({ languageTag: true, multiple: false, maxLength: 100 });
        expect(fields[1]).toMatchObject({ multiple: true, maxItems: 5 });
        expect(fields[2].options).toEqual([{ value: 'US', label: 'United States' }, { value: 'CN', label: 'China' }]);
        expect(unsupportedRequired).toEqual(['complex_thing']);
    });

    it('builds the attributes Amazon expects from the form values', () => {
        const { fields } = PTD.formFields(SCHEMA);
        const attrs = PTD.attributesFrom({
            brand: 'Acme', bullet_point: ['One', ' ', 'Two'], country_of_origin: 'US',
            item_package_weight: { value: '1.5', unit: 'pounds' }, batteries_required: false, unknown: 'x'
        }, fields, { marketplaceId: 'M', languageTag: 'en_US' });
        expect(attrs).toEqual({
            brand: [{ value: 'Acme', language_tag: 'en_US', marketplace_id: 'M' }],
            bullet_point: [{ value: 'One', language_tag: 'en_US', marketplace_id: 'M' }, { value: 'Two', language_tag: 'en_US', marketplace_id: 'M' }],
            country_of_origin: [{ value: 'US', marketplace_id: 'M' }],
            item_package_weight: [{ value: 1.5, unit: 'pounds', marketplace_id: 'M' }],
            batteries_required: [{ value: false, marketplace_id: 'M' }]
        });
    });
});

describe('listing create handlers', () => {
    const registry = require('../../../Services/Actions/registry.js');

    it('selling an existing ASIN needs an ASIN, a SKU without spaces, a price, and FBM stock', () => {
        const h = registry.get('listings.offer_existing_asin');
        expect(h.flag).toBe('AMAZON_ACTIONS_LISTING_CREATE');
        expect(() => h.validate({ asin: 'B0', sku: 'S', price: 1 })).toThrow('ASIN');
        expect(() => h.validate({ asin: 'B00J357DGW', sku: 'has space', price: 1 })).toThrow('no spaces');
        expect(() => h.validate({ asin: 'B00J357DGW', sku: 'S1', price: 5, fulfillment: 'FBM' })).toThrow('stock');
        expect(h.validate({ asin: 'b00j357dgw', sku: 'S1', price: '5', fulfillment: 'FBA' })).toEqual({ asin: 'B00J357DGW', sku: 'S1', price: 5, fulfillment: 'FBA', quantity: null, condition: 'new_new' });
    });

    it('replacing needs at least one changed field', () => {
        expect(() => registry.get('listings.replace_listing').validate({ sku: 'S1', values: {} })).toThrow('at least one');
    });
});
