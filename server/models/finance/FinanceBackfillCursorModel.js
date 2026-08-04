/**
 * FinanceBackfillCursorModel.js
 *
 * Resumable checkpoint for finance Step 2 (`backfillPendingExpenses`).
 *
 * WHY
 * Step 2 converts estimated Amazon fees into actuals. It loads every pending order, derives a
 * window from the oldest one, and walks the whole thing in a single uninterrupted run. On a
 * high-volume account that is 7,124 pending orders across 55 days and 1000+ API pages — hours of
 * wall-clock with a BullMQ worker held the entire time, and nothing recorded if it dies partway.
 * A measured large seller produces ~88k expense rows PER DAY, so a 55-day window is ~4.3M rows of
 * which a few thousand match; and because `Expences.js` deliberately has no pre-emptive inter-page
 * delay, most of that wall-clock is 10s-60s throttle backoffs. Narrowing the window per run is what
 * actually shortens the run.
 *
 * This cursor lets one run cover one slice of the window and the next run continue.
 *
 * WHY DATE SLICES AND NOT A SAVED NextToken
 * Same reasoning as ReviewIngestSliceModel, and it applies even more strongly here: SP-API
 * pagination tokens are short-lived and bound to the exact query that produced them, and Step 2's
 * query ends at `now - 3min`, recomputed every invocation. A token minted in one run is bound to a
 * `postedBefore` that no longer exists in the next. A date range is stable.
 *
 * WHY THE WINDOW IS FROZEN FOR THE DURATION OF A PASS
 * `windowStart` derives from `min(purchasePacificDate)` over the orders that REMAIN. Recomputing it
 * mid-pass, as orders resolve and that minimum moves forward, would shift the boundary under the
 * cursor and could skip a range entirely. So it is captured once when a pass begins.
 *
 * WHY THIS IS NOT THE WINDOW-CAPPING BUG THAT WAS ALREADY REJECTED ONCE
 * FinanceService.js documents an earlier attempt that capped the span at N days from the oldest
 * pending purchase date, and why it was "wrong and actively harmful": `finStart` is a derived
 * minimum over the surviving rows *with no cursor*, so one permanently-stuck order pinned the window
 * at its own date for up to 45 days and every newer pending row sat outside it forever, never
 * searched, expiring with its estimate never replaced.
 *
 * "With no cursor" is the whole difference. That attempt SHRANK the window and had no memory of what
 * it had covered. This SLICES the same full window and records how far it has got, so every part of
 * [windowStart, passEnd] is visited within one pass and passes repeat. Nothing is permanently
 * excluded. Any bound that is a pure function of `min(purchasePacificDate)` over the surviving set is
 * starvation-by-construction, because that set is biased toward exactly the rows that cannot resolve.
 *
 * PARTIAL SLICES ARE NEVER MARKED COMPLETE
 * `pagesLastRun` is observability only, never a resume offset. `coveredUntil` advances only after a
 * slice's writes have landed, so an interrupted slice is simply re-walked in full.
 */

const mongoose = require('mongoose');

// A claim older than this is treated as abandoned (worker crashed or was killed mid-slice) and may
// be taken over. There is no per-user finance lock in this codebase, so this is the only thing
// discouraging two concurrent runs from both advancing the cursor and skipping a slice between them.
const STALE_CLAIM_MS = 30 * 60 * 1000;

// Retention. Deliberately NOT wired into config/logRetention.js — these are operational checkpoints,
// not logs, and that module's 30-day default could delete a cursor mid-pass on a slow backlog.
const CURSOR_RETENTION_SECONDS = 90 * 24 * 60 * 60;

const FinanceBackfillCursorSchema = new mongoose.Schema(
  {
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    country: { type: String, required: true },
    region: { type: String, required: true, enum: ['NA', 'EU', 'FE'] },

    // ── The frozen pass window ──
    // Captured when a pass begins; see "WHY THE WINDOW IS FROZEN" above.
    // `min(purchasePacificDate) - SETTLEMENT_LAG[region].beforeDays`, as YYYY-MM-DD.
    windowStart: { type: String, required: true },
    // The pass's upper bound, also frozen. Step 2's live end is `now - 3min` (an API requirement),
    // so this records what "now" was when the pass started.
    windowEnd: { type: String, required: true },

    // ── Progress ──
    // How far BACK this pass has searched. Starts at `windowEnd` and moves toward `windowStart`,
    // because the walk is newest-first: almost every real resolution is in the most recent slice,
    // so searching there first is what makes a fee post-to-resolve latency short.
    // The pass is complete once this reaches `windowStart`.
    coveredUntil: { type: String, required: true },

    passStartedAt: { type: Date, default: () => new Date() },
    lastRunAt: { type: Date, default: () => new Date() },
    // Set to now + STALE_CLAIM_MS while a run is working a slice.
    claimedUntil: { type: Date, default: null },

    // ── Observability only. Never used to resume from. ──
    slicesDone: { type: Number, default: 0 },
    passesCompleted: { type: Number, default: 0 },
    resolvedThisPass: { type: Number, default: 0 },
    pagesLastRun: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One cursor per account+marketplace.
FinanceBackfillCursorSchema.index(
  { User: 1, country: 1, region: 1 },
  { unique: true }
);

FinanceBackfillCursorSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: CURSOR_RETENTION_SECONDS, name: 'financeBackfillCursor_ttl' }
);

module.exports = mongoose.model('FinanceBackfillCursor', FinanceBackfillCursorSchema);
module.exports.STALE_CLAIM_MS = STALE_CLAIM_MS;
