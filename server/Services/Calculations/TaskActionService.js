/**
 * Fixes SellerQI can make on Amazon for a task — only after the seller approves.
 *
 * Nothing here runs on its own: a task carries a proposed change (what would be
 * sent, in words the seller reads), and the change is made only when the seller
 * approves it on the Tasks page. Every attempt is logged (TaskActionLog) with who
 * approved it and Amazon's answer, and a change that already succeeded is never
 * sent again.
 *
 * Supported (the same Amazon Ads calls the PPC page's buttons already make):
 *   search_term_zero_sales -> add the search term as a negative exact keyword
 *   wasted_spend_keyword   -> pause the keyword
 *   product_acos_above_breakeven -> lower the bids of the keywords proposed on the
 *     task (renderData.bidChanges); any keyword whose bid changed since is skipped
 *
 * Kill switch: TASK_ACTIONS_DISABLED=true stops every change (proposals are still
 * shown, approving returns an error).
 */

const logger = require('../../utils/Logger.js');
const TaskItem = require('../../models/MCP/TaskItemModel.js');
const TaskActionLog = require('../../models/MCP/TaskActionLogModel.js');

/** At most this many changes per approval request. */
const MAX_ACTIONS_PER_REQUEST = 25;

// A search term that is an ASIN is a product target, which needs a negative product
// target, not a negative keyword; not offered yet.
const isAsin = (text) => /^b0[0-9a-z]{8}$/i.test(String(text || '').trim());

const actionsDisabled = () => String(process.env.TASK_ACTIONS_DISABLED || '').toLowerCase() === 'true';

/**
 * Pure: the change a task proposes, or null. `payload` is what is sent to Amazon.
 * @param {Object} task - stored task (errorCategory, errorType, renderData)
 */
const money = (n) => Number(n).toFixed(2);

function proposedActionFor(task) {
    if (task?.errorCategory !== 'sponsoredAds') return null;
    const d = task.renderData || {};
    const campaign = d.campaignName ? ` in the campaign "${d.campaignName}"` : '';

    if (task.errorType === 'product_acos_above_breakeven') {
        const changes = (Array.isArray(d.bidChanges) ? d.bidChanges : []).filter(c => c?.keywordId && Number(c.newBid) > 0);
        if (changes.length === 0) return null;
        const lines = changes.map(c => `"${c.keyword}" ${money(c.currentBid)} → ${money(c.newBid)}`).join('; ');
        const shared = changes.some(c => c.sharedAdGroup)
            ? ' Some of these keywords are in ad groups that also advertise other products, so their bids change for those too.' : '';
        return {
            type: 'lower_bids',
            label: `Lower ${changes.length} bid${changes.length === 1 ? '' : 's'}`,
            summary: `Lower the bids on ${changes.length} keyword${changes.length === 1 ? '' : 's'} whose ads cost more than this product's break-even: ${lines}.${shared} Product targets and auto campaigns are not changed.`,
            payload: { bids: changes.map(c => ({ keywordId: String(c.keywordId), bid: Number(c.newBid), expectedCurrentBid: Number(c.currentBid) })) }
        };
    }

    if (task.errorType === 'search_term_zero_sales') {
        const term = String(d.searchTerm || '').trim();
        if (!term || isAsin(term) || !d.campaignId) return null;
        const level = d.adGroupId ? 'adGroup' : 'campaign';
        return {
            type: 'add_negative_keyword',
            label: 'Add as negative keyword',
            summary: `Add "${term}" as a negative exact keyword${campaign}${level === 'adGroup' ? ' (this ad group)' : ' (whole campaign)'}, so your ads stop showing for it.`,
            payload: { level, keyword: { campaignId: String(d.campaignId), adGroupId: d.adGroupId ? String(d.adGroupId) : undefined, keywordText: term, matchType: 'negativeExact', state: 'enabled' } }
        };
    }

    if (task.errorType === 'wasted_spend_keyword') {
        const keyword = String(d.keyword || '').trim();
        if (!d.keywordId) return null;
        return {
            type: 'pause_keyword',
            label: 'Pause keyword',
            summary: `Pause the keyword "${keyword || d.keywordId}"${campaign}. You can turn it back on in Amazon Ads at any time.`,
            payload: { keywordId: String(d.keywordId), adType: 'SP' }
        };
    }
    return null;
}

/** Amazon v3 answers a create with { <entity>: { success: [], error: [] } }. */
function v3Errors(result) {
    const errors = [];
    for (const value of Object.values(result || {})) {
        if (value && Array.isArray(value.error)) errors.push(...value.error);
    }
    return errors;
}

/** Sends one approved change to Amazon. Throws on any failure. */
async function execute(action, { userId, country, region }) {
    const { resolveAdsCredentials } = require('../AmazonAds/resolveAdsCredentials.js');
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) throw new Error('AMAZON_ADS_CLIENT_ID is not set');
    const { accessToken, profileId, region: adsRegion } = await resolveAdsCredentials(userId, country, region);

    if (action.type === 'add_negative_keyword') {
        const { addToNegative, getConfig } = require('../AmazonAds/addToNegetive.js');
        const config = getConfig({ accessToken, profileId, region: adsRegion, clientId });
        const result = await addToNegative(config, [action.payload.keyword], { level: action.payload.level });
        const errors = v3Errors(result);
        if (errors.length > 0) throw Object.assign(new Error(`Amazon rejected it: ${JSON.stringify(errors[0]).slice(0, 300)}`), { response: result });
        return result;
    }
    if (action.type === 'lower_bids') {
        // Only keywords whose bid is still what the proposal saw: a bid the seller
        // changed since is theirs to keep.
        const { loadKeywordSnapshot } = require('../../utils/ppcSnapshotLoader.js');
        const snapshot = await loadKeywordSnapshot(String(userId), country, region).catch(() => null);
        const current = new Map((snapshot?.keywordData || []).map(k => [String(k.keywordId), Number(k.bid)]));
        const bids = action.payload.bids.filter(b => Math.abs((current.get(b.keywordId) ?? NaN) - b.expectedCurrentBid) < 0.005);
        if (bids.length === 0) throw new Error('These bids have changed since the suggestion was made, so nothing was sent. Refresh to see a new suggestion.');
        const { updateKeywordBids } = require('../AmazonAds/Pause-ArchiveKeywords.js');
        const result = await updateKeywordBids({ bids: bids.map(({ keywordId, bid }) => ({ keywordId, bid })), accessToken, profileId, region: adsRegion, clientId });
        const errors = v3Errors(result);
        if (errors.length > 0) throw Object.assign(new Error(`Amazon rejected ${errors.length} of ${bids.length}: ${JSON.stringify(errors[0]).slice(0, 300)}`), { response: result });
        return { ...result, sent: bids.length, skippedChanged: action.payload.bids.length - bids.length };
    }
    if (action.type === 'pause_keyword') {
        const { pauseKeywords } = require('../AmazonAds/Pause-ArchiveKeywords.js');
        const result = await pauseKeywords({ ...action.payload, accessToken, profileId, region: adsRegion, clientId });
        const failed = Object.values(result || {}).find((v) => v && v.success === false);
        if (failed) throw Object.assign(new Error(failed.error || 'Amazon did not pause the keyword'), { response: result });
        return result;
    }
    throw new Error(`Unknown action ${action.type}`);
}

/**
 * Makes the approved changes, one task at a time. Each is checked again here from
 * the stored task (never from what the browser sent), skipped when it already
 * succeeded, logged, and on success the task is marked done.
 *
 * @param {Object} params
 * @param {string[]} params.taskIds
 * @param {Object} params.approvedBy - { userId, memberId, adminId, superAdminId }
 * @returns {Promise<Array<{taskId, status: 'succeeded'|'failed'|'skipped', message}>>}
 */
async function approveTaskActions({ userId, country, region, taskIds = [], approvedBy = {} }) {
    if (actionsDisabled()) throw new Error('Changes on Amazon are switched off');
    const ids = [...new Set((taskIds || []).map(String))].slice(0, MAX_ACTIONS_PER_REQUEST);
    const tasks = await TaskItem.find({ userId, country, region, taskId: { $in: ids } }).lean();
    const byId = new Map(tasks.map((t) => [t.taskId, t]));
    const results = [];

    for (const taskId of ids) {
        const task = byId.get(taskId);
        const action = task ? proposedActionFor(task) : null;
        if (!action) {
            results.push({ taskId, status: 'skipped', message: 'There is no change to make for this task.' });
            continue;
        }
        const done = await TaskActionLog.findOne({ userId, country, region, taskId, actionType: action.type, status: 'succeeded' }).lean();
        if (done) {
            results.push({ taskId, status: 'skipped', message: 'This change was already made.' });
            continue;
        }

        const log = await TaskActionLog.create({
            userId, country, region, taskId, errorType: task.errorType,
            actionType: action.type, payload: action.payload, summary: action.summary,
            approvedBy: {
                userId: approvedBy.userId ? String(approvedBy.userId) : null,
                memberId: approvedBy.memberId ? String(approvedBy.memberId) : null,
                adminId: approvedBy.adminId ? String(approvedBy.adminId) : null,
                superAdminId: approvedBy.superAdminId ? String(approvedBy.superAdminId) : null
            }
        });
        try {
            const response = await execute(action, { userId, country, region });
            await TaskActionLog.updateOne({ _id: log._id }, { $set: { status: 'succeeded', response } });
            await TaskItem.updateOne(
                { userId, country, region, taskId },
                { $set: { status: 'completed', completedAt: new Date(), stillDetected: false } }
            );
            logger.info('[TaskActions] change made on Amazon', { userId: String(userId), country, region, taskId, actionType: action.type });
            results.push({ taskId, status: 'succeeded', message: 'Done on Amazon.' });
        } catch (error) {
            await TaskActionLog.updateOne({ _id: log._id }, { $set: { status: 'failed', error: error.message, response: error.response || null } });
            logger.warn('[TaskActions] change failed', { userId: String(userId), country, region, taskId, actionType: action.type, error: error.message });
            results.push({ taskId, status: 'failed', message: error.message });
        }
    }
    return results;
}

/**
 * For the Tasks page: each task's proposed change (without the raw payload) and,
 * when one was already made, that it is done.
 */
async function annotateProposedActions(userId, tasks = []) {
    const withActions = tasks.map((t) => ({ task: t, action: proposedActionFor(t) }));
    const ids = withActions.filter((x) => x.action).map((x) => x.task.taskId);
    let doneIds = new Set();
    if (ids.length > 0) {
        try {
            const logs = await TaskActionLog.find({ userId, taskId: { $in: ids }, status: 'succeeded' }).select('taskId').lean();
            doneIds = new Set(logs.map((l) => l.taskId));
        } catch (_) { /* no log read = not known to be done */ }
    }
    return withActions.map(({ task, action }) => (action
        ? { ...task, proposedAction: { type: action.type, label: action.label, summary: action.summary, done: doneIds.has(task.taskId) } }
        : task));
}

module.exports = {
    MAX_ACTIONS_PER_REQUEST,
    proposedActionFor,
    approveTaskActions,
    annotateProposedActions,
    actionsDisabled
};
