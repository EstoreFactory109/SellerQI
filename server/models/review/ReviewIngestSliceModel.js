/**
 * ReviewIngestSliceModel.js
 *
 * Resumable checkpoint for review-order ingestion.
 *
 * WHY
 * A high-volume seller can have ~120k shipped orders inside the 15-day ingestion window —
 * more pages than can be walked inside the ~60 min SP-API credential lifetime. Previously the
 * run buffered everything in memory and wrote at the end, so failing partway through
 * persisted NOTHING (one such account had 0 ReviewOrder documents despite months of nightly
 * attempts). Splitting the window into date slices lets each run finish whole slices, record
 * them, and have the next run continue from there.
 *
 * WHY DATE SLICES AND NOT A SAVED NextToken
 * SP-API pagination tokens are short-lived and bound to the exact query that produced them,
 * and the ingestion window is anchored to *today* — so Monday's token points at a range that
 * no longer exists on Wednesday. A date range, by contrast, is stable, and re-walking one is
 * idempotent because ReviewOrder upserts key on {marketplaceId, amazonOrderId}.
 *
 * PARTIAL SLICES ARE NEVER MARKED COMPLETE
 * `pagesFetched` is recorded for observability only — never as a resume offset. A slice that
 * did not finish is simply re-walked in full next run.
 */

const mongoose = require('mongoose');

// A claim older than this is considered abandoned (worker crashed / was killed mid-slice) and
// may be taken over by another run. Comfortably longer than a single slice should ever take.
const STALE_CLAIM_MS = 30 * 60 * 1000;

// Retention. Deliberately NOT wired into config/logRetention.js: these are operational
// checkpoints, not logs, and that module's default is 30 days — which would be long enough to
// silently delete a checkpoint that is still inside the 15-day ingestion window on a slow
// backfill. 90 days is far beyond any slice's useful life while still bounding growth.
const SLICE_RETENTION_SECONDS = 90 * 24 * 60 * 60;

const ReviewIngestSliceSchema = new mongoose.Schema(
  {
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    country: { type: String, required: true },
    region: { type: String, required: true, enum: ['NA', 'EU', 'FE'] },
    marketplaceId: { type: String, required: true },

    // Hour-resolution start of the slice, e.g. '2026-07-13T00'. Hour resolution means
    // changing REVIEW_INGEST_SLICE_HOURS produces distinct keys rather than colliding with
    // slices recorded at a different granularity.
    sliceKey: { type: String, required: true },
    sliceStart: { type: Date, required: true },
    sliceEnd: { type: Date, required: true },

    status: {
      type: String,
      required: true,
      enum: ['pending', 'in_progress', 'complete', 'failed'],
      default: 'pending',
      index: true,
    },

    // Observability only — see the note above about never using this as a resume offset.
    pagesFetched: { type: Number, default: 0 },
    ordersUpserted: { type: Number, default: 0 },

    claimedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

// One document per account-slice. This uniqueness is also the concurrency primitive: a
// concurrent claim attempt on an already-complete slice fails with a duplicate-key error,
// which the claim helper treats as "someone else owns it".
ReviewIngestSliceSchema.index(
  { User: 1, country: 1, region: 1, marketplaceId: 1, sliceKey: 1 },
  { unique: true }
);

// Drives "which slices still need work", oldest first.
ReviewIngestSliceSchema.index({
  User: 1,
  country: 1,
  region: 1,
  marketplaceId: 1,
  status: 1,
  sliceStart: 1,
});

ReviewIngestSliceSchema.index(
  { sliceStart: 1 },
  { expireAfterSeconds: SLICE_RETENTION_SECONDS, name: 'reviewIngestSlice_ttl' }
);

/**
 * Atomically claim a slice for this run.
 *
 * Claimable when the slice does not exist yet, is pending/failed, or carries a stale
 * in_progress claim. A `complete` slice is never claimable.
 *
 * @returns {Promise<object|null>} the claimed document, or null if another run owns it
 */
ReviewIngestSliceSchema.statics.claimSlice = async function claimSlice({
  User,
  country,
  region,
  marketplaceId,
  slice,
  now = new Date(),
}) {
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
  const key = { User, country, region, marketplaceId, sliceKey: slice.sliceKey };

  try {
    return await this.findOneAndUpdate(
      {
        ...key,
        $or: [
          { status: { $in: ['pending', 'failed'] } },
          { status: 'in_progress', claimedAt: { $lt: staleBefore } },
          { status: 'in_progress', claimedAt: null },
        ],
      },
      {
        $set: { status: 'in_progress', claimedAt: now, error: '' },
        $setOnInsert: {
          sliceStart: new Date(slice.createdAfter),
          sliceEnd: new Date(slice.createdBefore),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // 11000 = duplicate key. The filter did not match (slice is complete, or another run
    // claimed it a moment ago) so the upsert tried to insert over the unique index. Either
    // way this run must not process it.
    if (err && (err.code === 11000 || err.code === 11001)) return null;
    throw err;
  }
};

ReviewIngestSliceSchema.statics.markComplete = function markComplete(
  id,
  { pagesFetched = 0, ordersUpserted = 0 } = {}
) {
  return this.updateOne(
    { _id: id },
    {
      $set: {
        status: 'complete',
        completedAt: new Date(),
        pagesFetched,
        ordersUpserted,
        error: '',
      },
    }
  );
};

ReviewIngestSliceSchema.statics.markFailed = function markFailed(id, error, stats = {}) {
  return this.updateOne(
    { _id: id },
    {
      $set: {
        status: 'failed',
        error: String(error || '').slice(0, 500),
        pagesFetched: stats.pagesFetched || 0,
        ordersUpserted: stats.ordersUpserted || 0,
      },
    }
  );
};

/** Slice keys already finished for this account, so a run can skip them cheaply. */
ReviewIngestSliceSchema.statics.completedKeys = async function completedKeys({
  User,
  country,
  region,
  marketplaceId,
}) {
  const docs = await this.find(
    { User, country, region, marketplaceId, status: 'complete' },
    { sliceKey: 1 }
  ).lean();
  return new Set(docs.map((d) => d.sliceKey));
};

module.exports = mongoose.model('ReviewIngestSlice', ReviewIngestSliceSchema);
module.exports.STALE_CLAIM_MS = STALE_CLAIM_MS;
