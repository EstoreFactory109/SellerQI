/**
 * Listing offer changes (SP-API Listings Items PATCH): FBM stock and business (B2B)
 * pricing. Built on the signing and reads in UpdateProductContentService.
 *
 * Every change can be checked first with Amazon's VALIDATION_PREVIEW (Amazon
 * validates and answers with issues, saving nothing), which is what the approval
 * window shows before the seller approves.
 */
const { readLiveListing, patchListingItem } = require('./UpdateProductContentService.js');

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** The seller-fulfilled stock line of a live listing, or null when Amazon fulfils it. */
function fbmAvailability(listing) {
    const live = (listing?.fulfillmentAvailability || []).find((f) => f.fulfillmentChannelCode === 'DEFAULT');
    if (!live) return null;
    const attr = (listing?.attributes?.fulfillment_availability || []).find((f) => f.fulfillment_channel_code === 'DEFAULT') || {};
    return {
        quantity: Number.isFinite(Number(live.quantity)) ? Number(live.quantity) : null,
        handlingTime: Number.isFinite(Number(attr.lead_time_to_ship_max_days)) ? Number(attr.lead_time_to_ship_max_days) : null
    };
}

/** Pure: the FBM stock patch. */
function buildFulfillmentAvailabilityPatch({ quantity, handlingTime = null }) {
    return [{
        op: 'replace',
        path: '/attributes/fulfillment_availability',
        value: [{
            fulfillment_channel_code: 'DEFAULT',
            quantity: Math.trunc(Number(quantity)),
            ...(handlingTime ? { lead_time_to_ship_max_days: Math.trunc(Number(handlingTime)) } : {})
        }]
    }];
}

/** The live offers split into the business one and everything else (regular price, ...). */
function splitOffers(listing) {
    const offers = Array.isArray(listing?.attributes?.purchasable_offer) ? listing.attributes.purchasable_offer : [];
    return { b2b: offers.find((o) => o.audience === 'B2B') || null, others: offers.filter((o) => o.audience !== 'B2B') };
}

/** Pure: a business offer as SellerQI shows it. */
function readB2BOffer(offer) {
    if (!offer) return null;
    const price = Number(offer.our_price?.[0]?.schedule?.[0]?.value_with_tax);
    const plan = offer.quantity_discount_plan?.[0]?.schedule?.[0];
    const sale = offer.discounted_price?.[0]?.schedule?.[0];
    return {
        price: Number.isFinite(price) ? price : null,
        currency: offer.currency || '',
        discountType: plan?.discount_type || null,
        tiers: (plan?.levels || []).map((l) => ({ minQuantity: Number(l.lower_bound), value: Number(l.value) })),
        salePrice: sale ? Number(sale.value_with_tax) : null,
        saleStart: sale?.start_at || null,
        saleEnd: sale?.end_at || null
    };
}

/**
 * Pure: the purchasable_offer patch with the new business offer. Amazon replaces
 * the whole attribute, so every other offer (the regular price) is sent back
 * unchanged next to it - sending the business offer alone would remove them.
 */
function buildB2BOfferPatch({ others, marketplaceId, currency, price, discountType = 'fixed', tiers = [], salePrice = null, saleStart = null, saleEnd = null }) {
    const b2b = {
        marketplace_id: marketplaceId,
        currency,
        audience: 'B2B',
        our_price: [{ schedule: [{ value_with_tax: round2(price) }] }],
        ...(tiers.length ? {
            quantity_discount_plan: [{ schedule: [{ discount_type: discountType, levels: tiers.map((t) => ({ lower_bound: Math.trunc(t.minQuantity), value: round2(t.value) })) }] }]
        } : {}),
        ...(salePrice ? {
            discounted_price: [{ schedule: [{ value_with_tax: round2(salePrice), ...(saleStart ? { start_at: saleStart } : {}), ...(saleEnd ? { end_at: saleEnd } : {}) }] }]
        } : {})
    };
    return [{ op: 'replace', path: '/attributes/purchasable_offer', value: [...(others || []), b2b] }];
}

/** Amazon's issues as plain text, and whether any blocks the change. */
function issuesOf(response) {
    const issues = Array.isArray(response?.issues) ? response.issues : [];
    return {
        messages: issues.map((i) => `${i.severity === 'ERROR' ? '' : `${i.severity || 'Note'}: `}${i.message || i.code}`),
        blocking: issues.some((i) => i.severity === 'ERROR') || response?.status === 'INVALID'
    };
}

/** Send a patch (or only validate it). Throws when Amazon refuses a real change. */
async function patchListing({ sku, userId, country, region, patches, validateOnly = false, live = null }) {
    const { productType, context } = live || await readLiveListing({ sku, userId, country, region });
    if (!productType) throw new Error('Amazon did not say what product type this listing is, so it cannot be changed here.');
    const response = await patchListingItem(
        context.sellerId, sku, context.marketplaceId, context.baseUri, context.accessToken, context.credentials, context.awsRegion,
        productType, patches, validateOnly ? 'VALIDATION_PREVIEW' : null
    );
    if (!validateOnly) {
        const { messages, blocking } = issuesOf(response);
        if (blocking || (response?.status && response.status !== 'ACCEPTED')) {
            throw Object.assign(new Error(messages[0] || `Amazon did not accept the change (${response?.status || 'no answer'}).`), { response });
        }
    }
    return response;
}

module.exports = {
    readLiveListing, patchListing, fbmAvailability, splitOffers, readB2BOffer,
    buildFulfillmentAvailabilityPatch, buildB2BOfferPatch, issuesOf
};
