/**
 * TaskIdentity — which stored task a detected issue IS.
 *
 * A task used to be identified by asin + errorCategory + errorType. That breaks whenever
 * the LABEL of a real problem changes between fetches while the problem stays the same:
 * the planner saw a new problem, resolved (or kept completed) the old row and inserted a
 * pending one, so the seller's "done" and its history were lost. The labels that drift:
 *
 *   account health    orderWithDefectsStatus  <->  orderWithDefectsStatus_unstable
 *   stock             replenishment_needed    <->  out_of_stock
 *   listing length    titleresult_char_limit  <->  titleresult_too_short (also bullets,
 *                     description), backend_keywords_char_limit <-> _underused
 *   profitability     negative_profit <-> low_margin <-> ad_spend_no_sales
 *   ads keyword       keywordId, or the keyword text when the id came back as 0
 *   ads search term   raw text (case / spacing)
 *   removal shortfall ASIN, or SKU:<sku> when the SKU drops out of the catalogue
 *
 * identityKeyOf() names the PROBLEM; errorType, text, amounts and priority are the
 * problem's current STATE, which the planner refreshes in place on the same row.
 * Every type not listed above keeps exactly the identity it always had.
 *
 * Pure: no DB. Used by the generators (stamped on every task), the reconcile planner
 * (matching) and scripts/migrateTaskIdentity.js (backfill), so all three agree.
 */
const crypto = require('crypto');

// Unit separator: cannot appear in an ASIN, a category or a type, unlike '|' or ':'.
const SEP = '\u001f';

const PROFITABILITY_TYPES = new Set(['negative_profit', 'low_margin', 'ad_spend_no_sales', 'profitability_issue']);
const LENGTH_SUFFIX = /_(char_limit|too_short)$/;
const BACKEND_LENGTH_TYPES = new Set(['backend_keywords_char_limit', 'backend_keywords_underused']);

/** "  Red  Shoes " and "red shoes" are the same keyword / search term. */
const normText = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const isStockType = (type) => type === 'out_of_stock' || type.startsWith('replenishment_needed');

/**
 * The family a type belongs to: the part of the identity that does not change with the
 * problem's state.
 */
function familyOf(category, type) {
    if (category === 'account' && type.endsWith('_unstable')) return type.slice(0, -'_unstable'.length);
    if (category === 'inventory' && isStockType(type)) return 'stock';
    if (category === 'ranking' && BACKEND_LENGTH_TYPES.has(type)) return 'backend_keywords_length';
    if (category === 'ranking' && !type.startsWith('backend_') && LENGTH_SUFFIX.test(type)) return type.replace(LENGTH_SUFFIX, '_length');
    if (category === 'profitability' && PROFITABILITY_TYPES.has(type)) return 'profitability';
    return type;
}

/** The thing the problem is about, where the stored `asin` slot is not a stable name for it. */
function entityOf(category, type, asin, renderData) {
    const rd = renderData || {};
    if (category === 'sponsoredAds' && type === 'wasted_spend_keyword') {
        // The same key the calculation aggregates keywords on (DashboardCalculation
        // calculateSponsoredAdsErrors), so it never depends on whether keywordId came back.
        return `KW:${rd.campaignId || ''}|${rd.adGroupId || ''}|${normText(rd.keyword || asin)}`;
    }
    if (category === 'sponsoredAds' && (type === 'search_term_zero_sales' || type === 'auto_campaign_migration_needed')) {
        return `ST:${normText(rd.searchTerm || asin)}`;
    }
    if (category === 'inventory' && type === 'removal_shortfall' && rd.sku) {
        return `SKU:${rd.sku}`;
    }
    return asin;
}

/**
 * @param {{ asin: string, errorCategory: string, errorType: string, renderData?: object }} task
 * @returns {string} the identity within one marketplace
 */
function identityKeyOf(task) {
    const category = String(task?.errorCategory || '');
    const type = String(task?.errorType || '');
    const asin = String(task?.asin || '');
    return [entityOf(category, type, asin, task?.renderData), category, familyOf(category, type)].join(SEP);
}

/**
 * How serious this state of the problem is, within its family. Moving UP on a task the
 * seller completed reopens it straight away (the problem got worse); moving down or
 * sideways never does. 0 for every family without an order.
 */
function severityRank(task) {
    const category = String(task?.errorCategory || '');
    const type = String(task?.errorType || '');
    if (category === 'account' && familyOf(category, type) !== type) return 1; // unstable
    if (category === 'account') return 2;
    if (category === 'inventory' && type === 'out_of_stock') return 2;
    if (category === 'inventory' && type.startsWith('replenishment_needed')) return 1;
    if (category === 'profitability') {
        return { low_margin: 1, ad_spend_no_sales: 2, negative_profit: 3 }[type] || 0;
    }
    return 0;
}

/**
 * One task per identity: the most severe state wins, then the larger amount, then the
 * first seen. Replaces "drop replenishment when out_of_stock exists" and makes the
 * search-term representative (which ad group's numbers) the same every run instead of
 * whichever row came first.
 * @param {Array} tasks  generated tasks; identityKey is stamped on each
 * @returns {Array} the survivors, in first-seen order
 */
function collapseByIdentity(tasks) {
    const best = new Map();
    const order = [];
    for (const task of tasks) {
        const key = task.identityKey || identityKeyOf(task);
        task.identityKey = key;
        const held = best.get(key);
        if (!held) {
            best.set(key, task);
            order.push(key);
            continue;
        }
        const rank = severityRank(task) - severityRank(held);
        if (rank > 0 || (rank === 0 && (Number(task.amount) || 0) > (Number(held.amount) || 0))) {
            best.set(key, task);
        }
    }
    return order.map((key) => best.get(key));
}

/**
 * The grouping key of an Amazon listing issue: its code plus the attributes it names,
 * which do not change when Amazon rewords the message; the message itself (case,
 * numbers and identifiers stripped) only when no code came back.
 */
function listingIssueGroupKey(issue) {
    const code = issue?.code != null ? String(issue.code).trim() : '';
    if (code) {
        const attrs = [...new Set((issue.attributeNames || []).map(String))].sort().join(',');
        return `code:${code}${attrs ? `:${attrs}` : ''}`;
    }
    const message = normText(issue?.message)
        .replace(/\bb0[0-9a-z]{8}\b/g, '#') // ASINs (ISBN-style ones are all digits, caught below)
        .replace(/\d+([.,]\d+)?/g, '#');
    return `msg:${message}`;
}

/** The `asin` slot of a grouped listing task: one per severity + group key. */
const listingGroupEntity = (severity, groupKey) =>
    `${severity}:${crypto.createHash('sha1').update(String(groupKey)).digest('hex').slice(0, 16)}`;

module.exports = {
    identityKeyOf,
    familyOf,
    severityRank,
    collapseByIdentity,
    listingIssueGroupKey,
    listingGroupEntity,
    normText,
    SEP,
};
