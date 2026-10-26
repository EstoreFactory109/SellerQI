const mongoose = require("mongoose");

/**
 * Every change SellerQI makes on Amazon for a task, after the seller approved it.
 *
 * One document per attempt: what was asked, who approved it, and what Amazon said.
 * A successful attempt also stops the same change being sent twice (see
 * TaskActionService.approveTaskActions).
 */
const taskActionLogSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        country: { type: String, required: true },
        region: { type: String, required: true },
        taskId: { type: String, required: true },
        errorType: { type: String, default: "" },
        // add_negative_keyword | pause_keyword
        actionType: { type: String, required: true },
        // Exactly what was sent to Amazon.
        payload: { type: mongoose.Schema.Types.Mixed, default: {} },
        // What the seller saw and approved.
        summary: { type: String, default: "" },
        // Who clicked approve: the account owner, a team member, or staff.
        approvedBy: {
            userId: { type: String, default: null },
            memberId: { type: String, default: null },
            adminId: { type: String, default: null },
            superAdminId: { type: String, default: null }
        },
        status: { type: String, enum: ["running", "succeeded", "failed"], default: "running" },
        response: { type: mongoose.Schema.Types.Mixed, default: null },
        error: { type: String, default: "" }
    },
    { timestamps: true }
);

taskActionLogSchema.index({ userId: 1, country: 1, region: 1, taskId: 1, createdAt: -1 });

module.exports = mongoose.model("TaskActionLog", taskActionLogSchema);
