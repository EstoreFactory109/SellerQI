/**
 * TopProducts Model
 *
 * Stores the AI-narrated "top products to fix" ranking for an account, so no
 * request ever waits on (or pays for) an LLM call.
 *
 * Sibling of TopOpportunitiesModel: that one answers "which PROBLEM is biggest",
 * this one answers "which PRODUCT should I fix". Both are built from the same
 * TaskItem source (see TaskOpportunityGroupsService) so they cannot disagree.
 *
 * Written by TopProductsService.calculateAndStoreTopProducts.
 */

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    asin: { type: String, required: true },
    rank: { type: Number, required: true },
    productName: { type: String, default: '' },

    // Money carried over from our own rollup — never recomputed by the LLM.
    // CAPPED: a product's profit gap already contains its wasted ad spend, so this
    // is max(gap, adWaste), never their sum. See capProfitOpportunity.
    profitImpact: { type: Number, default: 0 },
    // The two inputs, kept for display: "of which ~$X is wasted ad spend" reads as
    // a component of profitImpact rather than an addition to it.
    profitGap: { type: Number, default: 0 },
    adWasteComponent: { type: Number, default: 0 },
    // Capital locked in unsellable stock. NOT profit — reported alongside, never added.
    capitalTiedUp: { type: Number, default: 0 },
    amountIsEstimated: { type: Boolean, default: false },

    // Issues sitting directly on this ASIN, and ad issues attributed to it. Kept
    // apart because one ad issue can be attributed to several products.
    taskCount: { type: Number, default: 0 },
    adsTaskCount: { type: Number, default: 0 },
    categories: { type: [String], default: [] },

    // Advertised but missing from the seller's catalogue — a finding in itself.
    notInCatalogue: { type: Boolean, default: false },

    // LLM-authored fields.
    why: { type: String, default: '' },
    action: { type: String, default: '' }
}, { _id: false });

const topProductsSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    country: { type: String, required: true, index: true },
    region: {
        type: String,
        required: true,
        enum: ['NA', 'EU', 'FE'],
        index: true
    },

    // ISO 4217 code for every amount here — Amazon reports marketplace-local money.
    currencyCode: { type: String, default: 'USD' },

    products: { type: [productSchema], default: [] },

    productsConsidered: { type: Number, default: 0 },
    tasksConsidered: { type: Number, default: 0 },

    // Sum across only the products SHOWN. A subset by definition — never a headline.
    totalRecoverableAmount: { type: Number, default: 0 },

    // The account's whole POTENTIAL PROFIT IMPACT: de-duplicated per ASIN, across
    // products above and below the display cut. This is what a headline must use.
    // Deliberately not called "recoverable" — it blends measured cash savings with
    // margin-based estimates.
    potentialProfitImpact: { type: Number, default: 0 },

    // Capital locked in unsellable stock, account-wide. A different quantity from
    // profit: freeing it returns working capital, it never lands as profit.
    capitalTiedUp: { type: Number, default: 0 },

    // Money that reached no product (ad waste whose campaign couldn't be matched),
    // stored so the UI can be honest that the product view isn't the whole picture.
    unattributedAmount: { type: Number, default: 0 },

    generatedAt: { type: Date, default: Date.now },
    source: {
        type: String,
        enum: ['schedule', 'integration', 'manual', 'api_fallback'],
        default: 'schedule'
    },

    model: { type: String, default: '' },
    tokensUsed: {
        promptTokens: { type: Number, default: 0 },
        completionTokens: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 }
    },
    usedFallback: { type: Boolean, default: false },
    fallbackReason: { type: String, default: '' }
}, { timestamps: true });

topProductsSchema.index({ userId: 1, country: 1, region: 1 }, { unique: true });

topProductsSchema.statics.upsertForAccount = async function (userId, country, region, payload = {}) {
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    return this.findOneAndUpdate(
        { userId: userObjectId, country, region },
        {
            $set: {
                currencyCode: payload.currencyCode || 'USD',
                products: payload.products || [],
                productsConsidered: payload.productsConsidered || 0,
                tasksConsidered: payload.tasksConsidered || 0,
                totalRecoverableAmount: payload.totalRecoverableAmount || 0,
                potentialProfitImpact: payload.potentialProfitImpact || 0,
                capitalTiedUp: payload.capitalTiedUp || 0,
                unattributedAmount: payload.unattributedAmount || 0,
                generatedAt: new Date(),
                source: payload.source || 'schedule',
                model: payload.model || '',
                tokensUsed: payload.tokensUsed || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                usedFallback: !!payload.usedFallback,
                fallbackReason: payload.fallbackReason || ''
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

topProductsSchema.statics.getForAccount = async function (userId, country, region) {
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    return this.findOne({ userId: userObjectId, country, region }).lean();
};

module.exports = mongoose.model('TopProducts', topProductsSchema);
