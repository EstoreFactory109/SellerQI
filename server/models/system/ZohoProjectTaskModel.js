/**
 * ZohoProjectTaskModel.js
 *
 * Tasks synced nightly from the Zoho projects that ESF clients are linked to
 * (see Services/Zoho/ZohoTaskSync.js). The client's Status page reads from here,
 * never from Zoho directly — so the page stays fast and keeps working when Zoho
 * is slow, rate-limiting, or briefly down.
 *
 * ONE DOCUMENT PER TASK, deliberately.
 * The obvious alternative — one document per project holding a tasks array —
 * would grow without bound as comment threads accumulate, and this repo has
 * already been bitten by 16MB-document failures (ERR_OUT_OF_RANGE). A task's
 * own comment list is naturally bounded; a project's is not.
 *
 * Nothing here is a source of truth. The whole collection is derivable from
 * Zoho, so a wipe-and-resync is always a safe recovery.
 */

const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema({
    commentId: { type: String, required: true },
    // Plain text, converted at sync time from Zoho's HTML — see zohoRichText.js.
    // Storing text rather than HTML is what keeps third-party markup out of the
    // browser entirely.
    content: { type: String, default: '' },
    authorName: { type: String, default: null },
    createdAt: { type: Date, default: null },
    attachmentCount: { type: Number, default: 0 },
}, { _id: false });

const ZohoProjectTaskSchema = new mongoose.Schema({
    portalId: { type: String, required: true },
    projectId: { type: String, required: true, index: true },
    projectName: { type: String, default: null },
    taskId: { type: String, required: true },

    name: { type: String, default: null },
    // The portal's own status label (this portal uses Open/Content/Design).
    // Never matched on by name — statusIsClosed/isCompleted carry the meaning.
    status: { type: String, default: null },
    statusIsClosed: { type: Boolean, default: false },
    isCompleted: { type: Boolean, default: false },
    priority: { type: String, default: null },
    percentComplete: { type: Number, default: null },

    ownerNames: { type: [String], default: [] },
    tasklist: { type: String, default: null },
    milestone: { type: String, default: null },
    createdByName: { type: String, default: null },
    updatedByName: { type: String, default: null },

    // Drives the In progress / Coming Up split: a start date in the future means
    // the work has not begun. Absent means started (a task with no dates but
    // active comments is real work, not a plan).
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    taskCreatedAt: { type: Date, default: null },
    taskUpdatedAt: { type: Date, default: null },

    hasAttachments: { type: Boolean, default: false },
    comments: { type: [CommentSchema], default: [] },

    syncedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// The upsert key for every sync write.
ZohoProjectTaskSchema.index({ projectId: 1, taskId: 1 }, { unique: true });
// The Status page's read: every task for one project, newest activity first.
ZohoProjectTaskSchema.index({ projectId: 1, taskUpdatedAt: -1 });

const ZohoProjectTask = mongoose.models.ZohoProjectTask
    || mongoose.model('ZohoProjectTask', ZohoProjectTaskSchema);

module.exports = ZohoProjectTask;
