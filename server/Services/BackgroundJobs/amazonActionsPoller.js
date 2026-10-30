/**
 * Follows up changes Amazon processes over minutes (bulk feeds now, inbound
 * shipments later): once a minute, every approved change still waiting for
 * Amazon is checked (ChangeRequestService.pollDue). Each request is claimed before
 * it is checked, so overlapping ticks or instances never check one twice.
 *
 * Hosted by cronProducerStandalone (no memory budget for another PM2 app).
 * AMAZON_ACTIONS_POLLER_DISABLED=true stops it.
 */
const logger = require('../../utils/Logger.js');

let running = false;

async function tick() {
    if (running) return;
    running = true;
    try {
        const { pollDue } = require('../Actions/ChangeRequestService.js');
        const out = await pollDue({ limit: 20 });
        if (out.due) logger.info('[AmazonActionsPoller] followed up changes', out);
    } catch (error) {
        logger.error('[AmazonActionsPoller] tick failed', { error: error.message });
    } finally {
        running = false;
    }
}

function setupCron() {
    if (String(process.env.AMAZON_ACTIONS_POLLER_DISABLED || '').toLowerCase() === 'true') {
        logger.info('[AmazonActionsPoller] disabled');
        return null;
    }
    const cron = require('node-cron');
    return cron.schedule('* * * * *', tick);
}

module.exports = { setupCron, tick };
