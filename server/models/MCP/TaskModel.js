/**
 * Task Model
 * 
 * Stores metadata for user tasks (renewal date).
 * 
 * IMPORTANT: Individual tasks are now stored in the TaskItem collection
 * (see TaskItemModel.js) to avoid the 16MB MongoDB document limit.
 * 
 * The 'tasks' array is kept for backward compatibility during migration
 * but should not be used for new data. It will be cleared during first run.
 */

const mongoose = require('mongoose');

// Legacy embedded task schema - kept for migration compatibility only
const LegacyTaskItemSchema = new mongoose.Schema({
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
}, { _id: false });

const TaskSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // DEPRECATED: Tasks are now stored in TaskItem collection
    // This field is kept for backward compatibility and will be migrated
    tasks: {
        type: [LegacyTaskItemSchema],
        default: []
    },
    taskRenewalDate: {
        type: Date,
        required: true
    }
}, {
    timestamps: true
});

// Ensure only one document per user
TaskSchema.index({ userId: 1 }, { unique: true });

/**
 * Check if this document has legacy embedded tasks that need migration
 */
TaskSchema.methods.hasLegacyTasks = function() {
    return this.tasks && this.tasks.length > 0;
};

const Task = mongoose.model('Task', TaskSchema);

module.exports = Task;

