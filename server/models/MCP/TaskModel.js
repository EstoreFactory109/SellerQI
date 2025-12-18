/**
 * Task Model
 * 
 * Stores tasks generated from error analysis for each user.
 */

const mongoose = require('mongoose');

const TaskItemSchema = new mongoose.Schema({
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
        enum: ['ranking', 'conversion', 'inventory', 'profitability', 'sponsoredAds'],
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
    tasks: {
        type: [TaskItemSchema],
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

const Task = mongoose.model('Task', TaskSchema);

module.exports = Task;

