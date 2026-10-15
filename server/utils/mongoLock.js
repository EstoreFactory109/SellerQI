/**
 * mongoLock.js — a short-lived mutual-exclusion lock on OrchestrationCronLock.
 *
 * Same acquire-then-verify-holder pattern as zohoTaskSyncStandalone.acquireLock:
 * the upsert only matches an expired (or missing) lock, concurrent upserts collide
 * on the unique lockKey index, and the loser is detected by reading the holder back
 * rather than trusting its own write. The TTL means a holder that dies without
 * releasing cannot block the key past `ttlMs`.
 */

const logger = require('./Logger.js');

const newHolder = (prefix) =>
    `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * @param {string} lockKey
 * @param {number} ttlMs
 * @param {string} [holderPrefix]
 * @returns {Promise<null | (() => Promise<void>)>} a release function when won, null when not
 */
async function acquireLock(lockKey, ttlMs, holderPrefix = 'lock') {
    const OrchestrationCronLock = require('../models/system/OrchestrationCronLockModel.js');
    const holder = newHolder(holderPrefix);
    const now = new Date();
    try {
        await OrchestrationCronLock.findOneAndUpdate(
            { lockKey, $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }] },
            { $set: { lockedUntil: new Date(now.getTime() + ttlMs), holder } },
            { upsert: true, new: true }
        );
        const current = await OrchestrationCronLock.findOne({ lockKey }).lean();
        if (!current || current.holder !== holder) return null;
    } catch (error) {
        if (error && (error.code === 11000 || error.code === 11001)) return null;
        logger.error('[mongoLock] Lock acquisition error', { lockKey, error: error?.message });
        return null;
    }

    return async () => {
        try {
            // Only our own hold: if the TTL lapsed and someone else took the key,
            // deleting it would release THEIR lock.
            await OrchestrationCronLock.deleteOne({ lockKey, holder });
        } catch (error) {
            logger.warn('[mongoLock] Lock release failed; it will expire on its own', { lockKey, error: error?.message });
        }
    };
}

module.exports = { acquireLock };
