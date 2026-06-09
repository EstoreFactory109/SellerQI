/**
 * Log Retention Configuration
 *
 * Single source of truth for how long each log collection is kept in MongoDB.
 * Cleanup is enforced via TTL (Time-To-Live) indexes: MongoDB automatically
 * deletes documents once their date field is older than `expireAfterSeconds`.
 * The background TTL monitor sweeps roughly once every 60 seconds, so disk
 * usage stays flat instead of spiking between bi-weekly purges.
 *
 * Each entry maps a Mongoose model -> the Date field to expire on, the
 * retention window (days), and a stable index name so retention can be
 * updated later via `collMod` (see scripts/setupLogTTLIndexes.js).
 *
 * Override any window with an environment variable (value in DAYS), e.g.:
 *   LOG_RETENTION_SESSION_DAYS=14
 *   LOG_RETENTION_PAYMENT_DAYS=730
 *
 * IMPORTANT: changing a retention window does NOT take effect by simply
 * editing the env and restarting — an existing TTL index with a different
 * duration causes an IndexOptionsConflict. Run `node scripts/setupLogTTLIndexes.js`
 * to apply the new value (it uses collMod to update in place).
 */

const SECONDS_PER_DAY = 60 * 60 * 24;

const days = (envVar, fallback) => {
    const raw = process.env[envVar];
    const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Retention policy per log collection.
 *
 * Defaults reflect the trade-off between debuggability and disk:
 *  - Session/sync logs are purely diagnostic        -> 30 days
 *  - Email logs help support/deliverability triage  -> 90 days
 *  - Payment logs are financial/audit records       -> 365 days (see note)
 *
 * NOTE on PaymentLogs: these are event records for Razorpay/Stripe activity.
 * Many jurisdictions require financial records be retained for several years
 * (often 7). Confirm your compliance requirement before shortening this; the
 * source of truth for transactions still lives in the payment provider, but
 * keep this generous unless legal/finance signs off on a shorter window.
 */
const LOG_RETENTION = {
    userAccountLogs: {
        model: 'UserAccountLogs',
        dateField: 'sessionStartTime',
        indexName: 'ttl_sessionStartTime',
        retentionDays: days('LOG_RETENTION_SESSION_DAYS', 30),
    },
    financeSyncLogs: {
        model: 'FinanceSyncLog',
        dateField: 'fetchedAt',
        indexName: 'ttl_fetchedAt',
        retentionDays: days('LOG_RETENTION_FINANCE_SYNC_DAYS', 30),
    },
    emailLogs: {
        model: 'EmailLogs',
        dateField: 'createdAt',
        indexName: 'ttl_createdAt',
        retentionDays: days('LOG_RETENTION_EMAIL_DAYS', 90),
    },
    paymentLogs: {
        model: 'PaymentLogs',
        dateField: 'createdAt',
        indexName: 'ttl_createdAt',
        retentionDays: days('LOG_RETENTION_PAYMENT_DAYS', 365),
    },
};

/** Retention window in seconds for a given policy key (for expireAfterSeconds). */
const expireAfterSeconds = (key) => LOG_RETENTION[key].retentionDays * SECONDS_PER_DAY;

module.exports = {
    LOG_RETENTION,
    SECONDS_PER_DAY,
    expireAfterSeconds,
};
