const mongoose = require("mongoose");

/**
 * FBA removal orders (GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA).
 *
 * WHY THIS EXISTS
 * The FBA Aged Inventory report says how much stock is ageing, but not how much
 * of it is already on its way out. Without that, a manager reads 300 units past
 * 365 days and raises a removal for stock that was removed last week. This is
 * Amazon's removal-order detail: one row per order line, with how much was
 * requested, shipped, disposed, cancelled and is still in process.
 *
 * SNAPSHOT TRAIL, NOT A LIVE ROW
 * One document per fetch per marketplace, same as the other report sources. An
 * empty result is stored too — no removal orders is a real answer.
 */

const lineSchema = new mongoose.Schema({
    orderId: { type: String, default: "" },
    requestDate: { type: String, default: "" },
    lastUpdatedDate: { type: String, default: "" },
    // Return, Disposal, Liquidation — in Amazon's words.
    orderType: { type: String, default: "" },
    orderStatus: { type: String, default: "" },
    sku: { type: String, default: "" },
    fnsku: { type: String, default: "" },
    disposition: { type: String, default: "" },
    requestedQuantity: { type: Number, default: 0 },
    cancelledQuantity: { type: Number, default: 0 },
    disposedQuantity: { type: Number, default: 0 },
    shippedQuantity: { type: Number, default: 0 },
    inProcessQuantity: { type: Number, default: 0 },
    removalFee: { type: Number, default: 0 },
    currency: { type: String, default: "" },
    // Units not yet shipped, disposed or cancelled on an order still open.
    // Decided once at parse time so every reader agrees.
    pendingQuantity: { type: Number, default: 0 },
    isPending: { type: Boolean, default: false }
}, { _id: false });

const removalOrdersSchema = new mongoose.Schema(
    {
        User: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        region: { type: String, required: true },
        country: { type: String, required: true },
        // The request-date window the report was asked for.
        windowStart: { type: Date, default: null },
        windowEnd: { type: Date, default: null },
        lines: { type: [lineSchema], default: [] },
        lineCount: { type: Number, default: 0 },
        pendingOrderCount: { type: Number, default: 0 },
        pendingUnits: { type: Number, default: 0 },
        headers: { type: [String], default: [] },
        // True when no order-id or SKU column could be found; the report must
        // then not read the snapshot as "no removals pending".
        unreadable: { type: Boolean, default: false }
    },
    { timestamps: true }
);

removalOrdersSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model("RemovalOrders", removalOrdersSchema);
