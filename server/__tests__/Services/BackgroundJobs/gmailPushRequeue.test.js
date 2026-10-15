/**
 * The push-queue worker: taking the sync lock, and what happens when it is already held.
 *
 * WHY THIS EXISTS
 * The worker used to answer a held lock with `{ skipped: 'sync-already-running' }` and
 * drop the job outright, on the theory that "whichever sync holds it walks history to the
 * present and will pick up the same message." That is only true if the message entered
 * Gmail's history BEFORE the running sync called history.list. A notification arriving
 * seconds after that fetch announces a message the running sync will never see, the job
 * still completes successfully, and nothing retries it — the reply then waits for the
 * next poll, up to GMAIL_POLL_MINUTES. That gap is a real contributor to "replies arrive
 * late," and this suite is what pins the fix: re-enqueue with a growing delay instead.
 */

const mockFindOneAndUpdate = jest.fn();
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();
jest.mock('../../../models/system/OrchestrationCronLockModel.js', () => ({
    findOneAndUpdate: (...a) => mockFindOneAndUpdate(...a),
    findOne: (...a) => mockFindOne(...a),
    updateOne: (...a) => mockUpdateOne(...a),
}));

const mockRunSync = jest.fn();
jest.mock('../../../Services/Gmail/GmailIngestService.js', () => ({
    runSync: (...a) => mockRunSync(...a),
}));

const mockEnqueueGmailSync = jest.fn();
jest.mock('../../../Services/BackgroundJobs/gmailInboxQueue.js', () => ({
    enqueueGmailSync: (...a) => mockEnqueueGmailSync(...a),
    GMAIL_INBOX_QUEUE_NAME: 'gmail-inbox-sync',
    queueConfig: { connection: {} },
}));

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const standalone = require('../../../Services/BackgroundJobs/gmailInboxStandalone.js');
const { processGmailSyncJob, requeueBlockedSync, MAX_SYNC_REQUEUES } = standalone;

const job = (data = {}) => ({ id: 'job-1', data });

/** The lock is "held" when the holder check comes back as someone else. */
const lockFree = () => {
    mockFindOneAndUpdate.mockResolvedValue({});
    mockFindOne.mockReturnValue({ lean: async () => ({ holder: expect.any(String) }) });
};

beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateOne.mockResolvedValue({});
    mockRunSync.mockResolvedValue({ ingested: 1 });
    mockEnqueueGmailSync.mockResolvedValue({ id: 'new-job' });
});

describe('the lock is free', () => {
    test('runs the sync and releases the lock', async () => {
        mockFindOneAndUpdate.mockResolvedValue({});
        // acquireLock re-reads to verify it actually won the upsert — make the holder match.
        let capturedHolder;
        mockFindOneAndUpdate.mockImplementation(async (_q, update) => { capturedHolder = update.$set.holder; return {}; });
        mockFindOne.mockReturnValue({ lean: async () => ({ holder: capturedHolder }) });

        const result = await processGmailSyncJob(job({ reason: 'push' }));

        expect(mockRunSync).toHaveBeenCalledWith({ reason: 'push' });
        expect(result).toEqual({ ingested: 1 });
        expect(mockUpdateOne).toHaveBeenCalled(); // releaseLock
        expect(mockEnqueueGmailSync).not.toHaveBeenCalled();
    });

    test('defaults the reason to push when the job carries none', async () => {
        mockFindOneAndUpdate.mockImplementation(async (_q, update) => { mockFindOne.mockReturnValue({ lean: async () => ({ holder: update.$set.holder }) }); return {}; });

        await processGmailSyncJob(job({}));

        expect(mockRunSync).toHaveBeenCalledWith({ reason: 'push' });
    });

    test('releases the lock even when runSync throws', async () => {
        mockFindOneAndUpdate.mockImplementation(async (_q, update) => { mockFindOne.mockReturnValue({ lean: async () => ({ holder: update.$set.holder }) }); return {}; });
        mockRunSync.mockRejectedValue(new Error('boom'));

        await expect(processGmailSyncJob(job({}))).rejects.toThrow('boom');
        expect(mockUpdateOne).toHaveBeenCalled();
    });
});

describe('the lock is already held', () => {
    beforeEach(() => {
        // Someone else's holder wins the race, so acquireLock reports false.
        mockFindOneAndUpdate.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    });

    test('does not run the sync, and does not throw', async () => {
        const result = await processGmailSyncJob(job({ reason: 'push' }));

        expect(mockRunSync).not.toHaveBeenCalled();
        expect(result.skipped).toBe('sync-already-running');
    });

    test('re-enqueues a fresh job rather than dropping the notification', async () => {
        const result = await processGmailSyncJob(job({ reason: 'push', announcedHistoryId: '12345' }));

        expect(mockEnqueueGmailSync).toHaveBeenCalledTimes(1);
        const [call] = mockEnqueueGmailSync.mock.calls[0];
        expect(call.reason).toBe('push');
        expect(call.historyId).toBe('12345');
        expect(call.requeueCount).toBe(1);
        expect(result.requeued).toBe(true);
    });

    test('the delay grows on each successive requeue: 15s, 30s, 60s', async () => {
        await requeueBlockedSync(job({ requeueCount: 0 }));
        expect(mockEnqueueGmailSync.mock.calls[0][0].delayMs).toBe(15000);

        await requeueBlockedSync(job({ requeueCount: 1 }));
        expect(mockEnqueueGmailSync.mock.calls[1][0].delayMs).toBe(30000);

        await requeueBlockedSync(job({ requeueCount: 2 }));
        expect(mockEnqueueGmailSync.mock.calls[2][0].delayMs).toBe(60000);
    });

    test('gives up after the cap, leaving the poll as the only backstop', async () => {
        const result = await requeueBlockedSync(job({ requeueCount: MAX_SYNC_REQUEUES }));

        expect(mockEnqueueGmailSync).not.toHaveBeenCalled();
        expect(result).toEqual({ skipped: 'sync-already-running', requeued: false });
    });

    test('a queue failure (e.g. Redis down) is swallowed, not thrown', async () => {
        // Retrying cannot fix an outage; the poll is what actually covers this case.
        mockEnqueueGmailSync.mockRejectedValue(new Error('ECONNREFUSED'));

        const result = await requeueBlockedSync(job({ requeueCount: 0 }));

        expect(result).toEqual({ skipped: 'sync-already-running', requeued: false });
    });

    test('never spends a BullMQ retry attempt — the job resolves, it never rejects', async () => {
        // This is the point of re-enqueueing instead of throwing: attempts:3 on the
        // ORIGINAL job must stay available for a genuine failure, not a benign lock
        // contention.
        await expect(processGmailSyncJob(job({ reason: 'push' }))).resolves.not.toThrow();
    });
});

describe('the no-fixed-jobId rule still holds through a requeue', () => {
    test('enqueueGmailSync is called with no jobId option', async () => {
        mockFindOneAndUpdate.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));

        await requeueBlockedSync(job({ requeueCount: 0 }));

        const [call] = mockEnqueueGmailSync.mock.calls[0];
        expect(call).not.toHaveProperty('jobId');
    });
});
