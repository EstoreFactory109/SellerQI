const mongoose = require('mongoose');

const OrchestrationCronLockSchema = new mongoose.Schema({
    lockKey: { type: String, required: true, unique: true, index: true },
    lockedUntil: { type: Date, required: true },
    holder: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.models.OrchestrationCronLock
    || mongoose.model('OrchestrationCronLock', OrchestrationCronLockSchema);
