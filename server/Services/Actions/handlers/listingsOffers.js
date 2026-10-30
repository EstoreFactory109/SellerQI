/**
 * Offer changes on a listing: FBM stock, and business (B2B) pricing with quantity
 * tiers and a business sale price. tasks-logics.xlsx "Post Fn" (Inventory, B2B).
 * Behind AMAZON_ACTIONS_FBM_STOCK_ENABLED and AMAZON_ACTIONS_B2B_ENABLED.
 *
 * Previews read the listing live and run Amazon's VALIDATION_PREVIEW, so the
 * approval window shows Amazon's own issues before anything is sent. Seen live:
 * a seller-fulfilled listing reports its stock in fulfillmentAvailability, and the
 * regular price is the purchasable_offer with audience "ALL".
 */
const { userError, staleError } = require('../errors.js');

const MAX_STOCK = 1000000;
const MAX_TIERS = 5;
const money = (n, cur) => `${cur ? `${cur} ` : ''}${Number(n).toFixed(2)}`;

function writes() {
    return require('../../Sp_API/ListingsWriteService.js');
}

async function storeProductField(ctx, sku, field, value) {
    try {
        const Seller = require('../../../models/user-auth/sellerCentralModel.js');
        await Seller.updateOne(
            { User: ctx.userId },
            { $set: { [`sellerAccount.$[a].products.$[p].${field}`]: value } },
            { arrayFilters: [{ 'a.country': ctx.country, 'a.region': ctx.region }, { 'p.sku': sku }] }
        );
    } catch (_) { /* the next daily sync stores it anyway */ }
}

const updateFbmStock = {
    actionType: 'listings.update_fbm_stock',
    feature: 'listings',
    flag: 'AMAZON_ACTIONS_FBM_STOCK',
    idempotent: true, // setting the same stock twice is harmless
    validate(input) {
        const sku = String(input?.sku || '').trim();
        if (!sku) throw userError('Choose the listing.');
        const quantity = Number(input?.quantity);
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_STOCK) throw userError('Stock must be a whole number, 0 or more.');
        let handlingTime = null;
        if (input?.handlingTime !== undefined && input?.handlingTime !== null && input?.handlingTime !== '') {
            handlingTime = Number(input.handlingTime);
            if (!Number.isInteger(handlingTime) || handlingTime < 1 || handlingTime > 30) throw userError('Handling time must be 1 to 30 days.');
        }
        return { sku, quantity, handlingTime };
    },
    async preview(input, ctx) {
        const W = writes();
        const live = await W.readLiveListing({ sku: input.sku, userId: ctx.userId, country: ctx.country, region: ctx.region });
        const now = W.fbmAvailability(live.listing);
        if (!now) throw userError('Amazon fulfils this listing (FBA), so its stock comes from what you send to Amazon\'s warehouses, not from here.');
        const patches = W.buildFulfillmentAvailabilityPatch({ quantity: input.quantity, handlingTime: input.handlingTime ?? now.handlingTime });
        const check = W.issuesOf(await W.patchListing({ ...ctx, sku: input.sku, patches, validateOnly: true, live }));
        const warnings = [];
        if (input.quantity === 0) warnings.push('With 0 in stock your offer stops being buyable until you add stock.');
        if (now.quantity > 0 && input.quantity > now.quantity * 10) warnings.push(`That is more than 10 times the stock you have listed now (${now.quantity}).`);
        if (input.quantity === now.quantity && (!input.handlingTime || input.handlingTime === now.handlingTime)) throw userError('That is already the stock on Amazon.');
        return {
            title: 'Update stock',
            target: `Listing ${input.sku} on Amazon (you ship it)`,
            lines: [
                { label: 'Stock', before: now.quantity === null ? '(not read)' : String(now.quantity), after: String(input.quantity) },
                ...(input.handlingTime && input.handlingTime !== now.handlingTime ? [{ label: 'Handling time', before: now.handlingTime ? `${now.handlingTime} days` : '(not set)', after: `${input.handlingTime} days` }] : [])
            ],
            warnings,
            amazonIssues: check.messages,
            blocking: check.blocking,
            payload: { sku: input.sku, patches, quantity: input.quantity },
            expected: { quantity: now.quantity }
        };
    },
    async staleCheck(doc, ctx) {
        const W = writes();
        const live = await W.readLiveListing({ sku: doc.payload.sku, userId: ctx.userId, country: ctx.country, region: ctx.region });
        const now = W.fbmAvailability(live.listing);
        if (!now) throw staleError('This listing is no longer fulfilled by you, so the stock was not changed.');
        if (now.quantity !== doc.expected?.quantity) {
            throw staleError(`The stock on Amazon is now ${now.quantity} (it was ${doc.expected?.quantity} when this was prepared, probably from an order), so nothing was sent. Review it again.`);
        }
    },
    async execute(payload, ctx) {
        const result = await writes().patchListing({ ...ctx, sku: payload.sku, patches: payload.patches });
        await storeProductField(ctx, payload.sku, 'fbmQuantity', payload.quantity);
        return result;
    }
};

const setB2BPricing = {
    actionType: 'listings.set_b2b_pricing',
    feature: 'listings',
    flag: 'AMAZON_ACTIONS_B2B',
    idempotent: true, // the same offer sent twice is the same offer
    validate(input) {
        const sku = String(input?.sku || '').trim();
        if (!sku) throw userError('Choose the listing.');
        const price = Number(input?.price);
        if (!(price > 0)) throw userError('Enter the business price.');
        const discountType = input?.discountType === 'percent' ? 'percent' : 'fixed';
        const raw = (Array.isArray(input?.tiers) ? input.tiers : []).filter((t) => t && (t.minQuantity !== '' && t.minQuantity !== undefined));
        if (raw.length > MAX_TIERS) throw userError(`Amazon allows up to ${MAX_TIERS} quantity tiers.`);
        const tiers = raw.map((t) => ({ minQuantity: Number(t.minQuantity), value: Number(t.value) }));
        tiers.forEach((t, i) => {
            if (!Number.isInteger(t.minQuantity) || t.minQuantity < 2) throw userError('Each tier starts at 2 or more units.');
            if (discountType === 'fixed' && !(t.value > 0 && t.value < price)) throw userError('Each tier price must be below the business price.');
            if (discountType === 'percent' && !(t.value > 0 && t.value < 100)) throw userError('Each tier discount must be between 0% and 100%.');
            const prev = tiers[i - 1];
            if (prev && !(t.minQuantity > prev.minQuantity)) throw userError('Tier quantities must go up.');
            if (prev && discountType === 'fixed' && !(t.value < prev.value)) throw userError('Each higher tier must be cheaper than the one before.');
            if (prev && discountType === 'percent' && !(t.value > prev.value)) throw userError('Each higher tier must give a bigger discount than the one before.');
        });
        let salePrice = null;
        let saleStart = null;
        let saleEnd = null;
        if (input?.salePrice !== undefined && input?.salePrice !== null && input?.salePrice !== '') {
            salePrice = Number(input.salePrice);
            if (!(salePrice > 0 && salePrice < price)) throw userError('The business sale price must be below the business price.');
            saleStart = input.saleStart ? new Date(input.saleStart).toISOString() : null;
            saleEnd = input.saleEnd ? new Date(input.saleEnd).toISOString() : null;
            if (!saleStart || !saleEnd || !(saleEnd > saleStart)) throw userError('Give the sale a start and an end date (end after start).');
        }
        return { sku, price, discountType, tiers, salePrice, saleStart, saleEnd };
    },
    async preview(input, ctx) {
        const W = writes();
        const live = await W.readLiveListing({ sku: input.sku, userId: ctx.userId, country: ctx.country, region: ctx.region });
        const { b2b, others } = W.splitOffers(live.listing);
        const regular = others.find((o) => o.audience === 'ALL') || others[0] || null;
        const currency = (b2b || regular)?.currency || '';
        const regularPrice = Number(regular?.our_price?.[0]?.schedule?.[0]?.value_with_tax);
        const current = W.readB2BOffer(b2b);
        const patches = W.buildB2BOfferPatch({ others, marketplaceId: live.context.marketplaceId, currency, ...input });
        const check = W.issuesOf(await W.patchListing({ ...ctx, sku: input.sku, patches, validateOnly: true, live }));
        const tierText = (tiers, type) => (tiers.length ? tiers.map((t) => `${t.minQuantity}+: ${type === 'percent' ? `${t.value}% off` : money(t.value, currency)}`).join(', ') : 'none');
        const warnings = [];
        if (regularPrice > 0 && input.price > regularPrice) warnings.push(`The business price is above your regular price (${money(regularPrice, currency)}).`);
        if (!b2b) warnings.push('This listing has no business price yet. Amazon accepts one only if your account is enrolled in Amazon Business.');
        warnings.push('Your regular price is sent back unchanged with the business offer.');
        return {
            title: 'Set business pricing',
            target: `Listing ${input.sku} on Amazon (business buyers)`,
            lines: [
                { label: 'Business price', before: current?.price ? money(current.price, currency) : '(none)', after: money(input.price, currency) },
                { label: 'Quantity tiers', before: tierText(current?.tiers || [], current?.discountType), after: tierText(input.tiers, input.discountType) },
                ...(input.salePrice || current?.salePrice ? [{
                    label: 'Business sale',
                    before: current?.salePrice ? money(current.salePrice, currency) : '(none)',
                    after: input.salePrice ? `${money(input.salePrice, currency)} from ${input.saleStart.slice(0, 10)} to ${input.saleEnd.slice(0, 10)}` : '(none)'
                }] : []),
                ...(regularPrice > 0 ? [{ label: 'Regular price', before: money(regularPrice, currency), after: `${money(regularPrice, currency)} (unchanged)` }] : [])
            ],
            warnings,
            amazonIssues: check.messages,
            blocking: check.blocking,
            payload: { sku: input.sku, patches, offer: { ...input, currency } },
            expected: { b2b: JSON.stringify(current), others: JSON.stringify(others) }
        };
    },
    async staleCheck(doc, ctx) {
        const W = writes();
        const live = await W.readLiveListing({ sku: doc.payload.sku, userId: ctx.userId, country: ctx.country, region: ctx.region });
        const { b2b, others } = W.splitOffers(live.listing);
        if (JSON.stringify(W.readB2BOffer(b2b)) !== doc.expected?.b2b || JSON.stringify(others) !== doc.expected?.others) {
            throw staleError('The prices on this listing changed since this was prepared, so nothing was sent. Review it again.');
        }
    },
    async execute(payload, ctx) {
        const result = await writes().patchListing({ ...ctx, sku: payload.sku, patches: payload.patches });
        await storeProductField(ctx, payload.sku, 'b2bOffer', { ...payload.offer, at: new Date().toISOString() });
        await storeProductField(ctx, payload.sku, 'has_b2b_pricing', true);
        return result;
    }
};

module.exports = { handlers: [updateFbmStock, setB2BPricing] };
