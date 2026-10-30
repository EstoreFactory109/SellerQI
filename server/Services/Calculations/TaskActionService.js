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
 *   budget_limited_profitable -> raise the campaign's daily budget to Amazon's
 *     suggestion (current budget re-read live; skipped if it changed)
 *   ads_on_unbuyable -> pause that product's enabled product ads (found live at
 *     approval); the seller turns them back on once the product can sell
 *   listing text tasks (title, bullets, description, backend keywords) -> replace
 *     that field with text the seller writes or picks from AI suggestions, checked
 *     against the same listing rules before anything is sent ("Fix It")
 *   negative_feedback_order -> send Amazon's own "please update your feedback"
 *     message for that order (Messaging API; Amazon writes it, once per order)
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

const actionsDisabled = () => require('../Actions/actionGates.js').writesDisabled();

/**
 * Pure: the change a task proposes, or null. `payload` is what is sent to Amazon.
 * @param {Object} task - stored task (errorCategory, errorType, renderData)
 */
const money = (n) => Number(n).toFixed(2);

// Ranking task prefix -> the listing field Fix It updates.
const LISTING_FIELDS = [
    ['titleresult_', 'title', 'title'],
    ['bulletpoints_', 'bulletpoints', 'bullet points'],
    ['description_', 'description', 'description'],
    ['backend_keywords_', 'generic_keyword', 'backend keywords']
];

function listingFieldOf(task) {
    if (task?.errorCategory !== 'ranking' || !task.asin || /^[A-Z]+:/.test(task.asin)) return null;
    const hit = LISTING_FIELDS.find(([prefix]) => String(task.errorType || '').startsWith(prefix));
    return hit ? { field: hit[1], label: hit[2] } : null;
}

/**
 * Checks text the seller approved for a listing field against the listing rules,
 * so a fix never sends content that breaks them. Titles must pass every title rule;
 * bullets and description must have no restricted words or claims; backend keywords
 * must fit Amazon's byte limit (using little of it is advice, not a blocker).
 * @returns {{ok: boolean, value: any, reason?: string}}
 */
function validateListingContent(field, raw, { brand = '' } = {}) {
    const R = require('./Rankings.js');
    const reasons = (result, keys) => keys
        .map(k => result?.[k])
        .filter(x => x && x.status === 'Error')
        .map(x => x.Message)
        .join(' ');
    if (field === 'title') {
        const value = String(raw || '').trim();
        if (!value) return { ok: false, value, reason: 'Enter a title.' };
        const r = R.checkTitle(value, { brand, strict: true });
        return r.NumberOfErrors > 0 ? { ok: false, value, reason: reasons(r, Object.keys(r)) || 'This title still breaks a listing rule.' } : { ok: true, value };
    }
    if (field === 'bulletpoints') {
        const value = (Array.isArray(raw) ? raw : String(raw || '').split('\n')).map(s => String(s).trim()).filter(Boolean);
        if (value.length === 0) return { ok: false, value, reason: 'Enter at least one bullet point.' };
        const r = R.checkBulletPoints(value, { strict: true });
        return r.RestictedWords?.status === 'Error' ? { ok: false, value, reason: r.RestictedWords.Message } : { ok: true, value };
    }
    if (field === 'description') {
        const value = String(raw || '').trim();
        if (!value) return { ok: false, value, reason: 'Enter a description.' };
        const r = R.checkDescription([value], { strict: true });
        return r.RestictedWords?.status === 'Error' ? { ok: false, value, reason: r.RestictedWords.Message } : { ok: true, value };
    }
    if (field === 'generic_keyword') {
        const value = String(raw || '').trim();
        if (!value) return { ok: false, value, reason: 'Enter backend keywords.' };
        const bytes = new TextEncoder().encode(value).length;
        return bytes > 250 ? { ok: false, value, reason: `These keywords are ${bytes} bytes; Amazon ignores all of them over 250.` } : { ok: true, value };
    }
    return { ok: false, value: raw, reason: 'This field cannot be updated here.' };
}

function proposedActionFor(task) {
    const listing = listingFieldOf(task);
    if (listing) {
        return {
            type: 'update_listing_content',
            label: `Fix the ${listing.label}`,
            editable: true,
            field: listing.field,
            summary: `Replace this product's ${listing.label} on Amazon with the text you approve below.`,
            payload: { field: listing.field, asin: task.asin }
        };
    }
    if (task?.errorCategory === 'account' && task.errorType === 'negative_feedback_order') {
        const orderId = String(task.renderData?.orderId || '').trim();
        if (!orderId) return null;
        return {
            type: 'request_feedback_update',
            label: 'Ask buyer to update feedback',
            summary: `Send Amazon's standard message asking the buyer of order ${orderId} to consider updating their feedback. Amazon writes the message and allows it once per order; it cannot offer anything in return. Best sent after you have resolved the buyer's problem.`,
            payload: { orderId }
        };
    }
    if (task?.errorCategory !== 'sponsoredAds') return null;
    const d = task.renderData || {};

    if (task.errorType === 'budget_limited_profitable') {
        const budget = Number(d.budget);
        const suggested = Number(d.suggestedBudget);
        if (!d.campaignId || !(suggested > budget)) return null;
        return {
            type: 'raise_budget',
            label: 'Raise budget',
            summary: `Raise the daily budget of "${d.campaignName || d.campaignId}" from $${budget.toFixed(2)} to $${suggested.toFixed(2)} (Amazon's suggestion), so it stays on all day. You can lower it again in Amazon Ads at any time.`,
            payload: { campaignId: String(d.campaignId), budget: suggested, expectedCurrentBudget: budget }
        };
    }

    if (task.errorType === 'ads_on_unbuyable' && task.asin && /^[A-Z0-9]{10}$/i.test(task.asin)) {
        return {
            type: 'pause_product_ads',
            label: 'Pause ads for this product',
            summary: `Pause every Sponsored Products ad for ${task.asin}${d.reason ? ` while ${d.reason}` : ''}. Campaigns and keywords stay as they are; turn the ads back on in Amazon Ads once the product can sell again.`,
            payload: { asin: String(task.asin).toUpperCase() }
        };
    }
    const campaign = d.campaignName ? ` in the campaign "${d.campaignName}"` : '';

    if (task.errorType === 'product_acos_above_breakeven') {
        const changes = (Array.isArray(d.bidChanges) ? d.bidChanges : []).filter(c => (c?.keywordId || c?.targetId) && Number(c.newBid) > 0);
        if (changes.length === 0) return null;
        const lines = changes.map(c => `${c.kind === 'target' ? 'target ' : ''}"${c.keyword}" ${money(c.currentBid)} → ${money(c.newBid)}`).join('; ');
        const shared = changes.some(c => c.sharedAdGroup)
            ? ' Some of these are in ad groups that also advertise other products, so their bids change for those too.' : '';
        const hasTargets = changes.some(c => c.kind === 'target');
        return {
            type: 'lower_bids',
            label: `Lower ${changes.length} bid${changes.length === 1 ? '' : 's'}`,
            summary: `Lower the bids on ${changes.length} keyword${hasTargets ? 's and targets' : (changes.length === 1 ? '' : 's')} whose ads cost more than this product's break-even: ${lines}.${shared}${hasTargets ? '' : ' Product targets and auto campaigns are not changed.'}`,
            payload: { bids: changes.map(c => (c.kind === 'target'
                ? { kind: 'target', targetId: String(c.targetId), bid: Number(c.newBid), expectedCurrentBid: Number(c.currentBid) }
                : { keywordId: String(c.keywordId), bid: Number(c.newBid), expectedCurrentBid: Number(c.currentBid) })) }
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

const { v3Errors } = require('../Actions/adsErrors.js');

// Task action type -> the change handler that makes it (Services/Actions/handlers),
// and how the task's payload maps to that handler's input.
const TASK_ACTION_HANDLERS = {
    add_negative_keyword: ['ads.add_negative_keywords', (p) => ({ level: p.level, keywords: [p.keyword] })],
    pause_keyword: ['ads.pause_keywords', (p) => ({ keywordIds: [String(p.keywordId)], adType: p.adType || 'SP' })],
    lower_bids: ['ads.lower_bids', (p) => p],
    raise_budget: ['ads.raise_budget', (p) => p],
    pause_product_ads: ['ads.pause_product_ads', (p) => p],
    update_listing_content: ['listings.update_content', (p) => ({ asin: p.asin, field: p.field, value: p.value })],
    request_feedback_update: ['messaging.request_feedback', (p) => p]
};

/** Sends one approved change to Amazon through its handler. Throws on any failure. */
async function execute(action, { userId, country, region }) {
    const entry = TASK_ACTION_HANDLERS[action.type];
    if (!entry) throw new Error(`Unknown action ${action.type}`);
    const handler = require('../Actions/registry.js').get(entry[0]);
    return handler.execute(entry[1](action.payload), { userId, country, region });
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
async function approveTaskActions({ userId, country, region, taskIds = [], approvedBy = {}, content = {} }) {
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
        if (action.editable) {
            // The one place the request supplies content: the text the seller approved.
            const brand = await require('../../models/user-auth/sellerCentralModel.js')
                .findOne({ User: userId }).select('brand').lean().then(s => s?.brand || '').catch(() => '');
            const checked = validateListingContent(action.field, content?.[taskId], { brand });
            if (!checked.ok) {
                results.push({ taskId, status: 'failed', message: checked.reason });
                continue;
            }
            action.payload = { ...action.payload, value: checked.value };
            action.summary = `${action.summary.replace(' with the text you approve below.', '')}: ${Array.isArray(checked.value) ? checked.value.join(' | ') : checked.value}`.slice(0, 2000);
        }
        // Listing text can be fixed again with different text; ads changes only once.
        const done = action.editable ? null : await TaskActionLog.findOne({ userId, country, region, taskId, actionType: action.type, status: 'succeeded' }).lean();
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
                superAdminId: approvedBy.superAdminId ? String(approvedBy.superAdminId) : null,
                esfUserId: approvedBy.esfUserId ? String(approvedBy.esfUserId) : null
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
        ? { ...task, proposedAction: {
            type: action.type, label: action.label, summary: action.summary, done: doneIds.has(task.taskId),
            ...(action.editable ? { editable: true, field: action.field } : {})
        } }
        : task));
}

module.exports = {
    MAX_ACTIONS_PER_REQUEST,
    TASK_ACTION_HANDLERS,
    v3Errors,
    proposedActionFor,
    validateListingContent,
    approveTaskActions,
    annotateProposedActions,
    actionsDisabled
};
