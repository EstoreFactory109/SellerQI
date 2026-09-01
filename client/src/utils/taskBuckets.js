/**
 * Sorts a seller's tasks into three buckets: High impact, Quick wins, and
 * Everything else.
 *
 * This is the SELECTION half of the feature. The domain data it selects on
 * (effortMinutes / impactWeight / isQuickWin) is computed server-side by
 * TaskPrioritizationService and arrives on each task from /api/pagewise/tasks.
 *
 * Selection lives on the client because it depends on two pieces of client
 * state: the active category filter (so narrowing to Sponsored Ads re-buckets
 * within that section) and which tasks the seller has ticked off (a completed
 * task shouldn't hold a "do this first" slot).
 */

export const BUCKET = {
    HIGH_IMPACT: 'highImpact',
    QUICK_WINS: 'quickWins',
    EVERYTHING_ELSE: 'everythingElse'
};

export const BUCKET_ORDER = [BUCKET.HIGH_IMPACT, BUCKET.QUICK_WINS, BUCKET.EVERYTHING_ELSE];

export const BUCKET_LABELS = {
    [BUCKET.HIGH_IMPACT]: 'High impact',
    [BUCKET.QUICK_WINS]: 'Quick wins',
    [BUCKET.EVERYTHING_ELSE]: 'Everything else'
};

export const BUCKET_SUBTITLES = {
    [BUCKET.HIGH_IMPACT]: 'Do these first',
    [BUCKET.QUICK_WINS]: 'Under 5 minutes each',
    [BUCKET.EVERYTHING_ELSE]: ''
};

// Each highlighted bucket stays short enough to actually act on.
export const MAX_PER_HIGHLIGHT_BUCKET = 6;

/**
 * Cap per issue type inside the highlighted buckets. An account can carry 3,445
 * wasted-keyword tasks; without this cap "High impact" would be six rows of the
 * same problem instead of six different problems worth doing.
 */
export const MAX_PER_ERROR_TYPE = 2;

/** Mirrors normalizeErrorType in TaskPrioritizationService (replenishment_needed_<SKU>). */
const PREFIXED_ERROR_TYPES = ['replenishment_needed'];

const normalizeErrorType = (errorType) => {
    if (!errorType || typeof errorType !== 'string') return '';
    const prefix = PREFIXED_ERROR_TYPES.find((p) => errorType.startsWith(p));
    return prefix || errorType;
};

const typeKey = (task) => `${task.errorCategory}:${normalizeErrorType(task.errorType)}`;

/**
 * Impact ordering. Real recoverable money always beats a weight — a task with
 * a dollar figure is a measured loss, a weight is only a judgement about how
 * much that class of problem usually costs.
 */
export function compareByImpact(a, b) {
    const aMoney = a.amount > 0;
    const bMoney = b.amount > 0;
    if (aMoney !== bMoney) return aMoney ? -1 : 1;
    if (aMoney && bMoney && b.amount !== a.amount) return b.amount - a.amount;

    const aWeight = a.impactWeight || 0;
    const bWeight = b.impactWeight || 0;
    if (bWeight !== aWeight) return bWeight - aWeight;

    // Equally important — prefer whichever is cheaper to do.
    const aEffort = a.effortMinutes ?? Number.MAX_SAFE_INTEGER;
    const bEffort = b.effortMinutes ?? Number.MAX_SAFE_INTEGER;
    if (aEffort !== bEffort) return aEffort - bEffort;

    // Stable, so the list doesn't reshuffle between renders.
    return String(a.taskId).localeCompare(String(b.taskId));
}

/**
 * Take up to `limit` tasks in impact order, honouring the per-type diversity cap.
 * @returns {{picked: Array, pickedIds: Set<string>}}
 */
function pickWithDiversity(candidates, limit) {
    const picked = [];
    const perType = new Map();

    for (const task of candidates) {
        if (picked.length >= limit) break;
        const k = typeKey(task);
        const used = perType.get(k) || 0;
        if (used >= MAX_PER_ERROR_TYPE) continue;
        perType.set(k, used + 1);
        picked.push(task);
    }

    return { picked, pickedIds: new Set(picked.map((t) => t.taskId)) };
}

/**
 * Partition tasks into the three buckets.
 *
 * Strict partition: every input task lands in exactly one bucket, so the three
 * counts always sum to the input length and no row is ever shown twice. A task
 * that is both high impact and quick is claimed by High impact — it's the best
 * kind of task, and Quick wins then fills with the next-best quick ones.
 *
 * @param {Array} tasks - tasks carrying effortMinutes/impactWeight/isQuickWin
 * @param {Object} [options]
 * @param {Set<string>|Array<string>} [options.completedTaskIds] - excluded from
 *   the highlighted buckets; they fall through to Everything else.
 * @returns {{highImpact: Array, quickWins: Array, everythingElse: Array}}
 */
export function selectBuckets(tasks, options = {}) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
        return { highImpact: [], quickWins: [], everythingElse: [] };
    }

    const completed = options.completedTaskIds instanceof Set
        ? options.completedTaskIds
        : new Set(options.completedTaskIds || []);

    const ordered = [...tasks].sort(compareByImpact);
    const actionable = ordered.filter((t) => !completed.has(t.taskId));

    const high = pickWithDiversity(actionable, MAX_PER_HIGHLIGHT_BUCKET);

    const quickCandidates = actionable.filter((t) => t.isQuickWin && !high.pickedIds.has(t.taskId));
    const quick = pickWithDiversity(quickCandidates, MAX_PER_HIGHLIGHT_BUCKET);

    const claimed = new Set([...high.pickedIds, ...quick.pickedIds]);
    const everythingElse = ordered.filter((t) => !claimed.has(t.taskId));

    return {
        highImpact: high.picked,
        quickWins: quick.picked,
        everythingElse
    };
}

/**
 * The issue-type key used to join a task to its group. Must match the group `id`
 * built server-side by TaskOpportunityGroupsService.
 * @param {Object} task
 * @returns {string}
 */
export function groupKeyForTask(task) {
    return `${task.errorCategory}:${normalizeErrorType(task.errorType)}`;
}

/**
 * Index the server-provided groups by id for O(1) lookup from a task row.
 * @param {Array} groups
 * @returns {Map<string, Object>}
 */
export function indexGroups(groups) {
    return new Map((Array.isArray(groups) ? groups : []).map((g) => [g.id, g]));
}

/**
 * "~2 min" / "~1 hr 30 min" for display next to a task.
 * @param {number} minutes
 * @returns {string}
 */
export function formatEffort(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    if (minutes < 60) return `~${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `~${hours} hr` : `~${hours} hr ${rest} min`;
}
