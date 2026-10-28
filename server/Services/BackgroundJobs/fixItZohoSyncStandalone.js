/**
 * Fix it ↔ Zoho sweep: every 30 minutes, each Fix it work order still syncing (active,
 * cancelled-but-paid, or ended in the last 30 days) is reconciled with Zoho — subtasks the
 * team closed complete the seller's SellerQI tasks, tasks the seller finished close their
 * subtasks, and new high-value tasks top the work order up (FixItZohoSync).
 *
 * Changes made IN SellerQI are already pushed straight away (payment, task reconcile, the
 * seller ticking a task); this sweep is what brings Zoho's side back, since Zoho sends us
 * no webhooks.
 *
 * Hosted in cron-producer (cronProducerStandalone.js) for the same memory-budget reason as
 * the nightly Zoho task sync. On by default; FIXIT_ZOHO_SYNC_ENABLED=false turns it off.
 * Only sellers who bought a Fix it package have work orders, so for everyone else this
 * reads one empty query.
 */
const cron = require('node-cron');
const logger = require('../../utils/Logger.js');
const { acquireLock } = require('../../utils/mongoLock.js');

const ENABLED = process.env.FIXIT_ZOHO_SYNC_ENABLED !== 'false';
const CRON = process.env.FIXIT_ZOHO_SYNC_CRON || '*/30 * * * *';
const LOCK_TTL_MS = 25 * 60 * 1000;

async function runTick() {
    const release = await acquireLock('fixit-zoho-sweep', LOCK_TTL_MS, 'fixit-zoho-sweep');
    if (!release) return { skipped: 'another sweep is running' };
    try {
        const FixItZohoSync = require('../Stripe/FixItZohoSync.js');
        const results = await FixItZohoSync.syncAll();
        const changed = results.filter((r) => r && (r.created || r.adopted || r.completedInSellerQI || r.closedInZoho || r.reopenedInZoho || r.reopenedInSellerQI));
        if (results.length) logger.info(`[FixItZohoSweep] ${results.length} work order(s), ${changed.length} changed, ${results.filter((r) => r?.error).length} failed`);
        return { workOrders: results.length, changed: changed.length };
    } finally {
        await release();
    }
}

function setupCron() {
    if (!ENABLED) {
        logger.info('[FixItZohoSweep] disabled (FIXIT_ZOHO_SYNC_ENABLED=false)');
        return null;
    }
    return cron.schedule(CRON, async () => {
        try {
            await runTick();
        } catch (error) {
            logger.error('[FixItZohoSweep] tick failed', { error: error?.message });
        }
    }, { timezone: 'UTC' });
}

module.exports = { setupCron, runTick };
