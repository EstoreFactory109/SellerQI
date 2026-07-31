/**
 * asyncReportEngine.js — BidBison-style non-blocking report orchestration (P8).
 *
 * Instead of a worker sleeping inline while Amazon generates a report, this engine
 * drives a "submit → re-check later" state machine backed by the AsyncReportRequest
 * collection. It is deliberately transport-agnostic: each ads service supplies three
 * small adapter functions, so the engine contains ZERO Amazon-specific code and is
 * fully unit-testable with mock adapters.
 *
 * An adapter "spec" (one per report to fetch):
 *   {
 *     service,        // string, e.g. 'ppcMetricsAggregated'
 *     paramsKey,      // stable string identifying the variant (e.g. campaignType) — dedupe key
 *     params,         // opaque blob persisted so finalize() can run later
 *     marketplaceId,  // optional
 *     maxPollAttempts,// optional per-spec cap (defaults to opts.maxPollAttempts)
 *     submit()             -> Promise<reportId>        // CREATE the report (no polling)
 *     checkStatusOnce(id)  -> Promise<'PROCESSING'|{ready:true, handle}|{failed:true, note?}>
 *     finalize(handle,row) -> Promise<{ empty?:boolean }>  // download + process + SAVE
 *   }
 *
 * The engine is called once per ADS-phase run. On the FIRST run (no rows yet) it
 * SUBMITs; on later (delayed) runs it POLLs. It returns:
 *   { done:false, reschedule:{ delayMs, pollAttempt } }  // some reports still pending
 *   { done:true,  summary:{ done, noData, failed, total } } // all reports terminal
 *
 * Terminal states never block: a FAILED report just doesn't contribute data, exactly
 * like the current inline path where a failed ads service is logged and the pipeline
 * continues (advance-on-failure preserved).
 */

const defaultModel = require('../../models/amazon-ads/AsyncReportRequestModel.js');
const logger = require('../../utils/Logger.js');

const TERMINAL = new Set(['DONE', 'NO_DATA', 'FAILED']);

/**
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.country
 * @param {string} args.region
 * @param {string} args.runDate            YYYY-MM-DD (logical day)
 * @param {Array}  args.specs              adapter specs (see file header)
 * @param {number} [args.pollDelayMs]      delay before the next re-check (default 60s)
 * @param {number} [args.maxPollAttempts]  default cap per report (default 240)
 * @param {number} [args.pollAttempt]      current poll attempt (carried in phaseData)
 * @param {object} [args.Model]            AsyncReportRequest model (injectable for tests)
 */
async function runAsyncAdsReports(args) {
    const {
        userId, country, region, runDate, specs,
        group = 'sched_ads',
        // Domain label persisted on each row. Defaults to 'ads' — which is also the schema
        // default, so existing ads rows written before this parameter existed still match the
        // filter below. The finance Sales Report passes 'finance' so its rows are not filed under
        // ads, which would make them indistinguishable in reconciliation sweeps and dashboards.
        phase = 'ads',
        pollDelayMs = 60000,
        // Delay before the FIRST status check (right after submitting). Ads reports take
        // ~40min–4h, so a long initial wait (e.g. 1h) avoids dozens of pointless "still
        // processing" checks. Defaults to pollDelayMs when not set (backwards-compatible).
        initialDelayMs,
        maxPollAttempts = 240,
        pollAttempt = 0,
        Model = defaultModel,
    } = args;
    const firstDelayMs = (initialDelayMs != null) ? initialDelayMs : pollDelayMs;

    // Scope to (account, day, phase-group) so phases sharing a runDate (e.g. sched_ads
    // and sched_batch_4 in the same daily run) never see each other's rows.
    const baseFilter = { userId: String(userId), country, region, runDate, group, phase };
    const specByKey = new Map(specs.map(s => [`${s.service}|${s.paramsKey}`, s]));

    const existing = await Model.find(baseFilter).lean();
    const justSubmitted = existing.length === 0;

    if (justSubmitted) {
        // ---- SUBMIT stage: create every report, persist a SUBMITTED row -------
        await submitAll({ Model, baseFilter, specs, maxPollAttempts });
    } else {
        // ---- POLL stage: advance each not-yet-terminal report ----------------
        await pollAll({ Model, baseFilter, rows: existing, specByKey });
    }

    // Recompute terminal/pending counts after this pass.
    const rows = await Model.find(baseFilter).lean();
    const pending = rows.filter(r => !TERMINAL.has(r.status));

    if (pending.length > 0) {
        // First wait after SUBMIT uses the (long) initial delay; subsequent re-checks use
        // the shorter poll delay.
        const delayMs = justSubmitted ? firstDelayMs : pollDelayMs;
        return { done: false, reschedule: { delayMs, pollAttempt: pollAttempt + 1 } };
    }

    const summary = {
        total: rows.length,
        done: rows.filter(r => r.status === 'DONE').length,
        noData: rows.filter(r => r.status === 'NO_DATA').length,
        failed: rows.filter(r => r.status === 'FAILED').length,
    };
    return { done: true, summary };
}

async function submitAll({ Model, baseFilter, specs, maxPollAttempts }) {
    for (const spec of specs) {
        const cap = spec.maxPollAttempts || maxPollAttempts;
        let reportId = null;
        let status = 'SUBMITTED';
        let note = '';
        try {
            reportId = await spec.submit();
            if (!reportId) {
                // Service declined to create a report (e.g. no matching campaigns) —
                // treat as NO_DATA so it is terminal and never polled.
                status = 'NO_DATA';
                note = 'submit returned no reportId';
            }
        } catch (err) {
            status = 'FAILED';
            note = `submit failed: ${err.message}`;
            logger.warn(`[asyncReportEngine] submit failed for ${spec.service}/${spec.paramsKey}: ${err.message}`);
        }
        // Idempotent upsert on the unique (account, runDate, service, paramsKey) key.
        await Model.updateOne(
            { ...baseFilter, service: spec.service, paramsKey: spec.paramsKey },
            {
                $set: {
                    ...baseFilter,
                    service: spec.service,
                    paramsKey: spec.paramsKey,
                    params: spec.params || {},
                    marketplaceId: spec.marketplaceId || '',
                    reportId,
                    status,
                    maxPollAttempts: cap,
                    note,
                },
                $setOnInsert: { pollAttempts: 0 },
            },
            { upsert: true }
        );
    }
}

async function pollAll({ Model, baseFilter, rows, specByKey }) {
    for (const row of rows) {
        if (TERMINAL.has(row.status)) continue;
        const spec = specByKey.get(`${row.service}|${row.paramsKey}`);
        if (!spec) {
            // No adapter for this row (spec list changed) — leave it; reconciliation
            // or the next run with a full spec list will handle it. Do not fail data.
            continue;
        }
        if (!row.reportId) {
            await markStatus(Model, row._id, 'FAILED', 'no reportId on SUBMITTED row');
            continue;
        }

        let result;
        try {
            result = await spec.checkStatusOnce(row.reportId);
        } catch (err) {
            // Transient status-check error: bump attempts, keep SUBMITTED so the next
            // tick retries. Only give up when the cap is exceeded.
            await bumpOrFail(Model, row, `status check error: ${err.message}`);
            continue;
        }

        if (result === 'PROCESSING' || result === 'PENDING') {
            await bumpOrFail(Model, row, 'still processing at cap');
            continue;
        }
        if (result && result.failed) {
            await markStatus(Model, row._id, 'FAILED', result.note || 'report failed');
            continue;
        }
        if (result && result.ready) {
            try {
                const fin = await spec.finalize(result.handle, row);
                const status = fin && fin.empty ? 'NO_DATA' : 'DONE';
                // Stash any processed output so the phase can combine across reports
                // (e.g. PPC metrics merges SP/SB/SD into one per-day doc before saving).
                const set = { status, note: '' };
                if (fin && fin.result !== undefined) set.result = fin.result;
                await Model.updateOne({ _id: row._id }, { $set: set });
            } catch (err) {
                await markStatus(Model, row._id, 'FAILED', `finalize failed: ${err.message}`);
            }
            continue;
        }
        // Unknown adapter result — treat as still processing (bounded by cap).
        await bumpOrFail(Model, row, `unknown status result`);
    }
}

async function bumpOrFail(Model, row, note) {
    const attempts = (row.pollAttempts || 0) + 1;
    if (attempts >= (row.maxPollAttempts || 240)) {
        await markStatus(Model, row._id, 'FAILED', `poll cap reached (${attempts}); ${note}`);
    } else {
        await Model.updateOne({ _id: row._id }, { $set: { pollAttempts: attempts, note } });
    }
}

async function markStatus(Model, id, status, note) {
    await Model.updateOne({ _id: id }, { $set: { status, note } });
}

/**
 * Reconciliation (mirrors BidBison's resetInProgressEvents): find distinct accounts
 * that still have SUBMITTED ads reports untouched for `staleMs` — i.e. their delayed
 * poll job was probably lost (worker crash / Redis flush). The caller re-enqueues a
 * `sched_ads` poll for each returned account. Wire into freshnessSweeper or worker boot.
 *
 * Returns: [{ userId, country, region, runDate }] (deduped).
 */
/**
 * Accounts with SUBMITTED rows that haven't been touched for a while — i.e. a delayed poll job was
 * lost and nobody is re-checking them.
 *
 * `phase` is a parameter rather than the hard-coded 'ads' it used to be: the finance Sales Report
 * now uses this same engine and writes rows with phase:'finance', which the old filter would have
 * skipped — a stuck finance report would never have been re-checked. Defaults to both domains so
 * existing callers keep working and gain finance coverage for free.
 */
async function findStuckAdsAccounts({
    staleMs = 15 * 60 * 1000,
    now = Date.now(),
    Model = defaultModel,
    phase = ['ads', 'finance'],
} = {}) {
    const cutoff = new Date(now - staleMs);
    const phaseFilter = Array.isArray(phase) ? { $in: phase } : phase;
    const rows = await Model.find({ phase: phaseFilter, status: 'SUBMITTED', updatedAt: { $lt: cutoff } }).lean();
    const seen = new Set();
    const out = [];
    for (const r of rows) {
        const key = `${r.userId}|${r.country}|${r.region}|${r.runDate}|${r.group}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // `group` already identifies the domain ('sched_ads' vs 'sched_finance'), so the caller can
        // route the re-enqueue without needing `phase` echoed back — keep the returned shape stable.
        out.push({ userId: r.userId, country: r.country, region: r.region, runDate: r.runDate, group: r.group });
    }
    return out;
}

module.exports = { runAsyncAdsReports, findStuckAdsAccounts, TERMINAL };
