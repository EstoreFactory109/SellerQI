/**
 * TaskItem Model
 * 
 * Stores individual tasks in a separate collection to avoid the 16MB document limit.
 * Each task is stored as its own document, allowing unlimited tasks per user.
 * 
 * This replaces the embedded tasks array in the Task model for scalability.
 */

const mongoose = require('mongoose');

const TaskItemSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // Marketplace this task belongs to. Tasks used to be keyed by user alone, so a
    // seller with several marketplaces got one shared pool: the US view was built
    // from UK products, and the same ASIN failing in two marketplaces collided on
    // the dedup index so only one survived. Optional rather than required so the
    // rows written before this change stay readable until they are backfilled.
    country: {
        type: String,
        index: true
    },
    region: {
        type: String,
        index: true
    },
    taskId: {
        type: String,
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    asin: {
        type: String,
        required: true
    },
    errorCategory: {
        type: String,
        enum: ['ranking', 'conversion', 'inventory', 'profitability', 'sponsoredAds', 'account'],
        required: true
    },
    errorType: {
        type: String,
        required: true
    },
    // Optional (was required) — profitability/sponsoredAds/Buy-Box tasks now store
    // `renderData` instead and render `error`/`solution` on read (see
    // CreateTasksService.getUserTasks). Every other category still populates these
    // directly at creation time, exactly as before.
    error: {
        type: String,
        required: false
    },
    solution: {
        type: String,
        required: false
    },
    // Raw numbers needed to render `error`/`solution` on demand, for the categories
    // that manufacture prose from numbers rather than carrying through pre-written
    // text (profitability, sponsoredAds, Buy Box). Shape varies by errorType. Absent
    // for every other category — they have no cheaper structured form to fall back to.
    renderData: {
        type: mongoose.Schema.Types.Mixed,
        required: false
    },
    // Dollar amount recoverable by fixing this task (see RecoverableAmountUtils.js).
    // 0 for categories with no computed amount (ranking, account, most conversion checks).
    amount: {
        type: Number,
        default: 0
    },
    // True when `amount` is an estimate (e.g. stranded inventory, Buy Box loss) rather
    // than a measured figure (e.g. real ad spend, real storage fees).
    amountIsEstimated: {
        type: Boolean,
        default: false
    },
    // Capital locked in unsellable stock (unfulfillable / stranded inventory). A
    // DIFFERENT quantity from `amount`: freeing it returns working capital and stops
    // storage fees, but it never lands as profit, so the two must never be summed.
    capitalAmount: {
        type: Number,
        default: 0
    },
    // `resolved` is set only by the system: the issue stopped being detected
    // without the seller ticking it off. `completed` is the seller's own action.
    status: {
        type: String,
        enum: ['pending', 'completed', 'in_progress', 'resolved'],
        default: 'pending'
    },

    // ── Lifecycle (written by CreateTasksService.reconcileTasks) ──
    // First and most recent run that detected this issue.
    firstSeenAt: { type: Date },
    lastSeenAt: { type: Date },
    // When the seller marked it completed. Starts the grace period before a
    // still-detected issue is reopened.
    completedAt: { type: Date },
    // When the system found the issue gone.
    resolvedAt: { type: Date },
    reopenedAt: { type: Date },
    reopenCount: { type: Number, default: 0 },
    // Reopened because the seller marked it done but the data still shows it.
    stillDetected: { type: Boolean, default: false },
    // Why it was last reopened: 'reappeared' | 'still_detected' | 'escalated' (got worse).
    reopenReason: { type: String },
    // Which problem this is (Services/Calculations/TaskIdentity.js). Stays the same while
    // the problem's label (errorType) moves with its state, so the row and the seller's
    // status survive e.g. low stock -> out of stock.
    identityKey: { type: String }
}, {
    timestamps: true
});

// Index for efficient queries by user
TaskItemSchema.index({ userId: 1, createdAt: -1 });

// Deduplication key. country/region are part of it because the same ASIN can fail
// the same way in two marketplaces and both are real, separate pieces of work —
// without them the second insert is rejected as a duplicate and silently lost.
// The previous index ({userId, asin, errorCategory, errorType}) has to be dropped
// explicitly; see scripts/migrateScopeTasksToMarketplace.js.
TaskItemSchema.index(
    { userId: 1, country: 1, region: 1, asin: 1, errorCategory: 1, errorType: 1 },
    { unique: true, name: 'task_dedup_marketplace' }
);

// Primary read path: one marketplace's tasks.
/*
 * One row per problem per marketplace. Partial: rows written before identities existed
 * have none until scripts/migrateTaskIdentity.js backfills them, and must not collide.
 * task_dedup_marketplace (above) is dropped by that script (--drop-old-index) once every
 * row has an identity: it would otherwise refuse a row whose label moved onto a label
 * another (merged-away) row still holds.
 */
TaskItemSchema.index(
    { userId: 1, country: 1, region: 1, identityKey: 1 },
    { unique: true, name: 'task_identity_marketplace', partialFilterExpression: { identityKey: { $type: 'string' } } }
);

TaskItemSchema.index({ userId: 1, country: 1, region: 1 });

// Index for status queries
TaskItemSchema.index({ userId: 1, status: 1 });

// Open-work reads (dashboard groups, top products) for one marketplace.
TaskItemSchema.index({ userId: 1, country: 1, region: 1, status: 1 });

// Statuses that still need the seller's attention. Everything the dashboard sums
// and ranks is drawn from these only.
const OPEN_STATUSES = ['pending', 'in_progress'];

/**
 * Build a {userId, country?, region?} filter.
 *
 * The marketplace is applied only when supplied. A caller that has not been
 * updated therefore keeps its old, user-wide behaviour rather than matching
 * nothing — filtering on `country: undefined` would silently empty a seller's
 * task list, which is a worse failure than the mixing this replaces.
 */
TaskItemSchema.statics.scopeFilter = function(userId, country = null, region = null) {
    const filter = { userId };
    if (country) filter.country = country;
    if (region) filter.region = region;
    return filter;
};

/**
 * Find all tasks for a user, optionally limited to one marketplace.
 */
TaskItemSchema.statics.findByUserId = function(userId, options = {}) {
    const { limit, skip, status, sort = { createdAt: -1 }, country = null, region = null } = options;

    const query = this.find(this.scopeFilter(userId, country, region));
    
    if (status) {
        query.where('status', status);
    }
    
    if (sort) {
        query.sort(sort);
    }
    
    if (skip) {
        query.skip(skip);
    }
    
    if (limit) {
        query.limit(limit);
    }
    
    return query.lean();
};

/**
 * Get task identifiers for deduplication
 * Returns a Set of "asin-errorCategory-errorType" strings
 */
TaskItemSchema.statics.getTaskIdentifiers = async function(userId, country = null, region = null) {
    const tasks = await this.find(this.scopeFilter(userId, country, region))
        .select('asin errorCategory errorType')
        .lean();
    
    return new Set(tasks.map(t => `${t.asin}-${t.errorCategory}-${t.errorType}`));
};

/**
 * Delete completed tasks for a user (used during renewal)
 */
TaskItemSchema.statics.deleteCompletedTasks = function(userId, country = null, region = null) {
    return this.deleteMany({ ...this.scopeFilter(userId, country, region), status: 'completed' });
};

/**
 * Delete a user's tasks, for ONE marketplace when it is given.
 *
 * Weekly renewal calls this before re-inserting. Unscoped, one marketplace's
 * rebuild wiped every other marketplace's tasks as a side effect.
 */
TaskItemSchema.statics.deleteByUserId = function(userId, country = null, region = null) {
    return this.deleteMany(this.scopeFilter(userId, country, region));
};

/**
 * Count tasks by status for a user
 */
TaskItemSchema.statics.countByStatus = async function(userId, country = null, region = null) {
    const match = { userId: typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId };
    if (country) match.country = country;
    if (region) match.region = region;
    const results = await this.aggregate([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    
    const counts = { pending: 0, completed: 0, in_progress: 0, resolved: 0, total: 0 };
    results.forEach(r => {
        counts[r._id] = r.count;
        counts.total += r.count;
    });
    
    return counts;
};

/**
 * Bulk insert tasks in chunks to avoid memory issues
 */
TaskItemSchema.statics.bulkInsertTasks = async function(userId, tasks, chunkSize = 500, country = null, region = null) {
    if (!tasks || tasks.length === 0) return { insertedCount: 0 };
    
    let insertedCount = 0;
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    for (let i = 0; i < tasks.length; i += chunkSize) {
        const chunk = tasks.slice(i, i + chunkSize);
        const docsToInsert = chunk.map(task => ({
            userId: userObjectId,
            // Per-task values win so a caller can mix marketplaces in one batch;
            // the arguments are the default for the usual single-marketplace call.
            country: task.country || country,
            region: task.region || region,
            taskId: task.taskId,
            identityKey: task.identityKey,
            productName: task.productName,
            asin: task.asin,
            errorCategory: task.errorCategory,
            errorType: task.errorType,
            error: task.error,
            solution: task.solution,
            renderData: task.renderData,
            amount: task.amount || 0,
            amountIsEstimated: !!task.amountIsEstimated,
            capitalAmount: task.capitalAmount || 0,
            status: task.status || 'pending'
        }));
        
        try {
            // Use ordered: false to continue on duplicate key errors
            const result = await this.insertMany(docsToInsert, { ordered: false });
            insertedCount += result.length;
        } catch (error) {
            // Duplicates are expected (the dedup index is how repeats are dropped);
            // anything else is a real failure and must not be reported as success.
            if (!isOnlyDuplicateKeyErrors(error)) throw error;
            insertedCount += error.insertedDocs?.length ?? error.result?.insertedCount ?? 0;
        }
    }

    return { insertedCount };
};

/**
 * True when every write error in a bulk failure is a duplicate key (11000).
 *
 * The old check accepted any error carrying `writeErrors`, so a validation
 * failure or a 16MB rejection was swallowed and logged as a normal insert.
 */
function isOnlyDuplicateKeyErrors(error) {
    if (!error) return false;
    const writeErrors = error.writeErrors
        ? (Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors])
        : null;
    if (writeErrors && writeErrors.length > 0) {
        return writeErrors.every(e => (e?.code ?? e?.err?.code) === 11000);
    }
    return error.code === 11000;
}

/**
 * Apply one reconcile pass as a single unordered bulkWrite.
 *
 * Unordered so one bad op cannot stop the rest. A duplicate key on an insert
 * means a concurrent writer already created that task, which is the same end
 * state, so it is tolerated; any other write error is rethrown.
 *
 * @param {Array} ops - bulkWrite operations
 * @returns {{inserted: number, modified: number, deleted: number, duplicates: number}}
 */
TaskItemSchema.statics.reconcileWrite = async function(ops) {
    if (!Array.isArray(ops) || ops.length === 0) {
        return { inserted: 0, modified: 0, deleted: 0, duplicates: 0 };
    }
    try {
        const r = await this.bulkWrite(ops, { ordered: false });
        return {
            inserted: r.insertedCount || 0,
            modified: r.modifiedCount || 0,
            deleted: r.deletedCount || 0,
            duplicates: 0
        };
    } catch (error) {
        if (!isOnlyDuplicateKeyErrors(error)) throw error;
        const r = error.result || {};
        const writeErrors = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors].filter(Boolean);
        return {
            inserted: r.insertedCount || 0,
            modified: r.modifiedCount || 0,
            deleted: r.deletedCount || 0,
            duplicates: writeErrors.length || 1
        };
    }
};

TaskItemSchema.statics.OPEN_STATUSES = OPEN_STATUSES;
TaskItemSchema.statics.isOnlyDuplicateKeyErrors = isOnlyDuplicateKeyErrors;

const TaskItem = mongoose.model('TaskItem', TaskItemSchema);

module.exports = TaskItem;
