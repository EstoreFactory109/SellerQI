/**
 * gmailInboxQueue.js — the queue a Pub/Sub push hands work to.
 *
 * The push endpoint must answer Google in milliseconds. Pub/Sub retries anything that is
 * not a prompt 2xx, so doing the sync inline turns one slow mailbox into a redelivery
 * storm that makes the mailbox slower. The handler therefore verifies, enqueues, and
 * returns 204.
 *
 * ── CONCURRENCY IS 1, AND NOT FOR THROUGHPUT ──
 * The history cursor is a single serialised value. Two syncs advancing it at once is the
 * same permanent-mail-loss bug as advancing it past a failure, reached by a different
 * road. This is a correctness constraint, not a tuning knob.
 *
 * ── NO FIXED jobId ──
 * BullMQ silently DROPS an add() whose jobId matches an existing job, and completed jobs
 * are retained. deleteUserQueue.js documents this costing a purge that never ran; here
 * it would cost mail that is never fetched — two notifications arriving close together,
 * the second discarded, and whatever it was announcing left unseen until the next poll.
 * A timestamp is not a fix either: two pushes in the same millisecond collide.
 */

const { Queue } = require('bullmq');
const { getQueueRedisConnection } = require('../../config/queueRedisConn.js');
const logger = require('../../utils/Logger.js');

const GMAIL_INBOX_QUEUE_NAME = 'gmail-inbox-sync';

const queueConfig = {
    connection: getQueueRedisConnection(),
    prefix: 'bullmq',
    defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 24 * 3600, count: 200 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
    },
};

let queueInstance = null;

function getGmailInboxQueue() {
    if (!queueInstance) {
        queueInstance = new Queue(GMAIL_INBOX_QUEUE_NAME, queueConfig);
        queueInstance.on('error', (err) => logger.error('[GmailInboxQueue] Queue error:', err));
        logger.info('[GmailInboxQueue] Gmail inbox sync queue initialized');
    }
    return queueInstance;
}

/**
 * Ask for a sync.
 *
 * @param {object} [payload]
 * @param {string} [payload.reason]     'push' | 'poll' | 'manual'
 * @param {string} [payload.historyId]  what the notification announced — recorded for
 *   diagnostics ONLY. It is a doorbell, never a cursor: Pub/Sub delivers out of order
 *   and at least once, so adopting it would regularly skip mail.
 */
async function enqueueGmailSync({ reason = 'push', historyId = null } = {}) {
    const queue = getGmailInboxQueue();
    // No explicit jobId — see the header.
    return queue.add('sync', { reason, announcedHistoryId: historyId ? String(historyId) : null });
}

module.exports = {
    getGmailInboxQueue,
    enqueueGmailSync,
    GMAIL_INBOX_QUEUE_NAME,
    queueConfig,
};
