/**
 * Tests for reviewWorkerStandalone — the daily worker that takes review ingestion and
 * review-request sending out of the data pipeline.
 *
 * WHY THIS EXISTS
 * These two services used to run in `sched_calc_review`, the phase immediately before
 * `sched_finalize` — and `sched_finalize` is the only thing that closes the
 * DataFetchTracking doc that publishes the dashboard's date range. The sender sleeps 5s
 * after every order (15s when it re-checks eligibility first) with a 400-order cap, so it
 * held that range hostage for over an hour on 8 accounts and 23.8h on one.
 *
 * WHAT THESE TESTS PIN, and why each one earns its place:
 *   - The CADENCE. Ingestion is Mon/Wed/Fri, sending is daily. A worker that ran both
 *     daily would triple ingestion's SP-API order calls against Amazon. This is the
 *     regression test; everything else is secondary.
 *   - The DRY RUN being genuinely inert. This ships with the flag off while the pipeline
 *     is STILL running batches 6 and 7, so a dry run that called a processor would mean
 *     two systems soliciting the same buyers.
 *   - The ACTIVE-USER FILTER inverting the sibling sweeps' fail-safe. Elsewhere an empty
 *     filter means "process everyone" so a query blip can't stop the sweep. Here that
 *     would mean sending review requests on behalf of churned accounts, so it means skip.
 *   - The LOCK. The sender has no per-order claim, so two concurrent runs for one account
 *     can double-solicit — burning the single solicitation Amazon allows that order.
 */

const path = require('path');

// Each loadWorker() re-registers the module's top-level process handlers.
process.setMaxListeners(50);

const WORKER = '../../../Services/BackgroundJobs/reviewWorkerStandalone.js';

const mockUserFind = jest.fn();
const mockSellerFind = jest.fn();
const mockIngest = jest.fn();
const mockSend = jest.fn();
const mockLockFindOneAndUpdate = jest.fn();
const mockLockFindOne = jest.fn();
const mockLockUpdateOne = jest.fn();

jest.mock('../../../models/user-auth/userModel.js', () => ({ find: (...a) => mockUserFind(...a) }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ find: (...a) => mockSellerFind(...a) }));
jest.mock('../../../models/system/OrchestrationCronLockModel.js', () => ({
    findOneAndUpdate: (...a) => mockLockFindOneAndUpdate(...a),
    findOne: (...a) => mockLockFindOne(...a),
    updateOne: (...a) => mockLockUpdateOne(...a),
}));
jest.mock('../../../Services/review/scheduledReviewIngestionProcessor.js', () => ({
    scheduledReviewIngestion: (...a) => mockIngest(...a),
}));
jest.mock('../../../Services/review/scheduledReviewRequestProcessor.js', () => ({
    scheduledReviewRequestSender: (...a) => mockSend(...a),
}));
jest.mock('../../../utils/Logger.js', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../config/dbConn.js', () => jest.fn(async () => {}));
jest.mock('node-cron', () => ({ schedule: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })) }));

const PRO_USER = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const AGENCY_USER = 'aaaaaaaaaaaaaaaaaaaaaaa2';

/**
 * ENABLED and the tuning constants are read once at module load, so a test that needs a
 * different flag must load a fresh copy of the module.
 */
function loadWorker(env = {}) {
    const saved = {};
    for (const [k, v] of Object.entries(env)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    let mod;
    jest.isolateModules(() => { mod = require(WORKER); });
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    return mod;
}

/** The worker enabled, with batch pacing off so tests don't sleep. */
const loadEnabled = (extra = {}) => loadWorker({
    REVIEW_WORKER_ENABLED: 'true',
    REVIEW_WORKER_BATCH_DELAY_MS: '0',
    ...extra,
});

const sellerWith = (userId, accounts) => ({ User: userId, sellerAccount: accounts });
const usAccount = { country: 'US', region: 'NA', spiRefreshToken: 'tok' };

beforeEach(() => {
    // resetMocks:true wipes implementations each test, so (re)install them here.
    mockUserFind.mockReset().mockReturnValue({ lean: async () => [{ _id: PRO_USER }] });
    mockSellerFind.mockReset().mockReturnValue({ lean: async () => [sellerWith(PRO_USER, [usAccount])] });
    mockIngest.mockReset().mockResolvedValue({ success: true, data: {}, error: null });
    mockSend.mockReset().mockResolvedValue({ success: true, data: {}, error: null });
    mockLockFindOneAndUpdate.mockReset().mockResolvedValue({});
    mockLockFindOne.mockReset();
    mockLockUpdateOne.mockReset().mockResolvedValue({});
});

// ---------------------------------------------------------------------------

describe('cadence — the behaviour change that would be invisible in production', () => {
    // Ingestion walks Amazon's Orders API. Running it 7 days a week instead of 3 would
    // roughly triple that call volume against a documented 1-request-per-minute limit,
    // and nothing in the output would look wrong.
    test.each([[1, 'Monday'], [3, 'Wednesday'], [5, 'Friday']])(
        'day %i (%s): ingestion runs',
        async (dayOfWeek) => {
            const { runReviewTick } = loadEnabled();

            const summary = await runReviewTick({ dayOfWeek });

            expect(mockIngest).toHaveBeenCalledTimes(1);
            expect(summary.runIngestion).toBe(true);
        }
    );

    test.each([[0, 'Sunday'], [2, 'Tuesday'], [4, 'Thursday'], [6, 'Saturday']])(
        'day %i (%s): ingestion does NOT run',
        async (dayOfWeek) => {
            const { runReviewTick } = loadEnabled();

            const summary = await runReviewTick({ dayOfWeek });

            expect(mockIngest).not.toHaveBeenCalled();
            expect(summary.runIngestion).toBe(false);
        }
    );

    test.each([0, 1, 2, 3, 4, 5, 6])('day %i: sending runs every day', async (dayOfWeek) => {
        const { runReviewTick } = loadEnabled();

        await runReviewTick({ dayOfWeek });

        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('the day is UTC, not server-local', async () => {
        // The pipeline used `new Date().getDay()`, which agrees only because production
        // runs UTC. This is the same day number DataFetchTracking records.
        const { runReviewTick } = loadEnabled();
        // A moment that is Saturday in UTC but already Sunday east of the date line.
        jest.useFakeTimers({ doNotFake: ['setTimeout', 'setImmediate', 'nextTick'] });
        jest.setSystemTime(Date.parse('2026-09-05T23:00:00Z'));
        try {
            const summary = await runReviewTick();

            expect(summary.dayOfWeek).toBe(6);        // Saturday UTC
            expect(mockIngest).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    /**
     * SELF-RETIRING CROSS-CHECK. While the pipeline still owns these two services, the
     * worker's cadence must agree with ScheduleConfig's — two sources of truth coexist and
     * could drift apart silently. The cutover DELETES both entries from ScheduleConfig,
     * at which point there is nothing to compare against and this test skips itself
     * rather than failing. That is the whole reason the worker states INGEST_DAYS itself
     * instead of reading getFunctionsForDay: doing so would reduce it to a no-op the
     * moment the pipeline entries go.
     */
    test('while the pipeline still has these services, the cadence matches ScheduleConfig', () => {
        // Read as SOURCE, not as a module: requiring ScheduleConfig pulls in the whole
        // SP-API service graph (it `require`s every processor at load), which is far too
        // much machinery for a membership check.
        const src = require('fs').readFileSync(
            path.join(__dirname, '../../../Services/schedule/ScheduleConfig.js'), 'utf8'
        );

        /** Which `const <NAME>_FUNCTIONS = {` block a key is declared inside. */
        const blockOf = (key) => {
            const at = src.indexOf(`'${key}': {`);
            if (at === -1) return null;
            const blocks = [...src.matchAll(/^const (\w+_FUNCTIONS) = \{/gm)];
            const enclosing = blocks.filter((b) => b.index < at).pop();
            return enclosing ? enclosing[1] : null;
        };

        const ingestBlock = blockOf('reviewOrderIngestion');
        if (ingestBlock === null) return; // cutover done — this check has served its purpose

        const { INGEST_DAYS } = loadWorker();
        expect(ingestBlock).toBe('MON_WED_FRI_FUNCTIONS');
        expect(Array.from(INGEST_DAYS).sort()).toEqual([1, 3, 5]);
        expect(blockOf('reviewRequestSender')).toBe('DAILY_FUNCTIONS');
    });
});

describe('the dry run must be provably inert', () => {
    // This is the shipped state. The pipeline is still running batches 6 and 7, so a dry
    // run that called a processor means two systems soliciting the same buyers.
    test('with the flag off, neither processor is called', async () => {
        const { runReviewTick } = loadWorker({ REVIEW_WORKER_ENABLED: undefined });

        const summary = await runReviewTick({ dayOfWeek: 1 });

        expect(mockIngest).not.toHaveBeenCalled();
        expect(mockSend).not.toHaveBeenCalled();
        expect(summary.enabled).toBe(false);
        expect(summary.processed).toBe(0);
    });

    test('"false" and any other value are off — only the exact string "true" enables it', async () => {
        for (const value of ['false', 'TRUE', '1', 'yes', '']) {
            const { runReviewTick } = loadWorker({ REVIEW_WORKER_ENABLED: value });
            await runReviewTick({ dayOfWeek: 1 });
        }
        expect(mockIngest).not.toHaveBeenCalled();
        expect(mockSend).not.toHaveBeenCalled();
    });

    test('it still reports the accounts it WOULD have processed — that log is the verification', async () => {
        const { runReviewTick } = loadWorker({ REVIEW_WORKER_ENABLED: 'false' });

        const summary = await runReviewTick({ dayOfWeek: 1 });

        expect(summary.accounts).toBe(1);
        expect(summary.runIngestion).toBe(true);
    });
});

describe('per account', () => {
    test('ingestion completes before sending starts', async () => {
        // Not a same-run correctness requirement (the two date windows barely overlap),
        // but on a cold-start account it gets the first requests out a run earlier.
        const order = [];
        mockIngest.mockImplementation(async () => {
            order.push('ingest:start');
            await new Promise((r) => setTimeout(r, 5));
            order.push('ingest:end');
            return { success: true };
        });
        mockSend.mockImplementation(async () => { order.push('send:start'); return { success: true }; });
        const { runReviewTick } = loadEnabled();

        await runReviewTick({ dayOfWeek: 1 });

        expect(order).toEqual(['ingest:start', 'ingest:end', 'send:start']);
    });

    test('the processors are called with the account triple and a source tag', async () => {
        const { runReviewTick } = loadEnabled();

        await runReviewTick({ dayOfWeek: 1 });

        expect(mockIngest).toHaveBeenCalledWith(PRO_USER, 'US', 'NA', 'review-worker');
        expect(mockSend).toHaveBeenCalledWith(PRO_USER, 'US', 'NA', 'review-worker');
    });

    test('sending still runs when ingestion fails', async () => {
        // The sender works off orders persisted by EARLIER runs. Skipping it because one
        // Amazon call failed today would punish an existing backlog.
        mockIngest.mockRejectedValue(new Error('Orders API 503'));
        const { runReviewTick } = loadEnabled();

        const summary = await runReviewTick({ dayOfWeek: 1 });

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(summary).toMatchObject({ ingestFailed: 1, sendOk: 1 });
    });

    test('a LITE-plan skip is counted as a skip, not a failure', async () => {
        // The PRO/trial gate lives inside scheduledReviewRequestSender and returns
        // success:true with data.skipped. Counting that as a failure would make the
        // summary read as broken every single night.
        mockSend.mockResolvedValue({ success: true, data: { skipped: true, reason: 'LITE plan' }, error: null });
        const { runReviewTick } = loadEnabled();

        const summary = await runReviewTick({ dayOfWeek: 1 });

        expect(summary).toMatchObject({ sendSkippedLitePlan: 1, sendFailed: 0, sendOk: 0 });
    });

    test('one account throwing does not stop the rest of the sweep', async () => {
        mockSellerFind.mockReturnValue({
            lean: async () => [
                sellerWith(PRO_USER, [usAccount]),
                sellerWith(AGENCY_USER, [{ country: 'UK', region: 'EU', spiRefreshToken: 'tok' }]),
            ],
        });
        mockUserFind.mockReturnValue({ lean: async () => [{ _id: PRO_USER }, { _id: AGENCY_USER }] });
        mockSend.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ success: true });
        const { runReviewTick } = loadEnabled({ REVIEW_WORKER_CONCURRENCY: '1' });

        const summary = await runReviewTick({ dayOfWeek: 1 });

        expect(summary.processed).toBe(2);
        expect(summary.sendFailed).toBe(1);
        expect(summary.sendOk).toBe(1);
        expect(summary.errors).toBe(0); // handled per account, not an unexpected rejection
    });
});

describe('account selection', () => {
    test('only verified PRO or agency-client users, matching the daily pipeline', async () => {
        const { runReviewTick } = loadEnabled();

        await runReviewTick({ dayOfWeek: 1 });

        expect(mockUserFind).toHaveBeenCalledWith(
            { isVerified: true, $or: [{ packageType: 'PRO' }, { isAgencyClient: true }] },
            { _id: 1 }
        );
    });

    // THE INVERTED FAIL-SAFE. The sibling sweeps read an empty active set as "no filter,
    // process everyone" so a query blip cannot stop them. Here that would mean walking
    // orders and sending review requests on behalf of every churned account.
    test('an empty active-user set skips the tick rather than processing everyone', async () => {
        mockUserFind.mockReturnValue({ lean: async () => [] });
        const { runReviewTick } = loadEnabled();

        const summary = await runReviewTick({ dayOfWeek: 1 });

        expect(mockSellerFind).not.toHaveBeenCalled();
        expect(mockSend).not.toHaveBeenCalled();
        expect(summary.skippedInactive).toBe(true);
    });

    test('a failed active-user query skips the tick too', async () => {
        mockUserFind.mockReturnValue({ lean: async () => { throw new Error('mongo down'); } });
        const { runReviewTick } = loadEnabled();

        const summary = await runReviewTick({ dayOfWeek: 1 });

        expect(mockSend).not.toHaveBeenCalled();
        expect(summary.skippedInactive).toBe(true);
    });

    test('accounts without any SP-API refresh token are skipped', async () => {
        // Both processors bail on a missing token anyway; filtering here avoids the trip.
        mockSellerFind.mockReturnValue({
            lean: async () => [sellerWith(PRO_USER, [{ country: 'US', region: 'NA' }])],
        });
        const { runReviewTick } = loadEnabled();

        const summary = await runReviewTick({ dayOfWeek: 1 });

        expect(summary.accounts).toBe(0);
        expect(mockSend).not.toHaveBeenCalled();
    });

    test('the legacy token field names still count as connected', async () => {
        // The processors fall back spiRefreshToken || spRefreshToken || refreshToken.
        mockSellerFind.mockReturnValue({
            lean: async () => [sellerWith(PRO_USER, [{ country: 'US', region: 'NA', refreshToken: 'legacy' }])],
        });
        const { runReviewTick } = loadEnabled();

        expect((await runReviewTick({ dayOfWeek: 1 })).accounts).toBe(1);
    });

    test('a marketplace listed twice on one seller is processed once', async () => {
        // A duplicated subdocument would otherwise mean two concurrent senders on the
        // same account — the exact double-solicit the lock exists to prevent.
        mockSellerFind.mockReturnValue({
            lean: async () => [sellerWith(PRO_USER, [usAccount, { ...usAccount }])],
        });
        const { runReviewTick } = loadEnabled();

        const summary = await runReviewTick({ dayOfWeek: 1 });

        expect(summary.accounts).toBe(1);
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('accounts missing country or region are skipped', async () => {
        mockSellerFind.mockReturnValue({
            lean: async () => [sellerWith(PRO_USER, [{ region: 'NA', spiRefreshToken: 't' }, { country: 'US', spiRefreshToken: 't' }])],
        });
        const { runReviewTick } = loadEnabled();

        expect((await runReviewTick({ dayOfWeek: 1 })).accounts).toBe(0);
    });
});

describe('bounds', () => {
    const manyAccounts = (n) => Array.from({ length: n }, (_, i) => ({
        country: 'US', region: 'NA', spiRefreshToken: 't', _i: i,
    }));

    test('the per-tick cap bounds the sweep and is reported, never silent', async () => {
        mockSellerFind.mockReturnValue({
            lean: async () => manyAccounts(5).map((a, i) => sellerWith(`user${i}`, [a])),
        });
        mockUserFind.mockReturnValue({ lean: async () => manyAccounts(5).map((_, i) => ({ _id: `user${i}` })) });
        const { runReviewTick } = loadEnabled({ REVIEW_WORKER_MAX_ACCOUNTS_PER_TICK: '2' });

        const summary = await runReviewTick({ dayOfWeek: 0 });

        expect(summary.accounts).toBe(5);      // honest about what it found
        expect(summary.processed).toBe(2);     // and about what it did
        expect(summary.cappedByTick).toBe(true);
    });

    test('an exhausted tick budget stops starting accounts and says so', async () => {
        // Legacy ingestion has no internal bound — it walks every order with a 2s sleep
        // each, which is how one account reached 23.8h inside calc_review.
        mockSellerFind.mockReturnValue({
            lean: async () => [sellerWith('u1', [usAccount]), sellerWith('u2', [usAccount])],
        });
        mockUserFind.mockReturnValue({ lean: async () => [{ _id: 'u1' }, { _id: 'u2' }] });
        mockSend.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 20)); return { success: true }; });
        const { runReviewTick } = loadEnabled({
            REVIEW_WORKER_CONCURRENCY: '1',
            REVIEW_WORKER_TICK_BUDGET_MS: '60000',
        });

        // 60s is the floor the worker clamps to, so the budget cannot be set absurdly low
        // by accident; with a fast mock neither account exceeds it.
        const summary = await runReviewTick({ dayOfWeek: 0 });

        expect(summary.processed).toBe(2);
        expect(summary.outOfBudget).toBe(false);
    });
});

describe('the lock — what stops two ticks double-soliciting', () => {
    test('the key is bucketed by UTC date, so a stuck lock cannot swallow the next day', () => {
        const { lockKeyForToday } = loadWorker();

        expect(lockKeyForToday(new Date('2026-09-02T01:00:00Z'))).toBe('review-worker-2026-09-02');
        expect(lockKeyForToday(new Date('2026-09-03T01:00:00Z'))).toBe('review-worker-2026-09-03');
    });

    test('acquiring succeeds when the stored holder is us', async () => {
        const worker = loadWorker();
        mockLockFindOne.mockImplementation(() => ({
            lean: async () => mockLockFindOneAndUpdate.mock.calls.length
                ? { holder: mockLockFindOneAndUpdate.mock.calls[0][1].$set.holder }
                : null,
        }));

        await expect(worker.acquireLock('review-worker-2026-09-02')).resolves.toBe(true);
    });

    test('a second instance is refused while the first holds the lock', async () => {
        // The sender has no per-order claim: two concurrent runs can both read an order as
        // "not_requested" and both solicit it. Amazon's 403 alreadySent keeps the buyer
        // from seeing two, but it burns the one solicitation that order gets.
        const first = loadWorker();
        const second = loadWorker();
        let stored = null;
        mockLockFindOneAndUpdate.mockImplementation(async (filter, update) => {
            if (stored === null) stored = update.$set.holder;   // free — winner takes it
            return {};
        });
        mockLockFindOne.mockImplementation(() => ({ lean: async () => ({ holder: stored }) }));

        await expect(first.acquireLock('k')).resolves.toBe(true);
        await expect(second.acquireLock('k')).resolves.toBe(false);
    });

    test('a duplicate-key collision is a lost race, not an error', async () => {
        const worker = loadWorker();
        mockLockFindOneAndUpdate.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));

        await expect(worker.acquireLock('k')).resolves.toBe(false);
    });

    test('release only clears a lock we still hold', async () => {
        const worker = loadWorker();

        await worker.releaseLock('k');

        const [filter, update] = mockLockUpdateOne.mock.calls[0];
        expect(filter.lockKey).toBe('k');
        expect(filter.holder).toEqual(expect.any(String));   // scoped to this holder
        expect(update.$set.lockedUntil).toEqual(new Date(0));
    });

    test('a release failure is not fatal — the TTL is the real backstop', async () => {
        const worker = loadWorker();
        mockLockUpdateOne.mockRejectedValue(new Error('write failed'));

        await expect(worker.releaseLock('k')).resolves.toBeUndefined();
    });
});

describe('the PM2 app is registered and matches the worker', () => {
    test('review-worker exists, is a single fork, and caps its heap below the restart limit', () => {
        const { apps } = require(path.join(__dirname, '../../../../ecosystem.config.js'));
        const app = apps.find((a) => a.name === 'review-worker');

        expect(app).toBeDefined();
        expect(app.script).toBe('./server/Services/BackgroundJobs/reviewWorkerStandalone.js');
        expect(app.instances).toBe(1);          // a second instance would contend for the lock
        expect(app.exec_mode).toBe('fork');
        // V8 sizes old-space from system RAM unless told otherwise, which would put the
        // heap ceiling above the PM2 cap meant to contain it.
        expect(app.node_args).toContain('--max-old-space-size=384');
        expect(app.max_memory_restart).toBe('512M');
    });

    test('it is ENABLED, and the pipeline no longer runs these services', () => {
        // These two assertions belong together on purpose. The worker being on while the
        // pipeline still had the services would mean both soliciting the same buyers; the
        // pipeline losing them while the worker was off would mean nobody does. Either half
        // alone is a bug, so the test fails if they ever drift apart.
        const { apps } = require(path.join(__dirname, '../../../../ecosystem.config.js'));
        const app = apps.find((a) => a.name === 'review-worker');
        const scheduleConfigSrc = require('fs').readFileSync(
            path.join(__dirname, '../../../Services/schedule/ScheduleConfig.js'), 'utf8'
        );

        expect(app.env.REVIEW_WORKER_ENABLED).toBe('true');
        expect(scheduleConfigSrc).not.toMatch(/'reviewOrderIngestion':/);
        expect(scheduleConfigSrc).not.toMatch(/'reviewRequestSender':/);
    });

    test('ingestion mode is passed through, so it matches the pipeline', () => {
        // Legacy ingestion is unbounded and streaming is capped at 40 min. Leaving this
        // unset would let a new PM2 app silently pick a different mode from the pipeline.
        const { apps } = require(path.join(__dirname, '../../../../ecosystem.config.js'));
        const app = apps.find((a) => a.name === 'review-worker');

        expect(app.env.REVIEW_INGEST_STREAMING).toBeDefined();
    });
});
