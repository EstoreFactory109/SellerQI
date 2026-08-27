/**
 * Tests for startTrackingForRun — exactly one OPEN DataFetchTracking doc per account.
 *
 * WHY THIS EXISTS
 * `createTrackingEntry` is a bare `new this({...}).save()`: no upsert, no dedup, and both compound
 * indexes on the collection are non-unique. Every execution of `sched_init` created another
 * `started` doc and walked away from the last one.
 *
 * That is not a rare path. worker.js runs BullMQ with `lockDuration: 20min` and
 * `maxStalledCount: 3`, so a worker death, a blocked event loop or a hit lock-extension ceiling
 * makes BullMQ re-run the SAME `sched_init` up to four times, ~20 minutes apart. Each execution
 * left another doc open, and ~9h later sweepStalledPipelines relabelled every one of them
 * `stalled-pipeline-autorecovered` — the number that gets read as "stuck at calc_review". Observed
 * verbatim on one production account: 06:01:02 / 06:21:06 / 06:41:11 / 07:01:17. BullMQ's retry
 * never goes through the producer, so no producer-side dedup can see any of it.
 *
 * The two properties that matter, and the two ways this can go wrong:
 *   - abandoned docs are CLOSED, so they cannot masquerade as stalls
 *   - docs belonging to ANOTHER pipeline are never touched. Five code paths write this collection,
 *     and the onboarding integration runs on a separate BullMQ queue the scheduled producer cannot
 *     see; closing its doc mid-run would make the two pipelines overwrite each other's outcome.
 */

const mockFind = jest.fn();
const mockUpdateMany = jest.fn();
const mockCreateTrackingEntry = jest.fn();
const mockFindById = jest.fn();

jest.mock('../../../models/system/DataFetchTrackingModel', () => ({
    find: (...args) => mockFind(...args),
    updateMany: (...args) => mockUpdateMany(...args),
    createTrackingEntry: (...args) => mockCreateTrackingEntry(...args),
    findById: (...args) => mockFindById(...args),
}));
jest.mock('../../../utils/Logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const {
    startTrackingForRun,
    completeTracking,
    failTracking,
    SCHEDULED_OWNER,
} = require('../../../Services/system/DataFetchTrackingService');

const RANGE = { startDate: '2026-07-28', endDate: '2026-08-26' };

/** `find(...).select(...).lean()` resolves to these. */
function whenOpenDocsAre(docs) {
    mockFind.mockReturnValue({ select: () => ({ lean: async () => docs }) });
}

beforeEach(() => {
    mockFind.mockReset();
    mockFindById.mockReset();
    mockUpdateMany.mockReset().mockResolvedValue({ modifiedCount: 0 });
    mockCreateTrackingEntry.mockReset().mockImplementation(async () => ({ _id: 'new-doc' }));
});

describe('a re-run closes what the last execution abandoned', () => {
    // THE REGRESSION TEST for the 20-minute duplicate series. The point is not that no new doc is
    // created — it is that the old one does not stay open pretending to be a stall.
    test('a BullMQ retry closes the previous doc and opens exactly one new one', async () => {
        whenOpenDocsAre([{ _id: 'doc-1' }]);

        const entry = await startTrackingForRun('u1', 'US', 'NA', RANGE, 'session-2');

        expect(entry._id).toBe('new-doc');
        expect(mockUpdateMany).toHaveBeenCalledWith(
            { _id: { $in: ['doc-1'] }, status: 'started' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'failed',
                    errorMessage: 'superseded-by-newer-run',
                    autoClosedStale: true,
                }),
            })
        );
    });

    // WHY NOT REUSE THE OPEN DOC. Nothing here can tell "BullMQ retried this job" from "the next
    // hourly run started over a dead one". Reusing in the second case would leave `fetchedAt`
    // pinned to the earlier, abandoned attempt — misreporting when the data was actually gathered,
    // which is the single question this collection exists to answer.
    test('the new doc is a fresh create, so fetchedAt reflects THIS attempt', async () => {
        whenOpenDocsAre([{ _id: 'doc-1' }]);

        await startTrackingForRun('u1', 'US', 'NA', RANGE, 'session-2');

        expect(mockCreateTrackingEntry).toHaveBeenCalledTimes(1);
        expect(mockCreateTrackingEntry).toHaveBeenCalledWith(
            'u1', 'US', 'NA', RANGE, 'session-2', SCHEDULED_OWNER
        );
    });

    test('several abandoned docs are all closed, not just the newest', async () => {
        whenOpenDocsAre([{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }]);

        await startTrackingForRun('u1', 'US', 'NA', RANGE, 's');

        expect(mockUpdateMany.mock.calls[0][0]._id.$in).toEqual(['a', 'b', 'c']);
    });

    // The status re-filter is a CAS guard: a doc that legitimately finalizes between the read and
    // this write must never be clobbered back to failed.
    test('the close re-filters on status:started', async () => {
        whenOpenDocsAre([{ _id: 'doc-1' }]);

        await startTrackingForRun('u1', 'US', 'NA', RANGE, 's');

        expect(mockUpdateMany.mock.calls[0][0]).toMatchObject({ status: 'started' });
    });
});

describe('other pipelines are never touched', () => {
    // THE DEFECT THIS GUARDS. Integration.executeInitPhase opens docs for the same
    // (User, country, region) from a SEPARATE queue that the scheduled producer's liveness check
    // cannot see. An unscoped close would mark a live onboarding run failed, and whichever
    // pipeline finished last would overwrite the other's outcome.
    test('the lookup is scoped to docs this pipeline opened', async () => {
        whenOpenDocsAre([]);

        await startTrackingForRun('u1', 'US', 'NA', RANGE, 's');

        expect(mockFind).toHaveBeenCalledWith({
            User: 'u1',
            country: 'US',
            region: 'NA',
            status: 'started',
            producedBy: SCHEDULED_OWNER,
        });
    });

    test('the new doc is stamped with the owner, so the next run can recognise it', async () => {
        whenOpenDocsAre([]);

        await startTrackingForRun('u1', 'US', 'NA', RANGE, 's');

        expect(mockCreateTrackingEntry.mock.calls[0][5]).toBe(SCHEDULED_OWNER);
    });
});

describe('no open docs', () => {
    test('creates one and writes nothing else', async () => {
        whenOpenDocsAre([]);

        const entry = await startTrackingForRun('u1', 'US', 'NA', RANGE, 's');

        expect(entry._id).toBe('new-doc');
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });
});

describe('closing a doc is compare-and-set, not a blind write', () => {
    // WHY. Two chains can race on one account: BullMQ's stalled-reclaim starts a second
    // `sched_init` while the first is still alive, and both then enqueue the SAME deterministic
    // phase ids, so only one chain's trackingEntryId survives into finalize. Without the guard,
    // the losing chain's finalize resurrects a doc already closed as `superseded-by-newer-run` —
    // leaving a `completed` row that still carries `autoClosedStale: true`, while the run that
    // superseded it stays `started` forever and gets re-driven 9h later as a phantom stall.
    //
    // These call the real markCompleted/markFailed, so the guard is exercised, not just asserted.
    const realModel = jest.requireActual('../../../models/system/DataFetchTrackingModel');

    function docFor(id, findOneAndUpdate) {
        return {
            _id: id,
            status: 'failed',
            errorMessage: 'superseded-by-newer-run',
            constructor: { findOneAndUpdate },
            markCompleted: realModel.schema.methods.markCompleted,
            markFailed: realModel.schema.methods.markFailed,
        };
    }

    test('completeTracking does not resurrect a doc someone else closed', async () => {
        const findOneAndUpdate = jest.fn().mockResolvedValue(null); // CAS lost
        mockFindById.mockResolvedValue(docFor('doc-1', findOneAndUpdate));

        await completeTracking('doc-1');

        expect(findOneAndUpdate).toHaveBeenCalledWith(
            { _id: 'doc-1', status: 'started' },
            { $set: { status: 'completed' } },
            { new: true }
        );
    });

    test('failTracking is guarded the same way', async () => {
        const findOneAndUpdate = jest.fn().mockResolvedValue(null);
        mockFindById.mockResolvedValue(docFor('doc-1', findOneAndUpdate));

        await failTracking('doc-1', 'boom');

        expect(findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: 'doc-1', status: 'started' });
    });

    test('a doc still open IS closed normally', async () => {
        const findOneAndUpdate = jest.fn().mockResolvedValue({ _id: 'doc-1', status: 'completed' });
        mockFindById.mockResolvedValue(docFor('doc-1', findOneAndUpdate));

        const result = await completeTracking('doc-1');

        expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
        expect(result).toBeTruthy();
    });
});

describe('cleanup failure never blocks a run', () => {
    // Leaving a stale doc open is a reporting problem. A pipeline that will not start is a
    // customer one, so both failures degrade to the old unconditional-create behaviour.
    test('a failing lookup still opens the run', async () => {
        mockFind.mockReturnValue({ select: () => ({ lean: async () => { throw new Error('mongo down'); } }) });

        const entry = await startTrackingForRun('u1', 'US', 'NA', RANGE, 's');

        expect(entry._id).toBe('new-doc');
        expect(mockCreateTrackingEntry).toHaveBeenCalledTimes(1);
    });

    test('a failing close still opens the run', async () => {
        whenOpenDocsAre([{ _id: 'doc-1' }]);
        mockUpdateMany.mockRejectedValue(new Error('write failed'));

        const entry = await startTrackingForRun('u1', 'US', 'NA', RANGE, 's');

        expect(entry._id).toBe('new-doc');
    });
});
