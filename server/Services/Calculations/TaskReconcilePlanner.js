/**
 * TaskReconcilePlanner
 *
 * Decides how one marketplace's stored tasks must change so they match the issues
 * detected by the latest calculation, and expresses that as bulkWrite operations.
 *
 * It replaces two behaviours of the legacy path (CreateTasksService, mode `off`):
 *   - insert-only inside the 7-day window, which left fixed issues pending and
 *     amounts frozen at first sight;
 *   - wipe-and-rebuild at renewal, which threw away the seller's completed /
 *     in-progress status and minted new random task ids every week.
 *
 * Pure: no DB, no network, no clock (callers pass `now`). Everything that decides a
 * task's fate is here so it can be tested exhaustively.
 *
 * The rules
 *   detected, not stored            -> insert as pending
 *   detected, stored                -> refresh content (amount, text, renderData);
 *                                      status: resolved -> pending (reopened);
 *                                      completed for > COMPLETED_GRACE_DAYS -> pending
 *                                      with stillDetected; otherwise unchanged
 *   not detected, stored, open      -> resolved, IF its data source was covered this
 *                                      run and the mass-resolve rail did not trip
 *   not detected, stored, done      -> purged after DONE_RETENTION_DAYS
 */

const COMPLETED_GRACE_DAYS = 7;
const DONE_RETENTION_DAYS = 30;
// lastSeenAt is diagnostic; touching it on every run would rewrite every task of
// a 25k-task account each time. Refresh it at most this often when nothing else changed.
const LAST_SEEN_TOUCH_HOURS = 20;

// Mass-resolve rail: a source that would resolve more than this share of its open
// tasks (and at least RAIL_MIN_TASKS of them) is far likelier to be a data gap than
// a seller who fixed everything overnight, so resolution is held back...
const RAIL_SHARE = 0.8;
const RAIL_MIN_TASKS = 20;
// ...but only for this many consecutive runs. A drop that persists is real (paused
// campaigns, a cleared catalogue), and a permanent hold would pin dead tasks forever.
const RAIL_MAX_CONSECUTIVE = 3;

// What counts as a material change for the AI views (which cost an LLM call to
// regenerate): open recoverable $ moving by more than this share, or this share of
// open tasks appearing, resolving or reopening. One new keyword on a 900-task
// account is not worth a regeneration; a tenth of the list turning over is.
const MATERIAL_SHARE = 0.1;

const OPEN_STATUSES = new Set(['pending', 'in_progress']);
// Categories generated per product inside the ranking loop of analyseData.
const PRODUCT_LEVEL_CATEGORIES = new Set(['ranking', 'conversion', 'inventory']);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which data source an issue type is detected from. Resolution is only trusted
 * when that source actually arrived this run: an absent source looks identical to
 * "no issues", and resolving on it would silently close real work.
 *
 * errorTypes with no entry fall back to the category as their source, which also
 * covers retired types that are still stored (e.g. insufficient_reviews).
 */
const SOURCE_BY_TYPE = {
    // Backend keywords come from BackendKeywordResultArray, not the main ranking array.
    'ranking:backend_keywords_char_limit': 'ranking.backend',
    'ranking:backend_keywords_duplicate_words': 'ranking.backend',

    'conversion:missing_aplus_content': 'conversion.aplus',
    'conversion:missing_brand_story': 'conversion.brandStory',
    'conversion:insufficient_images': 'conversion.images',
    'conversion:missing_video': 'conversion.video',
    'conversion:low_star_rating': 'conversion.rating',
    'conversion:no_buybox': 'conversion.buybox',

    'sponsoredAds:high_acos': 'sponsoredAds.campaigns',
    'sponsoredAds:wasted_spend_keyword': 'sponsoredAds.keywords',
    'sponsoredAds:search_term_zero_sales': 'sponsoredAds.searchTerms',
    'sponsoredAds:auto_campaign_migration_needed': 'sponsoredAds.autoMigration',

    // tasks-logics.xlsx detectors: each has its own input (kpi/index.js KPI_SOURCES).
    'inventory:listing_suppressed': 'kpi.suppressed',
    'inventory:out_of_stock': 'kpi.outOfStock',
    'sponsoredAds:ads_on_unbuyable': 'kpi.adsOnUnbuyable',
    'profitability:cogs_missing': 'kpi.cogsMissing',
    'account:ahr_early_warning': 'kpi.ahrEarlyWarning',
    'inventory:removal_shortfall': 'kpi.removalShortfall',
    'inventory:removal_confirm_receipt': 'kpi.removalShortfall',
    'conversion:sales_drop': 'kpi.salesDrop',
    'conversion:conversion_rate_drop': 'kpi.conversionDrop',
    'conversion:traffic_drop': 'kpi.trafficDrop',
    'sponsoredAds:tacos_rising': 'kpi.tacos',
    'sponsoredAds:top_seller_not_advertised': 'kpi.topSellerAds',
    'conversion:rating_drop': 'kpi.ratingDrop',
    'inventory:weeks_of_cover': 'kpi.weeksOfCover',
    'inventory:listing_warnings': 'kpi.listingWarnings',
    'account:invoice_defect_rate': 'kpi.invoiceDefect',
    'inventory:low_inventory_fee_risk': 'kpi.lowInventoryFee',
    'inventory:fba_fee_increase': 'kpi.fbaFeeIncrease',
    'inventory:handling_time_long': 'kpi.handlingTime',
    'inventory:new_seller_on_brand': 'kpi.newSellerOnBrand',
    'ranking:listing_errors': 'kpi.listingErrors',
    'inventory:lost_damaged_unreimbursed': 'kpi.lostDamaged',
    'inventory:return_reason_spike': 'kpi.returnReasons',
    'ranking:detail_page_changed': 'kpi.detailPageChanged',
    'inventory:inbound_shortage': 'kpi.inboundShortage',
    'inventory:refund_not_returned': 'kpi.refundNotReturned',
    'conversion:high_traffic_low_conversion': 'kpi.trafficMix',
    'conversion:low_traffic_high_conversion': 'kpi.trafficMix',
    'sponsoredAds:product_acos_above_breakeven': 'kpi.productAcos',
    'ranking:backend_keywords_title_overlap': 'ranking.backend',
    'ranking:backend_keywords_underused': 'ranking.backend'
};

/** @returns {string} the coverage key for a task */
function coverageSourceFor(category, errorType) {
    return SOURCE_BY_TYPE[`${category}:${errorType}`] || category;
}

/** Identity within one marketplace; mirrors the task_dedup_marketplace index. */
const taskKey = (t) => `${t.asin}\u0000${t.errorCategory}\u0000${t.errorType}`;

/**
 * Comparable form of a value: drops null/undefined (Mongo stores an undefined
 * renderData field as null, so a naive compare would see a change every run) and
 * sorts keys.
 */
function canonical(value) {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) return value.map(canonical);
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) {
            const v = canonical(value[k]);
            if (v !== undefined) out[k] = v;
        }
        return Object.keys(out).length > 0 ? out : undefined;
    }
    return value;
}

const sameValue = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * The seller-visible content of a task, normalised the same way bulkInsertTasks
 * stores it.
 */
function contentOf(task) {
    return {
        productName: task.productName,
        error: task.error ?? undefined,
        solution: task.solution ?? undefined,
        renderData: task.renderData ?? undefined,
        amount: Number(task.amount) || 0,
        amountIsEstimated: !!task.amountIsEstimated,
        capitalAmount: Number(task.capitalAmount) || 0
    };
}

function withoutUndefined(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
    return out;
}

const CONTENT_FIELDS = ['productName', 'error', 'solution', 'renderData', 'amount', 'amountIsEstimated', 'capitalAmount'];

/**
 * @param {Object} params
 * @param {Array} params.existing - stored TaskItem docs for the marketplace (lean)
 * @param {Array} params.desired - tasks from the generate* functions, with stable taskIds
 * @param {Object} params.coverage - { [source]: boolean, uncoveredProductAsins?: string[] };
 *   a missing source key means NOT covered
 * @param {Object} [params.priorRailTrips] - { [source]: consecutive trip count } from the last run
 * @param {Object} params.scope - { userId, country, region } stamped onto inserts
 * @param {Date} params.now
 * @returns {{ ops: Array, summary: Object, railTrips: Object }}
 */
function planReconcile({ existing = [], desired = [], coverage = {}, priorRailTrips = {}, scope, now }) {
    const nowMs = now.getTime();
    const ops = [];
    const summary = {
        desired: 0,
        existing: existing.length,
        inserted: 0,
        contentUpdated: 0,
        touched: 0,
        reopened: 0,
        stillDetected: 0,
        resolved: 0,
        purged: 0,
        uncoveredSources: [],
        heldUnvisitedProduct: 0,
        railHeld: {},
        openCountBefore: 0,
        openAmountBefore: 0,
        openAmountAfter: 0
    };

    const existingByKey = new Map();
    for (const t of existing) {
        // A duplicate key can only exist for rows written before the dedup index;
        // keep the first and leave the rest alone.
        const k = taskKey(t);
        if (!existingByKey.has(k)) existingByKey.set(k, t);
        if (OPEN_STATUSES.has(t.status)) {
            summary.openCountBefore++;
            summary.openAmountBefore += Number(t.amount) || 0;
        }
    }

    // First occurrence wins, matching the legacy path where the unique index
    // rejected later duplicates within one batch.
    const desiredByKey = new Map();
    for (const t of desired) {
        const k = taskKey(t);
        if (!desiredByKey.has(k)) desiredByKey.set(k, t);
    }
    summary.desired = desiredByKey.size;

    // ── Detected issues ──
    for (const [k, want] of desiredByKey) {
        const have = existingByKey.get(k);
        const content = contentOf(want);

        if (!have) {
            ops.push({
                insertOne: {
                    document: {
                        userId: scope.userId,
                        country: scope.country,
                        region: scope.region,
                        taskId: want.taskId,
                        asin: want.asin,
                        errorCategory: want.errorCategory,
                        errorType: want.errorType,
                        ...withoutUndefined(content),
                        status: 'pending',
                        firstSeenAt: now,
                        lastSeenAt: now,
                        reopenCount: 0,
                        stillDetected: false
                    }
                }
            });
            summary.inserted++;
            summary.openAmountAfter += content.amount;
            continue;
        }

        const $set = {};
        const $unset = {};
        let $inc;

        const current = contentOf(have);
        let contentChanged = false;
        for (const f of CONTENT_FIELDS) {
            if (sameValue(current[f], content[f])) continue;
            contentChanged = true;
            if (content[f] === undefined) $unset[f] = '';
            else $set[f] = content[f];
        }

        let status = have.status;
        if (have.status === 'resolved') {
            status = 'pending';
            $set.status = 'pending';
            $set.reopenedAt = now;
            $unset.resolvedAt = '';
            $inc = { reopenCount: 1 };
            summary.reopened++;
        } else if (have.status === 'completed') {
            // Rows completed before completedAt existed fall back to updatedAt,
            // the last time anything (in practice, the status change) touched them.
            const completedAt = have.completedAt || have.updatedAt;
            const completedMs = completedAt ? new Date(completedAt).getTime() : NaN;
            const graceOver = Number.isFinite(completedMs) && nowMs - completedMs > COMPLETED_GRACE_DAYS * DAY_MS;
            if (!graceOver && !have.completedAt && completedAt) {
                // Pin the fallback before this write bumps updatedAt: otherwise every
                // content refresh would restart the grace period and it never ends.
                $set.completedAt = new Date(completedAt);
            }
            if (graceOver) {
                status = 'pending';
                $set.status = 'pending';
                $set.stillDetected = true;
                $set.reopenedAt = now;
                $unset.completedAt = '';
                $inc = { reopenCount: 1 };
                summary.stillDetected++;
            }
        }

        const lastSeenMs = have.lastSeenAt ? new Date(have.lastSeenAt).getTime() : 0;
        const stale = nowMs - lastSeenMs > LAST_SEEN_TOUCH_HOURS * 60 * 60 * 1000;
        const statusChanged = status !== have.status;

        const pinsCompletedAt = $set.completedAt !== undefined;
        if (contentChanged || statusChanged || stale || pinsCompletedAt) {
            $set.lastSeenAt = now;
            if (!have.firstSeenAt) $set.firstSeenAt = have.createdAt || now;
            const update = { $set };
            if (Object.keys($unset).length > 0) update.$unset = $unset;
            if ($inc) update.$inc = $inc;
            // Filtered on the status we read: if the seller changed it since, the
            // op matches nothing and their choice stands; content catches up next run.
            ops.push({ updateOne: { filter: { _id: have._id, status: have.status }, update } });
            if (contentChanged) summary.contentUpdated++;
            else if (!statusChanged) summary.touched++;
        }

        if (OPEN_STATUSES.has(status)) summary.openAmountAfter += content.amount;
    }

    // ── Issues no longer detected ──
    const vanishedOpenBySource = new Map();
    const openCountBySource = new Map();
    for (const t of existingByKey.values()) {
        if (!OPEN_STATUSES.has(t.status)) continue;
        const source = coverageSourceFor(t.errorCategory, t.errorType);
        openCountBySource.set(source, (openCountBySource.get(source) || 0) + 1);
        if (desiredByKey.has(taskKey(t))) continue;
        if (!vanishedOpenBySource.has(source)) vanishedOpenBySource.set(source, []);
        vanishedOpenBySource.get(source).push(t);
    }

    const railTrips = {};
    const uncovered = new Set();
    const uncoveredAsins = new Set(coverage.uncoveredProductAsins || []);
    for (const [source, allVanished] of vanishedOpenBySource) {
        if (coverage[source] !== true) {
            uncovered.add(source);
            for (const t of allVanished) summary.openAmountAfter += Number(t.amount) || 0;
            continue;
        }

        // A product the calculation never visited cannot have its product-level
        // issues judged; hold those back individually.
        const vanished = [];
        for (const t of allVanished) {
            if (PRODUCT_LEVEL_CATEGORIES.has(t.errorCategory) && uncoveredAsins.has(t.asin)) {
                summary.heldUnvisitedProduct++;
                summary.openAmountAfter += Number(t.amount) || 0;
            } else {
                vanished.push(t);
            }
        }
        if (vanished.length === 0) continue;

        const openCount = openCountBySource.get(source) || 0;
        const trips = vanished.length >= RAIL_MIN_TASKS && vanished.length > RAIL_SHARE * openCount;
        if (trips) {
            const consecutive = (Number(priorRailTrips[source]) || 0) + 1;
            if (consecutive < RAIL_MAX_CONSECUTIVE) {
                railTrips[source] = consecutive;
                summary.railHeld[source] = { wouldResolve: vanished.length, open: openCount, consecutive };
                for (const t of vanished) summary.openAmountAfter += Number(t.amount) || 0;
                continue;
            }
            // Held long enough: the drop is real. Let it through and reset.
        }

        for (const t of vanished) {
            ops.push({
                updateOne: {
                    filter: { _id: t._id, status: t.status },
                    update: { $set: { status: 'resolved', resolvedAt: now, stillDetected: false } }
                }
            });
            summary.resolved++;
        }
    }
    summary.uncoveredSources = [...uncovered].sort();

    // ── Retention for finished work that is no longer detected ──
    const purgeBefore = nowMs - DONE_RETENTION_DAYS * DAY_MS;
    for (const t of existingByKey.values()) {
        if (desiredByKey.has(taskKey(t))) continue;
        let doneAt;
        if (t.status === 'resolved') doneAt = t.resolvedAt || t.updatedAt;
        else if (t.status === 'completed') doneAt = t.completedAt || t.updatedAt;
        else continue;
        const doneMs = doneAt ? new Date(doneAt).getTime() : NaN;
        if (Number.isFinite(doneMs) && doneMs < purgeBefore) {
            ops.push({ deleteOne: { filter: { _id: t._id, status: t.status } } });
            summary.purged++;
        }
    }

    summary.openAmountBefore = Math.round(summary.openAmountBefore * 100) / 100;
    summary.openAmountAfter = Math.round(summary.openAmountAfter * 100) / 100;

    const statusChanges = summary.inserted + summary.resolved + summary.reopened + summary.stillDetected;
    const amountBase = Math.max(summary.openAmountBefore, 1);
    const amountMoved = Math.abs(summary.openAmountAfter - summary.openAmountBefore) / amountBase > MATERIAL_SHARE;
    const listTurnedOver = summary.openCountBefore === 0
        ? statusChanges > 0
        : statusChanges / summary.openCountBefore > MATERIAL_SHARE;
    summary.changed = statusChanges > 0 || summary.contentUpdated > 0 || summary.purged > 0;
    summary.material = listTurnedOver || amountMoved;

    return { ops, summary, railTrips };
}

module.exports = {
    planReconcile,
    coverageSourceFor,
    taskKey,
    canonical,
    COMPLETED_GRACE_DAYS,
    DONE_RETENTION_DAYS,
    LAST_SEEN_TOUCH_HOURS,
    RAIL_SHARE,
    RAIL_MIN_TASKS,
    RAIL_MAX_CONSECUTIVE,
    MATERIAL_SHARE,
    SOURCE_BY_TYPE
};
