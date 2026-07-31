/**
 * Tests for asyncReportEngine (P8) — the BidBison-style non-blocking report
 * orchestration state machine. Uses an in-memory fake AsyncReportRequest model and
 * mock adapters, so it validates the SUBMIT → POLL → terminal logic with zero DB/Amazon.
 *
 * These lock the properties that matter:
 *   - SUBMIT creates one row per spec and does NOT finalize
 *   - a report still processing → done:false + reschedule (worker released)
 *   - a ready report → finalize() runs, row DONE; empty → NO_DATA
 *   - all-terminal → done:true (pipeline advances)
 *   - failures never block (FAILED is terminal, still advances)
 *   - poll cap is enforced (the fix for the previously-uncapped pollers)
 */

const { runAsyncAdsReports, findStuckAdsAccounts } = require('../../../Services/AmazonAds/asyncReportEngine.js');

// ---- Minimal in-memory fake of the AsyncReportRequest mongoose model ----------
function makeFakeModel() {
    let seq = 1;
    const docs = [];
    const matches = (doc, filter) =>
        Object.entries(filter).every(([k, v]) => {
            if (v && typeof v === 'object' && !(v instanceof Date)) {
                if ('$lt' in v) return doc[k] != null && doc[k] < v.$lt;
                // findStuckAdsAccounts filters `phase` with $in so it can cover both the ads and
                // finance domains in one sweep.
                if ('$in' in v) return v.$in.some(x => String(doc[k]) === String(x));
                return false;
            }
            return String(doc[k]) === String(v);
        });

    return {
        _docs: docs,
        find(filter) {
            return { lean: async () => docs.filter(d => matches(d, filter)).map(d => ({ ...d })) };
        },
        async updateOne(filter, update, opts = {}) {
            const set = update.$set || {};
            const setOnInsert = update.$setOnInsert || {};
            let doc = docs.find(d => matches(d, filter));
            if (doc) {
                Object.assign(doc, set);
                return { matchedCount: 1, modifiedCount: 1 };
            }
            if (opts.upsert) {
                doc = { _id: seq++, pollAttempts: 0, status: 'SUBMITTED', ...setOnInsert, ...set };
                docs.push(doc);
                return { matchedCount: 0, upsertedCount: 1 };
            }
            return { matchedCount: 0, modifiedCount: 0 };
        },
    };
}

const ACCT = { userId: 'u1', country: 'US', region: 'NA', runDate: '2026-07-20' };

function specFor(service, adapters) {
    return {
        service,
        paramsKey: adapters.paramsKey || 'default',
        params: { foo: 'bar' },
        marketplaceId: 'ATVPDKIKX0DER',
        submit: adapters.submit,
        checkStatusOnce: adapters.checkStatusOnce,
        finalize: adapters.finalize,
        ...(adapters.maxPollAttempts ? { maxPollAttempts: adapters.maxPollAttempts } : {}),
    };
}

describe('asyncReportEngine — SUBMIT stage', () => {
    it('creates one SUBMITTED row per spec with its reportId, does not finalize, and asks to reschedule', async () => {
        const Model = makeFakeModel();
        const finalize = jest.fn();
        const specs = [
            specFor('svcA', { paramsKey: 'SP', submit: async () => 'rep-A', checkStatusOnce: jest.fn(), finalize }),
            specFor('svcB', { paramsKey: 'SB', submit: async () => 'rep-B', checkStatusOnce: jest.fn(), finalize }),
        ];
        const res = await runAsyncAdsReports({ ...ACCT, specs, Model });

        expect(res.done).toBe(false);
        expect(res.reschedule).toEqual({ delayMs: 60000, pollAttempt: 1 });
        expect(Model._docs).toHaveLength(2);
        expect(Model._docs.map(d => d.reportId).sort()).toEqual(['rep-A', 'rep-B']);
        expect(Model._docs.every(d => d.status === 'SUBMITTED')).toBe(true);
        expect(finalize).not.toHaveBeenCalled();
    });

    it('uses initialDelayMs for the first wait after SUBMIT (long wait for slow ads reports)', async () => {
        const Model = makeFakeModel();
        const specs = [specFor('svcA', { submit: async () => 'rep-A', checkStatusOnce: jest.fn(), finalize: jest.fn() })];
        const res = await runAsyncAdsReports({ ...ACCT, specs, Model, pollDelayMs: 300000, initialDelayMs: 3600000 });
        expect(res.done).toBe(false);
        expect(res.reschedule.delayMs).toBe(3600000); // initial (1h) delay, not the 5min poll delay
    });

    it('marks a spec NO_DATA (terminal) when submit returns no reportId', async () => {
        const Model = makeFakeModel();
        const specs = [specFor('svcA', { submit: async () => null, checkStatusOnce: jest.fn(), finalize: jest.fn() })];
        const res = await runAsyncAdsReports({ ...ACCT, specs, Model });
        expect(res.done).toBe(true); // only spec is terminal
        expect(Model._docs[0].status).toBe('NO_DATA');
    });

    it('marks a spec FAILED (terminal, non-blocking) when submit throws', async () => {
        const Model = makeFakeModel();
        const specs = [specFor('svcA', { submit: async () => { throw new Error('boom'); }, checkStatusOnce: jest.fn(), finalize: jest.fn() })];
        const res = await runAsyncAdsReports({ ...ACCT, specs, Model });
        expect(res.done).toBe(true);
        expect(Model._docs[0].status).toBe('FAILED');
    });
});

describe('asyncReportEngine — POLL stage', () => {
    // Helper: seed a SUBMITTED row (simulating a prior SUBMIT run). group defaults to
    // 'sched_ads' to match the engine's default scope.
    async function seed(Model, service, reportId, extra = {}) {
        await Model.updateOne(
            { ...ACCT, group: 'sched_ads', phase: 'ads', service, paramsKey: 'default' },
            { $set: { ...ACCT, group: 'sched_ads', phase: 'ads', service, paramsKey: 'default', reportId, status: 'SUBMITTED', maxPollAttempts: 240, ...extra }, $setOnInsert: { pollAttempts: 0 } },
            { upsert: true }
        );
    }

    it('still-processing report → done:false, reschedule, pollAttempts incremented', async () => {
        const Model = makeFakeModel();
        await seed(Model, 'svcA', 'rep-A');
        const finalize = jest.fn();
        const specs = [specFor('svcA', { submit: jest.fn(), checkStatusOnce: async () => 'PROCESSING', finalize })];

        const res = await runAsyncAdsReports({ ...ACCT, specs, Model, pollAttempt: 1 });
        expect(res.done).toBe(false);
        expect(res.reschedule.pollAttempt).toBe(2);
        expect(Model._docs[0].pollAttempts).toBe(1);
        expect(Model._docs[0].status).toBe('SUBMITTED');
        expect(finalize).not.toHaveBeenCalled();
    });

    it('uses pollDelayMs (not initialDelayMs) for re-checks after the first', async () => {
        const Model = makeFakeModel();
        await seed(Model, 'svcA', 'rep-A');
        const specs = [specFor('svcA', { submit: jest.fn(), checkStatusOnce: async () => 'PROCESSING', finalize: jest.fn() })];
        const res = await runAsyncAdsReports({ ...ACCT, specs, Model, pollDelayMs: 300000, initialDelayMs: 3600000, pollAttempt: 1 });
        expect(res.reschedule.delayMs).toBe(300000); // 5min poll delay, since rows already exist (not the first wait)
    });

    it('ready report → finalize runs, row DONE, and (all terminal) done:true', async () => {
        const Model = makeFakeModel();
        await seed(Model, 'svcA', 'rep-A');
        const finalize = jest.fn(async () => ({ empty: false }));
        const specs = [specFor('svcA', { submit: jest.fn(), checkStatusOnce: async () => ({ ready: true, handle: { url: 'x' } }), finalize })];

        const res = await runAsyncAdsReports({ ...ACCT, specs, Model });
        expect(finalize).toHaveBeenCalledTimes(1);
        expect(finalize.mock.calls[0][0]).toEqual({ url: 'x' }); // handle passed through
        expect(Model._docs[0].status).toBe('DONE');
        expect(res.done).toBe(true);
        expect(res.summary).toMatchObject({ total: 1, done: 1, noData: 0, failed: 0 });
    });

    it('stashes finalize().result on the row so the phase can combine reports before saving', async () => {
        const Model = makeFakeModel();
        await seed(Model, 'svcA', 'rep-A');
        const metrics = { totalSpend: 12.5, campaigns: [{ id: 'c1' }] };
        const specs = [specFor('svcA', { submit: jest.fn(), checkStatusOnce: async () => ({ ready: true, handle: {} }), finalize: async () => ({ empty: false, result: metrics }) })];
        await runAsyncAdsReports({ ...ACCT, specs, Model });
        expect(Model._docs[0].status).toBe('DONE');
        expect(Model._docs[0].result).toEqual(metrics);
    });

    it('ready but empty report → NO_DATA', async () => {
        const Model = makeFakeModel();
        await seed(Model, 'svcA', 'rep-A');
        const specs = [specFor('svcA', { submit: jest.fn(), checkStatusOnce: async () => ({ ready: true, handle: {} }), finalize: async () => ({ empty: true }) })];
        const res = await runAsyncAdsReports({ ...ACCT, specs, Model });
        expect(Model._docs[0].status).toBe('NO_DATA');
        expect(res.done).toBe(true);
    });

    it('finalize throwing → FAILED (terminal, does not block pipeline)', async () => {
        const Model = makeFakeModel();
        await seed(Model, 'svcA', 'rep-A');
        const specs = [specFor('svcA', { submit: jest.fn(), checkStatusOnce: async () => ({ ready: true, handle: {} }), finalize: async () => { throw new Error('save failed'); } })];
        const res = await runAsyncAdsReports({ ...ACCT, specs, Model });
        expect(Model._docs[0].status).toBe('FAILED');
        expect(res.done).toBe(true); // still advances
    });

    it('enforces the poll cap → FAILED once attempts reach maxPollAttempts', async () => {
        const Model = makeFakeModel();
        await seed(Model, 'svcA', 'rep-A', { pollAttempts: 2, maxPollAttempts: 3 });
        const specs = [specFor('svcA', { submit: jest.fn(), checkStatusOnce: async () => 'PROCESSING', finalize: jest.fn() })];
        const res = await runAsyncAdsReports({ ...ACCT, specs, Model });
        // 2 -> 3 reaches cap -> FAILED
        expect(Model._docs[0].status).toBe('FAILED');
        expect(res.done).toBe(true);
    });

    it('checkStatusOnce throwing bumps attempts (kept SUBMITTED) until cap', async () => {
        const Model = makeFakeModel();
        await seed(Model, 'svcA', 'rep-A', { pollAttempts: 0, maxPollAttempts: 240 });
        const specs = [specFor('svcA', { submit: jest.fn(), checkStatusOnce: async () => { throw new Error('429'); }, finalize: jest.fn() })];
        const res = await runAsyncAdsReports({ ...ACCT, specs, Model });
        expect(Model._docs[0].status).toBe('SUBMITTED');
        expect(Model._docs[0].pollAttempts).toBe(1);
        expect(res.done).toBe(false);
    });

    it('reconciliation: findStuckAdsAccounts returns deduped accounts with stale SUBMITTED rows', async () => {
        const Model = makeFakeModel();
        const now = 10_000_000;
        const stale = new Date(now - 30 * 60 * 1000); // 30 min old
        const fresh = new Date(now - 1 * 60 * 1000);  // 1 min old
        // Two stale SUBMITTED rows for the SAME account+group (should dedupe to 1).
        Model._docs.push({ _id: 1, phase: 'ads', group: 'sched_ads', status: 'SUBMITTED', userId: 'u1', country: 'US', region: 'NA', runDate: '2026-07-20', updatedAt: stale });
        Model._docs.push({ _id: 2, phase: 'ads', group: 'sched_ads', status: 'SUBMITTED', userId: 'u1', country: 'US', region: 'NA', runDate: '2026-07-20', updatedAt: stale });
        // A different stale account.
        Model._docs.push({ _id: 3, phase: 'ads', group: 'sched_ads', status: 'SUBMITTED', userId: 'u2', country: 'CA', region: 'NA', runDate: '2026-07-20', updatedAt: stale });
        // Fresh (not yet stale) — excluded.
        Model._docs.push({ _id: 4, phase: 'ads', group: 'sched_ads', status: 'SUBMITTED', userId: 'u3', country: 'US', region: 'NA', runDate: '2026-07-20', updatedAt: fresh });
        // Terminal — excluded.
        Model._docs.push({ _id: 5, phase: 'ads', group: 'sched_ads', status: 'DONE', userId: 'u4', country: 'US', region: 'NA', runDate: '2026-07-20', updatedAt: stale });

        const stuck = await findStuckAdsAccounts({ staleMs: 15 * 60 * 1000, now, Model });
        expect(stuck).toHaveLength(2);
        expect(stuck).toEqual(expect.arrayContaining([
            { userId: 'u1', country: 'US', region: 'NA', runDate: '2026-07-20', group: 'sched_ads' },
            { userId: 'u2', country: 'CA', region: 'NA', runDate: '2026-07-20', group: 'sched_ads' },
        ]));
    });

    it('mixed batch: one ready, one processing → done:false until the slow one finishes', async () => {
        const Model = makeFakeModel();
        await seed(Model, 'fast', 'rep-fast');
        await seed(Model, 'slow', 'rep-slow');
        const specs = [
            specFor('fast', { submit: jest.fn(), checkStatusOnce: async () => ({ ready: true, handle: {} }), finalize: async () => ({ empty: false }) }),
            specFor('slow', { submit: jest.fn(), checkStatusOnce: async () => 'PROCESSING', finalize: jest.fn() }),
        ];
        const res = await runAsyncAdsReports({ ...ACCT, specs, Model });
        expect(res.done).toBe(false);
        const byService = Object.fromEntries(Model._docs.map(d => [d.service, d.status]));
        expect(byService.fast).toBe('DONE');
        expect(byService.slow).toBe('SUBMITTED');
    });
});
