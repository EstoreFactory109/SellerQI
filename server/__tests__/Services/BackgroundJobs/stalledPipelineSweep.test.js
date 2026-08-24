/**
 * Tests for sweepStalledPipelines — the backstop that re-drives a daily pipeline whose
 * phase chain stopped before finalize.
 *
 * WHY THIS EXISTS
 * A chain that stops before `sched_finalize` leaves its DataFetchTracking doc pinned at
 * 'started'. Every reader of that collection selects status:{$in:['completed','partial']},
 * so the dashboard's date range silently stops advancing — while the per-day ads/finance
 * sweeps keep the underlying data current and every health check stays green. Production
 * 2026-08-06: two days of "data only up to Aug 3" with nothing else looking wrong.
 *
 * THE ORDERING IS THE DESIGN, AND IT IS WHAT THESE TESTS MOSTLY PIN
 * The stuck doc is closed ONLY after a verified enqueue, which makes closing it the dedup
 * mechanism with no extra state. Close-first would permanently lose the signal whenever
 * the enqueue was blocked — recreating the exact silent freeze this exists to end. Two
 * tests below (blocked, and success-but-unverified) fail against a close-first
 * implementation and are the reason to keep them.
 */

const mockAggregate = jest.fn();
const mockFindOne = jest.fn();
const mockUpdateMany = jest.fn();
jest.mock('../../../models/system/DataFetchTrackingModel.js', () => ({
    aggregate: (...a) => mockAggregate(...a),
    findOne: (...a) => mockFindOne(...a),
    updateMany: (...a) => mockUpdateMany(...a),
}));

const mockJobStatusFindOne = jest.fn();
jest.mock('../../../models/system/JobStatusModel.js', () => ({
    findOne: (...a) => mockJobStatusFindOne(...a),
}));

const mockUserFind = jest.fn();
jest.mock('../../../models/user-auth/userModel.js', () => ({ find: (...a) => mockUserFind(...a) }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock('../../../models/amazon-ads/PPCMetricsModel.js', () => ({}));
jest.mock('../../../models/finance/FinanceSyncLogModel.js', () => ({}));
jest.mock('../../../models/finance/DailySkuFinanceModel.js', () => ({}));

const mockShouldAttempt = jest.fn();
jest.mock('../../../Services/BackgroundJobs/UserSchedulingService.js', () => ({
    UserSchedulingService: { shouldAttemptAccountUpdate: (...a) => mockShouldAttempt(...a) },
}));

const mockEnqueue = jest.fn();
jest.mock('../../../Services/BackgroundJobs/producer.js', () => ({
    enqueueScheduledAccountJob: (...a) => mockEnqueue(...a),
}));

const mockGetJob = jest.fn();
jest.mock('../../../Services/BackgroundJobs/queue.js', () => ({
    getQueue: () => ({ getJob: (...a) => mockGetJob(...a) }),
}));

const { sweepStalledPipelines } = require('../../../Services/BackgroundJobs/freshnessSweeper.js');

const USER = '507f1f77bcf86cd799439011';
const HOURS = (h) => new Date(Date.now() - h * 60 * 60 * 1000);

/** One grouped aggregate row, as the sweep's $group produces it. */
const candidate = (overrides = {}) => ({
    _id: { User: USER, country: 'US', region: 'NA' },
    newest: HOURS(12),
    ids: ['doc1'],
    ...overrides,
});

/** A chainable stub for `.select(...).lean()`. */
const chain = (value) => ({ select: () => ({ lean: async () => value }) });

beforeEach(() => {
    jest.clearAllMocks();
    mockAggregate.mockResolvedValue([candidate()]);
    mockFindOne.mockReturnValue(chain(null));              // no newer completed/partial doc
    mockUpdateMany.mockResolvedValue({ modifiedCount: 1 });
    mockJobStatusFindOne.mockReturnValue(chain(null));     // nothing recently alive
    mockUserFind.mockReturnValue({ lean: async () => [{ _id: USER }] });
    mockShouldAttempt.mockResolvedValue({ eligible: true });
    mockEnqueue.mockResolvedValue({ success: true, jobId: 'j1' });
    mockGetJob.mockResolvedValue({ timestamp: Date.now() });
});

describe('detection', () => {
    test('a genuinely frozen, active, eligible account is re-driven and its doc closed', async () => {
        const res = await sweepStalledPipelines();

        expect(mockEnqueue).toHaveBeenCalledWith(USER, 'US', 'NA');
        expect(res).toMatchObject({ frozen: 1, recovered: 1, blocked: 0 });
        expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    });

    test('a newer completed doc means it already recovered — nothing is touched', async () => {
        mockFindOne.mockReturnValue(chain({ _id: 'newer' }));

        const res = await sweepStalledPipelines();

        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(mockUpdateMany).not.toHaveBeenCalled();
        expect(res.frozen).toBe(0);
    });

    test('an inactive/churned account is skipped', async () => {
        // There are a dozen ancient 'started' docs from closed accounts. Re-running those
        // forever would burn SP-API quota for customers who left.
        mockUserFind.mockReturnValue({ lean: async () => [{ _id: 'someone-else' }] });

        const res = await sweepStalledPipelines();

        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(res).toMatchObject({ frozen: 0, skippedInactive: 1 });
    });

    test('getActiveUserIdSet returning null means SKIP, not process-everyone', async () => {
        // The sibling sweeps treat null as "no filter" so a query blip cannot stop them.
        // Here the same fail-safe would mean re-running every churned account, so this
        // sweep deliberately inverts it.
        mockUserFind.mockReturnValue({ lean: async () => [] });

        const res = await sweepStalledPipelines();

        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(res.skippedInactive).toBe(1);
    });
});

describe('guards', () => {
    test.each([
        ['done', 'skippedDone'],
        ['capped', 'skippedCapped'],
    ])('shouldAttemptAccountUpdate "%s" blocks the re-drive', async (reason, counter) => {
        mockShouldAttempt.mockResolvedValue({ eligible: false, reason });

        const res = await sweepStalledPipelines();

        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(res[counter]).toBe(1);
    });

    test('recent JobStatus activity means a run is still walking — do not duplicate it', async () => {
        // The regression that matters most: getAllPhaseJobIds does not enumerate the
        // `-pollN` ids the ads/finance phases reschedule under, so producer.js's own dedup
        // is blind to a live poll chain. A healthy ads phase alone runs 40-50 min.
        mockJobStatusFindOne.mockReturnValue(chain({ _id: 'alive' }));

        const res = await sweepStalledPipelines();

        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(res).toMatchObject({ frozen: 1, skippedLive: 1, recovered: 0 });
    });

    test('the per-tick cap bounds how many full re-fetches one tick can start', async () => {
        const many = Array.from({ length: 9 }, (_, i) => candidate({
            _id: { User: USER, country: 'US', region: `R${i}` }, ids: [`d${i}`],
        }));
        mockAggregate.mockResolvedValue(many);

        const res = await sweepStalledPipelines();

        expect(res.recovered).toBe(5);            // PIPELINE_STALL_MAX_RECOVERIES_PER_TICK
        expect(res.cappedByTick).toBe(true);      // and it is reported, never silent
        expect(mockEnqueue).toHaveBeenCalledTimes(5);
    });
});

describe('close-only-after-verified-enqueue (the dedup mechanism)', () => {
    test('a BLOCKED enqueue leaves the doc open so the next tick retries', async () => {
        // Expected while the orphaned phase job is still inside producer.js's 8h window.
        // Closing here would lose the signal permanently — the account would look handled
        // and stay frozen forever.
        mockEnqueue.mockResolvedValue({ success: false, message: 'already in progress', state: 'active' });

        const res = await sweepStalledPipelines();

        expect(mockUpdateMany).not.toHaveBeenCalled();
        expect(res).toMatchObject({ blocked: 1, recovered: 0 });
    });

    test('success:true but NO fresh job queued is treated as blocked, not recovered', async () => {
        // producer.js swallows a failed job.remove() and then queue.add()s the same id;
        // BullMQ returns the PRE-EXISTING job and the producer still reports success.
        // Trusting the return value alone would close the doc over a no-op.
        mockGetJob.mockResolvedValue(null);

        const res = await sweepStalledPipelines();

        expect(mockUpdateMany).not.toHaveBeenCalled();
        expect(res).toMatchObject({ blocked: 1, recovered: 0 });
    });

    test('the close is CAS-guarded on status:started and never writes partial', async () => {
        await sweepStalledPipelines();

        const [filter, update] = mockUpdateMany.mock.calls[0];
        // Re-asserting 'started' stops a run that legitimately finalizes between our read
        // and this write from being clobbered.
        expect(filter.status).toBe('started');
        expect(filter._id).toEqual({ $in: ['doc1'] });
        // 'partial' is readable by all ten consumers and would promote a half-fetched
        // dataRange to the head of the calendar query. 'failed' stays correctly invisible.
        expect(update.$set.status).toBe('failed');
        expect(update.$set.status).not.toBe('partial');
        expect(update.$set.autoClosedStale).toBe(true);
    });
});

describe('resilience', () => {
    test('the kill switch short-circuits everything', async () => {
        const prev = process.env.PIPELINE_STALL_SWEEP_DISABLED;
        process.env.PIPELINE_STALL_SWEEP_DISABLED = 'true';
        jest.resetModules();
        const { sweepStalledPipelines: fresh } = require('../../../Services/BackgroundJobs/freshnessSweeper.js');

        const res = await fresh();

        expect(res.enabled).toBe(false);
        expect(mockAggregate).not.toHaveBeenCalled();
        if (prev === undefined) delete process.env.PIPELINE_STALL_SWEEP_DISABLED;
        else process.env.PIPELINE_STALL_SWEEP_DISABLED = prev;
    });

    test('one account throwing does not abort the rest of the sweep', async () => {
        mockAggregate.mockResolvedValue([
            candidate({ _id: { User: USER, country: 'US', region: 'NA' }, ids: ['a'] }),
            candidate({ _id: { User: USER, country: 'UK', region: 'EU' }, ids: ['b'] }),
        ]);
        mockShouldAttempt
            .mockRejectedValueOnce(new Error('mongo blip'))
            .mockResolvedValue({ eligible: true });

        const res = await sweepStalledPipelines();

        expect(res.errors).toBe(1);
        expect(res.recovered).toBe(1);   // the second account still got its re-drive
    });

    test('no candidates at all is a cheap no-op', async () => {
        mockAggregate.mockResolvedValue([]);

        const res = await sweepStalledPipelines();

        expect(res).toMatchObject({ scanned: 0, frozen: 0, recovered: 0 });
        expect(mockUserFind).not.toHaveBeenCalled();   // does not even build the active set
    });
});
