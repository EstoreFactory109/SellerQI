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
    error: {
        type: String,
        required: true
    },
    solution: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'in_progress'],
        default: 'pending'
    }
}, {
    timestamps: true
});

// Index for efficient queries by user
TaskItemSchema.index({ userId: 1, createdAt: -1 });

// Compound index for deduplication: unique task per user based on asin + errorCategory + errorType
TaskItemSchema.index({ userId: 1, asin: 1, errorCategory: 1, errorType: 1 }, { unique: true });

// Index for status queries
TaskItemSchema.index({ userId: 1, status: 1 });

/**
 * Find all tasks for a user
 */
TaskItemSchema.statics.findByUserId = function(userId, options = {}) {
    const { limit, skip, status, sort = { createdAt: -1 } } = options;
    
    const query = this.find({ userId });
    
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
TaskItemSchema.statics.getTaskIdentifiers = async function(userId) {
    const tasks = await this.find({ userId })
        .select('asin errorCategory errorType')
        .lean();
    
    return new Set(tasks.map(t => `${t.asin}-${t.errorCategory}-${t.errorType}`));
};

/**
 * Delete completed tasks for a user (used during renewal)
 */
TaskItemSchema.statics.deleteCompletedTasks = function(userId) {
    return this.deleteMany({ userId, status: 'completed' });
};

/**
 * Delete all tasks for a user
 */
TaskItemSchema.statics.deleteByUserId = function(userId) {
    return this.deleteMany({ userId });
};

/**
 * Count tasks by status for a user
 */
TaskItemSchema.statics.countByStatus = async function(userId) {
    const results = await this.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    
    const counts = { pending: 0, completed: 0, in_progress: 0, total: 0 };
    results.forEach(r => {
        counts[r._id] = r.count;
        counts.total += r.count;
    });
    
    return counts;
};

/**
 * Bulk insert tasks in chunks to avoid memory issues
 */
TaskItemSchema.statics.bulkInsertTasks = async function(userId, tasks, chunkSize = 500) {
    if (!tasks || tasks.length === 0) return { insertedCount: 0 };
    
    let insertedCount = 0;
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    for (let i = 0; i < tasks.length; i += chunkSize) {
        const chunk = tasks.slice(i, i + chunkSize);
        const docsToInsert = chunk.map(task => ({
            userId: userObjectId,
            taskId: task.taskId,
            productName: task.productName,
            asin: task.asin,
            errorCategory: task.errorCategory,
            errorType: task.errorType,
            error: task.error,
            solution: task.solution,
            status: task.status || 'pending'
        }));
        
        try {
            // Use ordered: false to continue on duplicate key errors
            const result = await this.insertMany(docsToInsert, { ordered: false });
            insertedCount += result.length;
        } catch (error) {
            // Handle duplicate key errors gracefully
            if (error.code === 11000 || error.writeErrors) {
                // Some docs may have been inserted before the error
                insertedCount += error.insertedDocs?.length || 0;
            } else {
                throw error;
            }
        }
    }
    
    return { insertedCount };
};

const TaskItem = mongoose.model('TaskItem', TaskItemSchema);

module.exports = TaskItem;
