/**
 * Pipeline progress — which stage of a data fetch is running, and is it alive.
 *
 * WHY THIS EXISTS
 * Debugging frozen accounts meant reconstructing "which phase is this account on, and is it still
 * moving?" by hand from JobStatus + DataFetchTracking, dozens of times over a week. The logging page
 * shows SESSIONS (start, status, success rate) but never which STAGE a run is in, so a healthy
 * multi-hour run and a dead one look identical. This endpoint is that reconstruction, done once.
 *
 * TWO TRAPS THIS HAD TO SOLVE, or the widget would confidently lie:
 *
 *   1. JobStatus rows are REUSED across runs. Job ids are deterministic
 *      (`scheduled-<uid>-<country>-<region>-<phase>`) and rows are UPSERTED, so a phase row carries
 *      whatever the LAST run left there. Reading it naively shows last night's outcome as if it were
 *      today's. Every row is therefore filtered against the current run's start.
 *
 *   2. `error` / `failedAt` SURVIVE a later success — nothing clears them. During this
 *      investigation that repeatedly showed a week-old error next to a job that had just completed,
 *      and twice led to a healthy job being called failed. So an error is surfaced only when it
 *      belongs to THIS run.
 *
 * Both pipelines (scheduled daily, first-connect integration) expose the same PHASES / PHASE_ORDER /
 * getPhaseDescription interface, so one normalised shape serves both.
 */

const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const logger = require('../../utils/Logger.js');

/**
 * How long a `running` phase may go without a heartbeat before it is reported as `stalled`.
 *
 * The worker heartbeats every 15 min (LOCK_EXTENSION_INTERVAL), so 60 tolerates a few missed beats
 * without calling a live job dead. Mirrors the sweeper guards, which use the same reasoning.
 */
const STALE_HEARTBEAT_MINUTES = Math.max(
    15,
    parseInt(process.env.PIPELINE_PROGRESS_STALE_MINUTES || '60', 10) || 60
);

/**
 * Grace window applied BEFORE the run start when deciding whether a phase belongs to this run.
 *
 * The INIT phase CREATES the DataFetchTracking document, so its own JobStatus row is necessarily
 * stamped a moment EARLIER than the run start it establishes. Without this, INIT is filtered out as
 * "a previous run" and renders pending on a run it actually completed — which is exactly what the
 * first production check of this endpoint showed.
 *
 * Sized from production rather than guessed: across 400 runs the largest observed lead was 1.3s
 * (p95 0.9s). 60s is a ~45x margin and still nowhere near the hours that separate consecutive runs,
 * so it cannot pull a previous run's rows in.
 */
const RUN_START_GRACE_MS = 60 * 1000;

/** Stage states. `stalled` is deliberately distinct from `running` — see deriveStages. */
const STATE = {
    PENDING: 'pending',
    RUNNING: 'running',
    STALLED: 'stalled',
    COMPLETED: 'completed',
    FAILED: 'failed',
};

/** Strip the `-pollN` suffix the ads/finance phases self-reschedule under. */
function basePhaseOf(jobId) {
    return String(jobId || '').replace(/-poll\d+$/, '');
}

function isPollJob(jobId) {
    return /-poll\d+$/.test(String(jobId || ''));
}

/**
 * Derive one ordered stage list from raw JobStatus rows.
 *
 * PURE — no DB, no clock beyond `now`. Exported so the state machine is unit-testable directly
 * rather than through the HTTP layer, the same reason FinanceService exports parseTsv.
 *
 * @param {object}   args
 * @param {string[]} args.phaseOrder     ordered phase names for this pipeline
 * @param {Function} args.describePhase  phase -> human label
 * @param {Array}    args.rows           JobStatus rows for the account (any age)
 * @param {Date}     args.runStart       start of the CURRENT run; rows older than this are ignored
 * @param {Date}     [args.now]
 * @returns {Array} one entry per phase, in order
 */
function deriveStages({ phaseOrder, describePhase, rows, runStart, now = new Date() }) {
    // Grace applied so the INIT phase — which creates the tracking doc and is therefore stamped
    // just before it — is not mistaken for a previous run's leftover. See RUN_START_GRACE_MS.
    const startMs = runStart ? new Date(runStart).getTime() - RUN_START_GRACE_MS : null;
    const staleBefore = now.getTime() - STALE_HEARTBEAT_MINUTES * 60 * 1000;

    // Fold rows onto their base phase, so `sched_finance-poll7` lands on `sched_finance` instead of
    // rendering as its own dot. One run produced nine poll rows for a single phase.
    const byPhase = new Map();
    for (const row of rows || []) {
        // metadata.phase is authoritative when present; the jobId suffix is the fallback.
        const phase = row?.metadata?.phase || basePhaseOf(row?.jobId).split('-').pop();
        if (!phase) continue;
        if (!byPhase.has(phase)) byPhase.set(phase, []);
        byPhase.get(phase).push(row);
    }

    return phaseOrder.map((phase) => {
        const all = byPhase.get(phase) || [];

        // TRAP 1: only rows touched by the CURRENT run count. A row whose startedAt predates the run
        // is last run's leftover and must read as `pending`, never as its stale state.
        const mine = startMs
            ? all.filter((r) => r.startedAt && new Date(r.startedAt).getTime() >= startMs)
            : [];

        const base = {
            phase,
            label: describePhase ? describePhase(phase) : phase,
            state: STATE.PENDING,
            startedAt: null,
            completedAt: null,
            elapsedMs: null,
            lastHeartbeatAt: null,
            pollCount: mine.filter((r) => isPollJob(r.jobId)).length,
            error: null,
        };

        if (!mine.length) return base;

        // Newest activity wins — a phase that polled nine times is represented by its latest tick.
        const newest = mine.reduce((a, b) =>
            new Date(b.updatedAt || b.startedAt || 0) > new Date(a.updatedAt || a.startedAt || 0) ? b : a
        );
        const startedAt = mine.reduce((min, r) =>
            (!min || new Date(r.startedAt) < new Date(min)) ? r.startedAt : min, null);

        base.startedAt = startedAt || newest.startedAt || null;
        base.lastHeartbeatAt = newest.lastHeartbeatAt || null;

        const anyFailed = mine.some((r) =>
            r.status === 'failed' && r.failedAt && new Date(r.failedAt).getTime() >= startMs);
        const anyRunning = mine.some((r) => r.status === 'running');
        const allDone = mine.every((r) => r.status === 'completed');

        if (anyFailed) {
            const failedRow = mine.find((r) =>
                r.status === 'failed' && r.failedAt && new Date(r.failedAt).getTime() >= startMs);
            base.state = STATE.FAILED;
            base.completedAt = failedRow.failedAt || null;
            // TRAP 2: only this run's error. A stale message from a previous run is deliberately
            // dropped — surfacing it is what made healthy jobs look broken during the investigation.
            base.error = failedRow.error || null;
        } else if (anyRunning) {
            const beat = base.lastHeartbeatAt ? new Date(base.lastHeartbeatAt).getTime() : null;
            const updated = newest.updatedAt ? new Date(newest.updatedAt).getTime() : null;
            const lastSign = beat || updated;
            // `stalled` is the state nothing could show before: still marked running, but nothing has
            // moved. That is precisely the "stuck or just slow?" question this page exists to answer.
            base.state = (lastSign && lastSign < staleBefore) ? STATE.STALLED : STATE.RUNNING;
        } else if (allDone) {
            base.state = STATE.COMPLETED;
            base.completedAt = newest.completedAt || null;
        } else {
            base.state = STATE.RUNNING;
        }

        const from = base.startedAt ? new Date(base.startedAt).getTime() : null;
        if (from) {
            const to = (base.state === STATE.COMPLETED || base.state === STATE.FAILED)
                ? new Date(base.completedAt || newest.updatedAt || now).getTime()
                : now.getTime();
            base.elapsedMs = Math.max(0, to - from);
        }

        return base;
    });
}

/** The stage a human would point at: the first non-terminal one, else the last. */
function currentStageOf(stages) {
    const active = stages.find((s) => s.state === STATE.RUNNING || s.state === STATE.STALLED);
    if (active) return active.phase;
    const failed = stages.find((s) => s.state === STATE.FAILED);
    if (failed) return failed.phase;
    const pending = stages.find((s) => s.state === STATE.PENDING);
    return pending ? pending.phase : (stages[stages.length - 1]?.phase || null);
}

/**
 * GET /app/jobs/pipeline-progress?pipeline=scheduled|integration&country=US&region=NA[&userId=]
 *
 * DELIBERATELY UNCACHED. Every neighbouring analytics route wraps itself in analyseDataCache; this
 * one must not — cached progress is worse than none, because it shows a stale stage confidently.
 *
 * `userId` is honoured only for an admin caller; everyone else is scoped to their own account.
 */
const getPipelineProgress = asyncHandler(async (req, res) => {
    const pipeline = String(req.query.pipeline || 'scheduled').toLowerCase();
    if (!['scheduled', 'integration'].includes(pipeline)) {
        return res.status(400).json(new ApiError(400, "pipeline must be 'scheduled' or 'integration'"));
    }

    // adminAuth sets `req.userAccessType` (and only lets 'enterpriseAdmin' through at all), so it is
    // the marker for "may look at another account". A plain `auth` caller never has it, so an
    // unauthorised ?userId= is silently ignored rather than rejected — it cannot widen scope.
    const isAdmin = req.userAccessType === 'enterpriseAdmin';
    const requestedUserId = req.query.userId && isAdmin ? String(req.query.userId) : null;
    const userId = requestedUserId || req.userId;
    if (!userId) return res.status(400).json(new ApiError(400, 'User id is missing'));

    const country = req.query.country || req.country;
    const region = req.query.region || req.region;
    if (!country || !region) {
        return res.status(400).json(new ApiError(400, 'country and region are required'));
    }

    try {
        const mongoose = require('mongoose');
        const JobStatus = require('../../models/system/JobStatusModel.js');
        const DataFetchTracking = require('../../models/system/DataFetchTrackingModel.js');
        const phases = pipeline === 'integration'
            ? require('../../Services/BackgroundJobs/integrationPhases.js')
            : require('../../Services/BackgroundJobs/scheduledPhases.js');

        const userObjectId = new mongoose.Types.ObjectId(String(userId));

        // The run boundary. Everything downstream is relative to this — see TRAP 1.
        const tracking = await DataFetchTracking.findOne({
            User: userObjectId, country, region,
        }).sort({ fetchedAt: -1 }).lean();

        // Never-run account: an honest empty shape, not an error.
        if (!tracking) {
            return res.status(200).json(new ApiResponse(200, {
                pipeline, runStartedAt: null, overallStatus: null, dataRange: null, sessionId: null,
                currentStage: null, completedCount: 0, totalCount: phases.PHASE_ORDER.length,
                stages: phases.PHASE_ORDER.map((p) => ({
                    phase: p, label: phases.getPhaseDescription(p), state: STATE.PENDING,
                    startedAt: null, completedAt: null, elapsedMs: null,
                    lastHeartbeatAt: null, pollCount: 0, error: null,
                })),
            }, 'No run recorded for this account yet'));
        }

        const prefix = pipeline === 'integration'
            ? `integration-${userId}-${country}-${region}`
            : `scheduled-${userId}-${country}-${region}`;
        const rows = await JobStatus.find({ jobId: { $regex: `^${prefix}` } })
            .select('jobId status startedAt completedAt failedAt updatedAt duration error lastHeartbeatAt elapsedMs metadata')
            .lean();

        const stages = deriveStages({
            phaseOrder: phases.PHASE_ORDER,
            describePhase: phases.getPhaseDescription,
            rows,
            runStart: tracking.fetchedAt,
        });

        return res.status(200).json(new ApiResponse(200, {
            pipeline,
            runStartedAt: tracking.fetchedAt,
            overallStatus: tracking.status,
            dataRange: tracking.dataRange || null,
            sessionId: tracking.sessionId || null,
            currentStage: currentStageOf(stages),
            completedCount: stages.filter((s) => s.state === STATE.COMPLETED).length,
            totalCount: stages.length,
            stages,
        }, 'Pipeline progress'));
    } catch (error) {
        logger.error('getPipelineProgress failed', { error: error.message, stack: error.stack });
        return res.status(500).json(new ApiError(500, 'Could not read pipeline progress'));
    }
});

module.exports = {
    getPipelineProgress,
    // Exported for tests — the state machine is where the traps live.
    deriveStages,
    currentStageOf,
    basePhaseOf,
    isPollJob,
    STATE,
    STALE_HEARTBEAT_MINUTES,
    RUN_START_GRACE_MS,
};
