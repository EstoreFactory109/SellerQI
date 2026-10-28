/**
 * A Zoho task the team closed, and the client's SellerQI tasks it was judged to cover
 * (Services/Zoho/ZohoCloseSync.js). For ESF clients added by staff — Fix it buyers have their
 * own two-way sync.
 *
 * mode 'dry_run' only records what WOULD be closed (reviewed in the ESF portal's
 * "Auto-closed tasks" page); 'on' also completed them. One row per close, so a re-sync never
 * repeats it.
 */
const mongoose = require('mongoose');

const zohoCloseMatchSchema = new mongoose.Schema(
    {
        projectId: { type: String, required: true },
        zohoTaskId: { type: String, required: true },
        zohoTaskName: { type: String, default: null },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        closedAt: { type: Date, required: true },
        mode: { type: String, enum: ['dry_run', 'on'], required: true },
        matches: [{
            _id: false,
            taskId: String,
            taskTitle: String,
            country: String,
            region: String,
            reason: String,
        }],
        considered: { type: Number, default: 0 },
        appliedAt: { type: Date, default: null },
        // SellerQI tasks the seller marked not-done again after this closed them.
        undoneTaskIds: { type: [String], default: [] },
    },
    { timestamps: true }
);

zohoCloseMatchSchema.index({ projectId: 1, zohoTaskId: 1, closedAt: 1 }, { unique: true });
zohoCloseMatchSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ZohoCloseMatch', zohoCloseMatchSchema);
