/**
 * DashboardSliceModel.js
 *
 * Incremental dashboard "slice" documents.
 *
 * Background:
 *   The legacy `sched_finalize` phase ran `Analyse()` which performed 20+
 *   Mongo collection reads + every calculator + cache write. At scale this
 *   was the hottest read path AND ran concurrently with write-heavy phases.
 *
 * Slices solve this by computing each phase's dashboard summary as a side
 * effect of the phase itself (when the data is already in memory) and
 * persisting it into ONE small document per (user, country, region, sliceKey).
 *
 * Phase → slice mapping (see scheduledPhases.js for the pipeline):
 *   sched_init        → "listings"       (active / inactive product counts)
 *   sched_batch_1_2   → "ppc"            (totalSpend, totalSales, ACOS, TACOS, ROAS, click/impression rollups)
 *                     → "inventory"      (restock, stranded, inbound, FBA)
 *                     → "performance"    (v1/v2 seller-performance rollups)
 *   sched_batch_3     → "mcp"            (sales/buybox rollups from MCP)
 *   sched_finance     → "finance"        (profitability, expenses, revenue, reimbursements, overhead)
 *   sched_batch_4     → "keywords"       (negative kw, search terms, recommendations)
 *   sched_calc_review → "issues"         (issue summary, productIssues, reviewData)
 *
 * Finalize reads all slices in ONE query, merges them, and writes the cache.
 * If `slices.length < SLICE_MIN_FOR_ASSEMBLY` (a phase failed or first run),
 * finalize falls back to the legacy `Analyse()` path — see ScheduledIntegration.
 *
 * Idempotency:
 *   - Compound unique index on (userId, country, region, sliceKey) — writes
 *     are upsert-only (`findOneAndUpdate({...}, ..., { upsert: true })`).
 *   - Replaying a phase overwrites that phase's slice without affecting others.
 *
 * Schema notes:
 *   - `data: Mixed` is intentional — each slice has a different shape and we
 *     don't want a strict schema preventing forward-compatible field additions.
 *   - `version` lets us bump the slice contract per-slice during evolution.
 *   - `producedByPhase` records which phase wrote this slice (for debugging).
 */

const mongoose = require('mongoose');

const DashboardSliceSchema = new mongoose.Schema({
    userId:           { type: String, required: true, index: true },
    country:          { type: String, required: true },
    region:           { type: String, required: true },
    sliceKey:         { type: String, required: true },
    data:             { type: mongoose.Schema.Types.Mixed, default: {} },
    version:          { type: Number, default: 1 },
    producedByPhase:  { type: String, default: null },
    producedAt:       { type: Date, default: Date.now }
}, {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
    collection: 'dashboardslices',
    minimize: false
});

DashboardSliceSchema.index(
    { userId: 1, country: 1, region: 1, sliceKey: 1 },
    { unique: true, name: 'dashboardslices_uniq_key' }
);

module.exports = mongoose.models.DashboardSlice
    || mongoose.model('DashboardSlice', DashboardSliceSchema);
