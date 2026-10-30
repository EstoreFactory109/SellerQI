const mongoose = require("mongoose");

/**
 * Amazon's product type definitions (the fields a listing of that type needs),
 * cached for 7 days per marketplace and requirement set. Not per seller.
 */
const productTypeDefinitionCacheSchema = new mongoose.Schema(
    {
        productType: { type: String, required: true },
        marketplaceId: { type: String, required: true },
        requirements: { type: String, required: true },
        version: { type: String, default: "" },
        displayName: { type: String, default: "" },
        schema: { type: mongoose.Schema.Types.Mixed, required: true },
        fetchedAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

productTypeDefinitionCacheSchema.index({ productType: 1, marketplaceId: 1, requirements: 1 }, { unique: true });
productTypeDefinitionCacheSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model("ProductTypeDefinitionCache", productTypeDefinitionCacheSchema);
