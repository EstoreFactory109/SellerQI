/**
 * Tests for the lock-extension ceiling — the queue's ONLY working timeout.
 *
 * WHY THIS EXISTS
 * A job-level `timeout` option has been a no-op since BullMQ v4 removed it from
 * JobsOptions (we run 5.x), so the `timeout: 2h` that used to sit in six places was
 * decoration. The only things that can end a stuck phase are the worker dying, or BullMQ
 * reclaiming the job once its lock lapses — and the old code extended the lock forever,
 * defeating the second.
 *
 * Production 2026-08-06: `sched_ads` sat `active` for 7.8 HOURS with attempts:0, lock
 * dutifully renewed the whole time. Because phase job ids are deterministic and BullMQ
 * silently drops an add whose id already exists, that one stuck job then swallowed every
 * later attempt to run that phase — including a manual re-drive — and the account's
 * dashboard silently froze for two days.
 *
 * The single most important assertion here is "stops extending past the ceiling". Without
 * it nothing else in the recovery story can ever trigger.
 */

jest.mock('../../../utils/Logger.js', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const logger = require('../../../utils/Logger.js');
const { runWithLockExtension, extendLockWithRetry, resolveCeiling } = require('../../../Services/BackgroundJobs/lockExtension.js');

const OPTS = { maxMs: 1000, intervalMs: 100, amountMs: 5000, label: 'TestWorker' };

/** A job whose extendLock calls are counted. */
function makeJob(overrides = {}) {
    return {
        id: 'job-1',
        token: 'tok',
        data: { phase: 'sched_ads', userId: 'u1' },
        extendLock: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => jest.clearAllMocks());

describe('the ceiling', () => {
    test('STOPS extending once the ceiling passes, instead of renewing forever', async () => {
        // The regression that matters. Against the old unbounded implementation the
        // extension count keeps climbing for as long as the job runs.
        const job = makeJob();

        await runWithLockExtension(job, () => sleep(700), { ...OPTS, maxMs: 250, intervalMs: 50 });

        // Extensions happen only in the first 250ms (~4 ticks at 50ms), not across all 700ms.
        expect(job.extendLock.mock.calls.length).toBeLessThanOrEqual(5);
        expect(job.extendLock.mock.calls.length).toBeGreaterThan(0);
    });

    test('keeps extending a job that is still within the ceiling', async () => {
        const job = makeJob();

        await runWithLockExtension(job, () => sleep(350), { ...OPTS, maxMs: 10_000, intervalMs: 50 });

        // ~6 ticks in 350ms; assert it kept going rather than stopping early.
        expect(job.extendLock.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    test('logs the ceiling breach LOUDLY, naming the job, phase and user', async () => {
        // The operator-facing half: a hung phase must be greppable, not silent.
        const job = makeJob();

        await runWithLockExtension(job, () => sleep(400), { ...OPTS, maxMs: 100, intervalMs: 40 });

        const said = logger.error.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
        expect(said).toMatch(/HUNG PHASE/);
        expect(said).toMatch(/job-1/);
        const ctx = logger.error.mock.calls.find((c) => c[1] && c[1].jobId)?.[1];
        expect(ctx).toMatchObject({ jobId: 'job-1', phase: 'sched_ads', userId: 'u1' });
    });

    test('breaching the ceiling does NOT reject — asyncFn still settles normally', async () => {
        // Throwing from the interval callback would be an unhandled rejection and would not
        // stop asyncFn anyway. Letting the lock lapse is the entire mechanism.
        const job = makeJob();

        await expect(
            runWithLockExtension(job, async () => { await sleep(300); return 'finished anyway'; }, { ...OPTS, maxMs: 50, intervalMs: 25 })
        ).resolves.toBe('finished anyway');
    });

    test('a late return past the ceiling is flagged as possibly-discarded', async () => {
        const job = makeJob();
        await runWithLockExtension(job, () => sleep(300), { ...OPTS, maxMs: 50, intervalMs: 25 });

        const said = logger.error.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
        expect(said).toMatch(/finally returned after/);
    });
});

describe('normal operation is unchanged', () => {
    test('returns the value and stops the timer when work finishes fast', async () => {
        const job = makeJob();

        const out = await runWithLockExtension(job, async () => 'done', OPTS);

        expect(out).toBe('done');
        expect(job.extendLock).not.toHaveBeenCalled();   // finished before the first tick
    });

    test('propagates a throw from the wrapped work, and still clears the timer', async () => {
        const job = makeJob();

        await expect(
            runWithLockExtension(job, async () => { throw new Error('phase blew up'); }, OPTS)
        ).rejects.toThrow('phase blew up');

        // If the interval leaked, extendLock would keep firing after settle.
        const after = job.extendLock.mock.calls.length;
        await sleep(250);
        expect(job.extendLock.mock.calls.length).toBe(after);
    });

    test('a failing extendLock does not abort the job', async () => {
        // Redis blips must not kill a running phase — retries absorb them.
        const job = makeJob({ extendLock: jest.fn().mockRejectedValue(new Error('redis blip')) });

        const out = await runWithLockExtension(job, async () => { await sleep(150); return 'ok'; },
            { ...OPTS, maxMs: 10_000, intervalMs: 40 });

        expect(out).toBe('ok');
    });
});

describe('resolveCeiling — the long-ceiling mechanism', () => {
    // This exercises the FUNCTION with a hypothetical carve-out set. No phase is currently
    // in worker.js's LONG_PHASES — see the separate describe block below for that.
    //
    // Measured over 1,384 completed production phases: every phase stayed under 2h except
    // calc_review, which reached 23.8h. That is why the mechanism exists. It is also why
    // too-low was the dangerous direction: a reclaimed job is RE-RUN, and calc_review used
    // to send review requests, so a false reclaim meant duplicate messages to real buyers.
    const CFG = { defaultMs: 3 * 3600_000, longMs: 26 * 3600_000, longPhases: new Set(['sched_calc_review']) };

    test('an ordinary phase gets the tight default', () => {
        expect(resolveCeiling('sched_ads', CFG)).toBe(CFG.defaultMs);
    });

    test('a phase IN the set gets the long ceiling', () => {
        expect(resolveCeiling('sched_calc_review', CFG)).toBe(CFG.longMs);
        expect(CFG.longMs).toBeGreaterThan(23.8 * 3600_000);
    });

    test('a phaseless (legacy whole-account) job gets the long ceiling, not the tight one', () => {
        // processUserData runs a whole account with no per-phase budget; capping it at the
        // per-phase default would reclaim legitimate work.
        expect(resolveCeiling(undefined, CFG)).toBe(CFG.longMs);
        expect(resolveCeiling(null, CFG)).toBe(CFG.longMs);
    });

    test('an unknown phase falls back to the tight default rather than the long one', () => {
        // Fail toward bounding an unknown phase; a new phase that genuinely needs longer
        // must be added to the set deliberately.
        expect(resolveCeiling('sched_some_future_phase', CFG)).toBe(CFG.defaultMs);
    });

    test('tolerates a missing longPhases set', () => {
        expect(resolveCeiling('sched_ads', { defaultMs: 1, longMs: 2 })).toBe(1);
    });

    test('an EMPTY set means every phase gets the tight default', () => {
        // worker.js's actual configuration since the review services moved out.
        const empty = { ...CFG, longPhases: new Set() };
        expect(resolveCeiling('sched_calc_review', empty)).toBe(empty.defaultMs);
        expect(resolveCeiling('sched_ads', empty)).toBe(empty.defaultMs);
        // ...but the phaseless legacy job is decided BEFORE the set is consulted, so it
        // keeps the long ceiling regardless. Emptying the set must not change that.
        expect(resolveCeiling(undefined, empty)).toBe(empty.longMs);
    });
});

describe('calc_review no longer has a carve-out', () => {
    /**
     * WHY THIS IS A SOURCE ASSERTION. worker.js assigns module.exports inside startWorker(),
     * so requiring it here to read LONG_PHASES would mean booting a worker. Reading the
     * declaration is enough to pin the thing that matters.
     *
     * THE DEFECT IT GUARDS. calc_review had a 26h lock ceiling because it legitimately ran
     * that long — it did review ingestion and sending. Those moved to review-worker, so the
     * phase is batch 5 only and the allowance became 26 hours of a wedged job holding a
     * worker slot before anything reacted. Putting calc_review back in this set without
     * moving the review services back would restore that blind spot.
     */
    test('worker.js declares an empty LONG_PHASES', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '../../../Services/BackgroundJobs/worker.js'), 'utf8'
        );
        expect(src).toMatch(/const LONG_PHASES = new Set\(\);/);
        expect(src).not.toMatch(/const LONG_PHASES = new Set\(\[/);
    });
});

describe('extendLockWithRetry', () => {
    test('returns true on first success without retrying', async () => {
        const job = makeJob();
        await expect(extendLockWithRetry(job, 1000, { label: 'T' })).resolves.toBe(true);
        expect(job.extendLock).toHaveBeenCalledTimes(1);
    });

    test('gives up after maxRetries and reports false rather than throwing', async () => {
        const job = makeJob({ extendLock: jest.fn().mockRejectedValue(new Error('nope')) });

        await expect(extendLockWithRetry(job, 1000, { maxRetries: 2, label: 'T' })).resolves.toBe(false);
        expect(job.extendLock).toHaveBeenCalledTimes(2);
        expect(logger.error).toHaveBeenCalled();
    });
});
