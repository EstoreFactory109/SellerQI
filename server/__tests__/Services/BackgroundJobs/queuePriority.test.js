/**
 * Tests for queue precedence and lock timing — the two things that decide whether the daily pipeline
 * can actually get a worker slot.
 *
 * WHY THIS EXISTS
 * Observed in production: 36 active jobs, EVERY one a catch-up job, zero daily-pipeline phases, with
 * 26 more catch-up jobs queued behind them. A customer's account sat frozen because its `sched_init`
 * was stuck behind that backlog; stopping the sweeper by hand freed the queue and it immediately
 * progressed. Separately, ~half of those 36 "active" jobs were phantom — held by workers that had
 * already died, because the lock took up to an hour (2h if the worker died early) to lapse.
 *
 * THE VERSION TRAP THESE TESTS GUARD
 * BullMQ inverted priority between v4 and v5. In the installed 5.76.7, 0 is the HIGHEST priority and
 * is the default, and moveToActive drains the `wait` list (priority 0) completely before touching the
 * `prioritized` set. So the fix is to mark CATCH-UP jobs only — the daily pipeline must keep NO
 * priority. Anyone "helpfully" adding a priority to the daily path would move it into `prioritized`
 * and destroy the precedence this buys, so that absence is asserted explicitly below.
 */

jest.mock('../../../models/system/DataFetchTrackingModel.js', () => ({
    aggregate: jest.fn(), findOne: jest.fn(), updateMany: jest.fn(),
}));
jest.mock('../../../models/system/JobStatusModel.js', () => ({ findOne: jest.fn(), find: jest.fn() }));
jest.mock('../../../models/user-auth/userModel.js', () => ({ find: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock('../../../models/amazon-ads/PPCMetricsModel.js', () => ({}));
jest.mock('../../../models/finance/FinanceSyncLogModel.js', () => ({}));
jest.mock('../../../models/finance/DailySkuFinanceModel.js', () => ({}));
jest.mock('../../../models/system/ErrorLogs.js', () => ({
    find: jest.fn(), updateMany: jest.fn(), countDocuments: jest.fn(),
}));
jest.mock('../../../Services/BackgroundJobs/UserSchedulingService.js', () => ({
    UserSchedulingService: { shouldAttemptAccountUpdate: jest.fn() },
}));
jest.mock('../../../Services/BackgroundJobs/producer.js', () => ({ enqueueScheduledAccountJob: jest.fn() }));
jest.mock('../../../Services/BackgroundJobs/queue.js', () => ({ getQueue: () => ({ getJob: jest.fn(), add: jest.fn() }) }));

const { CATCHUP_JOB_OPTS, CATCHUP_JOB_PRIORITY } = require('../../../Services/BackgroundJobs/freshnessSweeper.js');

describe('catch-up jobs yield to the daily pipeline', () => {
    // THE regression test. Without a priority these jobs land in `wait` alongside the daily
    // pipeline and win on FIFO, which is exactly how an account got starved.
    test('catch-up job options carry a non-zero priority', () => {
        expect(CATCHUP_JOB_PRIORITY).toBeGreaterThan(0);
        expect(CATCHUP_JOB_OPTS.priority).toBe(CATCHUP_JOB_PRIORITY);
    });

    test('the priority is a positive integer — BullMQ rejects fractional priorities', () => {
        expect(Number.isInteger(CATCHUP_JOB_OPTS.priority)).toBe(true);
        expect(CATCHUP_JOB_OPTS.priority).toBeGreaterThanOrEqual(1);
    });

    test('the retry/retention options are untouched by the priority change', () => {
        // Those bound how often a permanently-failing date is retried; a regression here would
        // re-introduce the every-few-hours re-enqueue loop the comments describe.
        expect(CATCHUP_JOB_OPTS.attempts).toBe(3);
        expect(CATCHUP_JOB_OPTS.removeOnFail).toEqual({ age: 7 * 24 * 3600, count: 1000 });
    });

    // The daily pipeline must stay at the implicit default of 0 to remain in the `wait` list.
    test('the scheduled pipeline sets NO priority anywhere', () => {
        const fs = require('fs');
        const path = require('path');
        const root = path.resolve(__dirname, '../../../Services/BackgroundJobs');

        for (const file of ['producer.js', 'worker.js']) {
            const src = fs.readFileSync(path.join(root, file), 'utf8');
            // enqueueUserJob in producer.js has a documented `options.priority` passthrough for the
            // legacy per-user path; the scheduled phase enqueues must not set one.
            const scheduledEnqueues = src
                .split('\n')
                .filter((l) => /priority/.test(l) && /scheduled|phase|initJobId|nextJobId|selfJobId/i.test(l));
            expect(scheduledEnqueues).toEqual([]);
        }
    });
});

describe('lock timing — reclaiming a dead worker\'s slot', () => {
    const worker = require('fs').readFileSync(
        require('path').resolve(__dirname, '../../../Services/BackgroundJobs/worker.js'), 'utf8'
    );

    /** Pull a numeric default out of the constant's env-fallback expression. */
    const defaultOf = (name) => {
        const re = new RegExp(`${name}[\\s\\S]{0,400}?\\|\\|\\s*([\\d\\s*]+)\\n\\s*\\);`, 'm');
        const m = re.exec(worker);
        expect(m).toBeTruthy();
        // eslint-disable-next-line no-eval
        return eval(m[1]);
    };

    const duration = defaultOf('const LOCK_DURATION');
    const interval = defaultOf('const LOCK_EXTENSION_INTERVAL');
    const amount = defaultOf('const LOCK_EXTENSION_AMOUNT');

    test('the keep-alive fires well inside both the initial lock and each extension', () => {
        // If the interval ever exceeded either, a healthy job would lose its lock and be RE-RUN —
        // and calc_review sends review requests, so a re-run means duplicate requests to sellers.
        expect(interval).toBeLessThan(duration);
        expect(interval).toBeLessThan(amount);
    });

    test('tolerance for consecutive missed renewals is no worse than the old 3', () => {
        // The real safety measure. Old settings (15min interval / 60min extension) tolerated 3
        // missed renewals; this must not silently regress below that while chasing lower latency.
        expect(Math.floor(amount / interval)).toBeGreaterThanOrEqual(3);
    });

    test('a dead worker\'s slot is reclaimed materially faster than the old hour', () => {
        // Reclaim latency is bounded by the extension amount, and by the INITIAL lock for a worker
        // that dies before its first renewal — which is why both moved.
        expect(amount).toBeLessThanOrEqual(30 * 60 * 1000);
        expect(duration).toBeLessThanOrEqual(30 * 60 * 1000);
    });

    test('the initial lock is not shorter than one extension, so the first window is not the weakest', () => {
        expect(duration).toBeGreaterThanOrEqual(amount);
    });

    test('integrationWorker uses the same env vars, so the two cannot drift apart', () => {
        const iw = require('fs').readFileSync(
            require('path').resolve(__dirname, '../../../Services/BackgroundJobs/integrationWorker.js'), 'utf8'
        );
        for (const v of [
            'WORKER_LOCK_DURATION_MS',
            'WORKER_LOCK_EXTENSION_INTERVAL_MS',
            'WORKER_LOCK_EXTENSION_AMOUNT_MS',
        ]) {
            expect(worker).toContain(v);
            expect(iw).toContain(v);
        }
    });
});
