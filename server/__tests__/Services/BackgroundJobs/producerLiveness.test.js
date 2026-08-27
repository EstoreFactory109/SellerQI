/**
 * Tests for the producer's account-level "is work already in flight?" check.
 *
 * WHY THIS EXISTS
 * The producer must not start a second pipeline run for an account that already has one going.
 * Getting the SIGNAL right is the whole problem, and two earlier attempts got it wrong:
 *
 *   1. Matching only `${parentJobId}-${phase}` job ids missed the `-pollN` self-reschedules
 *      entirely, so an async run waiting on Amazon looked like nothing at all.
 *   2. Asking JobStatus for a row with `status:'running'` missed them too — an async phase marks
 *      its OWN row `completed` and re-enqueues itself as a DELAYED job. For the whole of that wait
 *      (60 min for the ads phase's first poll, 15 min later, 5 min for finance) nothing is
 *      `running` while the pipeline is very much alive. Measured after that shipped: orphaned
 *      tracking docs rose from 4.4% to 13.0%, and from 2 affected accounts to 8.
 *
 * And the obvious repair — drop the `status` filter so it matches freshnessSweeper's query — is
 * ALSO wrong: a terminal `sched_finalize` row stays warm for 60 minutes too, so an account would be
 * blocked for up to an hour after a SUCCESSFUL finish, roughly halving its refresh rate.
 *
 * So the check asks BullMQ, the only thing that distinguishes "work pending" from "row recently
 * touched". These directions are all load-bearing and must all stay:
 *   - a DELAYED poll job blocks               -> otherwise the regression above returns
 *   - a WAITING job blocks                    -> the inter-phase gap; this is why plain non-async
 *                                                accounts were orphaning docs too
 *   - nothing pending does NOT block          -> otherwise accounts silently starve, which is
 *                                                worse than the duplication being prevented
 *   - a long-but-BEATING active job blocks    -> calc_review reaches 23.8h in production; treating
 *                                                one as dead restarts the chain mid-flight
 */

const HOUR = 60 * 60 * 1000;
const NINE_HOURS = 9 * HOUR;

/**
 * Wire producer.js to a fake BullMQ queue.
 *
 * `jobs` are what `getJobs` returns. Each carries the `data.parentJobId` that real phase jobs carry
 * — createNextPhaseJobData copies it into every hop including `-pollN` — which is exactly what the
 * check matches on.
 */
function loadProducer({ jobs = [], throwOnGetJobs = false, heartbeatRow = null } = {}) {
    jest.resetModules();
    const added = [];
    const removed = [];

    // A real queue stops returning a job once it is removed, and both the deterministic-id loop
    // and the account scan read through the same queue. Modelling that matters: a mock that kept
    // serving removed jobs would let a single job be "removed" twice and the assertions would not
    // notice.
    const present = jobs.map((j) => ({
        ...j,
        remove: async function () {
            removed.push(this.id);
            const i = present.indexOf(this);
            if (i >= 0) present.splice(i, 1);
        },
    }));

    jest.doMock('../../../Services/BackgroundJobs/queue.js', () => ({
        getQueue: () => ({
            // Ids only. The real getRanges does not hydrate payloads, which is the whole reason
            // the check uses it instead of getJobs.
            getRanges: async () => {
                if (throwOnGetJobs) throw new Error('redis unavailable');
                return present.map(j => j.id);
            },
            getJob: async (id) => present.find(j => j.id === id) || null,
            add: async (_name, _data, opts) => { added.push(opts.jobId); return { id: opts.jobId }; },
        }),
    }));
    jest.doMock('../../../utils/Logger.js', () => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    }));
    jest.doMock('../../../models/system/JobStatusModel.js', () => ({
        findOne: () => ({ select: () => ({ lean: async () => heartbeatRow }) }),
    }));

    const producer = require('../../../Services/BackgroundJobs/producer.js');
    return { ...producer, added, removed };
}

/** A queue job for the account under test. `ageMs` is how long ago it was enqueued. */
const job = (id, state, ageMs = 60 * 1000, parentJobId = 'scheduled-u1-US-NA') => ({
    id,
    timestamp: Date.now() - ageMs,
    data: { parentJobId },
    getState: async () => state,
});

afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

describe('pending work blocks a second run', () => {
    // THE REGRESSION TEST. A delayed `-pollN` job is the exact shape both earlier versions of this
    // check were blind to, and it is the entire cause of the orphaned tracking docs.
    test('a DELAYED poll job blocks the enqueue', async () => {
        const { enqueueScheduledAccountJob, added } = loadProducer({
            jobs: [job('scheduled-u1-US-NA-sched_ads-poll7', 'delayed', 5 * 60 * 1000)],
        });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/already has a scheduled job in progress/i);
        expect(result.jobId).toBe('scheduled-u1-US-NA-sched_ads-poll7');
        expect(result.state).toBe('delayed');
        expect(added).toEqual([]);
    });

    // The ads phase's FIRST poll waits 60 minutes (ADS_INITIAL_POLL_DELAY_MS) — exactly the old
    // 60-minute staleness window, so no amount of tuning that window could have fixed this.
    test('a delayed job waiting the full 60-minute ads initial delay still blocks', async () => {
        const { enqueueScheduledAccountJob, added } = loadProducer({
            jobs: [job('scheduled-u1-US-NA-sched_ads-poll1', 'delayed', 59 * 60 * 1000)],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(false);
        expect(added).toEqual([]);
    });

    // A poll job that has come due sits in `waiting` until a worker picks it up. Its id is still
    // outside getAllPhaseJobIds, so only the account scan can see it.
    test('a WAITING poll job blocks', async () => {
        const { enqueueScheduledAccountJob, added } = loadProducer({
            jobs: [job('scheduled-u1-US-NA-sched_finance-poll4', 'waiting', 30 * 1000)],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(false);
        expect(added).toEqual([]);
    });

    test('an ACTIVE poll job blocks', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({
            jobs: [job('scheduled-u1-US-NA-sched_ads-poll2', 'active', 20 * 60 * 1000)],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(false);
    });

    // Belt and braces: a plain phase id is caught by the deterministic-id loop that runs BEFORE
    // the scan. Both layers must agree, or a change to one silently shifts behaviour.
    test('a plain waiting phase job still blocks via the id loop', async () => {
        const { enqueueScheduledAccountJob, added } = loadProducer({
            jobs: [job('scheduled-u1-US-NA-sched_batch_3', 'waiting', 30 * 1000)],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(false);
        expect(added).toEqual([]);
    });

    test('the finance poll chain blocks too — same shape, different phase', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({
            jobs: [job('scheduled-u1-US-NA-sched_finance-poll12', 'delayed', 60 * 1000)],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(false);
    });
});

describe('nothing pending => the run proceeds (must fail OPEN)', () => {
    test('an empty queue does not block', async () => {
        const { enqueueScheduledAccountJob, added } = loadProducer({ jobs: [] });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(result.success).toBe(true);
        expect(added).toContain('scheduled-u1-US-NA-sched_init');
    });

    // A check that failed CLOSED would let one bad Redis call starve an account indefinitely —
    // strictly worse than the duplication it exists to prevent.
    test('a queue error degrades to enqueuing rather than blocking', async () => {
        const { enqueueScheduledAccountJob, added } = loadProducer({ throwOnGetJobs: true });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(result.success).toBe(true);
        expect(added).toContain('scheduled-u1-US-NA-sched_init');
    });

    test('a job carrying no data does not blow up the check', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({
            jobs: [{ id: 'weird', timestamp: Date.now(), getState: async () => 'waiting' }],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(true);
    });
});

describe('a job with no usable timestamp fails in the SAFE direction', () => {
    // `now - undefined` is NaN and every NaN comparison is false, so an unstamped job would sail
    // past the age check and land in the removal set. Deleting work is the one failure mode worth
    // hard-coding against, so it must count as live instead.
    test('an unstamped job blocks and is NOT removed', async () => {
        const { enqueueScheduledAccountJob, added, removed } = loadProducer({
            jobs: [{
                id: 'scheduled-u1-US-NA-sched_ads-poll2',
                data: { parentJobId: 'scheduled-u1-US-NA' },
                getState: async () => 'delayed',
            }],
        });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(result.success).toBe(false);
        expect(removed).toEqual([]);
        expect(added).toEqual([]);
    });

    test('an unstamped job alongside a real orphan still blocks', async () => {
        const { enqueueScheduledAccountJob, removed } = loadProducer({
            jobs: [
                {
                    id: 'scheduled-u1-US-NA-sched_ads-poll5',
                    data: { parentJobId: 'scheduled-u1-US-NA' },
                    getState: async () => 'delayed',
                },
                job('scheduled-u1-US-NA-sched_finance-poll9', 'delayed', NINE_HOURS),
            ],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(false);
        expect(removed).toEqual([]);
    });
});

describe('matching is scoped to one account', () => {
    // The match is an exact compare on job.data.parentJobId — not a prefix, not a regex — so
    // neighbouring accounts cannot collide however their ids are shaped.
    test('another account’s delayed job does not block', async () => {
        const { enqueueScheduledAccountJob, added } = loadProducer({
            jobs: [job('scheduled-u2-US-NA-sched_ads-poll1', 'delayed', 60 * 1000, 'scheduled-u2-US-NA')],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(true);
        expect(added).toContain('scheduled-u1-US-NA-sched_init');
    });

    test('a different region on the same user does not block', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({
            jobs: [job('scheduled-u1-UK-EU-sched_ads-poll1', 'delayed', 60 * 1000, 'scheduled-u1-UK-EU')],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(true);
    });

    // A prefix match WOULD have matched this, since it starts with the u1 parent id. An exact
    // compare must not.
    test('an account whose parentJobId merely starts with ours does not block', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({
            jobs: [job('scheduled-u1-US-NA-EXTRA-sched_ads', 'delayed', 60 * 1000, 'scheduled-u1-US-NA-EXTRA')],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(true);
    });
});

describe('orphaned jobs are cleared instead of pinning the account', () => {
    // Nothing has ever removed `-pollN` jobs: the producer's cleanup loop walks getAllPhaseJobIds,
    // which does not enumerate them. Left parked they keep firing alongside the new run, so both
    // chains write the same account at once.
    test('a delayed poll job past the 8h bound does not block AND is removed', async () => {
        const { enqueueScheduledAccountJob, added, removed } = loadProducer({
            jobs: [job('scheduled-u1-US-NA-sched_ads-poll3', 'delayed', NINE_HOURS)],
        });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(result.success).toBe(true);
        expect(removed).toContain('scheduled-u1-US-NA-sched_ads-poll3');
        expect(added).toContain('scheduled-u1-US-NA-sched_init');
    });

    // THE OTHER DIRECTION, and the one with teeth. sched_calc_review gets a 26h lock-extension
    // ceiling because production data shows it legitimately reaching 23.8h. Removing a beating one
    // destroys hours of real work and restarts the chain — the bug that froze a dashboard for five
    // days. Age alone cannot tell "running 9h" from "died 9h ago"; the heartbeat can.
    test('an ACTIVE job past 8h that is still heartbeating blocks and is NOT removed', async () => {
        const { enqueueScheduledAccountJob, added, removed } = loadProducer({
            jobs: [job('scheduled-u1-US-NA-sched_calc_review', 'active', NINE_HOURS)],
            heartbeatRow: { status: 'running', updatedAt: new Date(Date.now() - 3 * 60 * 1000) },
        });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(result.success).toBe(false);
        expect(removed).toEqual([]);
        expect(added).toEqual([]);
    });

    // The same judgement inside the ACCOUNT SCAN rather than the id loop: a `-pollN` id is not in
    // getAllPhaseJobIds, so only the scan sees it, and it must apply the identical heartbeat test
    // before deciding a 9h-old active job is an orphan.
    test('an ACTIVE poll job past 8h that is heartbeating is treated as live, not stale', async () => {
        const { enqueueScheduledAccountJob, added, removed } = loadProducer({
            jobs: [job('scheduled-u1-US-NA-sched_finance-poll30', 'active', NINE_HOURS)],
            heartbeatRow: { status: 'running', updatedAt: new Date(Date.now() - 2 * 60 * 1000) },
        });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(result.success).toBe(false);
        expect(result.jobId).toBe('scheduled-u1-US-NA-sched_finance-poll30');
        expect(removed).toEqual([]);
        expect(added).toEqual([]);
    });

    test('an ACTIVE job past 8h whose heartbeat went cold is removed, so a real orphan recovers', async () => {
        const { enqueueScheduledAccountJob, removed } = loadProducer({
            jobs: [job('scheduled-u1-US-NA-sched_calc_review', 'active', NINE_HOURS)],
            heartbeatRow: { status: 'running', updatedAt: new Date(Date.now() - 5 * HOUR) },
        });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(result.success).toBe(true);
        expect(removed).toContain('scheduled-u1-US-NA-sched_calc_review');
    });

    test('a live job alongside an orphaned one still blocks, and the orphan is left for later', async () => {
        // Blocking wins — we must not enqueue. Orphans are only cleared on a tick that actually
        // proceeds, so nothing is removed here.
        const { enqueueScheduledAccountJob, added, removed } = loadProducer({
            jobs: [
                job('scheduled-u1-US-NA-sched_ads-poll9', 'delayed', NINE_HOURS),
                job('scheduled-u1-US-NA-sched_finance-poll2', 'delayed', 2 * 60 * 1000),
            ],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(false);
        expect(added).toEqual([]);
        expect(removed).toEqual([]);
    });
});
