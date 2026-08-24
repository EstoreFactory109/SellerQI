/**
 * Liveness heartbeat, and the producer decision it exists to inform.
 *
 * THE BUG THIS CLOSES
 * producer.js removed ANY scheduled phase job older than MAX_SCHEDULED_JOB_AGE (8h) that was in
 * waiting/active/delayed — including one actively running. worker.js meanwhile grants
 * `sched_calc_review` a 26h lock-extension ceiling, because measured production data shows it
 * legitimately reaching 23.8h. Both shipped in the same commit, and on the largest accounts the
 * 8h side won: a healthy calc_review was deleted mid-flight, the chain restarted from
 * sched_init, and the account never reached finalize. One customer's dashboard was frozen for
 * five days.
 *
 * Age cannot distinguish "running for 9h" from "died 9h ago". JobStatus rows are written only at
 * phase start and end, so there was no signal to consult — which is also why freshnessSweeper's
 * liveness guard ("a phase legitimately mid-flight keeps its JobStatus row warm") was asserting
 * something untrue. runWithLockExtension now emits a heartbeat on its existing timer, and the
 * producer consults it.
 */

const { runWithLockExtension } = require('../../../Services/BackgroundJobs/lockExtension.js');

jest.mock('../../../utils/Logger.js', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

function makeJob(overrides = {}) {
    return {
        id: 'scheduled-user1-US-NA-sched_calc_review',
        data: { userId: 'user1', phase: 'sched_calc_review' },
        extendLock: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('runWithLockExtension — heartbeat', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

    test('fires on each tick while a long phase runs, so the row never goes cold', async () => {
        const job = makeJob();
        const onHeartbeat = jest.fn().mockResolvedValue(undefined);
        let release;
        const work = new Promise((resolve) => { release = resolve; });

        const promise = runWithLockExtension(job, () => work, {
            maxMs: 60_000, intervalMs: 1_000, amountMs: 5_000, onHeartbeat,
        });

        await jest.advanceTimersByTimeAsync(3_000);
        expect(onHeartbeat).toHaveBeenCalledTimes(3);

        release('done');
        await expect(promise).resolves.toBe('done');
    });

    test('stops as soon as the work finishes — no timer left beating for a dead job', async () => {
        const job = makeJob();
        const onHeartbeat = jest.fn().mockResolvedValue(undefined);

        await runWithLockExtension(job, async () => 'quick', {
            maxMs: 60_000, intervalMs: 1_000, amountMs: 5_000, onHeartbeat,
        });

        const afterCompletion = onHeartbeat.mock.calls.length;
        await jest.advanceTimersByTimeAsync(10_000);
        expect(onHeartbeat).toHaveBeenCalledTimes(afterCompletion);
    });

    test('stops when the work THROWS, not just on success', async () => {
        const job = makeJob();
        const onHeartbeat = jest.fn().mockResolvedValue(undefined);

        await expect(
            runWithLockExtension(job, async () => { throw new Error('phase blew up'); }, {
                maxMs: 60_000, intervalMs: 1_000, amountMs: 5_000, onHeartbeat,
            })
        ).rejects.toThrow('phase blew up');

        const afterThrow = onHeartbeat.mock.calls.length;
        await jest.advanceTimersByTimeAsync(10_000);
        expect(onHeartbeat).toHaveBeenCalledTimes(afterThrow);
    });

    test('a failing heartbeat never blocks the lock extension', async () => {
        // The lock is what actually keeps the job alive. A transient Mongo blip in the
        // heartbeat must not cost a renewal, or this "safety" feature would cause stalls.
        const job = makeJob();
        const onHeartbeat = jest.fn().mockRejectedValue(new Error('mongo unavailable'));
        let release;
        const work = new Promise((resolve) => { release = resolve; });

        const promise = runWithLockExtension(job, () => work, {
            maxMs: 60_000, intervalMs: 1_000, amountMs: 5_000, onHeartbeat,
        });

        await jest.advanceTimersByTimeAsync(2_000);
        expect(job.extendLock).toHaveBeenCalledTimes(2);

        release('ok');
        await expect(promise).resolves.toBe('ok');
    });

    test('omitting onHeartbeat is safe — existing callers are unaffected', async () => {
        const job = makeJob();
        let release;
        const work = new Promise((resolve) => { release = resolve; });

        const promise = runWithLockExtension(job, () => work, {
            maxMs: 60_000, intervalMs: 1_000, amountMs: 5_000,
        });

        await jest.advanceTimersByTimeAsync(2_000);
        expect(job.extendLock).toHaveBeenCalledTimes(2);

        release('fine');
        await expect(promise).resolves.toBe('fine');
    });

    test('past the ceiling the heartbeat stops too — a hung job must not look alive forever', async () => {
        // Otherwise the heartbeat would defeat the very recovery it feeds: a genuinely hung
        // phase would keep beating and the producer would never reclaim it.
        const job = makeJob();
        const onHeartbeat = jest.fn().mockResolvedValue(undefined);
        let release;
        const work = new Promise((resolve) => { release = resolve; });

        const promise = runWithLockExtension(job, () => work, {
            maxMs: 3_000, intervalMs: 1_000, amountMs: 5_000, onHeartbeat,
        });

        await jest.advanceTimersByTimeAsync(3_000);
        const atCeiling = onHeartbeat.mock.calls.length;
        await jest.advanceTimersByTimeAsync(10_000);
        expect(onHeartbeat).toHaveBeenCalledTimes(atCeiling);

        release('late');
        await promise;
    });
});

describe('producer — removing an old job only when it is not demonstrably alive', () => {
    const NINE_HOURS_AGO = () => Date.now() - 9 * 60 * 60 * 1000;
    let removed;

    /** Wire producer.js up to a fake queue + a controllable JobStatus row. */
    function loadProducer({ heartbeatAgeMs, status = 'running', rowMissing = false }) {
        jest.resetModules();
        removed = [];

        const job = {
            id: 'scheduled-u1-US-NA-sched_calc_review',
            timestamp: NINE_HOURS_AGO(),
            getState: async () => 'active',
            remove: async function () { removed.push(this.id); },
        };

        jest.doMock('../../../Services/BackgroundJobs/queue.js', () => ({
            getQueue: () => ({
                getJob: async (id) => (id === job.id ? job : null),
                add: async (_name, _data, opts) => ({ id: opts.jobId }),
            }),
        }));
        jest.doMock('../../../utils/Logger.js', () => ({
            info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
        }));
        // This mock APPLIES the query rather than returning a canned row, because the producer now
        // has two callers with different strategies and only a faithful mock can tell them apart:
        //   - hasRecentHeartbeat  does findOne({ jobId }) and filters status/age in JS
        //   - hasLiveAccountPhase filters status/updatedAt IN THE QUERY, so it stays index-backed
        //     on `jobId` instead of pulling rows into Node to filter them
        // A mock that ignored the query would hand the second one rows Mongo would never return,
        // and every assertion below about "heartbeat went cold" or "not running" would silently
        // stop testing anything.
        jest.doMock('../../../models/system/JobStatusModel.js', () => ({
            findOne: (query = {}) => ({
                select: () => ({
                    lean: async () => {
                        if (rowMissing) return null;
                        const row = { jobId: job.id, status, updatedAt: new Date(Date.now() - heartbeatAgeMs) };
                        if (query.status && query.status !== row.status) return null;
                        if (query.updatedAt?.$gt && !(row.updatedAt > query.updatedAt.$gt)) return null;
                        if (query.jobId?.$regex && !new RegExp(query.jobId.$regex).test(row.jobId)) return null;
                        return row;
                    },
                }),
            }),
        }));

        return require('../../../Services/BackgroundJobs/producer.js');
    }

    afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

    // THE REGRESSION TEST. Against the pre-fix producer this fails: the 9h-old job is removed
    // purely on age, destroying a live calc_review.
    test('a 9h-old job that is still heartbeating is NOT removed', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({ heartbeatAgeMs: 3 * 60 * 1000 });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(removed).toEqual([]);
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/already has a scheduled job in progress/i);
    });

    test('a 9h-old job whose heartbeat went cold IS removed, so a real orphan still recovers', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({ heartbeatAgeMs: 5 * 60 * 60 * 1000 });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(removed).toContain('scheduled-u1-US-NA-sched_calc_review');
        expect(result.success).toBe(true);
    });

    test('no JobStatus row at all => treated as dead (fails safe, matches old behaviour)', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({ heartbeatAgeMs: 0, rowMissing: true });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(removed).toContain('scheduled-u1-US-NA-sched_calc_review');
        expect(result.success).toBe(true);
    });

    test('a recent timestamp on a non-running row does not count as alive', async () => {
        // A row left at 'failed'/'completed' can still have a fresh updatedAt from its final
        // write. Only 'running' means "a worker is holding this right now".
        const { enqueueScheduledAccountJob } = loadProducer({
            heartbeatAgeMs: 60 * 1000, status: 'failed',
        });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(removed).toContain('scheduled-u1-US-NA-sched_calc_review');
        expect(result.success).toBe(true);
    });
});
