const mongoose = require("mongoose");

/**
 * AsyncReportRequest — the "parked work" record for the non-blocking ADS report
 * fetch (P8). One document = one Amazon report in flight for an account's daily run.
 *
 * This is SellerQI's equivalent of BidBison's `system_event_processes` row: instead
 * of a worker sleeping inline for the ~minutes-to-hours it takes Amazon to generate a
 * report, we persist the report's `reportId` + status here and re-check it later on a
 * BullMQ delayed job. "Waiting for Amazon" lives as a row in status SUBMITTED, never a
 * pinned worker.
 *
 * Lifecycle:  SUBMITTED (report created, id saved)
 *               → DONE / NO_DATA        (report ready, downloaded + saved)
 *               → FAILED                (fatal, or poll cap exceeded)
 *
 * The pipeline advances to the next phase only once every row for the run is terminal.
 * A FAILED row does NOT block the pipeline (advance-on-failure is preserved).
 */
const asyncReportRequestSchema = new mongoose.Schema({
    // ---- account + logical day ------------------------------------------------
    userId:   { type: String, required: true, index: true },
    country:  { type: String, required: true },
    region:   { type: String, required: true, enum: ["NA", "EU", "FE"] },
    // The logical day this run covers (YYYY-MM-DD, Pacific) — lets a re-run for the
    // same day dedupe/replace prior rows.
    runDate:  { type: String, required: true },

    // ---- which report ---------------------------------------------------------
    // 'finance' was added when the finance Sales Report was converted to this engine. The enum
    // previously allowed only "ads", which silently rejected any finance row.
    phase:        { type: String, required: true, default: "ads", enum: ["ads", "finance"] },
    // Phase-group scope: separates rows produced by different phases within the SAME
    // daily run (same runDate) — e.g. 'sched_ads' vs 'sched_batch_4' vs 'sched_ads_catchup'
    // — so each phase's engine run only sees its own reports when deciding "all done".
    group:        { type: String, required: true, default: "sched_ads", index: true },
    service:      { type: String, required: true }, // e.g. 'ppcMetricsAggregated', 'ppcSpendsBySKU'
    // Stable string describing the specific report variant within a service
    // (e.g. campaign type 'SP'/'SB'/'SD', ad type, date range). Part of the dedupe key.
    paramsKey:    { type: String, required: true, default: "" },
    // Full params needed to finalize (download+process) once ready — opaque blob.
    params:       { type: mongoose.Schema.Types.Mixed, default: {} },
    marketplaceId:{ type: String, default: "" },

    // ---- amazon report handles ------------------------------------------------
    reportId:     { type: String, default: null },
    documentUrl:  { type: String, default: null },

    // ---- state machine --------------------------------------------------------
    status: {
        type: String,
        required: true,
        enum: ["SUBMITTED", "DONE", "NO_DATA", "FAILED"],
        default: "SUBMITTED",
        index: true
    },
    pollAttempts:    { type: Number, default: 0 },
    maxPollAttempts: { type: Number, default: 240 },
    note:            { type: String, default: "" },

    // Set by the ADAPTER (it tags its own error), merely persisted by the engine — the engine stays
    // domain-agnostic and never interprets this. The phase reads it back to distinguish "Amazon was
    // having a bad day" from "this seller revoked our Amazon Ads grant", which are the same
    // `status: FAILED` but need completely different responses: retry vs. tell the seller to
    // re-authorize. Structural rather than parsed out of `note`, which is length-capped.
    authRevoked:     { type: Boolean, default: false },

    // Processed output stashed by finalize() when a report is downloaded. Some ads
    // services (e.g. PPC metrics) must merge multiple reports before saving a single
    // per-day document, so the phase reads these back once all rows are terminal and
    // does the combine+save once. Services that save per-report independently leave
    // this unset. Cleared/overwritten on re-run of the same day.
    result:          { type: mongoose.Schema.Types.Mixed, default: undefined },
}, { timestamps: true });

// Idempotent (re-)submit: one row per (account, day, group, service, variant).
asyncReportRequestSchema.index(
    { userId: 1, country: 1, region: 1, runDate: 1, group: 1, service: 1, paramsKey: 1 },
    { unique: true }
);
// Polling lookups (per phase-group).
asyncReportRequestSchema.index({ userId: 1, country: 1, region: 1, runDate: 1, group: 1, status: 1 });
// Reconciliation sweep: find stuck SUBMITTED rows by age.
asyncReportRequestSchema.index({ status: 1, updatedAt: 1 });
// Reconciliation sweep, scoped by domain (the sweeper now filters on `phase`).
asyncReportRequestSchema.index({ phase: 1, status: 1, updatedAt: 1 });

// TTL. These rows are transient bookkeeping — once a run's reports are terminal the row has no
// further use, but nothing was reaping them, so the collection grew without bound (one row per
// report per account per day). 30 days is far longer than any run and leaves plenty of history for
// debugging a stuck account.
asyncReportRequestSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 30 * 24 * 60 * 60, name: "asyncReportRequest_ttl" }
);

module.exports =
    mongoose.models.AsyncReportRequest ||
    mongoose.model("AsyncReportRequest", asyncReportRequestSchema);
