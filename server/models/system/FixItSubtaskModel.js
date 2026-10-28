/**
 * One SellerQI task mirrored as a Zoho subtask of a Fix it work order.
 *
 * The unique keys are the in-database duplicate guards: a SellerQI task (by identity) is
 * mirrored at most once per work order, and a Zoho subtask belongs to at most one mapping.
 * `state` records what was last synced (open / closed) so only TRANSITIONS are propagated
 * between the two sides — a change is never bounced back.
 */
const mongoose = require('mongoose');

const fixItSubtaskSchema = new mongoose.Schema(
    {
        workOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'FixItWorkOrder', required: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        taskId: { type: String, required: true },
        identityKey: { type: String, required: true },
        zohoSubtaskId: { type: String, default: null },
        title: { type: String, default: null },
        contentHash: { type: String, default: null },
        // creating: claimed, Zoho subtask not confirmed yet · open / closed: last synced state ·
        // removed: the team deleted it in Zoho (never recreated; still counts toward the quota)
        state: { type: String, enum: ['creating', 'open', 'closed', 'removed'], default: 'creating' },
        closedBy: { type: String, enum: ['zoho', 'sellerqi', null], default: null },
        // When it was last closed (either side): "Amazon still shows this N days after it was closed".
        closedAt: { type: Date, default: null },
        adoptedBy: { type: String, enum: ['marker', 'title', 'ai', null], default: null },
        claimedAt: { type: Date, default: () => new Date() },
        lastSyncedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

fixItSubtaskSchema.index({ workOrderId: 1, identityKey: 1 }, { unique: true });
fixItSubtaskSchema.index(
    { workOrderId: 1, zohoSubtaskId: 1 },
    { unique: true, partialFilterExpression: { zohoSubtaskId: { $type: 'string' } } }
);
fixItSubtaskSchema.index({ userId: 1, taskId: 1 });

module.exports = mongoose.model('FixItSubtask', fixItSubtaskSchema);
