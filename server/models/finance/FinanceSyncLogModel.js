const mongoose = require('mongoose');
const { LOG_RETENTION, expireAfterSeconds } = require('../../config/logRetention.js');

/**
 * FinanceSyncLogModel
 *
 * Tracks which dates have been successfully fetched and stored for each
 * user+country+region combination.
 *
 * Architecture:
 *   - One document per (User, country, region, date)
 *   - First fetch: creates 30 entries (one per day)
 *   - Daily fetch: creates 1 entry
 *   - To check if a date has been fetched: query this collection
 *   - To find the last fetched date: sort by date desc, limit 1
 *
 * Replaces:
 *   - ExpenseReportRunModel (run metadata)
 *   - AsinWiseSalesRunModel (sales run metadata)
 *
 * Usage in service:
 *   1. Check: what's the latest synced date?
 *   2. If no records → backfill last 30 days
 *   3. If latest date < yesterday → fetch each missing day
 *   4. After successful save → create a sync log entry
 */

const FinanceSyncLogSchema = new mongoose.Schema(
  {
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    country: {
      type: String,
      required: true,
      index: true,
    },
    region: {
      type: String,
      required: true,
      enum: ['NA', 'EU', 'FE'],
      index: true,
    },
    marketplaceId: {
      type: String,
      required: true,
      index: true,
    },

    // The date that was fetched (YYYY-MM-DD)
    date: {
      type: String,
      required: true,
      index: true,
    },

    // When this date was fetched
    fetchedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },

    status: {
      type: String,
      required: true,
      enum: ['success', 'failed', 'partial'],
      default: 'success',
    },

    // Stats for this day's fetch
    transactionCount: { type: Number, default: 0 },
    expenseRowCount: { type: Number, default: 0 },
    revenueRowCount: { type: Number, default: 0 },
    skuCount: { type: Number, default: 0 },

    // The actual postedAfter/postedBefore used for this fetch
    postedAfter: { type: String, default: '' },
    postedBefore: { type: String, default: '' },

    // Error message if status is 'failed'
    error: { type: String, default: '' },

    // Cause bucket for a failure, so responses that differ can be told apart without
    // string-matching the message:
    //   'auth_denied' — the seller's grant does not cover Reports; only reconnecting fixes it
    //   'timeout'     — report generation or download ran out of time; retrying CAN work
    //   'memory'      — stopped short of the heap ceiling; a smaller chunk/window will succeed
    //   'other'       — anything else
    // Additive and unset on pre-existing rows, so consumers must tolerate `undefined` and fall
    // back to inspecting `error` (see freshnessSweeper.isAccountFinanceAuthDenied).
    errorKind: {
      type: String,
      enum: ['auth_denied', 'timeout', 'memory', 'other'],
      required: false,
    },

    // Async path only: the AsyncReportRequest row `_id` that produced this day.
    //
    // Idempotency marker. A BullMQ retry can re-invoke a finalize that already completed — and if
    // that happens AFTER backfillPendingExpenses has converted this day's estimated fees into
    // actuals, the re-run's delete-then-insert would reinstate the ESTIMATES and lose the actual
    // fees. Finalize therefore checks whether every date in its chunk already carries its own
    // syncRunId and skips if so. Unset on the inline path.
    syncRunId: {
      type: String,
      required: false,
      index: true,
    },

    // ★ Provisional = this day was fetched but its sales are NOT yet trustworthy
    //   (the Sales Report returned 0 rows for it, or it contained Pending orders
    //   whose item-price is still empty). A provisional day is re-fetched by the
    //   daily incremental flow until it settles, then flipped to provisional:false.
    //   Backward-compatible: pre-existing rows have `provisional` undefined, which
    //   is treated as settled everywhere via `{ $ne: true }`.
    provisional: {
      type: Boolean,
      default: false,
      index: true,
    },

    // Count of Pending-status order rows seen for this day (diagnostic — explains
    // why a day is provisional and how much sales may still be unconfirmed).
    pendingOrderCount: { type: Number, default: 0 },

    // ── Per-date failure backoff ──
    // The freshness sweeper runs every 3h and treats any `failed` day as broken, so before these
    // existed a window that could not succeed was retried ~8x/day indefinitely. One account did
    // exactly that for a full day, re-running Step 1 each time.
    //
    // `consecutiveFailures` is incremented by recordSyncFailure and reset to 0 by a success write.
    // `nextRetryAfter` is when the sweeper may consider this date again; null means "no backoff
    // pending", NOT "give up" — being capped is signalled by consecutiveFailures reaching
    // FINANCE_MAX_DATE_RETRIES, which the sweeper checks separately. Conflating the two would make
    // a capped date retry immediately, the opposite of the intent.
    consecutiveFailures: { type: Number, default: 0 },
    nextRetryAfter: { type: Date, default: null },
  },
  { timestamps: true }
);

// Primary: find latest synced date for a user
FinanceSyncLogSchema.index({ User: 1, country: 1, region: 1, date: -1 });

// Prevent duplicate: one sync log per user+country+date
FinanceSyncLogSchema.index(
  { User: 1, country: 1, region: 1, date: 1 },
  { unique: true }
);

// TTL index: auto-delete sync logs older than the configured retention
// window (default 30 days). See server/config/logRetention.js to change it.
FinanceSyncLogSchema.index(
  { fetchedAt: 1 },
  { expireAfterSeconds: expireAfterSeconds('financeSyncLogs'), name: LOG_RETENTION.financeSyncLogs.indexName }
);

module.exports = mongoose.model('FinanceSyncLog', FinanceSyncLogSchema);