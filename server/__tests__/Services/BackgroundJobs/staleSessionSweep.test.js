/**
 * Tests for the liveness guard on the orphaned-logging-session sweep.
 *
 * WHY THIS EXISTS
 * `sweepStaleSessions` closed ANY session older than a flat STALE_SESSION_MAX_AGE_HOURS (6) with no
 * liveness check whatsoever. In production it force-closed two sessions for account
 * 6a57b823571ceb9266953c30 at ages 7.98h and 8.91h — at that exact moment sched_calc_review was
 * running with a heartbeat 5 minutes old, and the run went on to complete and reach finalize.
 * The customer saw "partial, 86%" for a run that was healthy and still going.
 *
 * This is the SAME bug class already fixed twice elsewhere: age cannot distinguish "running for 9h"
 * from "died 9h ago". producer.js hit it (removing live jobs at 8h while calc_review is granted a
 * 26h ceiling) and sweepStalledPipelines was written with a liveness guard from the start. This
 * sweep simply never got one.
 *
 * WHY NOT JUST RAISE THE AGE
 * worker.js documents calc_review reaching 23.8h with a 26h ceiling, so an honest flat threshold
 * would be ~27h — which would stop the sweep doing the job it exists for. Measured over 14 days of
 * production: only 3 of 3,642 naturally-closed sessions exceeded 6h. The age is right for almost
 * everything; liveness is what the handful of whale accounts need.
 *
 * WHAT MUST NOT REGRESS
 *   - fails SAFE: no heartbeat, or a broken liveness query, still closes the session
 *   - the CAS re-assert (sessionStatus:'in_progress' in the update filter)
 *   - the aggregation-pipeline update ($$NOW + per-doc $subtract)
 *   - the jobId is built COUNTRY-then-REGION, while sessionId is region-then-country
 */

const mockSessionFind = jest.fn();
const mockSessionUpdateMany = jest.fn();
const mockSessionCount = jest.fn();
jest.mock('../../../models/system/ErrorLogs.js', () => ({
    find: (...a) => mockSessionFind(...a),
    updateMany: (...a) => mockSessionUpdateMany(...a),
    countDocuments: (...a) => mockSessionCount(...a),
}));

const mockJobStatusFindOne = jest.fn();
jest.mock('../../../models/system/JobStatusModel.js', () => ({
    findOne: (...a) => mockJobStatusFindOne(...a),
}));

// Required at module load by freshnessSweeper; stubbed so no real mongoose is pulled in.
jest.mock('../../../models/system/DataFetchTrackingModel.js', () => ({
    aggregate: jest.fn(), findOne: jest.fn(), updateMany: jest.fn(),
}));
jest.mock('../../../models/user-auth/userModel.js', () => ({ find: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock('../../../models/amazon-ads/PPCMetricsModel.js', () => ({}));
jest.mock('../../../models/finance/FinanceSyncLogModel.js', () => ({}));
jest.mock('../../../models/finance/DailySkuFinanceModel.js', () => ({}));
jest.mock('../../../Services/BackgroundJobs/UserSchedulingService.js', () => ({
    UserSchedulingService: { shouldAttemptAccountUpdate: jest.fn() },
}));
jest.mock('../../../Services/BackgroundJobs/producer.js', () => ({ enqueueScheduledAccountJob: jest.fn() }));
jest.mock('../../../Services/BackgroundJobs/queue.js', () => ({ getQueue: () => ({ getJob: jest.fn() }) }));

const { sweepStaleSessions } = require('../../../Services/BackgroundJobs/freshnessSweeper.js');

const USER = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439022';
const HOURS = (h) => new Date(Date.now() - h * 60 * 60 * 1000);

/** One stale session row, as the batch query returns it. */
const session = (over = {}) => ({
    _id: 'sess1', userId: USER, country: 'US', region: 'NA', sessionStartTime: HOURS(8), ...over,
});

/** Chainable stub for `.sort().limit().select().lean()`. */
const batchChain = (rows) => ({
    sort: () => ({ limit: () => ({ select: () => ({ lean: async () => rows }) }) }),
});
/** Chainable stub for `.select().lean()`. */
const liveChain = (value) => ({ select: () => ({ lean: async () => value }) });

beforeEach(() => {
    jest.clearAllMocks();
    mockSessionFind.mockReturnValue(batchChain([session()]));
    mockSessionUpdateMany.mockResolvedValue({ modifiedCount: 1 });
    mockSessionCount.mockResolvedValue(0);
    mockJobStatusFindOne.mockReturnValue(liveChain(null)); // default: nothing alive -> close
});

describe('sweepStaleSessions — liveness', () => {
    // THE regression test. Against the pre-fix code this fails: the session is closed on age alone.
    test('a session whose pipeline is still active is NOT closed', async () => {
        mockJobStatusFindOne.mockReturnValue(liveChain({ _id: 'alive' }));

        const res = await sweepStaleSessions();

        expect(mockSessionUpdateMany).not.toHaveBeenCalled();
        expect(res).toMatchObject({ enabled: true, closed: 0, skippedLive: 1 });
    });

    test('a session with no recent pipeline activity IS closed', async () => {
        const res = await sweepStaleSessions();

        expect(mockSessionUpdateMany).toHaveBeenCalledTimes(1);
        expect(res).toMatchObject({ enabled: true, closed: 1, skippedLive: 0 });
    });

    test('mixed batch: the dead account is closed, the live one is spared', async () => {
        mockSessionFind.mockReturnValue(batchChain([
            session({ _id: 'live1', userId: USER }),
            session({ _id: 'live2', userId: USER }),
            session({ _id: 'dead1', userId: OTHER }),
        ]));
        // First account queried is alive, second is not.
        mockJobStatusFindOne
            .mockReturnValueOnce(liveChain({ _id: 'alive' }))
            .mockReturnValue(liveChain(null));

        const res = await sweepStaleSessions();

        expect(res).toMatchObject({ closed: 1, skippedLive: 2 });
        // Only the dead account's ids reach the update.
        expect(mockSessionUpdateMany).toHaveBeenCalledTimes(1);
        expect(mockSessionUpdateMany.mock.calls[0][0]._id).toEqual({ $in: ['dead1'] });
    });

    test('one liveness query per ACCOUNT, not per session', async () => {
        // 2000 findOne calls in a 384MB-heap process would be its own regression.
        mockSessionFind.mockReturnValue(batchChain([
            session({ _id: 'a' }), session({ _id: 'b' }), session({ _id: 'c' }),
        ]));

        await sweepStaleSessions();

        expect(mockJobStatusFindOne).toHaveBeenCalledTimes(1);
    });

    test('the liveness jobId is COUNTRY-then-REGION — the opposite order to sessionId', async () => {
        // sessionId is `userId_REGION_COUNTRY_ts`; jobId is `scheduled-userId-COUNTRY-REGION-phase`.
        // Getting this backwards would silently match nothing and close every live session.
        await sweepStaleSessions();

        const q = mockJobStatusFindOne.mock.calls[0][0];
        expect(q.jobId.$regex).toBe(`^scheduled-${USER}-US-NA`);
        expect(q.updatedAt.$gt).toBeInstanceOf(Date);
    });

    test('fails SAFE — a throwing liveness query still closes the session', async () => {
        mockJobStatusFindOne.mockImplementation(() => { throw new Error('mongo down'); });

        const res = await sweepStaleSessions();

        expect(mockSessionUpdateMany).toHaveBeenCalledTimes(1);
        expect(res).toMatchObject({ closed: 1, skippedLive: 0 });
    });
});

describe('sweepStaleSessions — behaviour that must not regress', () => {
    test('the update re-asserts sessionStatus:in_progress (the CAS guard)', async () => {
        // Stops a session that legitimately finalizes between the read and the write being clobbered.
        await sweepStaleSessions();

        expect(mockSessionUpdateMany.mock.calls[0][0].sessionStatus).toBe('in_progress');
    });

    test('the update is still an aggregation pipeline with $$NOW and a per-doc duration', async () => {
        // A plain $set cannot compute sessionDuration from each document's own sessionStartTime.
        await sweepStaleSessions();

        const update = mockSessionUpdateMany.mock.calls[0][1];
        expect(Array.isArray(update)).toBe(true);
        const set = update[0].$set;
        expect(set.sessionStatus).toBe('partial');
        expect(set.sessionEndTime).toBe('$$NOW');
        expect(set.autoClosedStale).toBe(true);
        expect(set.autoClosedAt).toBe('$$NOW');
        expect(set.sessionDuration).toEqual({ $subtract: ['$$NOW', '$sessionStartTime'] });
    });

    test('the batch query still selects only aged, unfinished, in-progress sessions', async () => {
        await sweepStaleSessions();

        const q = mockSessionFind.mock.calls[0][0];
        expect(q.sessionStatus).toBe('in_progress');
        expect(q.sessionStartTime.$lt).toBeInstanceOf(Date);
        expect(q.$or).toEqual([{ sessionEndTime: null }, { sessionEndTime: { $exists: false } }]);
    });

    test('remaining is net of the sessions deliberately spared', async () => {
        // Otherwise a healthy sweep reports a permanent backlog in the standalone runner's log.
        mockJobStatusFindOne.mockReturnValue(liveChain({ _id: 'alive' }));
        mockSessionCount.mockResolvedValue(5);

        const res = await sweepStaleSessions();

        expect(res.skippedLive).toBe(1);
        expect(res.remaining).toBe(4);
    });

    test('remaining never goes negative', async () => {
        mockJobStatusFindOne.mockReturnValue(liveChain({ _id: 'alive' }));
        mockSessionCount.mockResolvedValue(0);

        expect((await sweepStaleSessions()).remaining).toBe(0);
    });

    test('an empty batch is a clean no-op', async () => {
        mockSessionFind.mockReturnValue(batchChain([]));

        const res = await sweepStaleSessions();

        expect(mockJobStatusFindOne).not.toHaveBeenCalled();
        expect(mockSessionUpdateMany).not.toHaveBeenCalled();
        expect(res).toMatchObject({ enabled: true, closed: 0, skippedLive: 0, remaining: 0 });
    });

    test('the kill switch still short-circuits everything', async () => {
        // Read at module load, so the registry must be reset for the env var to take effect.
        const prev = process.env.STALE_SESSION_SWEEP_DISABLED;
        process.env.STALE_SESSION_SWEEP_DISABLED = 'true';
        jest.resetModules();
        try {
            const { sweepStaleSessions: fresh } = require('../../../Services/BackgroundJobs/freshnessSweeper.js');
            const res = await fresh();

            expect(res).toMatchObject({ enabled: false, closed: 0 });
            expect(mockSessionFind).not.toHaveBeenCalled();
        } finally {
            if (prev === undefined) delete process.env.STALE_SESSION_SWEEP_DISABLED;
            else process.env.STALE_SESSION_SWEEP_DISABLED = prev;
            jest.resetModules();
        }
    });
});
