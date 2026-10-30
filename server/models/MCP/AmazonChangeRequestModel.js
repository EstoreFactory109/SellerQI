const mongoose = require("mongoose");

/**
 * A change SellerQI makes on Amazon from a screen (PPC page, Your Products, QMate...),
 * only after the seller approved it. Tasks-page changes keep TaskActionLog.
 *
 * Life of a request (Services/Actions/ChangeRequestService.js):
 *   draft            - previewed: `preview` is what the seller sees, `payload` what
 *                      would be sent (built on the server, never taken from the browser)
 *   running          - approved and being sent (set atomically, so it is sent once)
 *   awaiting_amazon  - Amazon accepted it and is still processing (feeds, inbound)
 *   succeeded | failed
 *   stale            - what the preview showed had changed on Amazon; nothing was sent
 *   unknown          - the send timed out; reconciled by re-reading, never resent
 *   cancelled | expired (a draft nobody approved)
 */
const approverSchema = new mongoose.Schema(
    {
        userId: { type: String, default: null },
        memberId: { type: String, default: null },
        adminId: { type: String, default: null },
        superAdminId: { type: String, default: null },
        // ESF staff working in the client's account.
        esfUserId: { type: String, default: null }
    },
    { _id: false }
);

const amazonChangeRequestSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        country: { type: String, required: true },
        region: { type: String, required: true },
        // ads | listings | messaging | feeds | reports | orders | notifications | inbound
        feature: { type: String, required: true },
        // e.g. ads.pause_keywords, listings.update_content
        actionType: { type: String, required: true },
        // screen | qmate | task | bulk
        source: { type: String, default: "screen" },
        status: {
            type: String,
            enum: ["draft", "running", "awaiting_amazon", "succeeded", "failed", "stale", "unknown", "cancelled", "expired"],
            default: "draft"
        },
        // What the seller entered, kept so the change can be previewed again.
        input: { type: mongoose.Schema.Types.Mixed, default: {} },
        // Exactly what the approval screen showed: { title, target, lines:[{label,before,after}], warnings, amazonIssues }.
        preview: { type: mongoose.Schema.Types.Mixed, default: {} },
        // Exactly what is sent to Amazon.
        payload: { type: mongoose.Schema.Types.Mixed, default: {} },
        // Values read at preview time; re-read just before sending (stale check).
        expected: { type: mongoose.Schema.Types.Mixed, default: {} },
        idempotencyKey: { type: String, required: true },
        // Multi-step changes (an inbound shipment's confirm steps).
        parentId: { type: mongoose.Schema.Types.ObjectId, default: null },
        step: { type: String, default: "" },
        // Amazon's ids for what was created or is processing.
        amazon: { type: mongoose.Schema.Types.Mixed, default: {} },
        createdBy: { type: approverSchema, default: () => ({}) },
        approvedBy: { type: approverSchema, default: () => ({}) },
        approvedAt: { type: Date, default: null },
        pollCount: { type: Number, default: 0 },
        nextPollAt: { type: Date, default: null },
        response: { type: mongoose.Schema.Types.Mixed, default: null },
        error: { type: String, default: "" },
        // Drafts expire (TTL below); approved requests are kept.
        expiresAt: { type: Date, default: null }
    },
    { timestamps: true }
);

amazonChangeRequestSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
amazonChangeRequestSchema.index({ feature: 1, status: 1 });
amazonChangeRequestSchema.index({ status: 1, nextPollAt: 1 });
amazonChangeRequestSchema.index({ idempotencyKey: 1, status: 1 });
amazonChangeRequestSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, partialFilterExpression: { status: "draft" } }
);

module.exports = mongoose.model("AmazonChangeRequest", amazonChangeRequestSchema);
