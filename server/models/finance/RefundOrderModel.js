const mongoose = require("mongoose");

/**
 * Customer refunds per order and SKU, kept from the daily finance sync (the Finances
 * API transactions it already reads; DailySkuFinance only keeps daily totals). Feeds
 * tasks-logics.xlsx "Potential reimbursements: refund given, item not returned".
 * Kept 150 days: claims are for refunds 60-120 days old.
 */
const refundOrderSchema = new mongoose.Schema(
    {
        User: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        country: { type: String, required: true },
        region: { type: String, required: true },
        orderId: { type: String, required: true },
        sku: { type: String, default: "" },
        asin: { type: String, default: "" },
        // Earliest posting of the refund for this order and SKU.
        refundDate: { type: Date, required: true },
        // Refunded principal, as a positive number in the marketplace currency.
        amount: { type: Number, default: 0 },
        units: { type: Number, default: 0 }
    },
    { timestamps: true }
);

refundOrderSchema.index({ User: 1, country: 1, region: 1, orderId: 1, sku: 1 }, { unique: true });
refundOrderSchema.index({ User: 1, country: 1, region: 1, refundDate: -1 });
refundOrderSchema.index({ refundDate: 1 }, { expireAfterSeconds: 150 * 24 * 60 * 60 });

module.exports = mongoose.model("RefundOrder", refundOrderSchema);
