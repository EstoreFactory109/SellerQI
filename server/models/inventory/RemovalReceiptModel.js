const mongoose = require("mongoose");

/**
 * What a seller says actually arrived from an FBA removal order, one document per
 * order line (order id + SKU).
 *
 * WHY THIS EXISTS
 * Amazon's removal report only knows its own side: "requested 10, shipped 10".
 * Units lost by the carrier on the way back still count as shipped, so the report
 * never shows a shortfall (0 of 8,913 lines on 24 Oct 2026). Only the seller knows
 * what reached them; this stores their answer, and a received count below the
 * shipped one becomes a removal_shortfall task (kpi/Wave1Detectors.js).
 */
const removalReceiptSchema = new mongoose.Schema(
    {
        User: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        country: { type: String, required: true },
        region: { type: String, required: true },
        orderId: { type: String, required: true },
        sku: { type: String, default: "" },
        // What Amazon's report said was shipped when the seller answered, so the
        // answer can be read against the number they were shown.
        shippedQuantity: { type: Number, required: true, min: 0 },
        receivedQuantity: { type: Number, required: true, min: 0 },
        confirmedAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

removalReceiptSchema.index({ User: 1, country: 1, region: 1, orderId: 1, sku: 1 }, { unique: true });

module.exports = mongoose.model("RemovalReceipt", removalReceiptSchema);
