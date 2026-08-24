/**
 * Tests for the pipeline-progress state machine.
 *
 * WHY THIS EXISTS
 * This widget's whole value is answering "which stage, and is it alive?" at a glance. Two properties
 * of the underlying data make that easy to get confidently wrong, and both bit me repeatedly while
 * debugging by hand:
 *
 *   1. JobStatus rows are REUSED across runs — job ids are deterministic and rows are UPSERTED, so a
 *      phase row holds whatever the LAST run left behind. Read naively, last night's failure renders
 *      as today's state.
 *   2. `error` / `failedAt` SURVIVE a later success. Nothing clears them. In production I found a
 *      job displaying an error from five days earlier while its status was `completed`, and twice
 *      called a healthy job broken because of it.
 *
 * The tests named for those two traps are the ones that matter; they fail if the run-boundary filter
 * is removed. Everything else is ordering and folding.
 */

const {
    deriveStages,
    currentStageOf,
    basePhaseOf,
    isPollJob,
    STATE,
    STALE_HEARTBEAT_MINUTES,
} = require('../../controllers/system/PipelineProgressController.js');

const PHASES = ['sched_init', 'sched_ads', 'sched_finance', 'sched_finalize'];
const describe_ = (p) => `desc:${p}`;

const NOW = new Date('2026-08-19T12:00:00.000Z');
// 24h back deliberately: these accounts genuinely run for 9+ hours (calc_review alone hit 23.8h in
// production), so a narrow window would filter legitimate in-run rows out as "previous run" and the
// tests would assert the wrong thing.
const RUN_START = new Date('2026-08-18T12:00:00.000Z');
const MIN = (m) => new Date(NOW.getTime() - m * 60 * 1000);

/** A JobStatus row as the collection stores it. */
const row = (over = {}) => ({
    jobId: 'scheduled-u1-US-NA-sched_ads',
    metadata: { phase: 'sched_ads' },
    status: 'completed',
    startedAt: MIN(120),
    updatedAt: MIN(60),
    completedAt: MIN(60),
    ...over,
});

const run = (rows, opts = {}) => deriveStages({
    phaseOrder: PHASES, describePhase: describe_, rows, runStart: RUN_START, now: NOW, ...opts,
});
const stageOf = (stages, phase) => stages.find((s) => s.phase === phase);

describe('helpers', () => {
    test('basePhaseOf strips the -pollN suffix', () => {
        expect(basePhaseOf('scheduled-u1-US-NA-sched_finance-poll7')).toBe('scheduled-u1-US-NA-sched_finance');
        expect(basePhaseOf('scheduled-u1-US-NA-sched_finance')).toBe('scheduled-u1-US-NA-sched_finance');
    });

    test('isPollJob identifies rescheduled poll rows', () => {
        expect(isPollJob('x-sched_finance-poll12')).toBe(true);
        expect(isPollJob('x-sched_finance')).toBe(false);
    });
});

describe('the two traps', () => {
    // TRAP 1. Against a version without the run-boundary filter this fails: the stale row is
    // reported as `failed`, so the page shows last night's outcome as though it were today's.
    test('a row from a PREVIOUS run is pending, not its stale state', () => {
        const stages = run([
            row({
                metadata: { phase: 'sched_ads' },
                status: 'failed',
                startedAt: new Date('2026-08-18T04:00:00.000Z'), // before RUN_START
                failedAt: new Date('2026-08-18T05:00:00.000Z'),
                error: 'yesterday exploded',
            }),
        ]);

        const ads = stageOf(stages, 'sched_ads');
        expect(ads.state).toBe(STATE.PENDING);
        expect(ads.error).toBeNull();
        expect(ads.startedAt).toBeNull();
    });

    // TRAP 2. The exact shape seen in production: a row that succeeded today but still carries an
    // error and failedAt from days ago. Showing that error is what made healthy jobs look broken.
    test('a stale error surviving on a row that succeeded THIS run is not surfaced', () => {
        const stages = run([
            row({
                metadata: { phase: 'sched_ads' },
                status: 'completed',
                startedAt: MIN(90),
                completedAt: MIN(30),
                updatedAt: MIN(30),
                error: 'no engine row for chunk',                       // left over
                failedAt: new Date('2026-08-14T10:00:00.000Z'),         // days before this run
            }),
        ]);

        const ads = stageOf(stages, 'sched_ads');
        expect(ads.state).toBe(STATE.COMPLETED);
        expect(ads.error).toBeNull();
    });
});

describe('the INIT ordering subtlety', () => {
    // Found by running this against production, not by reasoning: INIT *creates* the
    // DataFetchTracking doc, so its JobStatus row is stamped a moment BEFORE the run start it
    // establishes. Without a grace window it is filtered out as a previous run and shows `pending`
    // on a run it completed — which is exactly what the first real-data check produced.
    test('INIT starting fractionally BEFORE the tracking doc still belongs to this run', () => {
        const stages = run([
            row({
                jobId: 'x-sched_init',
                metadata: { phase: 'sched_init' },
                status: 'completed',
                // 2s before run start — production max observed lead was 1.3s.
                startedAt: new Date(RUN_START.getTime() - 2000),
                completedAt: new Date(RUN_START.getTime() + 60000),
                updatedAt: new Date(RUN_START.getTime() + 60000),
            }),
        ]);

        expect(stageOf(stages, 'sched_init').state).toBe(STATE.COMPLETED);
    });

    test('the grace window is small enough to still exclude a genuinely previous run', () => {
        // Runs are hours apart, so a row from an earlier run must never sneak in.
        const stages = run([
            row({
                jobId: 'x-sched_init',
                metadata: { phase: 'sched_init' },
                status: 'failed',
                startedAt: new Date(RUN_START.getTime() - 6 * 60 * 60 * 1000),
                failedAt: new Date(RUN_START.getTime() - 5 * 60 * 60 * 1000),
                error: 'previous run',
            }),
        ]);

        expect(stageOf(stages, 'sched_init').state).toBe(STATE.PENDING);
        expect(stageOf(stages, 'sched_init').error).toBeNull();
    });
});

describe('stage states', () => {
    test('running with a fresh heartbeat reads as running', () => {
        const stages = run([
            row({ status: 'running', completedAt: null, startedAt: MIN(200), updatedAt: MIN(5), lastHeartbeatAt: MIN(5) }),
        ]);
        expect(stageOf(stages, 'sched_ads').state).toBe(STATE.RUNNING);
    });

    // The state nothing could show before, and the one that answers "stuck or just slow?".
    test('running with a STALE heartbeat reads as stalled', () => {
        const stale = STALE_HEARTBEAT_MINUTES + 30;
        const stages = run([
            row({ status: 'running', completedAt: null, startedAt: MIN(600), updatedAt: MIN(stale), lastHeartbeatAt: MIN(stale) }),
        ]);
        expect(stageOf(stages, 'sched_ads').state).toBe(STATE.STALLED);
    });

    test('a long run that is still beating is running, NOT stalled', () => {
        // calc_review reached 23.8h in production; elapsed time must never imply death.
        const stages = run([
            row({ status: 'running', completedAt: null, startedAt: MIN(9 * 60), updatedAt: MIN(3), lastHeartbeatAt: MIN(3) }),
        ]);
        const ads = stageOf(stages, 'sched_ads');
        expect(ads.state).toBe(STATE.RUNNING);
        expect(ads.elapsedMs).toBe(9 * 60 * 60 * 1000);
    });

    test('a failure in THIS run is surfaced with its message', () => {
        const stages = run([
            row({ status: 'failed', completedAt: null, startedAt: MIN(120), failedAt: MIN(90), updatedAt: MIN(90), error: 'Unsupported country: "ZA"' }),
        ]);
        const ads = stageOf(stages, 'sched_ads');
        expect(ads.state).toBe(STATE.FAILED);
        expect(ads.error).toBe('Unsupported country: "ZA"');
    });

    test('a phase with no row at all is pending', () => {
        expect(stageOf(run([]), 'sched_finance').state).toBe(STATE.PENDING);
    });
});

describe('poll folding', () => {
    test('poll rows collapse onto the parent stage and are counted', () => {
        // One production run produced sched_finance plus poll1..poll9; nine extra dots would be
        // unreadable, so they fold into one.
        const polls = [1, 2, 3].map((n) => row({
            jobId: `scheduled-u1-US-NA-sched_finance-poll${n}`,
            metadata: { phase: 'sched_finance' },
            status: 'completed', startedAt: MIN(100 - n), updatedAt: MIN(50 - n), completedAt: MIN(50 - n),
        }));
        const stages = run([
            row({ jobId: 'scheduled-u1-US-NA-sched_finance', metadata: { phase: 'sched_finance' }, startedAt: MIN(110), updatedAt: MIN(105), completedAt: MIN(105) }),
            ...polls,
        ]);

        const fin = stageOf(stages, 'sched_finance');
        expect(fin.pollCount).toBe(3);
        expect(fin.state).toBe(STATE.COMPLETED);
        // Only ever one dot per phase, however many polls happened.
        expect(stages.filter((s) => s.phase === 'sched_finance')).toHaveLength(1);
    });

    test('a still-running poll keeps the whole stage running', () => {
        const stages = run([
            row({ jobId: 'x-sched_finance', metadata: { phase: 'sched_finance' }, status: 'completed', startedAt: MIN(100), updatedAt: MIN(95), completedAt: MIN(95) }),
            row({ jobId: 'x-sched_finance-poll4', metadata: { phase: 'sched_finance' }, status: 'running', completedAt: null, startedAt: MIN(40), updatedAt: MIN(2), lastHeartbeatAt: MIN(2) }),
        ]);
        expect(stageOf(stages, 'sched_finance').state).toBe(STATE.RUNNING);
    });

    test('elapsed spans from the earliest poll start, not the latest', () => {
        const stages = run([
            row({ jobId: 'x-sched_finance', metadata: { phase: 'sched_finance' }, status: 'running', completedAt: null, startedAt: MIN(180), updatedAt: MIN(1), lastHeartbeatAt: MIN(1) }),
            row({ jobId: 'x-sched_finance-poll1', metadata: { phase: 'sched_finance' }, status: 'running', completedAt: null, startedAt: MIN(30), updatedAt: MIN(1), lastHeartbeatAt: MIN(1) }),
        ]);
        expect(stageOf(stages, 'sched_finance').elapsedMs).toBe(180 * 60 * 1000);
    });
});

describe('ordering and shape', () => {
    test('every phase is rendered, in PHASE_ORDER, with no gaps', () => {
        expect(run([]).map((s) => s.phase)).toEqual(PHASES);
    });

    test('labels come from the pipeline describePhase', () => {
        expect(run([])[0].label).toBe('desc:sched_init');
    });

    test('a mid-chain failure leaves later stages pending', () => {
        const stages = run([
            row({ metadata: { phase: 'sched_init' }, jobId: 'x-sched_init', status: 'completed', startedAt: MIN(300), updatedAt: MIN(290), completedAt: MIN(290) }),
            row({ status: 'failed', completedAt: null, startedAt: MIN(280), failedAt: MIN(270), updatedAt: MIN(270), error: 'boom' }),
        ]);

        expect(stageOf(stages, 'sched_init').state).toBe(STATE.COMPLETED);
        expect(stageOf(stages, 'sched_ads').state).toBe(STATE.FAILED);
        expect(stageOf(stages, 'sched_finance').state).toBe(STATE.PENDING);
        expect(stageOf(stages, 'sched_finalize').state).toBe(STATE.PENDING);
    });

    test('a missing runStart yields all-pending rather than throwing', () => {
        const stages = run([row()], { runStart: null });
        expect(stages.every((s) => s.state === STATE.PENDING)).toBe(true);
    });

    test('malformed rows are skipped, not fatal', () => {
        expect(() => run([null, {}, { jobId: null }])).not.toThrow();
    });
});

describe('currentStageOf', () => {
    test('points at the running stage', () => {
        const stages = run([
            row({ metadata: { phase: 'sched_init' }, jobId: 'x-sched_init', status: 'completed', startedAt: MIN(300), updatedAt: MIN(290), completedAt: MIN(290) }),
            row({ status: 'running', completedAt: null, startedAt: MIN(200), updatedAt: MIN(2), lastHeartbeatAt: MIN(2) }),
        ]);
        expect(currentStageOf(stages)).toBe('sched_ads');
    });

    test('a stalled stage is what the operator is pointed at', () => {
        const stale = STALE_HEARTBEAT_MINUTES + 10;
        const stages = run([
            row({ status: 'running', completedAt: null, startedAt: MIN(400), updatedAt: MIN(stale), lastHeartbeatAt: MIN(stale) }),
        ]);
        expect(currentStageOf(stages)).toBe('sched_ads');
    });

    test('with nothing running it points at the failure', () => {
        const stages = run([
            row({ status: 'failed', completedAt: null, startedAt: MIN(200), failedAt: MIN(150), updatedAt: MIN(150), error: 'x' }),
        ]);
        expect(currentStageOf(stages)).toBe('sched_ads');
    });

    test('an untouched pipeline points at the first stage', () => {
        expect(currentStageOf(run([]))).toBe('sched_init');
    });
});
