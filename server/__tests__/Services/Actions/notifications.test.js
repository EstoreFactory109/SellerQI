/**
 * Live updates from Amazon: reading a notification, and subscribing only once a
 * destination exists (keeping an existing subscription instead of failing).
 */
const mock = { live: null, created: null, upserts: [] };
jest.mock('../../../Services/Sp_API/spApiClient.js', () => ({ credentialsFor: async () => ({ accessToken: 't' }) }));
jest.mock('../../../Services/Sp_API/NotificationsService.js', () => ({
    getSubscription: async () => mock.live,
    createSubscription: async () => { if (mock.created instanceof Error) throw mock.created; return mock.created; },
    deleteSubscription: async () => ({ deleted: true })
}));
jest.mock('../../../models/MCP/NotificationDestinationModel.js', () => ({ findOne: () => ({ lean: async () => null }) }));
jest.mock('../../../models/MCP/NotificationSubscriptionModel.js', () => ({ updateOne: async (...a) => { mock.upserts.push(a); }, deleteOne: async () => ({}) }));

const registry = require('../../../Services/Actions/registry.js');
const { parseNotification } = require('../../../Services/BackgroundJobs/spNotificationsConsumer.js');
const ctx = { userId: 'U1', country: 'US', region: 'NA' };

beforeEach(() => { mock.live = null; mock.created = null; mock.upserts = []; delete process.env.DESTINATION_ID; });

describe('parseNotification', () => {
    it('reads a feed-finished notification as Amazon sends it', () => {
        const body = JSON.stringify({
            NotificationType: 'FEED_PROCESSING_FINISHED',
            Payload: { feedProcessingFinishedNotification: { sellerId: 'S1', feedId: '23492394', feedType: 'JSON_LISTINGS_FEED', processingStatus: 'DONE' } },
            NotificationMetadata: { NotificationId: 'N1', SubscriptionId: 'SUB1' }
        });
        expect(parseNotification(body)).toEqual({ type: 'FEED_PROCESSING_FINISHED', id: 'N1', subscriptionId: 'SUB1', feedId: '23492394', sellerId: 'S1' });
    });
});

describe('notifications.create_subscription', () => {
    const h = registry.get('notifications.create_subscription');

    it('needs a destination first', async () => {
        await expect(h.preview(h.validate({ notificationType: 'order_change' }), ctx)).rejects.toThrow('not set up');
    });

    it("uses the app's existing destination, and refuses what is already on", async () => {
        process.env.DESTINATION_ID = 'D1';
        const p = await h.preview(h.validate({ notificationType: 'ORDER_CHANGE' }), ctx);
        expect(p.payload).toEqual({ notificationType: 'ORDER_CHANGE', destinationId: 'D1' });
        mock.live = { subscriptionId: 'SUB1' };
        await expect(h.preview(h.validate({ notificationType: 'ORDER_CHANGE' }), ctx)).rejects.toThrow('already on');
    });

    it('keeps a subscription made meanwhile instead of failing', async () => {
        mock.created = Object.assign(new Error('conflict'), { response: { status: 409 } });
        mock.live = { subscriptionId: 'SUB9', destinationId: 'D1' };
        const sub = await h.execute({ notificationType: 'ORDER_CHANGE', destinationId: 'D1' }, ctx);
        expect(sub.subscriptionId).toBe('SUB9');
        expect(mock.upserts[0][1].$set).toMatchObject({ subscriptionId: 'SUB9' });
    });

    it('only offers the kinds of update SellerQI uses', () => {
        expect(() => h.validate({ notificationType: 'B2B_ANY_OFFER_CHANGED' })).toThrow('Choose');
    });
});
