/**
 * Changes on Amazon from SellerQI's screens: preview first, send only after the
 * seller approves, log every attempt (AmazonChangeRequest).
 *
 *   createPreview  validate + preview (reads only) -> a draft; nothing is sent
 *   approve        draft -> running atomically (a second click or tab gets "already
 *                  sent"), stale check, send the STORED payload, record the result
 *   runApproved    preview + approve in one step, for screens where the seller's
 *                  click already was the approval (Fix It's Apply button)
 *
 * The payload is always built on the server by the handler; nothing the browser
 * sends at approval time is used.
 */
const crypto = require('crypto');
const logger = require('../../utils/Logger.js');
const ChangeRequest = require('../../models/MCP/AmazonChangeRequestModel.js');
const registry = require('./registry.js');
const { writesDisabled, handlerEnabledFor } = require('./actionGates.js');
const { userError, isTimeout } = require('./errors.js');

const DRAFT_MINUTES = 30;
// Following up a change Amazon processes over minutes (feeds, inbound): 15 s, 30 s,
// 1 min, then every 5 min; after a day it is reported as not finished.
const POLL_DELAYS_MS = [15000, 30000, 60000];
const POLL_EVERY_MS = 5 * 60 * 1000;
const POLL_GIVE_UP_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_REQUEST = 25;

/** A refusal the controller turns into an HTTP status. */
const refusal = (status, message) => Object.assign(new Error(message), { statusCode: status, isUserError: true });

/** Stable JSON (sorted keys) so the same change always gets the same key. */
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

const idempotencyKeyFor = ({ userId, country, region, actionType, payload }) =>
    crypto.createHash('sha256').update(`${userId}|${country}|${region}|${actionType}|${canonical(payload)}`).digest('hex');

const approverOf = (by = {}) => ({
    userId: by.userId ? String(by.userId) : null,
    memberId: by.memberId ? String(by.memberId) : null,
    adminId: by.adminId ? String(by.adminId) : null,
    superAdminId: by.superAdminId ? String(by.superAdminId) : null,
    esfUserId: by.esfUserId ? String(by.esfUserId) : null
});

/** What the browser gets back: never the raw payload. */
function view(doc) {
    if (!doc) return null;
    return {
        id: String(doc._id),
        feature: doc.feature,
        actionType: doc.actionType,
        status: doc.status,
        preview: doc.preview,
        amazon: doc.amazon || {},
        error: doc.error || '',
        message: messageFor(doc),
        createdAt: doc.createdAt,
        approvedAt: doc.approvedAt,
        expiresAt: doc.expiresAt
    };
}

function messageFor(doc) {
    switch (doc.status) {
        case 'draft': return 'Not sent yet. Review and approve to send it to Amazon.';
        case 'running': return 'Sending to Amazon...';
        case 'awaiting_amazon': return 'Amazon accepted it and is still processing.';
        case 'succeeded': return doc.error ? `Done on Amazon. ${doc.error}` : 'Done on Amazon.';
        case 'stale': return doc.error || 'Amazon changed since this was prepared, so nothing was sent. Review it again.';
        case 'unknown': return 'Amazon did not answer in time. SellerQI is checking whether it went through; it will not be sent again.';
        case 'cancelled': return doc.error || 'Cancelled; nothing was sent.';
        case 'expired': return 'This preview expired; nothing was sent.';
        default: return doc.error || 'Amazon did not accept the change.';
    }
}

const isStaff = (by = {}) => !!(by.superAdminId || by.esfUserId || by.adminId);

function handlerFor(actionType, feature, userId, actor = null) {
    const handler = registry.get(actionType);
    if (!handler || (feature && handler.feature !== feature)) throw refusal(404, 'This kind of change is not available.');
    if (!handlerEnabledFor(handler, userId)) throw refusal(403, 'This kind of change is not switched on for this account yet.');
    if (handler.staffOnly && actor && !isStaff(actor)) throw refusal(403, 'Only the SellerQI team can make this change.');
    return handler;
}

const nextPollAfter = (pollCount) => new Date(Date.now() + (POLL_DELAYS_MS[pollCount] ?? POLL_EVERY_MS));

/**
 * Validate and preview a change; store it as a draft (unless persist is false).
 * @returns {Promise<Object>} the draft as the browser sees it (or the bare preview when not persisted)
 */
async function createPreview({ userId, country, region, feature, actionType, input = {}, source = 'screen', createdBy = {}, persist = true }) {
    const handler = handlerFor(actionType, feature, userId, createdBy);
    if (!registry.previewable(handler)) throw refusal(404, 'This kind of change is not available here.');
    const ctx = { userId, country, region };
    const clean = handler.validate ? await handler.validate(input, ctx) : input;
    const result = await handler.preview(clean, ctx);
    const { payload, expected = {}, ...preview } = result || {};
    if (!payload) throw new Error(`${actionType} preview built no payload`);
    if (!persist) return { preview, payload, expected };

    const idempotencyKey = idempotencyKeyFor({ userId, country, region, actionType, payload });
    const doc = await ChangeRequest.create({
        userId, country, region, feature: handler.feature, actionType, source,
        status: 'draft', input: clean, preview, payload, expected, idempotencyKey,
        createdBy: approverOf(createdBy),
        expiresAt: new Date(Date.now() + DRAFT_MINUTES * 60 * 1000)
    });
    return view(doc);
}

/**
 * Send an approved draft. Every outcome is stored on the request.
 * @returns {Promise<Object>} the request as the browser sees it
 */
async function approve({ id, userId, country, region, feature, approvedBy = {} }) {
    if (writesDisabled()) throw refusal(503, 'Changes on Amazon are switched off right now.');
    const now = new Date();
    const doc = await ChangeRequest.findOneAndUpdate(
        { _id: id, userId, country, region, ...(feature ? { feature } : {}), status: 'draft', expiresAt: { $gt: now } },
        { $set: { status: 'running', approvedBy: approverOf(approvedBy), approvedAt: now, expiresAt: null } },
        { new: true }
    ).lean();
    if (!doc) {
        const existing = await ChangeRequest.findOne({ _id: id, userId, country, region, ...(feature ? { feature } : {}) }).lean().catch(() => null);
        if (!existing) throw refusal(404, 'Change not found.');
        if (existing.status === 'draft') throw refusal(409, 'This preview expired; nothing was sent. Review it again.');
        throw refusal(409, 'This change was already approved.');
    }

    const finish = async (set) => {
        const updated = await ChangeRequest.findOneAndUpdate({ _id: doc._id }, { $set: set }, { new: true }).lean();
        return view(updated || { ...doc, ...set });
    };

    let handler;
    try {
        handler = handlerFor(doc.actionType, doc.feature, userId, approvedBy);
    } catch (error) {
        return finish({ status: 'failed', error: error.message });
    }

    // The same change made a moment ago (another tab, or a double submit) is not sent again.
    const duplicate = await ChangeRequest.findOne({
        _id: { $ne: doc._id }, idempotencyKey: doc.idempotencyKey, status: 'succeeded',
        approvedAt: { $gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) }
    }).select('_id').lean();
    if (duplicate) return finish({ status: 'cancelled', error: 'The same change was just made, so it was not sent again.' });

    const ctx = { userId, country, region };
    try {
        if (handler.staleCheck) await handler.staleCheck(doc, ctx);
        const result = await handler.execute(doc.payload, ctx);
        if (result && result.pending) {
            return finish({ status: 'awaiting_amazon', amazon: result.amazon || {}, response: result.response || null, pollCount: 0, nextPollAt: nextPollAfter(0) });
        }
        logger.info('[ChangeRequest] made on Amazon', { userId: String(userId), country, region, actionType: doc.actionType, id: String(doc._id) });
        return finish({ status: 'succeeded', response: result ?? null, amazon: result?.amazon || doc.amazon || {} });
    } catch (error) {
        if (error.isStale) return finish({ status: 'stale', error: error.message });
        if (isTimeout(error) && !handler.idempotent) {
            logger.warn('[ChangeRequest] no answer from Amazon; not resending', { id: String(doc._id), actionType: doc.actionType, error: error.message });
            return finish({ status: 'unknown', error: error.message, nextPollAt: new Date(Date.now() + 60 * 1000) });
        }
        logger.warn('[ChangeRequest] failed', { id: String(doc._id), actionType: doc.actionType, error: error.message });
        return finish({ status: 'failed', error: String(error.message || 'Amazon did not accept the change.').slice(0, 1000), response: error.response ?? null, amazon: error.amazon || doc.amazon || {} });
    }
}

/** Approve several drafts, one after another. */
async function approveMany({ ids = [], ...rest }) {
    const unique = [...new Set((ids || []).map(String))];
    if (unique.length === 0) throw userError('Choose at least one change.');
    if (unique.length > MAX_PER_REQUEST) throw userError(`At most ${MAX_PER_REQUEST} changes at a time.`);
    const results = [];
    for (const id of unique) {
        try {
            results.push(await approve({ id, ...rest }));
        } catch (error) {
            results.push({ id, status: 'failed', message: error.message });
        }
    }
    return results;
}

/**
 * Preview and send in one step: for a screen where the seller already confirmed
 * the exact change with their click. Still logged like any other change.
 */
async function runApproved({ userId, country, region, feature, actionType, input, source = 'screen', approvedBy = {} }) {
    const draft = await createPreview({ userId, country, region, feature, actionType, input, source, createdBy: approvedBy });
    return approve({ id: draft.id, userId, country, region, feature, approvedBy });
}

async function cancelDraft({ id, userId, country, region }) {
    const doc = await ChangeRequest.findOneAndUpdate(
        { _id: id, userId, country, region, status: 'draft' },
        { $set: { status: 'cancelled', error: 'Cancelled before sending.', expiresAt: null } },
        { new: true }
    ).lean();
    if (!doc) throw refusal(409, 'Only a change that was not sent yet can be cancelled.');
    return view(doc);
}

/**
 * Ask Amazon how a change it is processing is doing, once. Claims the request
 * first (moves nextPollAt on), so two pollers never follow up the same one.
 * @returns {Promise<Object|null>} the updated request, or null when not due / taken
 */
async function pollOne(id) {
    const now = new Date();
    const doc = await ChangeRequest.findOneAndUpdate(
        { _id: id, status: 'awaiting_amazon', nextPollAt: { $lte: now } },
        { $set: { nextPollAt: new Date(now.getTime() + 2 * 60 * 1000) }, $inc: { pollCount: 1 } },
        { new: true }
    ).lean();
    if (!doc) return null;
    const handler = registry.get(doc.actionType);
    const set = async (fields) => view(await ChangeRequest.findOneAndUpdate({ _id: doc._id, status: 'awaiting_amazon' }, { $set: fields }, { new: true }).lean() || doc);
    if (!handler?.poll) return set({ status: 'failed', error: 'SellerQI cannot follow up this change.', nextPollAt: null });
    const started = new Date(doc.approvedAt || doc.createdAt).getTime();
    try {
        const out = await handler.poll(doc, { userId: doc.userId, country: doc.country, region: doc.region });
        if (out?.status === 'pending') {
            if (Date.now() - started > POLL_GIVE_UP_MS) {
                return set({ status: 'failed', error: 'Amazon has not finished processing this after a day. Check it in Seller Central.', nextPollAt: null });
            }
            return set({ nextPollAt: nextPollAfter(doc.pollCount) });
        }
        const status = ['succeeded', 'failed', 'cancelled'].includes(out?.status) ? out.status : 'failed';
        logger.info('[ChangeRequest] Amazon finished', { id: String(doc._id), actionType: doc.actionType, status });
        return set({ status, response: out?.response ?? doc.response, error: out?.error || (status === 'succeeded' ? (out?.note || '') : 'Amazon did not accept the change.'), nextPollAt: null });
    } catch (error) {
        // A failed check is not a failed change: try again later.
        logger.warn('[ChangeRequest] follow-up failed; will retry', { id: String(doc._id), error: error.message });
        return set({ nextPollAt: nextPollAfter(Math.max(doc.pollCount, POLL_DELAYS_MS.length)) });
    }
}

/** Follow up every change that is due (the cron poller). */
async function pollDue({ limit = 20 } = {}) {
    const due = await ChangeRequest.find({ status: 'awaiting_amazon', nextPollAt: { $lte: new Date() } })
        .sort({ nextPollAt: 1 }).limit(limit).select('_id').lean();
    let done = 0;
    for (const d of due) {
        if (await pollOne(d._id).catch(() => null)) done += 1;
    }
    return { due: due.length, polled: done };
}

async function get({ id, userId, country, region }) {
    let doc = await ChangeRequest.findOne({ _id: id, userId, country, region }).lean();
    if (!doc) throw refusal(404, 'Change not found.');
    // The approval window polls this while Amazon works: follow up when due.
    if (doc.status === 'awaiting_amazon' && doc.nextPollAt && new Date(doc.nextPollAt) <= new Date()) {
        await pollOne(doc._id).catch(() => null);
        doc = await ChangeRequest.findOne({ _id: id, userId, country, region }).lean();
    }
    return view(doc);
}

/** Recent changes for a screen's history panel (drafts left out). */
async function list({ userId, country, region, feature = null, limit = 20 }) {
    const docs = await ChangeRequest.find({
        userId, country, region, ...(feature ? { feature } : {}), status: { $ne: 'draft' }
    }).sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 20, 1), 100)).lean();
    return docs.map((d) => ({ ...view(d), approvedBy: d.approvedBy }));
}

/** Which kinds of change this account can make (the client shows buttons from this). */
function capabilities(userId, actor = {}) {
    const disabled = writesDisabled();
    const byFeature = {};
    for (const handler of registry.all()) {
        if (!registry.previewable(handler)) continue;
        const enabled = !disabled && handlerEnabledFor(handler, userId) && (!handler.staffOnly || isStaff(actor));
        (byFeature[handler.feature] ||= []).push({ actionType: handler.actionType, enabled });
    }
    return { writesDisabled: disabled, features: byFeature };
}

module.exports = {
    createPreview, approve, approveMany, runApproved, cancelDraft, get, list, capabilities, pollOne, pollDue,
    idempotencyKeyFor, canonical, DRAFT_MINUTES, MAX_PER_REQUEST
};
