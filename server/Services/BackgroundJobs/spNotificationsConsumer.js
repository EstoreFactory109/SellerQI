/**
 * Reads Amazon's event notifications from the SQS queue SellerQI's destination
 * points at (long polling), and routes them:
 *   FEED_PROCESSING_FINISHED  -> the bulk update waiting for that feed is followed
 *                                up straight away instead of on its next poll
 *   everything else           -> counted on the seller's subscription (last event)
 * Messages are deleted only after they were handled; a repeat (same
 * NotificationId within 2 days) is skipped.
 *
 * Off until SP_NOTIFICATIONS_QUEUE_URL is set (the queue is AWS infrastructure the
 * team creates). Hosted by cronProducerStandalone.
 */
const logger = require('../../utils/Logger.js');

const seen = new Map(); // NotificationId -> time (in-process dedupe)
const SEEN_MS = 2 * 24 * 60 * 60 * 1000;

/** Pure: Amazon's notification body -> what SellerQI needs from it. Exported for tests. */
function parseNotification(body) {
    const n = typeof body === 'string' ? JSON.parse(body) : body;
    const type = n.NotificationType || n.notificationType;
    const meta = n.NotificationMetadata || n.notificationMetadata || {};
    const payload = n.Payload || n.payload || {};
    return {
        type,
        id: meta.NotificationId || meta.notificationId || null,
        subscriptionId: meta.SubscriptionId || meta.subscriptionId || null,
        feedId: payload.feedProcessingFinishedNotification?.feedId || payload.FeedProcessingFinishedNotification?.FeedId || null,
        sellerId: payload.feedProcessingFinishedNotification?.sellerId || null
    };
}

async function handle(note) {
    const Subscription = require('../../models/MCP/NotificationSubscriptionModel.js');
    if (note.subscriptionId) {
        await Subscription.updateOne({ subscriptionId: String(note.subscriptionId) }, { $set: { lastEventAt: new Date() }, $inc: { eventCount: 1 } });
    }
    if (note.type === 'FEED_PROCESSING_FINISHED' && note.feedId) {
        const ChangeRequest = require('../../models/MCP/AmazonChangeRequestModel.js');
        const doc = await ChangeRequest.findOneAndUpdate({ 'amazon.feedId': String(note.feedId), status: 'awaiting_amazon' }, { $set: { nextPollAt: new Date() } }, { new: true }).select('_id').lean();
        if (doc) await require('../Actions/ChangeRequestService.js').pollOne(doc._id).catch(() => null);
    }
}

function start() {
    const queueUrl = process.env.SP_NOTIFICATIONS_QUEUE_URL;
    if (!queueUrl) {
        logger.info('[SpNotifications] off (SP_NOTIFICATIONS_QUEUE_URL not set)');
        return null;
    }
    const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
    const client = new SQSClient({ region: process.env.SP_NOTIFICATIONS_QUEUE_REGION || process.env.AWS_REGION || 'us-east-1' });
    let stopped = false;
    const loop = async () => {
        while (!stopped) {
            try {
                const res = await client.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 }));
                for (const m of res.Messages || []) {
                    try {
                        const note = parseNotification(m.Body);
                        const now = Date.now();
                        for (const [k, t] of seen) if (now - t > SEEN_MS) seen.delete(k);
                        if (!note.id || !seen.has(note.id)) {
                            await handle(note);
                            if (note.id) seen.set(note.id, now);
                        }
                        await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }));
                    } catch (error) {
                        // Left on the queue: SQS hands it out again after its visibility timeout.
                        logger.warn('[SpNotifications] message not handled', { error: error.message });
                    }
                }
            } catch (error) {
                logger.error('[SpNotifications] receive failed; retrying in 30 s', { error: error.message });
                await new Promise((r) => setTimeout(r, 30000));
            }
        }
    };
    loop();
    logger.info('[SpNotifications] reading the notifications queue');
    return { stop: () => { stopped = true; } };
}

module.exports = { start, parseNotification, handle };
