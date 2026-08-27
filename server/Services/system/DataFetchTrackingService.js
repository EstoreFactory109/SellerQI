/**
 * DataFetchTrackingService.js
 * 
 * Service for tracking when calendar-affecting services run.
 * This helps debug calendar date range issues by knowing exactly when data was fetched.
 */

const DataFetchTracking = require('../../models/system/DataFetchTrackingModel');
const logger = require('../../utils/Logger');

/**
 * Start tracking a data fetch session
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Object} dataRange - The data date range being fetched { startDate, endDate }
 * @param {string} sessionId - Optional session ID for correlation
 * @returns {Promise<Object>} The created tracking entry
 * 
 * Note: No servicesRan parameter - all calendar-affecting services run together on Mon/Wed/Fri
 */
async function startTracking(userId, country, region, dataRange, sessionId = null, producedBy = undefined) {
    try {
        const trackingEntry = await DataFetchTracking.createTrackingEntry(
            userId,
            country,
            region,
            dataRange,
            sessionId,
            producedBy
        );
        
        logger.info('[DataFetchTracking] Started tracking data fetch', {
            trackingId: trackingEntry._id,
            userId,
            country,
            region,
            dayName: trackingEntry.dayName,
            dateString: trackingEntry.dateString,
            timeString: trackingEntry.timeString,
            dataRange
        });
        
        return trackingEntry;
    } catch (error) {
        logger.error('[DataFetchTracking] Error starting tracking', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

// Marks docs opened by the scheduled pipeline's `sched_init`, so the supersede sweep below only
// ever closes docs it owns. See the `producedBy` field comment on the model for why that matters.
const SCHEDULED_OWNER = 'sched_init';

/**
 * Open a tracking doc for a scheduled run, closing any the previous run abandoned.
 *
 * WHY THIS EXISTS. `createTrackingEntry` is a bare `new this({...}).save()` — no upsert, no dedup,
 * and both compound indexes on the collection are non-unique. So every execution of `sched_init`
 * created another `started` doc and simply walked away from the last one.
 *
 * That is not a rare path. worker.js runs BullMQ with `lockDuration: 20min` and
 * `maxStalledCount: 3`, so a worker death, a blocked event loop or a hit lock-extension ceiling
 * makes BullMQ re-run the SAME `sched_init` up to four times, ~20 minutes apart. Every execution
 * left another doc open, and ~9h later sweepStalledPipelines relabelled all of them
 * `stalled-pipeline-autorecovered` — which is the number that gets read as "stuck at calc_review".
 * Observed verbatim on one production account: 06:01:02 / 06:21:06 / 06:41:11 / 07:01:17. BullMQ's
 * retry never goes through the producer, so no producer-side dedup can see any of it.
 *
 * WHY CLOSE-AND-CREATE RATHER THAN REUSE. Reusing the open doc looks tidier and is wrong twice
 * over. Nothing distinguishes "BullMQ retried this job" from "the next hourly run started over a
 * dead one" at this layer, and reusing in the second case leaves `fetchedAt` pinned to the earlier,
 * abandoned attempt — misreporting when the data was actually gathered, which is the one question
 * this collection exists to answer. Creating a fresh doc keeps `fetchedAt` honest and still leaves
 * exactly one open doc per account, which is the whole point.
 *
 * SCOPED BY `producedBy` ON PURPOSE. Five code paths write this collection, and the onboarding
 * integration pipeline runs on a SEPARATE BullMQ queue that the scheduled producer's liveness
 * check cannot see. An unscoped sweep would close a live onboarding run's doc out from under it
 * and the two pipelines would overwrite each other's outcome. Docs predating this field have no
 * `producedBy`, so they are left for the 9h sweep rather than being adopted here.
 *
 * @returns {Promise<Object>} the newly created tracking entry
 */
async function startTrackingForRun(userId, country, region, dataRange, sessionId = null) {
    try {
        const abandoned = await DataFetchTracking.find({
            User: userId,
            country,
            region,
            status: 'started',
            producedBy: SCHEDULED_OWNER,
        }).select('_id').lean();

        if (abandoned.length) {
            await supersedeDocs(abandoned.map(d => d._id));
            logger.info('[DataFetchTracking] Closed abandoned tracking entries before starting a new run', {
                userId, country, region, count: abandoned.length,
            });
        }
    } catch (error) {
        // Non-fatal: fall through and open the new doc anyway. Leaving a stale doc open is a
        // reporting problem; refusing to start a run is a customer one.
        logger.warn('[DataFetchTracking] Could not close open tracking entries; opening a new one anyway', {
            userId, country, region, error: error.message,
        });
    }

    return startTracking(userId, country, region, dataRange, sessionId, SCHEDULED_OWNER);
}

/** Close abandoned `started` docs. The status re-filter is a CAS guard so a doc that legitimately
 *  finalizes between the read and this write is never clobbered. */
async function supersedeDocs(ids) {
    if (!ids || !ids.length) return;
    await DataFetchTracking.updateMany(
        { _id: { $in: ids }, status: 'started' },
        {
            $set: {
                status: 'failed',
                errorMessage: 'superseded-by-newer-run',
                autoClosedStale: true,
                autoClosedAt: new Date(),
            },
        }
    );
}

/**
 * Mark a tracking entry as completed
 * @param {string} trackingId - The tracking entry ID
 * @returns {Promise<Object>} Updated tracking entry
 */
async function completeTracking(trackingId) {
    try {
        const trackingEntry = await DataFetchTracking.findById(trackingId);
        if (!trackingEntry) {
            throw new Error(`Tracking entry not found: ${trackingId}`);
        }
        
        // null = the doc was no longer `started`, i.e. something else already closed it (a
        // supersede, or the stalled sweep). Not an error — but worth seeing, because a run
        // finishing against a doc it no longer owns means two chains overlapped.
        const updated = await trackingEntry.markCompleted();
        if (!updated) {
            logger.warn('[DataFetchTracking] Tracking entry was already closed by someone else; leaving it alone', {
                trackingId, status: trackingEntry.status, errorMessage: trackingEntry.errorMessage,
            });
            return trackingEntry;
        }

        logger.info('[DataFetchTracking] Completed tracking data fetch', {
            trackingId,
            userId: trackingEntry.User,
            country: trackingEntry.country,
            region: trackingEntry.region,
            dayName: trackingEntry.dayName,
            dataRange: trackingEntry.dataRange
        });
        
        return trackingEntry;
    } catch (error) {
        logger.error('[DataFetchTracking] Error completing tracking', {
            trackingId,
            error: error.message
        });
        throw error;
    }
}

/**
 * Mark a tracking entry as failed
 * @param {string} trackingId - The tracking entry ID
 * @param {string} errorMessage - The error message
 * @returns {Promise<Object>} Updated tracking entry
 */
async function failTracking(trackingId, errorMessage) {
    try {
        const trackingEntry = await DataFetchTracking.findById(trackingId);
        if (!trackingEntry) {
            throw new Error(`Tracking entry not found: ${trackingId}`);
        }
        
        // null = already closed by someone else. See completeTracking for why this is a warn, not
        // an error.
        const updated = await trackingEntry.markFailed(errorMessage);
        if (!updated) {
            logger.warn('[DataFetchTracking] Tracking entry was already closed by someone else; leaving it alone', {
                trackingId, status: trackingEntry.status, attemptedError: errorMessage,
            });
            return trackingEntry;
        }

        logger.info('[DataFetchTracking] Failed tracking data fetch', {
            trackingId,
            userId: trackingEntry.User,
            country: trackingEntry.country,
            region: trackingEntry.region,
            errorMessage
        });
        
        return trackingEntry;
    } catch (error) {
        logger.error('[DataFetchTracking] Error marking tracking as failed', {
            trackingId,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get the latest completed fetch for a user/country/region
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object|null>} Latest tracking entry or null
 */
async function getLatestFetch(userId, country, region) {
    try {
        return await DataFetchTracking.findLatest(userId, country, region);
    } catch (error) {
        logger.error('[DataFetchTracking] Error getting latest fetch', {
            userId,
            country,
            region,
            error: error.message
        });
        return null;
    }
}

/**
 * Get fetch history for a user
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {number} limit - Number of entries to return
 * @returns {Promise<Array>} Array of tracking entries
 */
async function getFetchHistory(userId, country, region, limit = 10) {
    try {
        return await DataFetchTracking.getFetchHistory(userId, country, region, limit);
    } catch (error) {
        logger.error('[DataFetchTracking] Error getting fetch history', {
            userId,
            country,
            region,
            error: error.message
        });
        return [];
    }
}

/**
 * Get the latest usable fetch (completed or partial) for a user/country/region
 * Used for UI visibility - shows last run that got some data
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object|null>} Latest usable tracking entry or null
 */
async function getLatestUsableFetch(userId, country, region) {
    try {
        return await DataFetchTracking.findLatestUsable(userId, country, region);
    } catch (error) {
        logger.error('[DataFetchTracking] Error getting latest usable fetch', {
            userId,
            country,
            region,
            error: error.message
        });
        return null;
    }
}

/**
 * Get the most recent fetch (any status) for monitoring purposes
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object|null>} Most recent tracking entry or null
 */
async function getMostRecentFetch(userId, country, region) {
    try {
        return await DataFetchTracking.findMostRecent(userId, country, region);
    } catch (error) {
        logger.error('[DataFetchTracking] Error getting most recent fetch', {
            userId,
            country,
            region,
            error: error.message
        });
        return null;
    }
}

module.exports = {
    startTracking,
    startTrackingForRun,
    SCHEDULED_OWNER,
    completeTracking,
    failTracking,
    getLatestFetch,
    getFetchHistory,
    getLatestUsableFetch,
    getMostRecentFetch
};

