const mongoose = require("mongoose");

/**
 * Where Amazon sends SellerQI's event notifications, per SP-API region (one SQS
 * queue). Created once by the team: server/scripts/notifications/createDestination.js.
 */
const notificationDestinationSchema = new mongoose.Schema(
    {
        region: { type: String, required: true, unique: true },
        destinationId: { type: String, required: true },
        name: { type: String, default: "" },
        type: { type: String, default: "SQS" },
        arn: { type: String, default: "" }
    },
    { timestamps: true }
);

module.exports = mongoose.model("NotificationDestination", notificationDestinationSchema);
