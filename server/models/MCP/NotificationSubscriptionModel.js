const mongoose = require("mongoose");

/**
 * A seller's subscription to one kind of Amazon event (made after the seller
 * approved it), and the latest event received for it. Amazon keeps one
 * subscription per seller per region (US and CA share NA); country is where it
 * was switched on.
 */
const notificationSubscriptionSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        country: { type: String, required: true },
        region: { type: String, required: true },
        notificationType: { type: String, required: true },
        subscriptionId: { type: String, required: true },
        destinationId: { type: String, required: true },
        lastEventAt: { type: Date, default: null },
        eventCount: { type: Number, default: 0 }
    },
    { timestamps: true }
);

notificationSubscriptionSchema.index({ userId: 1, region: 1, notificationType: 1 }, { unique: true });
notificationSubscriptionSchema.index({ subscriptionId: 1 });

module.exports = mongoose.model("NotificationSubscription", notificationSubscriptionSchema);
