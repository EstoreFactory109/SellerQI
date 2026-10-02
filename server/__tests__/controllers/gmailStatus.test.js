/**
 * What /api/gmail/status says about the ingest backlog.
 *
 * This endpoint reported `connected: true, lastError: null` for a week while 37 messages
 * were being re-fetched on every ten-minute sync and never stored. Nothing was wrong with
 * the connection - the backlog was the problem, and nothing on the payload described it.
 * The only thing that ever set lastError was the backlog passing a 200-entry cap, which a
 * small inbox never reaches.
 *
 * So these tests are mostly about ONE distinction: age, not size. A count cannot tell a
 * broken integration from a busy morning.
 */
const mockFindOne = jest.fn();

jest.mock('../../models/system/GmailConnectionModel.js', () => ({
    SINGLETON_KEY: 'gmail_inbox',
    findOne: (...a) => mockFindOne(...a),
}));
jest.mock('../../Services/Gmail/config.js', () => ({
    getCredentials: () => ({ inboxAddress: 'support@estorefactory.com' }),
    getPubSubConfig: () => ({ topicName: 'projects/x/topics/y' }),
    isMessagingEnabled: () => true,
    getPollMinutes: () => 10,
}));
jest.mock('../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { getGmailStatus } = require('../../controllers/integration/GmailController.js');

const chain = (value) => ({ lean: async () => value });
const hoursAgo = (h) => new Date(Date.now() - h * 3600000);

const CONNECTED = {
    emailAddress: 'support@estorefactory.com',
    connectedAt: new Date('2026-09-23T10:00:00Z'),
    lastSyncAt: new Date(),
    watchExpiration: new Date(Date.now() + 100 * 3600000),
    lastError: null,
    lastErrorAt: null,
};

const run = (connection) => new Promise((resolve) => {
    mockFindOne.mockReturnValue(chain(connection));
    const res = {
        status() { return this; },
        json(body) { resolve(body.data); return this; },
    };
    getGmailStatus({}, res, () => {});
});

describe('a healthy backlog', () => {
    test('reports healthy when there is nothing pending', async () => {
        const data = await run({ ...CONNECTED, pendingMessages: [], deadLetterMessages: [] });

        expect(data.pendingCount).toBe(0);
        expect(data.pendingOldestAgeHours).toBeNull();
        expect(data.backlogHealthy).toBe(true);
    });

    test('a burst that arrived minutes ago is NOT unhealthy', async () => {
        // The distinction a count cannot make. Two hundred messages from the last ten
        // minutes are a busy morning, not a fault.
        const pending = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, attempts: 1, firstSeenAt: new Date() }));
        const data = await run({ ...CONNECTED, pendingMessages: pending, deadLetterMessages: [] });

        expect(data.pendingCount).toBe(200);
        expect(data.backlogHealthy).toBe(true);
    });
});

describe('a backlog that is actually stuck', () => {
    test('ONE message failing for days is unhealthy, however small the count', async () => {
        // The production state this was written for: a tiny backlog, reported healthy.
        const data = await run({
            ...CONNECTED,
            pendingMessages: [{ id: 'stuck', attempts: 900, firstSeenAt: hoursAgo(144) }],
            deadLetterMessages: [],
        });

        expect(data.pendingCount).toBe(1);
        expect(data.pendingOldestAgeHours).toBe(144);
        expect(data.pendingStuckCount).toBe(1);
        expect(data.pendingMaxAttempts).toBe(900);
        expect(data.backlogHealthy).toBe(false);
    });

    test('reports the age of the OLDEST entry, not the newest', async () => {
        const data = await run({
            ...CONNECTED,
            pendingMessages: [
                { id: 'new', attempts: 1, firstSeenAt: hoursAgo(1) },
                { id: 'old', attempts: 40, firstSeenAt: hoursAgo(50) },
            ],
            deadLetterMessages: [],
        });

        expect(data.pendingOldestAgeHours).toBe(50);
    });

    test('retired messages are surfaced, not hidden', async () => {
        // Stopping is a decision an operator should see, not a disappearance.
        const retiredAt = new Date();
        const data = await run({
            ...CONNECTED,
            pendingMessages: [],
            deadLetterMessages: [{ id: 'gone', attempts: 3, retiredAt, lastReason: 'not found in Gmail' }],
        });

        expect(data.deadLetterCount).toBe(1);
        expect(data.deadLetterNewestAt).toBe(retiredAt);
        expect(data.backlogHealthy).toBe(false);
    });
});

describe('the deploy window', () => {
    test('counts legacy ids before the first sync adopts them', async () => {
        // Between deploying and the first sync, the legacy field IS the backlog.
        // Reporting 0 then would be the same silence this change exists to end.
        const data = await run({
            ...CONNECTED,
            pendingMessageIds: ['a', 'b', 'c'],
            pendingMessages: [],
            deadLetterMessages: [],
        });

        expect(data.pendingCount).toBe(3);
    });

    test('survives a connection document written before these fields existed', async () => {
        const data = await run(CONNECTED);

        expect(data.pendingCount).toBe(0);
        expect(data.deadLetterCount).toBe(0);
        expect(data.backlogHealthy).toBe(true);
    });
});

describe('what it must not leak', () => {
    test('never returns the refresh token', async () => {
        const data = await run({ ...CONNECTED, refreshToken: 'super-secret', pendingMessages: [] });

        expect(JSON.stringify(data)).not.toContain('super-secret');
    });
});
