/**
 * One Fix it engagement in Zoho: the Trial, or a subscription for its whole life.
 *
 * It owns ONE parent Zoho task; the seller's SellerQI tasks are mirrored under it as
 * subtasks (FixItSubtask), topped up to `quota` — the tasks paid for so far (Trial 2;
 * Standard +30 / Accelerated +60 per paid month) — and kept in sync both ways by
 * Services/Stripe/FixItZohoSync.js until the engagement ends.
 *
 * Scoped to the marketplace the seller bought from (their tasks are per marketplace).
 */
const mongoose = require('mongoose');

const fixItWorkOrderSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        country: { type: String, default: null },
        region: { type: String, default: null },
        kind: { type: String, enum: ['trial', 'subscription'], required: true },
        // 'purchase:<FixItPurchase _id>' for a Trial, the Stripe subscription id for a subscription.
        key: { type: String, required: true, unique: true },
        packageId: { type: String, required: true },
        packageName: { type: String, required: true },
        tasksPerPeriod: { type: Number, required: true },
        quota: { type: Number, required: true },
        monthsPaid: { type: Number, default: 1 },
        // active: topped up and synced · ending: cancelled, synced but not topped up ·
        // ended: synced for a grace period after it ends, then left alone.
        status: { type: String, enum: ['active', 'ending', 'ended'], default: 'active', index: true },
        endedAt: { type: Date, default: null },
        portalId: { type: String, default: null },
        zohoProjectId: { type: String, required: true },
        zohoProjectName: { type: String, default: null },
        zohoProjectSource: { type: String, default: null },
        // Null only between the work order's claim and the parent's creation (crash recovery
        // looks for a top-level task with zohoParentTaskName before creating another).
        zohoParentTaskId: { type: String, default: null },
        zohoParentTaskName: { type: String, default: null },
        // An open status of this project (read off the new parent): reopening needs an id.
        zohoOpenStatusId: { type: String, default: null },
        parentContentHash: { type: String, default: null },
        lastSyncAt: { type: Date, default: null },
        lastSyncError: { type: String, default: null },
    },
    { timestamps: true }
);

fixItWorkOrderSchema.index({ userId: 1, country: 1, region: 1, status: 1 });

module.exports = mongoose.model('FixItWorkOrder', fixItWorkOrderSchema);
