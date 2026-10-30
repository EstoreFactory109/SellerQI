/**
 * Create a listing, or fully replace one (Listings Items PUT). tasks-logics.xlsx
 * "Post Fn" (Listings & Catalog). Behind AMAZON_ACTIONS_LISTING_CREATE_ENABLED.
 *
 *   listings.offer_existing_asin  sell a product already in Amazon's catalogue
 *                                 (LISTING_OFFER_ONLY: price, condition, stock)
 *   listings.create_product       a new product (LISTING), from the product type's
 *                                 fields (ProductTypeDefinitionsService)
 *   listings.replace_listing      replace a listing's content with the fields the
 *                                 seller edited; every other attribute is sent
 *                                 back as it is, because a PUT removes what it omits
 *
 * Every preview runs Amazon's VALIDATION_PREVIEW; an ERROR blocks sending.
 * Ordinary edits stay on PATCH (listings.update_content).
 */
const { userError, staleError } = require('../errors.js');

const FLAG = 'AMAZON_ACTIONS_LISTING_CREATE';
const CONDITIONS = ['new_new', 'used_like_new', 'used_very_good', 'used_good', 'used_acceptable', 'refurbished_refurbished', 'collectible_like_new'];
const FBA_CODE = { NA: 'AMAZON_NA', EU: 'AMAZON_EU', FE: 'AMAZON_FE' };
const CONDITION_LABEL = {
    new_new: 'New', used_like_new: 'Used - like new', used_very_good: 'Used - very good', used_good: 'Used - good',
    used_acceptable: 'Used - acceptable', refurbished_refurbished: 'Refurbished', collectible_like_new: 'Collectible - like new'
};

function L() { return require('../../Sp_API/UpdateProductContentService.js'); }
function PTD() { return require('../../Sp_API/ProductTypeDefinitionsService.js'); }
function issuesOf(r) { return require('../../Sp_API/ListingsWriteService.js').issuesOf(r); }

const skuOf = (v) => {
    const sku = String(v || '').trim();
    if (!sku || sku.length > 40 || /[\s]/.test(sku)) throw userError('The SKU must be 1 to 40 characters with no spaces.');
    return sku;
};

/** The live listing for a SKU, or null when the SKU does not exist yet. */
async function liveListing(context, sku) {
    try {
        return await L().getListingItem(context.sellerId, sku, context.marketplaceId, context.baseUri, context.accessToken, context.credentials, context.awsRegion);
    } catch (error) {
        if (error.response?.status === 404) return null;
        throw error;
    }
}

async function validatePut(context, sku, body) {
    return issuesOf(await L().putListingItem(context.sellerId, sku, context.marketplaceId, context.baseUri, context.accessToken, context.credentials, context.awsRegion, body, 'VALIDATION_PREVIEW'));
}

async function sendPut(ctx, sku, body) {
    const context = await L().listingContext(ctx);
    const response = await L().putListingItem(context.sellerId, sku, context.marketplaceId, context.baseUri, context.accessToken, context.credentials, context.awsRegion, body);
    const { messages, blocking } = issuesOf(response);
    if (blocking || (response?.status && response.status !== 'ACCEPTED')) {
        throw Object.assign(new Error(messages[0] || `Amazon did not accept the listing (${response?.status || 'no answer'}).`), { response });
    }
    return response;
}

const offerExistingAsin = {
    actionType: 'listings.offer_existing_asin',
    feature: 'listings',
    flag: FLAG,
    idempotent: true, // the same PUT twice is the same listing
    validate(input) {
        const asin = String(input?.asin || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(asin)) throw userError('Enter the ASIN (10 letters and numbers).');
        const sku = skuOf(input?.sku);
        const price = Number(input?.price);
        if (!(price > 0)) throw userError('Enter your price.');
        const fulfillment = input?.fulfillment === 'FBA' ? 'FBA' : 'FBM';
        const quantity = fulfillment === 'FBM' ? Number(input?.quantity) : null;
        if (fulfillment === 'FBM' && (!Number.isInteger(quantity) || quantity < 0)) throw userError('Enter the stock you will ship yourself.');
        const condition = CONDITIONS.includes(input?.condition) ? input.condition : 'new_new';
        return { asin, sku, price, fulfillment, quantity, condition };
    },
    async preview(input, ctx) {
        const context = await L().listingContext(ctx);
        const [catalog, existing] = await Promise.all([
            L().getCatalogItem(input.asin, context.marketplaceId, context.baseUri, context.accessToken, context.credentials, context.awsRegion).catch(() => null),
            liveListing(context, input.sku)
        ]);
        if (!catalog) throw userError(`Amazon has no product ${input.asin} in this marketplace.`);
        if (existing) throw userError(`You already have a listing with SKU ${input.sku}. Choose a new SKU.`);
        const productType = catalog.productTypes?.find((p) => p.marketplaceId === context.marketplaceId)?.productType || catalog.productTypes?.[0]?.productType || 'PRODUCT';
        const currency = { US: 'USD', CA: 'CAD', MX: 'MXN', UK: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', JP: 'JPY', IN: 'INR', AU: 'AUD', AE: 'AED', SA: 'SAR', SG: 'SGD', BR: 'BRL', SE: 'SEK', PL: 'PLN' }[ctx.country] || 'USD';
        const body = {
            productType,
            requirements: 'LISTING_OFFER_ONLY',
            attributes: {
                merchant_suggested_asin: [{ value: input.asin, marketplace_id: context.marketplaceId }],
                condition_type: [{ value: input.condition, marketplace_id: context.marketplaceId }],
                purchasable_offer: [{ marketplace_id: context.marketplaceId, currency, our_price: [{ schedule: [{ value_with_tax: input.price }] }] }],
                fulfillment_availability: [input.fulfillment === 'FBM'
                    ? { fulfillment_channel_code: 'DEFAULT', quantity: input.quantity }
                    : { fulfillment_channel_code: FBA_CODE[ctx.region] || 'AMAZON_NA' }]
            }
        };
        const check = await validatePut(context, input.sku, body);
        const name = catalog.summaries?.[0]?.itemName || input.asin;
        return {
            title: 'Start selling an existing product',
            target: `New listing ${input.sku} on Amazon`,
            lines: [
                { label: 'Product', before: '', after: `${String(name).slice(0, 80)} (${input.asin})` },
                { label: 'Your price', before: '', after: `${currency} ${input.price.toFixed(2)}` },
                { label: 'Condition', before: '', after: CONDITION_LABEL[input.condition] || input.condition },
                { label: 'Fulfilled by', before: '', after: input.fulfillment === 'FBA' ? 'Amazon (send stock to FBA next)' : `You, ${input.quantity} in stock` }
            ],
            warnings: ['Amazon may need to approve you for some brands or categories first; its check below says so if it does.'],
            amazonIssues: check.messages,
            blocking: check.blocking,
            payload: { sku: input.sku, body }
        };
    },
    async staleCheck(doc, ctx) {
        if (await liveListing(await L().listingContext(ctx), doc.payload.sku)) throw staleError(`A listing with SKU ${doc.payload.sku} now exists, so nothing was sent.`);
    },
    async execute(payload, ctx) {
        return sendPut(ctx, payload.sku, payload.body);
    }
};

const createProduct = {
    actionType: 'listings.create_product',
    feature: 'listings',
    flag: FLAG,
    idempotent: true,
    validate(input) {
        const productType = String(input?.productType || '').trim().toUpperCase();
        if (!/^[A-Z0-9_]{2,80}$/.test(productType)) throw userError('Choose the product type.');
        if (!input?.values || typeof input.values !== 'object') throw userError('Fill in the product details.');
        return { sku: skuOf(input?.sku), productType, values: input.values };
    },
    async preview(input, ctx) {
        const context = await L().listingContext(ctx);
        const { credentialsFor } = require('../../Sp_API/spApiClient.js');
        const creds = await credentialsFor(ctx.userId, ctx.country, ctx.region);
        const definition = await PTD().getDefinition(creds, input.productType, 'LISTING', ctx.country);
        const { fields, unsupportedRequired } = PTD().formFields(definition.schema);
        if (unsupportedRequired.length) {
            throw userError(`This product type needs details SellerQI cannot collect yet (${unsupportedRequired.slice(0, 5).join(', ')}). Create it in Seller Central.`);
        }
        const attributes = PTD().attributesFrom(input.values, fields, { marketplaceId: context.marketplaceId, languageTag: PTD().LANGUAGE[ctx.country] || 'en_US' });
        const missing = fields.filter((f) => f.required && !attributes[f.name]).map((f) => f.title);
        if (missing.length) throw userError(`Fill in: ${missing.slice(0, 8).join(', ')}.`);
        if (await liveListing(context, input.sku)) throw userError(`You already have a listing with SKU ${input.sku}. Choose a new SKU.`);
        const body = { productType: input.productType, requirements: 'LISTING', attributes };
        const check = await validatePut(context, input.sku, body);
        const titleOf = new Map(fields.map((f) => [f.name, f.title]));
        return {
            title: 'Create a new product',
            target: `New listing ${input.sku} (${definition.displayName}) on Amazon`,
            lines: Object.entries(attributes).map(([k, list]) => ({
                label: titleOf.get(k) || k,
                before: '',
                after: list.map((e) => (e.unit ? `${e.value} ${e.unit}` : String(e.value))).join(' | ').slice(0, 300)
            })),
            warnings: ['A new product also needs its images, and usually a product ID (UPC/EAN) or a GTIN exemption; Amazon\'s check below lists anything missing.'],
            amazonIssues: check.messages,
            blocking: check.blocking,
            payload: { sku: input.sku, body }
        };
    },
    async staleCheck(doc, ctx) {
        if (await liveListing(await L().listingContext(ctx), doc.payload.sku)) throw staleError(`A listing with SKU ${doc.payload.sku} now exists, so nothing was sent.`);
    },
    async execute(payload, ctx) {
        return sendPut(ctx, payload.sku, payload.body);
    }
};

const replaceListing = {
    actionType: 'listings.replace_listing',
    feature: 'listings',
    flag: FLAG,
    idempotent: true,
    validate(input) {
        if (!input?.values || typeof input.values !== 'object' || !Object.keys(input.values).length) throw userError('Change at least one field.');
        return { sku: skuOf(input?.sku), values: input.values };
    },
    async preview(input, ctx) {
        const context = await L().listingContext(ctx);
        const live = await liveListing(context, input.sku);
        if (!live) throw userError(`There is no listing with SKU ${input.sku}.`);
        const productType = live.summaries?.[0]?.productType;
        if (!productType) throw userError('Amazon did not say what product type this listing is.');
        const { credentialsFor } = require('../../Sp_API/spApiClient.js');
        const creds = await credentialsFor(ctx.userId, ctx.country, ctx.region);
        const definition = await PTD().getDefinition(creds, productType, 'LISTING', ctx.country);
        const { fields } = PTD().formFields(definition.schema);
        const edited = PTD().attributesFrom(input.values, fields, { marketplaceId: context.marketplaceId, languageTag: PTD().LANGUAGE[ctx.country] || 'en_US' });
        const current = live.attributes || {};
        const changed = Object.keys(edited).filter((k) => JSON.stringify(edited[k]) !== JSON.stringify(current[k]));
        if (!changed.length) throw userError('Nothing differs from the listing on Amazon.');
        // Everything not edited is sent back unchanged: a PUT removes what it omits.
        const body = { productType, requirements: 'LISTING', attributes: { ...current, ...edited } };
        const check = await validatePut(context, input.sku, body);
        const titleOf = new Map(fields.map((f) => [f.name, f.title]));
        const show = (list) => (list || []).map((e) => (e.unit ? `${e.value} ${e.unit}` : String(e.value))).join(' | ').slice(0, 200) || '(empty)';
        return {
            title: `Replace the listing ${input.sku}`,
            target: `Listing ${input.sku} on Amazon (full replace)`,
            lines: changed.map((k) => ({ label: titleOf.get(k) || k, before: show(current[k]), after: show(edited[k]) })),
            warnings: [`This sends the whole listing again. The ${Object.keys(current).length - changed.length} attributes you did not edit are sent back exactly as Amazon has them now.`],
            amazonIssues: check.messages,
            blocking: check.blocking,
            payload: { sku: input.sku, body },
            expected: { lastUpdatedDate: live.summaries?.[0]?.lastUpdatedDate || null }
        };
    },
    async staleCheck(doc, ctx) {
        const live = await liveListing(await L().listingContext(ctx), doc.payload.sku);
        if (!live) throw staleError('This listing no longer exists, so nothing was sent.');
        if ((live.summaries?.[0]?.lastUpdatedDate || null) !== doc.expected?.lastUpdatedDate) {
            throw staleError('This listing changed on Amazon since this was prepared, so nothing was sent (a replace would undo that change). Review it again.');
        }
    },
    async execute(payload, ctx) {
        return sendPut(ctx, payload.sku, payload.body);
    }
};

module.exports = { handlers: [offerExistingAsin, createProduct, replaceListing], CONDITIONS, CONDITION_LABEL };
