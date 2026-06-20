/**
 * SellerOpsQueryDetector — SellerOps (listing issues / inventory / account
 * health / reimbursements / product-BSR) question detection + classification.
 *
 * ZERO imports from any engine. Pure regex on the prompt text. This lives apart
 * from SellerOpsEngine (which imports FinanceEngine/AdsEngine) so that
 * StrategyQueryDetector can defer to SellerOps detection without forming a
 * circular dependency (StrategyQueryDetector → SellerOpsEngine → FinanceEngine →
 * StrategyQueryDetector). SellerOpsEngine re-exports these for back-compat.
 */

/** Extract the prompt text, lower-cased — robust to object-shaped `raw`. */
function extractPromptText(interpretation) {
  const rawField = interpretation && interpretation.raw;
  const fromRaw =
    typeof rawField === 'string'
      ? rawField
      : (rawField && (rawField.normalizedPrompt || rawField.prompt)) || '';
  const text = fromRaw || (interpretation && interpretation.rewrittenQuestion) || (interpretation && interpretation.rawQuestion) || '';
  return String(text).toLowerCase();
}

/**
 * Classify a SellerOps query (PART 4 classifier). First match wins; returns
 * 'not_seller_ops' when nothing matches.
 *
 * @param {Object} interpretation
 * @returns {string} a SellerOps queryType, or 'not_seller_ops'
 */
function classifySellerOpsQueryType(interpretation) {
  const prompt = extractPromptText(interpretation);
  const hasAsin = (interpretation?.entities?.asins || []).length > 0;

  // Listing Issues — fix questions first (most specific), then ASIN vs summary.
  if (/how.*(fix|resolve|repair).*(listing|suppress|image|bullet|title|description)/i.test(prompt)) {
    return 'listing_issue_fix';
  }
  const listingIssueCue =
    /listing\s*(issue|error|problem|quality|suppress|incomplete|missing|fix|health|status)/i.test(prompt) ||
    (/\blisting/i.test(prompt) && /(issue|error|problem|wrong|missing|suppress|quality|incomplete|problematic|fix)/i.test(prompt)) ||
    /(issue|error|problem)s?\b[^.?!]*\blistings?\b/i.test(prompt) ||
    /missing\s*(image|photo|bullet|title|description|content|video|a\+|aplus)/i.test(prompt) ||
    /suppress|inactive listing/i.test(prompt);
  if (listingIssueCue) {
    return hasAsin ? 'listing_issues_asin' : 'listing_issues_summary';
  }

  // Inventory.
  if (/running\s*low|low\s*stock|running\s*out|zero\s*inventory/i.test(prompt)) return 'low_stock';
  if (/overstock|slow\s*moving|excess\s*inventory|stranded/i.test(prompt)) return 'overstock';
  if (/what.*(should|need).*(restock|send|ship)|should i (restock|send|ship)|how (much|many).*(restock|send in)/i.test(prompt)) return 'restock_advice';
  if (
    /inventory|stock|fba\s*(unit|inventory)|in\s*stock|out\s*of\s*stock|restock|days\s*of\s*supply|units?\s*(do i have|i have|left|remaining|on hand|in (fba|stock))|how many units.*(have|left|remaining|in (fba|stock))/i.test(prompt)
  ) {
    return hasAsin ? 'inventory_asin' : 'inventory_summary';
  }

  // Account Health.
  if (/account\s*health|odr|order\s*defect|\bdefect\b|late\s*shipment|cancel\s*rate|performance\s*target|suspension|policy\s*violation|good\s*standing/i.test(prompt)) {
    const wantsAction =
      /how.*(fix|improve|reduce|lower)|what.*(should i|can i|do i).*(do|fix|improve|reduce)|what should i do|how do i (fix|improve|reduce)|what happens if/i.test(prompt);
    return wantsAction ? 'account_health_action' : 'account_health';
  }

  // Reimbursements.
  if (/reimburs|owed|claim|recoverable|lost.*inventory|damaged.*inventory/i.test(prompt)) {
    const wantsOpportunities = /opportunit|unclaimed|potential|recoverable|\bowed?\b|how much.*(owe|recover)|am i owed/i.test(prompt);
    const wantsHistory = /reimbursed|history|this month|last month|received|so far|\btrend/i.test(prompt);
    if (wantsHistory && !wantsOpportunities) return 'reimbursement_summary';
    return wantsOpportunities ? 'reimbursement_opportunities' : 'reimbursement_summary';
  }

  // Product / BSR.
  //
  // A finance/ads intent word means an ASIN question belongs to Finance/Ads, NOT
  // a SellerOps product-info card. Without this guard the bare "show me"/"detail"
  // cues below claimed queries like "show me profitability for B0XXX": SellerOps
  // matched product_details, isFinanceQuery deferred to it, and the seller got a
  // "product not found" from getProductDetails instead of their ASIN P&L.
  // "sales rank" is excluded from the signal — that's a BSR question (handled
  // immediately below), not a Finance "sales" question.
  const financeOrAdsSignal =
    !/sales\s*rank/i.test(prompt) &&
    /profit|revenue|\bsales\b|\bexpenses?\b|\bfees?\b|margin|\bcogs\b|p&l|pnl|gross\s*profit|earnings?|\bincome\b|acos|roas|tacos|\bppc\b|ad\s*spend|advertis|\bcampaigns?\b|keywords?|\bcpc\b|\bctr\b|impressions?|\bclicks?\b/i.test(prompt);

  // BSR / rank — always SellerOps (Finance/Ads don't track rank), so checked
  // before the finance/ads guard.
  if (hasAsin && /bsr|best\s*seller\s*rank|sales\s*rank/i.test(prompt)) {
    return 'product_details';
  }
  if (/bsr|best\s*seller\s*rank|sales\s*rank|rank.*(trending|improv|up|down)|trending.*rank|trending\s*(up|down)/i.test(prompt)) {
    return 'bsr_analysis';
  }
  // Generic product-info card — only when this isn't a finance/ads question.
  if (hasAsin && !financeOrAdsSignal && /detail|category|what.*about|show me|tell me about/i.test(prompt)) {
    return 'product_details';
  }
  if (/product\s*(catalog|list|count|detail)|how\s*many\s*products|my (product )?catalog/i.test(prompt)) {
    return hasAsin ? 'product_details' : 'product_summary';
  }

  return 'not_seller_ops';
}

/**
 * True when the query maps to any SellerOps queryType.
 * @param {Object} interpretation
 * @returns {boolean}
 */
function isSellerOpsQuery(interpretation) {
  return classifySellerOpsQueryType(interpretation) !== 'not_seller_ops';
}

module.exports = {
  isSellerOpsQuery,
  classifySellerOpsQueryType,
  extractPromptText,
};
