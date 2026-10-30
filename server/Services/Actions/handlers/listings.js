/**
 * Listing changes (SP-API Listings Items). One implementation for Fix It on the
 * Issues pages, QMate and the Tasks page.
 */
const { userError } = require('../errors.js');

const FIELDS = { title: 'Title', description: 'Description', bulletpoints: 'Bullet points', generic_keyword: 'Backend keywords' };

/** The SKU for an ASIN in this marketplace: an Active one first. */
async function skuForAsin(ctx, asin) {
    const Seller = require('../../../models/user-auth/sellerCentralModel.js');
    const seller = await Seller.findOne({ User: ctx.userId }).select('sellerAccount.country sellerAccount.region sellerAccount.products.asin sellerAccount.products.sku sellerAccount.products.status').lean();
    const account = (seller?.sellerAccount || []).find((a) => a.country === ctx.country && a.region === ctx.region);
    const product = (account?.products || []).find((p) => p.asin === asin && p.status === 'Active' && p.sku)
        || (account?.products || []).find((p) => p.asin === asin && p.sku);
    return product?.sku || null;
}

const show = (v) => (Array.isArray(v) ? v.join(' | ') : (v && typeof v === 'object' ? `Bullet ${Number(v.index) + 1}: ${v.value}` : String(v ?? '')));

const updateContent = {
    actionType: 'listings.update_content',
    feature: 'listings',
    idempotent: true,
    validate(input) {
        const field = String(input?.field || '').toLowerCase();
        if (!FIELDS[field]) throw userError(`The field must be one of: ${Object.keys(FIELDS).join(', ')}.`);
        if (!input?.sku && !input?.asin) throw userError('Choose the product to change.');
        const value = input.value;
        if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) throw userError('Enter the new text.');
        if (field === 'bulletpoints') {
            const partial = value && typeof value === 'object' && !Array.isArray(value) && typeof value.index === 'number' && value.value !== undefined;
            if (!Array.isArray(value) && !partial) throw userError('Bullet points must be a list, or one bullet with its position.');
        }
        return {
            sku: input.sku ? String(input.sku) : null,
            asin: input.asin ? String(input.asin) : null,
            field,
            value,
            autoFixConflicts: input.autoFixConflicts !== false,
            brandName: input.brandName ? String(input.brandName).trim() : ''
        };
    },
    async preview(input, ctx) {
        const sku = input.sku || await skuForAsin(ctx, input.asin);
        if (!sku) throw userError('No SKU found for this product, so the listing cannot be updated.');
        let before = '';
        try {
            const { readLiveListing, getCurrentAttributeValue } = require('../../Sp_API/UpdateProductContentService.js');
            const { listing } = await readLiveListing({ sku, userId: ctx.userId, country: ctx.country, region: ctx.region });
            before = show(getCurrentAttributeValue(listing, input.field));
        } catch (_) { /* the preview still shows the new text */ }
        return {
            title: `Change the ${FIELDS[input.field].toLowerCase()}`,
            target: `Listing ${sku} on Amazon`,
            lines: [{ label: FIELDS[input.field], before: before || '(not read)', after: show(input.value) }],
            warnings: [],
            payload: { ...input, sku }
        };
    },
    async execute(payload, ctx) {
        const sku = payload.sku || await skuForAsin(ctx, payload.asin);
        if (!sku) throw new Error('No SKU found for this product, so the listing cannot be updated.');
        const { updateProductContent, FIX_STATUS } = require('../../Sp_API/UpdateProductContentService.js');
        const result = await updateProductContent({
            sku, userId: ctx.userId, country: ctx.country, region: ctx.region,
            dataToBeUpdated: payload.field, valueToBeUpdated: payload.value,
            ...(payload.brandName || payload.autoFixConflicts === false
                ? { options: { autoFixConflicts: payload.autoFixConflicts !== false, ...(payload.brandName ? { brandName: payload.brandName } : {}) } }
                : {})
        });
        const accepted = [FIX_STATUS.SUCCESS, FIX_STATUS.PARTIAL_SUCCESS, FIX_STATUS.CONFLICT_RESOLVED].includes(result?.status);
        if (!accepted) throw Object.assign(new Error(result?.message || 'Amazon did not accept the change.'), { response: result });

        // The record Fix It keeps too: "changed by us" for the detail-page-change check.
        const ListingFixStatus = require('../../../models/system/ListingFixStatusModel.js');
        await ListingFixStatus.markAsFixed({
            userId: ctx.userId, country: ctx.country, region: ctx.region, asin: payload.asin || result.asin, sku,
            attribute: payload.field, valueApplied: payload.value
        }).catch(() => null);
        return { ...result, sku };
    }
};

/** Fix It's "fix catalog conflicts only" (8541 errors): Amazon's catalog values applied to the listing. */
const fixCatalogConflicts = {
    actionType: 'listings.fix_catalog_conflicts',
    feature: 'listings',
    idempotent: true,
    validate(input) {
        if (!input?.sku) throw userError('Choose the listing to fix.');
        return { sku: String(input.sku) };
    },
    async preview(input) {
        return {
            title: "Fix this listing's catalog conflicts",
            target: `Listing ${input.sku} on Amazon`,
            lines: [{ label: 'Conflicting attributes', before: 'Different from Amazon\'s catalog', after: "Amazon's catalog values" }],
            warnings: [],
            payload: input
        };
    },
    async execute(payload, ctx) {
        const { autoFixCatalogConflicts } = require('../../Sp_API/UpdateProductContentService.js');
        return autoFixCatalogConflicts({ sku: payload.sku, userId: ctx.userId, country: ctx.country, region: ctx.region });
    }
};

module.exports = { handlers: [updateContent, fixCatalogConflicts], skuForAsin };
