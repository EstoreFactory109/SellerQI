/**
 * JobStatusModel.js
 * 
 * MongoDB model for tracking job status and history
 * 
 * Stores job execution details for monitoring and debugging:
 * - Job ID (from BullMQ)
 * - User ID
 * - Status (pending|running|completed|failed)
 * - Timestamps (started, completed, failed)
 * - Execution details (duration, accounts processed, errors)
 */

const mongoose = require('mongoose');

const JobStatusSchema = new mongoose.Schema({
    // BullMQ job ID
    jobId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    // User ID being processed
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // Job status
    status: {
        type: String,
        enum: ['pending', 'running', 'completed', 'failed'],
        required: true,
        default: 'pending',
        index: true
    },
    // Worker information
    workerName: {
        type: String,
        required: false
    },
    // Timestamps
    enqueuedAt: {
        type: Date,
        default: Date.now
    },
    startedAt: {
        type: Date,
        required: false
    },
    completedAt: {
        type: Date,
        required: false
    },
    failedAt: {
        type: Date,
        required: false
    },
    // Execution details
    duration: {
        type: Number, // Duration in milliseconds
        required: false
    },
    accountsProcessed: {
        type: Number,
        required: false,
        default: 0
    },
    accountsSucceeded: {
        type: Number,
        required: false,
        default: 0
    },
    accountsFailed: {
        type: Number,
        required: false,
        default: 0
    },
    // Error information
    error: {
        type: String,
        required: false
    },
    stack: {
        type: String,
        required: false
    },
    // Retry information
    attemptNumber: {
        type: Number,
        required: false,
        default: 1
    },
    maxAttempts: {
        type: Number,
        required: false,
        default: 3
    },
    // Additional metadata
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        required: false
    }
}, {
    timestamps: true // Adds createdAt and updatedAt
});

// Indexes for efficient queries
JobStatusSchema.index({ userId: 1, status: 1 });
JobStatusSchema.index({ status: 1, createdAt: -1 });
JobStatusSchema.index({ createdAt: -1 }); // For recent jobs query

// Create the model
const JobStatus = mongoose.model('JobStatus', JobStatusSchema);

module.exports = JobStatus;

