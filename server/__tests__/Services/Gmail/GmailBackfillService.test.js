/**
 * runBackfill — recovery when the history cursor is too old for history.list to serve.
 *
 * WHY THIS FILE EXISTS NOW
 * No test covered this at all, which is how a schema change in GmailIngestService
 * (the retry-bound fix) went out without updating the one other place that clears the
 * backlog on success. Backfill's own comment already explains the policy - "the old
 * backlog refers to a window that no longer exists" - and that premise applies to
 * BOTH backlog fields, not just the legacy one it originally cleared.
 */
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();
jest.mock('../../../models/system/GmailConnectionModel.js', () => ({
    SINGLETON_KEY: 'gmail_inbox',
    findOne: (...a) => mockFindOne(...a),
    updateOne: (...a) => mockUpdateOne(...a),
}));

const mockGetProfile = jest.fn();
const mockListMessages = jest.fn();
jest.mock('../../../Services/Gmail/GmailClient.js', () => ({
    getProfile: (...a) => mockGetProfile(...a),
    listMessages: (...a) => mockListMessages(...a),
}));

const mockIngestMessage = jest.fn();
jest.mock('../../../Services/Gmail/GmailIngestService.js', () => ({
    ingestMessage: (...a) => mockIngestMessage(...a),
}));

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { runBackfill } = require('../../../Services/Gmail/GmailBackfillService.js');

const chain = (value) => ({ lean: async () => value });

beforeEach(() => {
    mockFindOne.mockReturnValue(chain({ key: 'gmail_inbox' }));
    mockUpdateOne.mockResolvedValue({});
    mockGetProfile.mockResolvedValue({ historyId: '9999' });
    mockListMessages.mockResolvedValue({ messages: [], nextPageToken: undefined });
    mockIngestMessage.mockResolvedValue({ status: 'ingested' });
});

describe('clearing the backlog on a successful re-baseline', () => {
    test('clears pendingMessages alongside the legacy pendingMessageIds', async () => {
        /*
         * This is the regression test for the gap: the backlog fix introduced
         * pendingMessages as the live shape, and this call site was not updated to
         * match. Before the fix below, this assertion fails because pendingMessages
         * is simply absent from the write.
         */
        await runBackfill();

        const [, update] = mockUpdateOne.mock.calls.at(-1);
        expect(update.$set.pendingMessageIds).toEqual([]);
        expect(update.$set.pendingMessages).toEqual([]);
    });

    test('does NOT touch deadLetterMessages', async () => {
        // Those are messages Gmail has already said no longer exist. Re-walking the
        // mailbox by date cannot bring one back, and the record is the only evidence
        // any of them ever existed - clearing it here would make that evidence as
        // transient as the backlog it was pulled out of.
        await runBackfill();

        const [, update] = mockUpdateOne.mock.calls.at(-1);
        expect(update.$set).not.toHaveProperty('deadLetterMessages');
    });

    test('re-baselines the cursor and clears the stale error alongside the backlog', async () => {
        await runBackfill();

        const [, update] = mockUpdateOne.mock.calls.at(-1);
        expect(update.$set.historyId).toBe('9999');
        expect(update.$set.lastError).toBeNull();
    });
});

describe('when there is nothing to re-baseline to', () => {
    test('does not write at all without a profile historyId', async () => {
        mockGetProfile.mockResolvedValue({});

        await runBackfill();

        expect(mockUpdateOne).not.toHaveBeenCalled();
    });

    test('skips entirely when there is no connection', async () => {
        mockFindOne.mockReturnValue(chain(null));

        const result = await runBackfill();

        expect(result).toEqual({ skipped: 'not-connected' });
        expect(mockGetProfile).not.toHaveBeenCalled();
    });
});

describe('walking messages', () => {
    test('ingests every message id returned, across pages', async () => {
        mockListMessages
            .mockResolvedValueOnce({ messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'p2' })
            .mockResolvedValueOnce({ messages: [{ id: 'm3' }], nextPageToken: undefined });

        const summary = await runBackfill();

        expect(mockIngestMessage).toHaveBeenCalledTimes(3);
        expect(summary.seen).toBe(3);
        expect(summary.ingested).toBe(3);
    });

    test('a failure on one message does not stop the walk, and is counted', async () => {
        mockListMessages.mockResolvedValue({ messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: undefined });
        mockIngestMessage
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ status: 'ingested' });

        const summary = await runBackfill();

        expect(summary.failed).toBe(1);
        expect(summary.ingested).toBe(1);
        // Reaching the baseline write is what matters most here: one bad message in a
        // backfill run must not abandon the cursor re-baseline the whole run exists for.
        expect(mockUpdateOne).toHaveBeenCalled();
    });

    test('reads the profile historyId BEFORE walking, not after', async () => {
        // Taken afterwards, it would sit past anything that arrived while the backfill
        // ran, re-creating in the recovery path the exact gap the recovery closes.
        const order = [];
        mockGetProfile.mockImplementation(async () => { order.push('profile'); return { historyId: '9999' }; });
        mockListMessages.mockImplementation(async () => { order.push('list'); return { messages: [], nextPageToken: undefined }; });

        await runBackfill();

        expect(order[0]).toBe('profile');
    });

    test('stops once the message cap is reached', async () => {
        mockListMessages.mockResolvedValue({
            messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` })),
            nextPageToken: undefined,
        });

        const summary = await runBackfill({ limit: 3 });

        expect(mockIngestMessage).toHaveBeenCalledTimes(3);
        expect(summary.seen).toBe(3);
    });
});
