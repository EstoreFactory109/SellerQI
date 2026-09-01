/**
 * Ending a run that BullMQ has permanently given up on.
 *
 * THE BUG THIS CLOSES
 * worker.js's `failed` handler used to close only the user's LOGGING SESSION — the frontend
 * spinner — and stop there. The run itself was left for dead: the phase's JobStatus row stayed at
 * `running` forever (nothing else ever writes it), no next phase was enqueued, so `sched_finalize`
 * never ran and the DataFetchTracking doc sat at `started` until the 9h stalled sweep, ~12-13h
 * worst case. The old comment even acknowledged "the pipeline never reaches sched_finalize" and
 * then fixed only the UI.
 *
 * That is the "stalled at calc_review" symptom. calc_review is not special — it has a 26h budget,
 * so it is usually the phase in flight when a worker goes away. Confirmed in production
 * 2026-09-01: PM2 restarted a worker for exceeding max_memory_restart (2.16GB > 2GB) 56 seconds
 * after it picked up calc_review, and that row read `running` for the next nine hours.
 *
 * The recovery is deliberately CAUSE-AGNOSTIC — memory restarts are only today's reason a worker
 * vanishes; deploys, OOM kills and crashes all land here too.
 */

const mockUpdateJobStatus = jest.fn();
const mockFailTracking = jest.fn();
const mockAdd = jest.fn();
const mockGetJob = jest.fn();

jest.mock('../../../Services/BackgroundJobs/queue.js', () => ({
    getQueue: () => ({
        add: (...a) => mockAdd(...a),
        getJob: (...a) => mockGetJob(...a),
    }),
}));
jest.mock('../../../utils/Logger.js', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../Services/system/DataFetchTrackingService.js', () => ({
    failTracking: (...a) => mockFailTracking(...a),
}));

const { closeOutAbandonedRun } = require('../../../Services/BackgroundJobs/abandonedRunRecovery.js');

const DEPS = { updateJobStatus: mockUpdateJobStatus, workerName: 'worker-test' };
const PARENT = 'scheduled-u1-US-NA';

/** A permanently-failed scheduled phase job, as BullMQ hands it to the `failed` event. */
function failedJob(phase, { attemptsMade = 3, attempts = 3, trackingEntryId = 'doc-1' } = {}) {
    return {
        id: `${PARENT}-${phase}`,
        attemptsMade,
        opts: { attempts },
        data: { userId: 'u1', country: 'US', region: 'NA', phase, parentJobId: PARENT,
                phaseData: { trackingEntryId, sessionId: 's1' } },
    };
}

beforeEach(() => {
    mockUpdateJobStatus.mockReset().mockResolvedValue(undefined);
    mockFailTracking.mockReset().mockResolvedValue(undefined);
    mockAdd.mockReset().mockResolvedValue({ id: 'added' });
    mockGetJob.mockReset().mockResolvedValue(null);
});

describe('an abandoned mid-chain phase lets the run finish', () => {
    // THE REGRESSION TEST. This is the production case, verbatim.
    test('calc_review abandoned by a worker restart advances to sched_finalize', async () => {
        const result = await closeOutAbandonedRun(
            failedJob('sched_calc_review'), new Error('job stalled more than allowable limit'), DEPS);

        expect(result).toMatchObject({ acted: true, advancedTo: 'sched_finalize' });
        expect(mockAdd).toHaveBeenCalledTimes(1);
        expect(mockAdd.mock.calls[0][2].jobId).toBe(`${PARENT}-sched_finalize`);
    });

    // Without this the row reads `running` forever, which is the entire reported symptom.
    test('the phase row is moved off "running" to failed', async () => {
        await closeOutAbandonedRun(failedJob('sched_calc_review'), new Error('boom'), DEPS);

        expect(mockUpdateJobStatus).toHaveBeenCalledWith(
            `${PARENT}-sched_calc_review`, 'u1', 'failed',
            expect.objectContaining({ metadata: expect.objectContaining({ abandoned: true }) })
        );
    });

    test('the failure is carried forward so finalize records it, not a silent success', async () => {
        await closeOutAbandonedRun(failedJob('sched_finance'), new Error('worker went away'), DEPS);

        const nextData = mockAdd.mock.calls[0][1];
        expect(nextData.phase).toBe('sched_batch_4');
        expect(nextData.phaseData.trackingEntryId).toBe('doc-1');   // the doc finalize must close
    });

    // The id-collision lesson: a completed job from the previous run owns the id for 2h and BullMQ
    // would silently drop the add.
    test('a stale holder of the next-phase id is cleared before adding', async () => {
        const remove = jest.fn().mockResolvedValue(undefined);
        mockGetJob.mockResolvedValue({ getState: async () => 'completed', remove });

        await closeOutAbandonedRun(failedJob('sched_calc_review'), new Error('x'), DEPS);

        expect(remove).toHaveBeenCalled();
        expect(mockAdd).toHaveBeenCalled();
    });

    test('an ACTIVE holder is never removed — that is live work', async () => {
        const remove = jest.fn();
        mockGetJob.mockResolvedValue({ getState: async () => 'active', remove });

        await closeOutAbandonedRun(failedJob('sched_calc_review'), new Error('x'), DEPS);

        expect(remove).not.toHaveBeenCalled();
    });
});

describe('the end of the chain closes the doc directly', () => {
    // finalize is the only phase that closes the doc, so if IT is abandoned there is nothing
    // downstream to do it.
    test('an abandoned sched_finalize fails the tracking doc instead of advancing', async () => {
        const result = await closeOutAbandonedRun(failedJob('sched_finalize'), new Error('died'), DEPS);

        expect(mockAdd).not.toHaveBeenCalled();
        expect(mockFailTracking).toHaveBeenCalledWith('doc-1', expect.stringMatching(/abandoned at sched_finalize/));
        expect(result).toMatchObject({ acted: true, closedTracking: 'doc-1' });
    });

    // `null`, not `undefined`: a destructuring default replaces undefined, so passing undefined
    // would silently hand the job a tracking id and test the opposite of what it claims.
    test('a one-shot catch-up with no tracking doc is a no-op, not a crash', async () => {
        const job = failedJob('sched_ads_catchup', { trackingEntryId: null });

        const result = await closeOutAbandonedRun(job, new Error('x'), DEPS);

        expect(mockAdd).not.toHaveBeenCalled();
        expect(mockFailTracking).not.toHaveBeenCalled();
        expect(result.acted).toBe(true);
    });
});

describe('it must not fire while BullMQ still intends to retry', () => {
    // THE DANGEROUS DIRECTION. Advancing while a retry is still coming would put two phases of the
    // same run in flight at once.
    test('attempts remaining => do nothing at all', async () => {
        const result = await closeOutAbandonedRun(
            failedJob('sched_calc_review', { attemptsMade: 1, attempts: 3 }), new Error('x'), DEPS);

        expect(result.acted).toBe(false);
        expect(mockAdd).not.toHaveBeenCalled();
        expect(mockUpdateJobStatus).not.toHaveBeenCalled();
    });

    test('a non-pipeline job (no phase/parentJobId) is ignored', async () => {
        const result = await closeOutAbandonedRun(
            { id: 'x', attemptsMade: 3, opts: { attempts: 3 }, data: { userId: 'u1' } },
            new Error('x'), DEPS);

        expect(result.acted).toBe(false);
        expect(mockAdd).not.toHaveBeenCalled();
    });
});

describe('recovery never throws out of the failed handler', () => {
    // It runs inside an event handler; throwing here would surface as an unhandled rejection,
    // which is precisely what used to kill these workers.
    test('a queue error is swallowed and reported, not thrown', async () => {
        mockAdd.mockRejectedValue(new Error('redis down'));

        await expect(closeOutAbandonedRun(failedJob('sched_calc_review'), new Error('x'), DEPS))
            .resolves.toMatchObject({ acted: false });
    });
});
