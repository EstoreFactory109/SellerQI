/**
 * Live updates from Amazon: subscribe a seller to event notifications, or stop
 * them. tasks-logics.xlsx "Post Fn" (Notifications). Behind
 * AMAZON_ACTIONS_NOTIFICATIONS_ENABLED, and only once the team has created the
 * region's destination (server/scripts/notifications/createDestination.js).
 */
const { userError } = require('../errors.js');

const TYPES = {
    FEED_PROCESSING_FINISHED: 'A bulk update you sent has finished (results show sooner)',
    REPORT_PROCESSING_FINISHED: 'An Amazon report SellerQI asked for is ready',
    LISTINGS_ITEM_ISSUES_CHANGE: 'Amazon flags or clears an issue on one of your listings',
    ORDER_CHANGE: 'An order is placed or changes status',
    FBA_INVENTORY_AVAILABILITY_CHANGES: 'Your FBA stock changes',
    ANY_OFFER_CHANGED: 'Offers on your products change (prices, Buy Box)'
};

async function destinationFor(region) {
    const Destination = require('../../../models/MCP/NotificationDestinationModel.js');
    const d = await Destination.findOne({ region }).lean();
    if (d) return d;
    // The app's existing destination (seen live: one SQS destination, the same id
    // in NA, EU and FE), configured as DESTINATION_ID.
    if (process.env.DESTINATION_ID) return { destinationId: process.env.DESTINATION_ID };
    throw userError('Live updates are not set up for this region yet (the SellerQI team has to create the destination first).');
}

const typeOf = (input) => {
    const t = String(input?.notificationType || '').toUpperCase();
    if (!TYPES[t]) throw userError('Choose the kind of update.');
    return t;
};

const createSubscription = {
    actionType: 'notifications.create_subscription',
    feature: 'notifications',
    flag: 'AMAZON_ACTIONS_NOTIFICATIONS',
    idempotent: true, // Amazon refuses a duplicate; the existing one is then kept
    validate(input) { return { notificationType: typeOf(input) }; },
    async preview(input, ctx) {
        const dest = await destinationFor(ctx.region);
        const { credentialsFor } = require('../../Sp_API/spApiClient.js');
        const { getSubscription } = require('../../Sp_API/NotificationsService.js');
        const creds = await credentialsFor(ctx.userId, ctx.country, ctx.region);
        const existing = await getSubscription({ accessToken: creds.accessToken, region: ctx.region, notificationType: input.notificationType });
        if (existing?.subscriptionId) throw userError('These updates are already on for this account.');
        return {
            title: 'Turn on live updates from Amazon',
            target: `Amazon notifications (${ctx.region})`,
            lines: [{ label: TYPES[input.notificationType], before: 'Off', after: 'On' }],
            warnings: ['Amazon then sends SellerQI a message each time this happens. You can turn it off at any time.'],
            payload: { notificationType: input.notificationType, destinationId: dest.destinationId }
        };
    },
    async execute(payload, ctx) {
        const { credentialsFor } = require('../../Sp_API/spApiClient.js');
        const N = require('../../Sp_API/NotificationsService.js');
        const creds = await credentialsFor(ctx.userId, ctx.country, ctx.region);
        let sub;
        try {
            sub = await N.createSubscription({ accessToken: creds.accessToken, region: ctx.region, notificationType: payload.notificationType, destinationId: payload.destinationId });
        } catch (error) {
            // Already subscribed (made elsewhere meanwhile): keep that one.
            if (error.response?.status !== 409) throw error;
            sub = await N.getSubscription({ accessToken: creds.accessToken, region: ctx.region, notificationType: payload.notificationType });
        }
        if (!sub?.subscriptionId) throw new Error('Amazon did not confirm the subscription.');
        const Subscription = require('../../../models/MCP/NotificationSubscriptionModel.js');
        await Subscription.updateOne(
            { userId: ctx.userId, region: ctx.region, notificationType: payload.notificationType },
            { $set: { country: ctx.country, subscriptionId: String(sub.subscriptionId), destinationId: String(sub.destinationId || payload.destinationId) } },
            { upsert: true }
        );
        return sub;
    }
};

const deleteSubscription = {
    actionType: 'notifications.delete_subscription',
    feature: 'notifications',
    flag: 'AMAZON_ACTIONS_NOTIFICATIONS',
    idempotent: true,
    validate(input) { return { notificationType: typeOf(input) }; },
    async preview(input, ctx) {
        const { credentialsFor } = require('../../Sp_API/spApiClient.js');
        const { getSubscription } = require('../../Sp_API/NotificationsService.js');
        const creds = await credentialsFor(ctx.userId, ctx.country, ctx.region);
        const existing = await getSubscription({ accessToken: creds.accessToken, region: ctx.region, notificationType: input.notificationType });
        if (!existing?.subscriptionId) throw userError('These updates are already off.');
        return {
            title: 'Turn off live updates from Amazon',
            target: `Amazon notifications (${ctx.region})`,
            lines: [{ label: TYPES[input.notificationType], before: 'On', after: 'Off' }],
            warnings: ['SellerQI still reads this data on its normal schedule.'],
            payload: { notificationType: input.notificationType, subscriptionId: String(existing.subscriptionId) }
        };
    },
    async execute(payload, ctx) {
        const N = require('../../Sp_API/NotificationsService.js');
        try {
            await N.deleteSubscription({ region: ctx.region, notificationType: payload.notificationType, subscriptionId: payload.subscriptionId });
        } catch (error) {
            if (error.response?.status !== 404) throw error; // already gone
        }
        const Subscription = require('../../../models/MCP/NotificationSubscriptionModel.js');
        await Subscription.deleteOne({ userId: ctx.userId, region: ctx.region, notificationType: payload.notificationType });
        return { deleted: true };
    }
};

module.exports = { handlers: [createSubscription, deleteSubscription], TYPES };
