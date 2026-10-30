/**
 * Amazon Ads changes. One implementation per change, used by the Tasks page
 * (TaskActionService) and by screens (ChangeRequestService).
 *
 * Handler shape (see ../registry.js): validate(input) -> clean input,
 * preview(input, ctx) -> what the seller sees + the payload, staleCheck(doc, ctx),
 * execute(payload, ctx) -> Amazon's answer (throws on any failure).
 */
const { assertNoV3Errors, v3Errors } = require('../adsErrors.js');
const { userError, staleError } = require('../errors.js');

const AD_TYPES = ['SP', 'SB', 'SD'];
const MAX_KEYWORDS = 500;
const money = (n) => Number(n).toFixed(2);

/** Ads token + profile for this marketplace, resolved once per request. */
async function adsCreds(ctx) {
    if (!ctx._ads) {
        const clientId = process.env.AMAZON_ADS_CLIENT_ID;
        if (!clientId) throw new Error('AMAZON_ADS_CLIENT_ID is not set');
        const { resolveAdsCredentials } = require('../../AmazonAds/resolveAdsCredentials.js');
        ctx._ads = { ...(await resolveAdsCredentials(ctx.userId, ctx.country, ctx.region)), clientId };
    }
    return ctx._ads;
}

/** Keyword text and match type from the daily snapshot, for the preview only. */
async function keywordNames(ctx, ids) {
    try {
        const { loadKeywordSnapshot } = require('../../../utils/ppcSnapshotLoader.js');
        const snap = await loadKeywordSnapshot(String(ctx.userId), ctx.country, ctx.region);
        const byId = new Map((snap?.keywordData || []).map((k) => [String(k.keywordId), k]));
        return ids.map((id) => byId.get(String(id)) || null);
    } catch (_) {
        return ids.map(() => null);
    }
}

const adTypeOf = (input) => {
    const t = String(input?.adType || 'SP').toUpperCase();
    if (!AD_TYPES.includes(t)) throw userError(`Ad type must be one of ${AD_TYPES.join(', ')}.`);
    return t;
};

const idList = (raw, label) => {
    const ids = [...new Set((Array.isArray(raw) ? raw : []).map(String).filter(Boolean))];
    if (ids.length === 0) throw userError(`Choose at least one ${label}.`);
    if (ids.length > MAX_KEYWORDS) throw userError(`At most ${MAX_KEYWORDS} ${label}s at a time.`);
    return ids;
};

/** Pause: the PPC page and the Tasks page. Pausing twice is harmless. */
const pauseKeywords = {
    actionType: 'ads.pause_keywords',
    feature: 'ads',
    idempotent: true,
    validate(input) {
        return { keywordIds: idList(input?.keywordIds, 'keyword'), adType: adTypeOf(input) };
    },
    async preview(input, ctx) {
        const names = await keywordNames(ctx, input.keywordIds);
        return {
            title: `Pause ${input.keywordIds.length} keyword${input.keywordIds.length === 1 ? '' : 's'}`,
            target: 'Amazon Ads',
            lines: input.keywordIds.map((id, i) => ({
                label: names[i] ? `"${names[i].keywordText}" (${String(names[i].matchType || '').toLowerCase()})` : `Keyword ${id}`,
                before: 'Enabled',
                after: 'Paused'
            })),
            warnings: ['You can turn paused keywords back on in Amazon Ads at any time.'],
            payload: input
        };
    },
    async execute(payload, ctx) {
        const { accessToken, profileId, region, clientId } = await adsCreds(ctx);
        const { pauseKeywords: pause } = require('../../AmazonAds/Pause-ArchiveKeywords.js');
        const result = await pause({ adType: payload.adType, keywordIds: payload.keywordIds, accessToken, profileId, region, clientId });
        const failed = Object.values(result || {}).find((v) => v && v.success === false);
        if (failed) throw Object.assign(new Error(failed.error || 'Amazon did not pause the keyword'), { response: result });
        return result;
    }
};

const NEGATIVE_MATCH = ['negativeExact', 'negativePhrase'];

/** Negatives: the PPC page, QMate and the Tasks page. Amazon refuses an exact duplicate. */
const addNegativeKeywords = {
    actionType: 'ads.add_negative_keywords',
    feature: 'ads',
    idempotent: true,
    validate(input) {
        const level = input?.level === 'campaign' ? 'campaign' : 'adGroup';
        const raw = Array.isArray(input?.keywords) ? input.keywords : [];
        if (raw.length === 0) throw userError('Choose at least one search term.');
        if (raw.length > MAX_KEYWORDS) throw userError(`At most ${MAX_KEYWORDS} at a time.`);
        const keywords = raw.map((k) => {
            const keywordText = String(k?.keywordText || '').trim();
            if (!keywordText || !k?.campaignId) throw userError('Each negative keyword needs its text and campaign.');
            if (level === 'adGroup' && !k.adGroupId) throw userError('Each negative keyword needs its ad group.');
            const matchType = NEGATIVE_MATCH.includes(k.matchType) ? k.matchType : (NEGATIVE_MATCH.includes(input?.matchType) ? input.matchType : 'negativeExact');
            return {
                campaignId: String(k.campaignId),
                ...(level === 'adGroup' ? { adGroupId: String(k.adGroupId) } : {}),
                keywordText,
                matchType,
                state: 'enabled',
                // Display only, never sent.
                _campaignName: k.campaignName ? String(k.campaignName) : '',
                _adGroupName: k.adGroupName ? String(k.adGroupName) : ''
            };
        });
        return { level, keywords };
    },
    async preview(input) {
        const where = (k) => [k._campaignName && `campaign "${k._campaignName}"`, input.level === 'adGroup' && k._adGroupName && `ad group "${k._adGroupName}"`]
            .filter(Boolean).join(', ') || (input.level === 'adGroup' ? 'its ad group' : 'its campaign');
        return {
            title: `Add ${input.keywords.length} negative keyword${input.keywords.length === 1 ? '' : 's'}`,
            target: 'Amazon Ads',
            lines: input.keywords.map((k) => ({
                label: `"${k.keywordText}"`,
                before: 'Ads can show for it',
                after: `${k.matchType === 'negativePhrase' ? 'Negative phrase' : 'Negative exact'} in ${where(k)}`
            })),
            warnings: ['Your ads stop showing for these searches. You can remove a negative keyword in Amazon Ads.'],
            payload: { level: input.level, keywords: input.keywords.map(({ _campaignName, _adGroupName, ...k }) => k) }
        };
    },
    async execute(payload, ctx) {
        const { accessToken, profileId, region, clientId } = await adsCreds(ctx);
        const { addToNegative, getConfig } = require('../../AmazonAds/addToNegetive.js');
        const config = getConfig({ accessToken, profileId, region, clientId });
        const result = await addToNegative(config, payload.keywords, { level: payload.level });
        assertNoV3Errors(result, payload.keywords.length > 1 ? payload.keywords.length : 0);
        return result;
    }
};

/** Pause a keyword and add it as an ad-group negative (the PPC page's combined button). */
const pauseAndNegate = {
    actionType: 'ads.pause_and_negate',
    feature: 'ads',
    idempotent: true,
    validate(input) {
        const adType = adTypeOf(input);
        const raw = Array.isArray(input?.items) ? input.items : [];
        if (raw.length === 0) throw userError('Choose at least one keyword.');
        if (raw.length > MAX_KEYWORDS) throw userError(`At most ${MAX_KEYWORDS} keywords at a time.`);
        const items = raw.map((k) => {
            if (!k?.keywordId || !k.campaignId || !k.adGroupId || !String(k.keywordText || '').trim()) {
                throw userError('Each keyword needs its id, text, campaign and ad group.');
            }
            return {
                keywordId: String(k.keywordId), campaignId: String(k.campaignId), adGroupId: String(k.adGroupId),
                keywordText: String(k.keywordText).trim(),
                matchType: k.matchType === 'negativeExact' ? 'negativeExact' : 'negativePhrase',
                _campaignName: k.campaignName ? String(k.campaignName) : ''
            };
        });
        return { adType, items };
    },
    async preview(input) {
        return {
            title: `Pause and add ${input.items.length} keyword${input.items.length === 1 ? '' : 's'} as negative`,
            target: 'Amazon Ads',
            lines: input.items.map((k) => ({
                label: `"${k.keywordText}"${k._campaignName ? ` in "${k._campaignName}"` : ''}`,
                before: 'Enabled keyword',
                after: `Paused, and ${k.matchType === 'negativeExact' ? 'negative exact' : 'negative phrase'} in its ad group`
            })),
            warnings: ['Your ads stop showing for these searches in this ad group.'],
            payload: { adType: input.adType, items: input.items.map(({ _campaignName, ...k }) => k) }
        };
    },
    async execute(payload, ctx) {
        const paused = await pauseKeywords.execute({ adType: payload.adType, keywordIds: payload.items.map((k) => k.keywordId) }, ctx);
        try {
            const negatives = await addNegativeKeywords.execute({
                level: 'adGroup',
                keywords: payload.items.map((k) => ({ campaignId: k.campaignId, adGroupId: k.adGroupId, keywordText: k.keywordText, matchType: k.matchType, state: 'enabled' }))
            }, ctx);
            return { pause: paused, addToNegative: negatives };
        } catch (error) {
            throw Object.assign(new Error(`Paused, but adding as negative failed: ${error.message}`), { response: { pause: paused, addToNegative: error.response || null, pauseSucceeded: true } });
        }
    }
};

/** Bid cuts proposed on an ACoS task. Only bids still at the proposed starting value are sent. */
const lowerBids = {
    actionType: 'ads.lower_bids',
    feature: 'ads',
    idempotent: true,
    async execute(payload, ctx) {
        const { accessToken, profileId, region, clientId } = await adsCreds(ctx);
        const keywordBids = payload.bids.filter((b) => b.kind !== 'target');
        const targetBids = payload.bids.filter((b) => b.kind === 'target');
        const unchanged = (current, id, expected) => Math.abs((current.get(id) ?? NaN) - expected) < 0.005;
        // Keywords: the daily keyword snapshot (checked against live Amazon, 150/150 equal).
        const { loadKeywordSnapshot } = require('../../../utils/ppcSnapshotLoader.js');
        const snapshot = keywordBids.length ? await loadKeywordSnapshot(String(ctx.userId), ctx.country, ctx.region).catch(() => null) : null;
        const kwCurrent = new Map((snapshot?.keywordData || []).map((k) => [String(k.keywordId), Number(k.bid)]));
        const kwSend = keywordBids.filter((b) => unchanged(kwCurrent, b.keywordId, b.expectedCurrentBid));
        // Targets: their snapshot is weekly, so the current bid is read live (a read).
        const { listTargetBids, updateTargetBids } = require('../../AmazonAds/AdsTargets.js');
        const live = targetBids.length ? await listTargetBids(accessToken, profileId, region, targetBids.map((b) => b.targetId)) : new Map();
        const tgCurrent = new Map([...live].map(([id, t]) => [id, t.bid]));
        const tgSend = targetBids.filter((b) => unchanged(tgCurrent, b.targetId, b.expectedCurrentBid));
        if (kwSend.length + tgSend.length === 0) throw staleError('These bids have changed since the suggestion was made, so nothing was sent. Refresh to see a new suggestion.');

        const responses = {};
        if (kwSend.length) {
            const { updateKeywordBids } = require('../../AmazonAds/Pause-ArchiveKeywords.js');
            responses.keywords = await updateKeywordBids({ bids: kwSend.map(({ keywordId, bid }) => ({ keywordId, bid })), accessToken, profileId, region, clientId });
        }
        if (tgSend.length) {
            responses.targets = await updateTargetBids({ bids: tgSend.map(({ targetId, bid }) => ({ targetId, bid })), accessToken, profileId, region });
        }
        const errors = [...v3Errors(responses.keywords), ...v3Errors(responses.targets)];
        const sent = kwSend.length + tgSend.length;
        if (errors.length > 0) throw Object.assign(new Error(`Amazon rejected ${errors.length} of ${sent}: ${JSON.stringify(errors[0]).slice(0, 300)}`), { response: responses });
        return { ...responses, sent, skippedChanged: payload.bids.length - sent };
    }
};

/** Budget raise on a profitable campaign that runs out of budget; the live budget is re-read. */
const raiseBudget = {
    actionType: 'ads.raise_budget',
    feature: 'ads',
    idempotent: true,
    async execute(payload, ctx) {
        const { accessToken, profileId, region } = await adsCreds(ctx);
        const { listCampaignBudgets, updateCampaignBudget } = require('../../AmazonAds/AdsTargets.js');
        const [live] = await listCampaignBudgets(accessToken, profileId, region, [payload.campaignId]);
        if (!live) throw staleError('This campaign is no longer enabled, so its budget was not changed.');
        if (Math.abs(Number(live.budget) - payload.expectedCurrentBudget) >= 0.005) {
            throw staleError(`This campaign's budget is now $${money(live.budget)}, changed since the suggestion, so nothing was sent.`);
        }
        const result = await updateCampaignBudget({ campaignId: payload.campaignId, budget: payload.budget, accessToken, profileId, region });
        assertNoV3Errors(result);
        return result;
    }
};

/** Pause every enabled product ad of an ASIN that cannot sell (found live at approval). */
const pauseProductAds = {
    actionType: 'ads.pause_product_ads',
    feature: 'ads',
    idempotent: true,
    async execute(payload, ctx) {
        const { accessToken, profileId, region } = await adsCreds(ctx);
        const { listEnabledProductAdsForAsin, pauseProductAds: pause } = require('../../AmazonAds/ProductAds.js');
        const ads = await listEnabledProductAdsForAsin({ asin: payload.asin, accessToken, profileId, region });
        if (ads.length === 0) throw staleError('This product has no enabled Sponsored Products ads now, so nothing was paused.');
        const result = await pause({ adIds: ads.map((a) => a.adId), accessToken, profileId, region });
        assertNoV3Errors(result, ads.length);
        return { ...result, paused: ads.length, adIds: ads.map((a) => String(a.adId)) };
    }
};

module.exports = {
    handlers: [pauseKeywords, addNegativeKeywords, pauseAndNegate, lowerBids, raiseBudget, pauseProductAds],
    adsCreds
};
