/**
 * Sponsored Products campaigns: pause / enable / archive campaigns and ad groups,
 * create campaigns and ad groups, add keywords. tasks-logics.xlsx "Post Fn"
 * (Advertising). New kinds of change, so behind AMAZON_ACTIONS_ADS_ENABLED
 * (+ AMAZON_ACTIONS_ADS_USER_IDS) until switched on.
 *
 * Previews read Amazon live (the daily snapshots keep only enabled campaigns).
 * A new campaign starts paused unless the seller ticks "start spending now".
 */
const { assertNoV3Errors, v3Errors, reasonOf } = require('../adsErrors.js');
const { userError, staleError } = require('../errors.js');
const { adsCreds } = require('./ads.js');

const FLAG = 'AMAZON_ACTIONS_ADS';
const STATES = ['ENABLED', 'PAUSED', 'ARCHIVED'];
const MATCH = ['EXACT', 'PHRASE', 'BROAD'];
const MAX_ITEMS = 100;
const MAX_KEYWORDS = 1000;
// Amazon refuses bids and budgets under its own minimum anyway; these catch the
// common marketplaces early with a readable message. Others rely on Amazon's answer.
const MIN_BID = { US: 0.02, CA: 0.02, UK: 0.02, DE: 0.02, FR: 0.02, IT: 0.02, ES: 0.02, NL: 0.02, JP: 2, IN: 1 };
const MIN_BUDGET = { US: 1, CA: 1, UK: 1, DE: 1, FR: 1, IT: 1, ES: 1, NL: 1, JP: 100, IN: 50 };
const BIDDING = ['LEGACY_FOR_SALES', 'AUTO_FOR_SALES', 'MANUAL'];
const BIDDING_LABEL = { LEGACY_FOR_SALES: 'Dynamic bids - down only', AUTO_FOR_SALES: 'Dynamic bids - up and down', MANUAL: 'Fixed bids' };

const amount = (v) => Math.round(Number(v) * 100) / 100;
const money = (v) => Number(v).toFixed(2);
const label = (s) => ({ ENABLED: 'Enabled', PAUSED: 'Paused', ARCHIVED: 'Archived' }[String(s).toUpperCase()] || String(s || ''));
const lc = (s) => String(s || '').trim().toLowerCase();

function bidOf(value, country, what) {
    const bid = amount(value);
    const min = MIN_BID[country] ?? 0.01;
    if (!(bid >= min)) throw userError(`${what} must be at least ${money(min)}.`);
    if (bid > 1000) throw userError(`${what} looks too high (over 1,000).`);
    return bid;
}

function budgetOf(value, country) {
    const budget = amount(value);
    const min = MIN_BUDGET[country] ?? 1;
    if (!(budget >= min)) throw userError(`The daily budget must be at least ${money(min)}.`);
    return budget;
}

function cleanKeywords(raw, country, defaultBid) {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > MAX_KEYWORDS) throw userError(`At most ${MAX_KEYWORDS} keywords at a time.`);
    const seen = new Set();
    const out = [];
    for (const k of list) {
        const keywordText = String(k?.keywordText || '').trim().replace(/\s+/g, ' ');
        if (!keywordText) continue;
        if (keywordText.length > 80 || keywordText.split(' ').length > 10) throw userError(`"${keywordText.slice(0, 40)}..." is too long for a keyword (10 words, 80 characters).`);
        const matchType = String(k?.matchType || 'EXACT').toUpperCase();
        if (!MATCH.includes(matchType)) throw userError('Match type must be exact, phrase or broad.');
        const key = `${lc(keywordText)}|${matchType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ keywordText, matchType, bid: k?.bid !== undefined && k?.bid !== null && k?.bid !== '' ? bidOf(k.bid, country, `The bid for "${keywordText}"`) : defaultBid });
    }
    return out;
}

/** Median daily budget of the seller's enabled campaigns (read live), for a sanity warning. */
async function medianBudget(creds) {
    try {
        const live = await require('../../AmazonAds/SpWrites.js').listCampaigns(creds, { states: ['ENABLED'] });
        const budgets = live.map((c) => Number(c.budget?.budget)).filter((n) => n > 0).sort((a, b) => a - b);
        return budgets.length ? budgets[Math.floor(budgets.length / 2)] : null;
    } catch (_) {
        return null;
    }
}

/** The product in this marketplace (the ad advertises the seller's SKU). */
async function productFor(ctx, sku) {
    const Seller = require('../../../models/user-auth/sellerCentralModel.js');
    const seller = await Seller.findOne({ User: ctx.userId }).select('sellerAccount.country sellerAccount.region sellerAccount.products.asin sellerAccount.products.sku sellerAccount.products.status sellerAccount.products.itemName').lean();
    const account = (seller?.sellerAccount || []).find((a) => a.country === ctx.country && a.region === ctx.region);
    return (account?.products || []).find((p) => p.sku === sku) || null;
}

/** Throws with what was created so far, so the seller can finish or undo it. */
function stepFailed(step, result, createdIds) {
    const NAMES = { campaignId: 'campaign', adGroupId: 'ad group', productAdId: 'product ad', keywordIds: 'keywords' };
    const done = Object.keys(NAMES).filter((k) => createdIds[k] && (!Array.isArray(createdIds[k]) || createdIds[k].length)).map((k) => NAMES[k]);
    const list = done.length > 1 ? `${done.slice(0, -1).join(', ')} and ${done[done.length - 1]}` : done[0];
    const reason = reasonOf(v3Errors(result)[0] || result);
    return Object.assign(
        new Error(`${done.length ? `Created the ${list}, but ` : ''}${step} failed: ${reason}`),
        { response: result, amazon: { createdIds } }
    );
}

const firstId = (result, key, idField) => {
    const ok = (result?.[key]?.success || [])[0];
    return ok ? String(ok[idField] || ok[key.replace(/s$/, '')]?.[idField] || '') : '';
};

// ---------------------------------------------------------------- state changes

function stateChange({ actionType, entity, idField, listFn, updateFn, nameOf }) {
    return {
        actionType,
        feature: 'ads',
        flag: FLAG,
        idempotent: true,
        validate(input) {
            const ids = [...new Set((Array.isArray(input?.ids) ? input.ids : []).map(String).filter(Boolean))];
            if (ids.length === 0) throw userError(`Choose at least one ${entity}.`);
            if (ids.length > MAX_ITEMS) throw userError(`At most ${MAX_ITEMS} at a time.`);
            const state = String(input?.state || '').toUpperCase();
            if (!STATES.includes(state)) throw userError('Choose pause, enable or archive.');
            if (state === 'ARCHIVED' && input?.confirmArchive !== true) throw userError('Archiving cannot be undone: confirm it first.');
            return { ids, state };
        },
        async preview(input, ctx) {
            const creds = await adsCreds(ctx);
            const SpWrites = require('../../AmazonAds/SpWrites.js');
            const live = await SpWrites[listFn](creds, { [`${idField}s`]: input.ids });
            const byId = new Map(live.map((x) => [String(x[idField]), x]));
            const missing = input.ids.filter((id) => !byId.has(id));
            if (missing.length) throw userError(`Amazon has no ${entity} with id ${missing[0]} in this account.`);
            const archived = input.ids.filter((id) => byId.get(id).state === 'ARCHIVED');
            if (archived.length && input.state !== 'ARCHIVED') throw userError(`An archived ${entity} cannot be changed.`);
            const toChange = input.ids.filter((id) => byId.get(id).state !== input.state);
            if (toChange.length === 0) throw userError(`Already ${label(input.state).toLowerCase()}.`);
            const warnings = [];
            if (input.state === 'ENABLED' && entity === 'campaign') {
                const total = toChange.reduce((s, id) => s + (Number(byId.get(id).budget?.budget) || 0), 0);
                if (total > 0) warnings.push(`These campaigns can then spend up to ${money(total)} a day in total.`);
            }
            if (input.state === 'ARCHIVED') warnings.push(`Archiving cannot be undone: an archived ${entity} can never be turned back on.`);
            if (input.state === 'PAUSED') warnings.push(`You can turn ${entity === 'campaign' ? 'campaigns' : 'ad groups'} back on at any time.`);
            return {
                title: `${input.state === 'ARCHIVED' ? 'Archive' : input.state === 'PAUSED' ? 'Pause' : 'Enable'} ${toChange.length} ${entity}${toChange.length === 1 ? '' : 's'}`,
                target: 'Amazon Ads',
                lines: toChange.map((id) => ({ label: nameOf(byId.get(id)) || id, before: label(byId.get(id).state), after: label(input.state) })),
                warnings,
                payload: { items: toChange.map((id) => ({ [idField]: id, state: input.state })) },
                expected: { states: Object.fromEntries(toChange.map((id) => [id, byId.get(id).state])) }
            };
        },
        async staleCheck(doc, ctx) {
            const creds = await adsCreds(ctx);
            const SpWrites = require('../../AmazonAds/SpWrites.js');
            const ids = doc.payload.items.map((x) => x[idField]);
            const live = new Map((await SpWrites[listFn](creds, { [`${idField}s`]: ids })).map((x) => [String(x[idField]), x.state]));
            const changed = ids.filter((id) => live.get(id) !== doc.expected?.states?.[id]);
            if (changed.length) throw staleError(`${changed.length} ${entity}${changed.length === 1 ? ' was' : 's were'} changed in Amazon Ads since this was prepared, so nothing was sent. Review it again.`);
        },
        async execute(payload, ctx) {
            const creds = await adsCreds(ctx);
            const result = await require('../../AmazonAds/SpWrites.js')[updateFn](creds, payload.items);
            assertNoV3Errors(result, payload.items.length > 1 ? payload.items.length : 0);
            return result;
        }
    };
}

const setCampaignState = stateChange({
    actionType: 'ads.set_campaign_state', entity: 'campaign', idField: 'campaignId',
    listFn: 'listCampaigns', updateFn: 'updateCampaignStates', nameOf: (c) => c?.name
});
const setAdGroupState = stateChange({
    actionType: 'ads.set_ad_group_state', entity: 'ad group', idField: 'adGroupId',
    listFn: 'listAdGroups', updateFn: 'updateAdGroupStates', nameOf: (g) => g?.name
});

// ---------------------------------------------------------------- keywords

const addKeywords = {
    actionType: 'ads.add_keywords',
    feature: 'ads',
    flag: FLAG,
    idempotent: true, // Amazon refuses an exact duplicate in the same ad group
    validate(input, ctx) {
        if (!input?.campaignId || !input?.adGroupId) throw userError('Choose the campaign and ad group.');
        const defaultBid = input?.defaultBid !== undefined && input?.defaultBid !== '' ? bidOf(input.defaultBid, ctx.country, 'The bid') : null;
        const keywords = cleanKeywords(input.keywords, ctx.country, defaultBid);
        if (keywords.length === 0) throw userError('Enter at least one keyword.');
        if (keywords.some((k) => k.bid === null)) throw userError('Give every keyword a bid, or a default bid.');
        return { campaignId: String(input.campaignId), adGroupId: String(input.adGroupId), keywords };
    },
    async preview(input, ctx) {
        const creds = await adsCreds(ctx);
        const SpWrites = require('../../AmazonAds/SpWrites.js');
        const [group] = await SpWrites.listAdGroups(creds, { adGroupIds: [input.adGroupId] });
        if (!group || String(group.campaignId) !== input.campaignId) throw userError('This ad group is not in that campaign.');
        if (group.state === 'ARCHIVED') throw userError('Keywords cannot be added to an archived ad group.');
        const existing = new Set((await SpWrites.listKeywords(creds, { adGroupIds: [input.adGroupId] })).map((k) => `${lc(k.keywordText)}|${String(k.matchType).toUpperCase()}`));
        const fresh = input.keywords.filter((k) => !existing.has(`${lc(k.keywordText)}|${k.matchType}`));
        const skipped = input.keywords.length - fresh.length;
        if (fresh.length === 0) throw userError('All of these keywords are already in this ad group.');
        return {
            title: `Add ${fresh.length} keyword${fresh.length === 1 ? '' : 's'}`,
            target: `Amazon Ads - ad group "${group.name}"`,
            lines: fresh.map((k) => ({ label: `"${k.keywordText}" (${k.matchType.toLowerCase()})`, before: 'Not in this ad group', after: `Added, bid ${money(k.bid)}` })),
            warnings: [
                ...(skipped ? [`${skipped} keyword${skipped === 1 ? ' is' : 's are'} already in this ad group and will be left as they are.`] : []),
                ...(group.state !== 'ENABLED' ? [`This ad group is ${label(group.state).toLowerCase()}, so the keywords will not run until it is enabled.`] : [])
            ],
            payload: { keywords: fresh.map((k) => ({ campaignId: input.campaignId, adGroupId: input.adGroupId, keywordText: k.keywordText, matchType: k.matchType, bid: k.bid, state: 'ENABLED' })) }
        };
    },
    async execute(payload, ctx) {
        const creds = await adsCreds(ctx);
        const result = await require('../../AmazonAds/SpWrites.js').createKeywords(creds, payload.keywords);
        assertNoV3Errors(result, payload.keywords.length > 1 ? payload.keywords.length : 0);
        return result;
    }
};

// ---------------------------------------------------------------- create

function cleanStart(value) {
    if (!value) return null;
    const s = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw userError('The start date must be a date.');
    const today = new Date().toISOString().slice(0, 10);
    if (s < today) throw userError('The start date cannot be in the past.');
    return s;
}

/** Ad group -> product ad -> keywords under an existing campaign; returns created ids. */
async function buildAdGroup(creds, { campaignId, adGroup, sku, keywords }, createdIds) {
    const SpWrites = require('../../AmazonAds/SpWrites.js');
    const groupResult = await SpWrites.createAdGroups(creds, [{ campaignId, name: adGroup.name, defaultBid: adGroup.defaultBid, state: 'ENABLED' }]);
    const adGroupId = firstId(groupResult, 'adGroups', 'adGroupId');
    if (!adGroupId || v3Errors(groupResult).length) throw stepFailed('creating the ad group', groupResult, createdIds);
    createdIds.adGroupId = adGroupId;

    const adResult = await SpWrites.createProductAds(creds, [{ campaignId, adGroupId, sku, state: 'ENABLED' }]);
    const adId = firstId(adResult, 'productAds', 'adId');
    if (!adId || v3Errors(adResult).length) throw stepFailed('adding the product', adResult, createdIds);
    createdIds.productAdId = adId;

    if (keywords.length) {
        const kwResult = await SpWrites.createKeywords(creds, keywords.map((k) => ({ campaignId, adGroupId, keywordText: k.keywordText, matchType: k.matchType, bid: k.bid, state: 'ENABLED' })));
        createdIds.keywordIds = (kwResult?.keywords?.success || []).map((s) => String(s.keywordId || s.keyword?.keywordId || '')).filter(Boolean);
        if (v3Errors(kwResult).length) throw stepFailed(`adding ${v3Errors(kwResult).length} of ${keywords.length} keywords`, kwResult, createdIds);
    }
    return createdIds;
}

const createCampaign = {
    actionType: 'ads.create_campaign',
    feature: 'ads',
    flag: FLAG,
    idempotent: false, // a resend would create a second campaign
    validate(input, ctx) {
        const name = String(input?.name || '').trim();
        if (!name || name.length > 128) throw userError('Give the campaign a name (up to 128 characters).');
        const targetingType = String(input?.targetingType || '').toUpperCase();
        if (!['MANUAL', 'AUTO'].includes(targetingType)) throw userError('Choose manual or automatic targeting.');
        const sku = String(input?.sku || '').trim();
        if (!sku) throw userError('Choose the product to advertise.');
        const strategy = BIDDING.includes(input?.biddingStrategy) ? input.biddingStrategy : 'LEGACY_FOR_SALES';
        const defaultBid = bidOf(input?.defaultBid, ctx.country, 'The default bid');
        const keywords = targetingType === 'MANUAL' ? cleanKeywords(input?.keywords, ctx.country, defaultBid) : [];
        if (targetingType === 'MANUAL' && keywords.length === 0) throw userError('A manual campaign needs at least one keyword.');
        return {
            name, targetingType, sku,
            dailyBudget: budgetOf(input?.dailyBudget, ctx.country),
            startDate: cleanStart(input?.startDate),
            biddingStrategy: strategy,
            adGroupName: String(input?.adGroupName || '').trim().slice(0, 128) || `${name} - ad group`,
            defaultBid,
            keywords,
            startEnabled: input?.startEnabled === true
        };
    },
    async preview(input, ctx) {
        const creds = await adsCreds(ctx);
        const SpWrites = require('../../AmazonAds/SpWrites.js');
        const [product, sameName, median] = await Promise.all([
            productFor(ctx, input.sku),
            SpWrites.listCampaigns(creds, { names: [input.name] }),
            medianBudget(creds)
        ]);
        if (!product) throw userError(`SKU ${input.sku} is not in this marketplace's catalogue.`);
        if (sameName.length) throw userError(`A campaign called "${input.name}" already exists. Choose another name.`);
        const warnings = [];
        if (median && input.dailyBudget > median * 3) warnings.push(`This budget is more than 3 times your usual campaign budget (${money(median)} a day).`);
        warnings.push(input.startEnabled
            ? `It starts spending ${input.startDate ? `on ${input.startDate}` : 'straight away'}, up to ${money(input.dailyBudget)} a day.`
            : 'It is created paused: nothing is spent until you enable it.');
        if (product.status && product.status !== 'Active') warnings.push(`This product's listing is ${String(product.status).toLowerCase()}, so its ads may not show.`);
        const kwLine = input.keywords.slice(0, 10).map((k) => `"${k.keywordText}" (${k.matchType.toLowerCase()}, ${money(k.bid)})`).join(', ');
        return {
            title: `Create the campaign "${input.name}"`,
            target: 'Amazon Ads - Sponsored Products',
            lines: [
                { label: 'Campaign', before: '', after: `${input.name}: ${input.targetingType === 'AUTO' ? 'automatic' : 'manual'} targeting, ${money(input.dailyBudget)} a day, ${BIDDING_LABEL[input.biddingStrategy]}, ${input.startEnabled ? 'enabled' : 'paused'}` },
                { label: 'Ad group', before: '', after: `${input.adGroupName}, default bid ${money(input.defaultBid)}` },
                { label: 'Product', before: '', after: `${product.itemName ? `${String(product.itemName).slice(0, 60)} ` : ''}(SKU ${input.sku}${product.asin ? `, ${product.asin}` : ''})` },
                ...(input.keywords.length ? [{ label: `Keywords (${input.keywords.length})`, before: '', after: `${kwLine}${input.keywords.length > 10 ? ` and ${input.keywords.length - 10} more` : ''}` }] : [])
            ],
            warnings,
            payload: input
        };
    },
    async staleCheck(doc, ctx) {
        const creds = await adsCreds(ctx);
        const same = await require('../../AmazonAds/SpWrites.js').listCampaigns(creds, { names: [doc.payload.name] });
        if (same.length) throw staleError(`A campaign called "${doc.payload.name}" now exists, so nothing was sent.`);
    },
    async execute(p, ctx) {
        const creds = await adsCreds(ctx);
        const SpWrites = require('../../AmazonAds/SpWrites.js');
        const createdIds = {};
        const campaignResult = await SpWrites.createCampaigns(creds, [{
            name: p.name,
            targetingType: p.targetingType,
            state: p.startEnabled ? 'ENABLED' : 'PAUSED',
            dynamicBidding: { strategy: p.biddingStrategy },
            budget: { budgetType: 'DAILY', budget: p.dailyBudget },
            ...(p.startDate ? { startDate: p.startDate } : {})
        }]);
        const campaignId = firstId(campaignResult, 'campaigns', 'campaignId');
        if (!campaignId || v3Errors(campaignResult).length) throw stepFailed('creating the campaign', campaignResult, createdIds);
        createdIds.campaignId = campaignId;
        await buildAdGroup(creds, { campaignId, adGroup: { name: p.adGroupName, defaultBid: p.defaultBid }, sku: p.sku, keywords: p.keywords }, createdIds);
        return { createdIds, amazon: { createdIds } };
    }
};

const createAdGroup = {
    actionType: 'ads.create_ad_group',
    feature: 'ads',
    flag: FLAG,
    idempotent: false,
    validate(input, ctx) {
        if (!input?.campaignId) throw userError('Choose the campaign.');
        const name = String(input?.name || '').trim();
        if (!name || name.length > 128) throw userError('Give the ad group a name (up to 128 characters).');
        const sku = String(input?.sku || '').trim();
        if (!sku) throw userError('Choose the product to advertise: an ad group without a product never shows.');
        const defaultBid = bidOf(input?.defaultBid, ctx.country, 'The default bid');
        return { campaignId: String(input.campaignId), name, sku, defaultBid, keywords: cleanKeywords(input?.keywords, ctx.country, defaultBid) };
    },
    async preview(input, ctx) {
        const creds = await adsCreds(ctx);
        const SpWrites = require('../../AmazonAds/SpWrites.js');
        const [[campaign], product, groups] = await Promise.all([
            SpWrites.listCampaigns(creds, { campaignIds: [input.campaignId] }),
            productFor(ctx, input.sku),
            SpWrites.listAdGroups(creds, { campaignIds: [input.campaignId] })
        ]);
        if (!campaign) throw userError('Amazon has no such campaign in this account.');
        if (campaign.state === 'ARCHIVED') throw userError('Ad groups cannot be added to an archived campaign.');
        if (!product) throw userError(`SKU ${input.sku} is not in this marketplace's catalogue.`);
        if (groups.some((g) => lc(g.name) === lc(input.name))) throw userError(`This campaign already has an ad group called "${input.name}".`);
        if (campaign.targetingType === 'AUTO' && input.keywords.length) throw userError('Keywords cannot be added to an automatic campaign: Amazon chooses the targets.');
        return {
            title: `Add the ad group "${input.name}"`,
            target: `Amazon Ads - campaign "${campaign.name}"`,
            lines: [
                { label: 'Ad group', before: '', after: `${input.name}, default bid ${money(input.defaultBid)}` },
                { label: 'Product', before: '', after: `SKU ${input.sku}${product.asin ? ` (${product.asin})` : ''}` },
                ...(input.keywords.length ? [{ label: `Keywords (${input.keywords.length})`, before: '', after: input.keywords.slice(0, 10).map((k) => `"${k.keywordText}" (${k.matchType.toLowerCase()})`).join(', ') }] : [])
            ],
            warnings: campaign.state !== 'ENABLED' ? [`The campaign is ${label(campaign.state).toLowerCase()}, so nothing runs until it is enabled.`] : [],
            payload: input
        };
    },
    async staleCheck(doc, ctx) {
        const creds = await adsCreds(ctx);
        const groups = await require('../../AmazonAds/SpWrites.js').listAdGroups(creds, { campaignIds: [doc.payload.campaignId] });
        if (groups.some((g) => lc(g.name) === lc(doc.payload.name))) throw staleError(`The campaign now has an ad group called "${doc.payload.name}", so nothing was sent.`);
    },
    async execute(p, ctx) {
        const creds = await adsCreds(ctx);
        const createdIds = {};
        await buildAdGroup(creds, { campaignId: p.campaignId, adGroup: { name: p.name, defaultBid: p.defaultBid }, sku: p.sku, keywords: p.keywords }, createdIds);
        return { createdIds, amazon: { createdIds } };
    }
};

module.exports = { handlers: [setCampaignState, setAdGroupState, addKeywords, createCampaign, createAdGroup], FLAG, cleanKeywords };
