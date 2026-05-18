/**
 * Lightweight domain lock: QMate answers Amazon seller analytics only.
 */

const AMAZON_KEYWORDS = [
    'sales',
    'orders',
    'asin',
    'inventory',
    'ads',
    'ppc',
    'ranking',
    'profit',
    'amazon',
    'campaign',
    'conversion',
    'reimbursement',
    'listing',
    'listings',
    'sku',
    'fee',
    'fees',
    'margin',
    'issue',
    'issues',
    'keyword',
    'keywords',
    'seller',
    'account',
    'buy box',
    'buybox',
    'refund',
    'storage',
    'stranded',
    'acos',
    'wasted',
    'health',
    'fulfillment',
    'fba',
    'catalog',
    'brand',
    'qmate',
    'sellerqi',
    'economics',
    'spend',
    'revenue',
    'cogs',
    'expense',
    'expenses',
    'gross',
    'net profit',
    'profitability',
    'marketplace',
    'sponsored',
    'negative keyword',
    'ad group',
    'campaigns',
    'impression',
    'click',
    'ctr',
    'title',
    'titles',
    'bullet',
    'bullets',
    'description',
    'image',
    'images',
    'photo',
    'photos',
    'review',
    'reviews',
    'rating',
    'ratings',
    'feedback',
    'price',
    'pricing',
    'promotion',
    'promotions',
    'deal',
    'deals',
    'shipping',
    'return',
    'returns',
    'suppressed',
    'suppression',
    'a+',
    'a plus',
    'report',
    'reports',
    'graph',
    'chart',
    'product',
    'products',
    'expence',
    'expences',
    'profitibility',
    'profitibilty',
    'revenu',
    'revenues',
    'recoverabl',
];

/** Seller-context time-range patterns imply an Amazon question even without a keyword hit. */
function looksLikeSellerTimeRange(query = '') {
    const q = String(query).toLowerCase();
    if (/\b(last|past|previous)\s+\d+\s+(day|days|week|weeks|month|months)\b/.test(q)) return true;
    if (/\b(this|last|previous)\s+(week|month|year|quarter)\b/.test(q)) return true;
    if (/\byesterday|today\b/.test(q)) return true;
    if (/\bfrom\s+\d/.test(q) && /\bto\s+\d/.test(q)) return true;
    return false;
}

/** Short replies to QMate clarification templates (not general chat). */
function looksLikeClarificationFollowUp(query = '') {
    const q = String(query).trim().toLowerCase();
    if (q.length <= 80 && /^(single|full|chart|action|option\s*[1-4]|[1-4]\s*[.):-])/i.test(q)) return true;
    if (/\b(value only|single number|full analysis|detailed analysis|just number)\b/i.test(q)) return true;
    return false;
}

/** User is asking what the assistant can do — in scope for QMate, not general web. */
function looksLikeInScopeMetaQuestion(query = '') {
    const q = String(query).toLowerCase();
    return (
        /\b(what can you|what do you do|how can you help|what are you|who are you)\b/.test(q) ||
        /\b(capabilit|features of (this|qmate|the (tool|chat)))\b/.test(q)
    );
}

/** Very short openers — routed to clarification / QMate, not general web. */
function looksLikeShortGreetingOrHelp(query = '') {
    const q = String(query).toLowerCase().trim();
    if (!q || q.length > 48) return false;
    return /^(help|help me|help!|hi|hello|hey|thanks|thank you)\b/i.test(q);
}

/** Vague in-app prompts — handled by clarification / suggestion guardrails, not hard-blocked. */
function looksLikeVagueMetaPrompt(query = '') {
    const q = String(query).toLowerCase();
    return /\b(tell me something|what can you do)\b/.test(q);
}

function isAmazonQuery(query = '') {
    const q = String(query).toLowerCase();
    if (looksLikeClarificationFollowUp(query)) return true;
    if (looksLikeInScopeMetaQuestion(query)) return true;
    if (looksLikeShortGreetingOrHelp(query)) return true;
    if (looksLikeVagueMetaPrompt(query)) return true;
    if (looksLikeSellerTimeRange(query) && /\bmy\b|\bour\b/.test(q)) return true;
    return AMAZON_KEYWORDS.some((k) => q.includes(k));
}

function enforceDomain(query = '') {
    if (!String(query).trim()) {
        return {
            blocked: true,
            message:
                'I can help with your Amazon seller account (sales, ads, inventory, profitability). What would you like to check?',
        };
    }
    if (!isAmazonQuery(query)) {
        return {
            blocked: true,
            message:
                'I can help with your Amazon seller account (sales, ads, inventory, profitability). What would you like to check?',
        };
    }
    return { blocked: false };
}

module.exports = {
    isAmazonQuery,
    enforceDomain,
    looksLikeClarificationFollowUp,
    looksLikeInScopeMetaQuestion,
    looksLikeShortGreetingOrHelp,
    looksLikeVagueMetaPrompt,
    looksLikeSellerTimeRange,
};
