/**
 * Tests for the producer's account-level liveness check.
 *
 * WHY THIS EXISTS
 * `getAllPhaseJobIds` returns only `${parentJobId}-${phase}`. But the async ads/finance phases do
 * not hold a worker slot while Amazon generates reports — they re-enqueue THEMSELVES as a delayed
 * job under `${parentJobId}-${phase}-poll${n}`, a suffix that list does not contain. So the
 * producer looked up `…-sched_ads`, found the ORIGINAL job already `completed`, removed it,
 * concluded nothing was running, and started a whole new run on top of a live one.
 *
 * The first run's DataFetchTracking doc is only ever closed by `sched_finalize`, so it stayed at
 * `started` and ~9h later the sweeper marked it `stalled-pipeline-autorecovered`.
 *
 * Measured in production over 14 days: 100 of 334 runs on the 10 async-engine accounts stalled
 * (29.9%), against 0 of 2,056 runs on the other 42 accounts — including 11 that ran MORE often
 * (up to 281 times each) and never stalled once. Median 86 minutes from a stalled run to the next
 * one starting.
 *
 * The two directions below are both load-bearing and must both stay:
 *   - a LIVE poll chain must block a new run   -> otherwise the original bug returns
 *   - a COLD or absent row must NOT block      -> otherwise one bad row starves an account forever,
 *                                                 which is worse than the bug being fixed
 */

const HOUR = 60 * 60 * 1000;

/** Wire producer.js to a fake queue and a controllable JobStatus collection. */
function loadProducer({ rows = [], throwOnFind = false } = {}) {
    jest.resetModules();
    const added = [];

    jest.doMock('../../../Services/BackgroundJobs/queue.js', () => ({
        getQueue: () => ({
            // No pre-existing phase jobs: this is the state the bug occurred in — every id the
            // producer knows to look for is gone, while a `-pollN` job is still pending.
            getJob: async () => null,
            add: async (_name, _data, opts) => { added.push(opts.jobId); return { id: opts.jobId }; },
        }),
    }));
    jest.doMock('../../../utils/Logger.js', () => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    }));
    jest.doMock('../../../models/system/JobStatusModel.js', () => ({
        // Applies the query, so a test cannot pass by handing back a row Mongo would have filtered.
        findOne: (query = {}) => ({
            select: () => ({
                lean: async () => {
                    if (throwOnFind) throw new Error('mongo unavailable');
                    return rows.find((r) => {
                        if (query.status && query.status !== r.status) return false;
                        if (query.updatedAt?.$gt && !(r.updatedAt > query.updatedAt.$gt)) return false;
                        if (query.jobId?.$regex && !new RegExp(query.jobId.$regex).test(r.jobId)) return false;
                        return true;
                    }) || null;
                },
            }),
        }),
    }));

    const producer = require('../../../Services/BackgroundJobs/producer.js');
    return { ...producer, added };
}

const row = (jobId, ageMs, status = 'running') => ({
    jobId, status, updatedAt: new Date(Date.now() - ageMs),
});

afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

describe('a live poll chain blocks a second run', () => {
    // THE REGRESSION TEST. This exact id shape — the `-poll{n}` suffix — is what the old check
    // could not see, and it is the entire cause of the 100 stalls.
    test('a warm -pollN row prevents the enqueue', async () => {
        const { enqueueScheduledAccountJob, added } = loadProducer({
            rows: [row('scheduled-u1-US-NA-sched_ads-poll7', 3 * 60 * 1000)],
        });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/already has a scheduled job in progress/i);
        expect(result.jobId).toBe('scheduled-u1-US-NA-sched_ads-poll7');
        expect(added).toEqual([]);
    });

    test('a warm ordinary phase row also blocks', async () => {
        const { enqueueScheduledAccountJob, added } = loadProducer({
            rows: [row('scheduled-u1-US-NA-sched_calc_review', 5 * 60 * 1000)],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(false);
        expect(added).toEqual([]);
    });

    test('the finance poll chain blocks too — the same shape, a different phase', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({
            rows: [row('scheduled-u1-US-NA-sched_finance-poll12', 60 * 1000)],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(false);
    });
});

describe('nothing live => the run proceeds (must fail OPEN)', () => {
    test('a cold row does not block', async () => {
        const { enqueueScheduledAccountJob, added } = loadProducer({
            rows: [row('scheduled-u1-US-NA-sched_ads-poll7', 5 * HOUR)],
        });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(result.success).toBe(true);
        expect(added).toContain('scheduled-u1-US-NA-sched_init');
    });

    test('a recent row that is not running does not block', async () => {
        // A 'failed'/'completed' row keeps a fresh updatedAt from its final write. Only 'running'
        // means a worker is holding it right now.
        const { enqueueScheduledAccountJob } = loadProducer({
            rows: [row('scheduled-u1-US-NA-sched_ads-poll7', 60 * 1000, 'failed')],
        });

        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(true);
    });

    test('no rows at all does not block', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({ rows: [] });
        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(true);
    });

    // A check that failed CLOSED would let one bad query starve an account indefinitely — strictly
    // worse than the double-enqueue it exists to prevent.
    test('a query error degrades to the previous behaviour rather than blocking', async () => {
        const { enqueueScheduledAccountJob, added } = loadProducer({ throwOnFind: true });

        const result = await enqueueScheduledAccountJob('u1', 'US', 'NA');

        expect(result.success).toBe(true);
        expect(added).toContain('scheduled-u1-US-NA-sched_init');
    });
});

describe('the prefix is scoped to one account', () => {
    // The query builds a regex from userId/country/region. Anchoring is what keeps it on the
    // `jobId` index AND what stops a neighbouring account matching.
    test('another account with a similar prefix does not block', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({
            rows: [row('scheduled-u1-US-NA-EXTRA-sched_ads-poll1', 60 * 1000)],
        });
        // Same account prefix -> SHOULD match (it is a longer id for the same parent).
        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(false);

        const other = loadProducer({
            rows: [row('scheduled-u2-US-NA-sched_ads-poll1', 60 * 1000)],
        });
        // Different account -> must NOT match.
        expect((await other.enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(true);
    });

    test('a different region on the same user does not block', async () => {
        const { enqueueScheduledAccountJob } = loadProducer({
            rows: [row('scheduled-u1-UK-EU-sched_ads-poll1', 60 * 1000)],
        });
        expect((await enqueueScheduledAccountJob('u1', 'US', 'NA')).success).toBe(true);
    });

    // Regex metacharacters in interpolated values would otherwise change the pattern's meaning.
    test('regex metacharacters in the account key are escaped, not interpreted', async () => {
        const { hasLiveAccountPhase } = loadProducer({
            rows: [row('scheduled-uXvalue-US-NA-sched_ads-poll1', 60 * 1000)],
        });
        // `u.` unescaped would match `uX`; escaped it is a literal dot and must not.
        expect((await hasLiveAccountPhase('scheduled-u.value-US-NA')).live).toBe(false);
    });
});

describe('threshold stays in step with the sweeper', () => {
    // producer.HEARTBEAT_STALE_MS and freshnessSweeper's PIPELINE_STALL_QUIET_MINUTES gate the SAME
    // decision from opposite sides. If they drift, one will re-drive an account the other still
    // considers alive — which is the failure this whole area exists to prevent.
    test('producer window equals the sweeper window', () => {
        const { HEARTBEAT_STALE_MS } = loadProducer({});
        const { PIPELINE_STALL_QUIET_MINUTES } = require('../../../Services/BackgroundJobs/freshnessSweeper.js');
        expect(HEARTBEAT_STALE_MS).toBe(PIPELINE_STALL_QUIET_MINUTES * 60 * 1000);
    });
});
