const mongoose = require("mongoose");

/**
 * FBA customer returns (GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA).
 *
 * One document per fetch per marketplace, like the other report snapshots. Feeds
 * the tasks-logics.xlsx "Return reason spike" task. Kept compact (no product name
 * or customer comments) so a large account's 90 days stay well under Mongo's 16MB.
 */
const lineSchema = new mongoose.Schema({
    returnDate: { type: String, default: "" },
    orderId: { type: String, default: "" },
    sku: { type: String, default: "" },
    asin: { type: String, default: "" },
    fnsku: { type: String, default: "" },
    quantity: { type: Number, default: 0 },
    // Amazon's reason code, e.g. DEFECTIVE, NOT_AS_DESCRIBED.
    reason: { type: String, default: "" },
    status: { type: String, default: "" },
    disposition: { type: String, default: "" }
}, { _id: false });

const customerReturnsSchema = new mongoose.Schema(
    {
        User: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        region: { type: String, required: true },
        country: { type: String, required: true },
        windowStart: { type: Date, default: null },
        windowEnd: { type: Date, default: null },
        lines: { type: [lineSchema], default: [] },
        lineCount: { type: Number, default: 0 },
        // Units per reason code over the whole window, so the codes Amazon really
        // sends can be checked without reading every line.
        reasonCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
        headers: { type: [String], default: [] },
        // True when no reason or ASIN column could be found: not "no returns".
        unreadable: { type: Boolean, default: false }
    },
    { timestamps: true }
);

customerReturnsSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model("CustomerReturns", customerReturnsSchema);
