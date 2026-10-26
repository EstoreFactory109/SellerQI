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
 *   ads_on_unbuyable -> pause that product's enabled product ads (found live at
 *     approval); the seller turns them back on once the product can sell
 *   listing text tasks (title, bullets, description, backend keywords) -> replace
 *     that field with text the seller writes or picks from AI suggestions, checked
 *     against the same listing rules before anything is sent ("Fix It")
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
    if (task?.errorCategory !== 'sponsoredAds') return null;
    const d = task.renderData || {};

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

/** Amazon v3 answers a create with { <entity>: { success: [], error: [] } }. */
function v3Errors(result) {
    const errors = [];
    for (const value of Object.values(result || {})) {
        if (value && Array.isArray(value.error)) errors.push(...value.error);
    }
    return errors;
}

/** Sends one approved change to Amazon. Throws on any failure. */
/** Listing fix: the seller's text, sent through the same service as Fix It, and recorded the same way. */
async function executeListingFix(action, { userId, country, region }) {
    const Seller = require('../../models/user-auth/sellerCentralModel.js');
    const seller = await Seller.findOne({ User: userId }).select('sellerAccount.country sellerAccount.region sellerAccount.products.asin sellerAccount.products.sku sellerAccount.products.status').lean();
    const account = (seller?.sellerAccount || []).find(a => a.country === country && a.region === region);
    const product = (account?.products || []).find(p => p.asin === action.payload.asin && p.status === 'Active' && p.sku)
        || (account?.products || []).find(p => p.asin === action.payload.asin && p.sku);
    if (!product) throw new Error('No SKU found for this product, so the listing cannot be updated.');

    const { updateProductContent, FIX_STATUS } = require('../Sp_API/UpdateProductContentService.js');
    const result = await updateProductContent({
        sku: product.sku, userId, country, region,
        dataToBeUpdated: action.payload.field, valueToBeUpdated: action.payload.value
    });
    const accepted = [FIX_STATUS.SUCCESS, FIX_STATUS.PARTIAL_SUCCESS, FIX_STATUS.CONFLICT_RESOLVED].includes(result?.status);
    if (!accepted) throw Object.assign(new Error(result?.message || 'Amazon did not accept the change.'), { response: result });

    // The record Fix It keeps too: "changed by us" for the detail-page-change check.
    const ListingFixStatus = require('../../models/system/ListingFixStatusModel.js');
    await ListingFixStatus.markAsFixed({
        userId, country, region, asin: action.payload.asin, sku: product.sku,
        attribute: action.payload.field, valueApplied: action.payload.value
    }).catch(() => null);
    return { status: result.status, sku: product.sku, message: result.message };
}

async function execute(action, { userId, country, region }) {
    if (action.type === 'update_listing_content') return executeListingFix(action, { userId, country, region });
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
        const keywordBids = action.payload.bids.filter(b => b.kind !== 'target');
        const targetBids = action.payload.bids.filter(b => b.kind === 'target');
        const unchanged = (current, id, expected) => Math.abs((current.get(id) ?? NaN) - expected) < 0.005;
        // Keywords: the daily keyword snapshot (checked against live Amazon, 150/150 equal).
        const { loadKeywordSnapshot } = require('../../utils/ppcSnapshotLoader.js');
        const snapshot = keywordBids.length ? await loadKeywordSnapshot(String(userId), country, region).catch(() => null) : null;
        const kwCurrent = new Map((snapshot?.keywordData || []).map(k => [String(k.keywordId), Number(k.bid)]));
        const kwSend = keywordBids.filter(b => unchanged(kwCurrent, b.keywordId, b.expectedCurrentBid));
        // Targets: their snapshot is weekly, so the current bid is read live (a read).
        const { listTargetBids, updateTargetBids } = require('../AmazonAds/AdsTargets.js');
        const live = targetBids.length ? await listTargetBids(accessToken, profileId, adsRegion, targetBids.map(b => b.targetId)) : new Map();
        const tgCurrent = new Map([...live].map(([id, t]) => [id, t.bid]));
        const tgSend = targetBids.filter(b => unchanged(tgCurrent, b.targetId, b.expectedCurrentBid));
        if (kwSend.length + tgSend.length === 0) throw new Error('These bids have changed since the suggestion was made, so nothing was sent. Refresh to see a new suggestion.');

        const responses = {};
        if (kwSend.length) {
            const { updateKeywordBids } = require('../AmazonAds/Pause-ArchiveKeywords.js');
            responses.keywords = await updateKeywordBids({ bids: kwSend.map(({ keywordId, bid }) => ({ keywordId, bid })), accessToken, profileId, region: adsRegion, clientId });
        }
        if (tgSend.length) {
            responses.targets = await updateTargetBids({ bids: tgSend.map(({ targetId, bid }) => ({ targetId, bid })), accessToken, profileId, region: adsRegion });
        }
        const errors = [...v3Errors(responses.keywords), ...v3Errors(responses.targets)];
        const sent = kwSend.length + tgSend.length;
        if (errors.length > 0) throw Object.assign(new Error(`Amazon rejected ${errors.length} of ${sent}: ${JSON.stringify(errors[0]).slice(0, 300)}`), { response: responses });
        return { ...responses, sent, skippedChanged: action.payload.bids.length - sent };
    }
    if (action.type === 'pause_product_ads') {
        const { listEnabledProductAdsForAsin, pauseProductAds } = require('../AmazonAds/ProductAds.js');
        const ads = await listEnabledProductAdsForAsin({ asin: action.payload.asin, accessToken, profileId, region: adsRegion });
        if (ads.length === 0) throw new Error('This product has no enabled Sponsored Products ads now, so nothing was paused.');
        const result = await pauseProductAds({ adIds: ads.map(a => a.adId), accessToken, profileId, region: adsRegion });
        const errors = v3Errors(result);
        if (errors.length > 0) throw Object.assign(new Error(`Amazon rejected ${errors.length} of ${ads.length}: ${JSON.stringify(errors[0]).slice(0, 300)}`), { response: result });
        return { ...result, paused: ads.length, adIds: ads.map(a => String(a.adId)) };
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
        ? { ...task, proposedAction: {
            type: action.type, label: action.label, summary: action.summary, done: doneIds.has(task.taskId),
            ...(action.editable ? { editable: true, field: action.field } : {})
        } }
        : task));
}

module.exports = {
    MAX_ACTIONS_PER_REQUEST,
    proposedActionFor,
    validateListingContent,
    approveTaskActions,
    annotateProposedActions,
    actionsDisabled
};
