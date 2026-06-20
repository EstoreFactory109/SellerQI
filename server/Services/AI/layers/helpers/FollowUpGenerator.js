/**
 * Generates deterministic follow-up suggestions based on the intent,
 * entities, and data that was actually returned.
 * These follow-ups are guaranteed to be answerable by QMate.
 *
 * Each follow-up has:
 *   - `label`  : short display text shown on the chip
 *   - `prompt` : complete, unambiguous question sent when the chip is clicked
 *
 * Template variables ({timeRange}, {asin}) are resolved inline from the
 * `entities` payload before the follow-up is returned to the caller.
 */

const FOLLOW_UP_TEMPLATES = {
  sales_query: {
    default: [
      { label: 'Show sales trend over time', prompt: 'Show me a sales trend chart for {timeRange}' },
      { label: 'Which product sold the most?', prompt: 'What is my top selling product by units in {timeRange}?' },
      { label: 'Compare to previous period', prompt: 'Compare my sales in {timeRange} to the previous period' },
    ],
    with_asin: [
      { label: 'See this product\'s profit margin', prompt: 'What is the profit margin for {asin}?' },
      { label: 'Check PPC spend for this product', prompt: 'How much did I spend on PPC for {asin} in {timeRange}?' },
      { label: 'View listing issues for this product', prompt: 'What listing issues does {asin} have?' },
    ],
  },
  profit_query: {
    default: [
      { label: 'Which product is least profitable?', prompt: 'Which product has the lowest profit margin in {timeRange}?' },
      { label: 'Show profit trend', prompt: 'Show me a profit trend chart for {timeRange}' },
      { label: 'See my expenses breakdown', prompt: 'What are my top expenses in {timeRange}?' },
    ],
  },
  ppc_query: {
    default: [
      { label: 'Show wasted ad spend', prompt: 'How much money did I waste on ads in {timeRange}?' },
      { label: 'Which keywords are wasting money?', prompt: 'What are my worst performing PPC keywords?' },
      { label: 'See PPC trend', prompt: 'Show me my PPC spend vs sales trend for {timeRange}' },
    ],
  },
  issue_query: {
    default: [
      { label: 'How can I fix these issues?', prompt: 'How do I fix my top listing issues?' },
      { label: 'Which product has the most issues?', prompt: 'Which product has the most listing issues?' },
      { label: 'Show issues by category', prompt: 'Break down my listing issues by category' },
    ],
  },
  inventory_query: {
    default: [
      { label: 'What\'s running low?', prompt: 'Which products are running low on inventory?' },
      { label: 'Show inventory value', prompt: 'What is my total FBA inventory value?' },
      { label: 'See reimbursement opportunities', prompt: 'Are there any FBA reimbursement opportunities?' },
    ],
  },
  // Default for any intent not explicitly mapped
  _default: {
    default: [
      { label: 'Show my sales overview', prompt: 'What were my total sales in the last 30 days?' },
      { label: 'Check my PPC performance', prompt: 'How is my PPC performing?' },
      { label: 'View listing issues', prompt: 'What listing issues do I have?' },
    ],
  },
};

function generateFollowUps(intent, entities, dataReturned) {
  const templates = FOLLOW_UP_TEMPLATES[intent] || FOLLOW_UP_TEMPLATES._default;

  const hasAsin = entities?.asins?.length > 0;
  const templateSet = (hasAsin && templates.with_asin) ? templates.with_asin : templates.default;

  // Resolve template variables
  const timeRange = entities?.timeRange?.value || 'the last 30 days';
  const asin = entities?.asins?.[0] || '';

  return templateSet
    .slice(0, 3) // max 3 follow-ups
    .map((t) => ({
      label: t.label,
      prompt: t.prompt
        .replace('{timeRange}', timeRange)
        .replace('{asin}', asin),
    }));
}

/**
 * Finance-engine follow-up templates, keyed by FinanceEngine queryType.
 * Same { label, prompt } shape as FOLLOW_UP_TEMPLATES; {timeRange}/{asin} are
 * resolved by generateFinanceFollowUps.
 */
const FINANCE_FOLLOW_UP_TEMPLATES = {
  summary_metrics: [
    { label: 'Break down my expenses', prompt: 'Break down my expenses for {timeRange}' },
    { label: 'Which products are most profitable?', prompt: 'Which are my top 5 products by profit in {timeRange}?' },
    { label: 'Compare to previous period', prompt: 'Compare my financials to the previous period' },
  ],
  expense_breakdown: [
    { label: 'Which fees are highest?', prompt: 'Which Amazon fees cost me the most?' },
    { label: 'Are expenses increasing?', prompt: 'Show me my expense trend over time' },
    { label: 'How can I reduce expenses?', prompt: 'How can I reduce my Amazon fees and expenses?' },
  ],
  comparison: [
    { label: 'Why did things change?', prompt: 'Why did my profit change compared to last period?' },
    { label: 'Show the trend over time', prompt: 'Show me my sales and profit trend' },
    { label: 'Which products changed most?', prompt: 'Which products had the biggest change in profit?' },
  ],
  why_analysis: [
    { label: 'Show me the worst products', prompt: 'Which products are losing money?' },
    { label: 'How can I fix this?', prompt: 'How can I improve my profitability?' },
    { label: 'Show expense breakdown', prompt: 'Break down my expenses in detail' },
  ],
  single_asin: [
    { label: 'Compare to other products', prompt: 'Show me my top 5 products by profit' },
    { label: 'Show all product profitability', prompt: 'Show me profitability for all products' },
    { label: 'Check PPC for this product', prompt: 'What is my PPC performance for {asin}?' },
  ],
  time_series: [
    { label: 'Compare to previous period', prompt: 'Compare this period to the previous one' },
    { label: 'Why is the trend changing?', prompt: 'Why is my profit trending this way?' },
    { label: 'Show product breakdown', prompt: 'Which products are driving this trend?' },
  ],
  top_bottom_products: [
    { label: 'Show losing products', prompt: 'Which products are losing money?' },
    { label: 'Full profitability breakdown', prompt: 'Show me ASIN-wise profitability' },
    { label: 'How to improve worst products?', prompt: 'How can I improve profitability on my worst products?' },
  ],
  asin_profitability: [
    { label: 'Show losing products', prompt: 'Which products are losing money?' },
    { label: 'Top products by profit', prompt: 'Show me my top 5 products by profit' },
    { label: 'Break down my expenses', prompt: 'Break down my expenses for {timeRange}' },
  ],
  fee_specific: [
    { label: 'Full expense breakdown', prompt: 'Break down all my expenses for {timeRange}' },
    { label: 'Which fees are highest?', prompt: 'Which Amazon fees cost me the most?' },
    { label: 'How can I reduce this fee?', prompt: 'How can I reduce my Amazon fees?' },
  ],
  cogs_query: [
    { label: 'See profit with COGS', prompt: 'What is my profit after COGS?' },
    { label: 'Products missing COGS', prompt: 'Which products don\'t have COGS entered?' },
  ],
  overhead_query: [
    { label: 'Full expense breakdown', prompt: 'Break down all my expenses' },
    { label: 'Are overhead costs increasing?', prompt: 'Compare my overhead costs to last month' },
  ],
  asin_comparison: [
    { label: 'See all product profitability', prompt: 'Show me profitability for all products' },
    { label: 'Deep dive into the winner', prompt: 'Show me full profitability for {winnerAsin}' },
    { label: 'What fees are each paying?', prompt: 'Compare expenses for {asin1} vs {asin2}' },
  ],
};

/**
 * Generate finance-specific follow-ups for a FinanceEngine queryType.
 * Falls back to the summary_metrics set for unmapped types.
 *
 * @param {string} queryType - FinanceEngine queryType
 * @param {Object} entities - interpretation.entities (for {timeRange}/{asin})
 * @returns {Array<{label:string, prompt:string}>} up to 3 follow-ups
 */
function generateFinanceFollowUps(queryType, entities) {
  const templates = FINANCE_FOLLOW_UP_TEMPLATES[queryType] || FINANCE_FOLLOW_UP_TEMPLATES.summary_metrics;
  const timeRange = entities?.timeRange?.value || 'the last 30 days';
  const asins = entities?.asins || [];
  const asin = asins[0] || '';
  const asin1 = asins[0] || '';
  const asin2 = asins[1] || '';
  // The actual winner is only known in the response; default to the first ASIN.
  const winnerAsin = asins[0] || '';

  return templates.slice(0, 3).map((t) => ({
    label: t.label,
    prompt: t.prompt
      .replace('{timeRange}', timeRange)
      .replace('{asin}', asin)
      .replace('{asin1}', asin1)
      .replace('{asin2}', asin2)
      .replace('{winnerAsin}', winnerAsin),
  }));
}

/**
 * Ads-engine follow-up templates, keyed by AdsEngine queryType.
 * Same { label, prompt } shape; {timeRange}/{asin}/{keyword} are resolved by
 * generateAdsFollowUps.
 */
const ADS_FOLLOW_UP_TEMPLATES = {
  ads_summary: [
    { label: 'Show wasted ad spend', prompt: 'Show me keywords wasting money' },
    { label: 'Compare to previous period', prompt: 'Compare my PPC performance to the previous period' },
    { label: 'Break down by ad type', prompt: 'Compare my SP vs SB vs SD performance' },
  ],
  wasted_spend: [
    { label: 'Pause worst keywords', prompt: 'Pause my worst performing keywords' },
    { label: 'How much could I save?', prompt: 'How much money could I save by optimizing ads?' },
    { label: 'Show top performers', prompt: 'Show my top performing keywords' },
  ],
  campaign_performance: [
    { label: 'Compare to other campaigns', prompt: 'Which campaign has the best ROAS?' },
    { label: 'Check budget utilization', prompt: 'Am I running out of budget on any campaigns?' },
    { label: 'Show campaign ACOS ranking', prompt: 'Rank my campaigns by ACOS' },
  ],
  ads_comparison: [
    { label: 'Why did it change?', prompt: 'Why did my PPC performance change?' },
    { label: 'Show trend over time', prompt: 'Show me my ACOS trend over time' },
    { label: 'Which campaigns changed?', prompt: 'Which campaigns changed the most?' },
  ],
  ads_why_analysis: [
    { label: 'Show wasted keywords', prompt: 'Show me keywords wasting money' },
    { label: 'How to fix this', prompt: 'How can I improve my PPC performance?' },
    { label: 'Show campaign breakdown', prompt: 'Which campaigns need the most attention?' },
  ],
  campaign_type_breakdown: [
    { label: 'Which ad type is best?', prompt: 'Which ad type has the best ROAS?' },
    { label: 'Show wasted ad spend', prompt: 'Show me keywords wasting money' },
    { label: 'Compare to previous period', prompt: 'Compare my PPC performance to the previous period' },
  ],
  budget_analysis: [
    { label: 'Which campaigns are limited?', prompt: 'Which campaigns are budget-limited?' },
    { label: 'Should I increase budgets?', prompt: 'Should I increase my campaign budgets?' },
    { label: 'Show campaign performance', prompt: 'How are my campaigns performing?' },
  ],
  organic_vs_paid: [
    { label: 'Am I too dependent on PPC?', prompt: 'Am I too dependent on PPC?' },
    { label: 'Show my ad spend trend', prompt: 'Show me my ad spend trend over time' },
    { label: 'How can I grow organic sales?', prompt: 'How can I improve my organic sales?' },
  ],
  search_term_analysis: [
    { label: 'What should I add as keywords?', prompt: 'What search terms should I add as exact match keywords?' },
    { label: 'What should I negative?', prompt: 'What search terms should I add as negative keywords?' },
    { label: 'Show wasted ad spend', prompt: 'Show me keywords wasting money' },
  ],
  top_performers: [
    { label: 'Show wasted keywords', prompt: 'Show me keywords wasting money' },
    { label: 'Compare to previous period', prompt: 'Compare my PPC performance to the previous period' },
    { label: 'Break down by ad type', prompt: 'Compare my SP vs SB vs SD performance' },
  ],
  ads_time_series: [
    { label: 'Why did it change?', prompt: 'Why did my PPC performance change?' },
    { label: 'Compare to previous period', prompt: 'Compare my PPC performance to the previous period' },
    { label: 'Show wasted ad spend', prompt: 'Show me keywords wasting money' },
  ],
  asin_ads: [
    { label: 'Which keywords drive sales?', prompt: 'Which keywords are driving sales for {asin}?' },
    { label: 'Which keywords waste money?', prompt: 'Which keywords are wasting money on {asin}?' },
    { label: 'Should I keep advertising it?', prompt: 'Should I keep running ads for {asin}?' },
  ],
  keyword_deep_dive: [
    { label: 'Show top performing keywords', prompt: 'Show my top performing keywords' },
    { label: 'Show wasted keywords', prompt: 'Show me keywords wasting money' },
    { label: 'Break down by ad type', prompt: 'Compare my SP vs SB vs SD performance' },
  ],
};

/**
 * Generate ads-specific follow-ups for an AdsEngine queryType.
 * Falls back to the ads_summary set for unmapped types.
 *
 * @param {string} queryType - AdsEngine queryType
 * @param {Object} entities - interpretation.entities (for {timeRange}/{asin}/{keyword})
 * @returns {Array<{label:string, prompt:string}>} up to 3 follow-ups
 */
function generateAdsFollowUps(queryType, entities) {
  const templates = ADS_FOLLOW_UP_TEMPLATES[queryType] || ADS_FOLLOW_UP_TEMPLATES.ads_summary;
  const timeRange = entities?.timeRange?.value || 'the last 30 days';
  const asin = (entities?.asins && entities.asins[0]) || '';
  const keyword = entities?.keywordText || '';

  return templates.slice(0, 3).map((t) => ({
    label: t.label,
    prompt: t.prompt
      .replace('{timeRange}', timeRange)
      .replace('{asin}', asin)
      .replace('{keyword}', keyword),
  }));
}

/**
 * GeneralStrategyEngine follow-up templates, keyed by strategyType. Same
 * { label, prompt } shape as the finance/ads templates. Cross-domain prompts
 * deliberately route to the OTHER engines/strategy types (e.g. a why_declining
 * answer offers "show wasted ad spend" → AdsEngine) to chain the investigation.
 */
const STRATEGY_FOLLOW_UP_TEMPLATES = {
  why_declining: [
    { label: 'Show expense breakdown', prompt: 'Break down my expenses in detail' },
    { label: 'Show wasted ad spend', prompt: 'Show me keywords wasting money' },
    { label: 'Which products are losing money?', prompt: 'Which products are losing money?' },
  ],
  how_to_improve: [
    { label: 'Fix wasted ad spend', prompt: 'Show me wasted keywords I should pause' },
    { label: 'Show loss-making products', prompt: 'Which products have negative profit?' },
    { label: 'Optimize my PPC', prompt: 'How can I reduce my ACOS?' },
  ],
  what_mistakes: [
    { label: 'How to fix these issues', prompt: 'What should I focus on first?' },
    { label: 'Show the details', prompt: 'Give me a complete business summary' },
    { label: 'Fix ads waste', prompt: 'Pause my worst performing keywords' },
  ],
  what_to_focus: [
    { label: 'Start with #1 priority', prompt: 'Tell me more about the top priority' },
    { label: 'Show full summary', prompt: 'Give me a complete business summary' },
  ],
  complete_summary: [
    { label: 'How to improve?', prompt: 'How can I increase my profit?' },
    { label: 'What to fix first?', prompt: 'What should I focus on first?' },
    { label: 'Show wasted spend', prompt: 'Where am I wasting money?' },
  ],
  is_it_worth: [
    { label: 'Optimize my ads', prompt: 'How can I improve my PPC performance?' },
    { label: 'Show organic vs paid', prompt: 'What percentage of sales come from ads?' },
    { label: 'Reduce ad waste', prompt: 'Show me wasted keywords' },
  ],
  where_losing: [
    { label: 'Fix the biggest loss', prompt: 'What should I focus on first?' },
    { label: 'Show product profitability', prompt: 'Which products should I discontinue?' },
    { label: 'Fix ad waste', prompt: 'Pause keywords wasting money' },
  ],
  general_health: [
    { label: 'How to improve my grade?', prompt: 'How can I improve my business performance?' },
    { label: 'Show detailed breakdown', prompt: 'Give me a complete business summary' },
  ],
};

/**
 * Generate strategy-specific follow-ups for a GeneralStrategyEngine strategyType.
 * Falls back to the complete_summary set for unmapped types. (These templates
 * carry no {timeRange}/{asin} variables, so no interpolation is needed.)
 *
 * @param {string} strategyType
 * @returns {Array<{label:string, prompt:string}>} up to 3 follow-ups
 */
function generateStrategyFollowUps(strategyType) {
  const templates = STRATEGY_FOLLOW_UP_TEMPLATES[strategyType] || STRATEGY_FOLLOW_UP_TEMPLATES.complete_summary;
  return templates.slice(0, 3);
}

/**
 * SellerOps follow-up templates, keyed by SellerOps queryType. {asin} resolved
 * by generateSellerOpsFollowUps.
 */
const SELLER_OPS_FOLLOW_UP_TEMPLATES = {
  listing_issues_summary: [
    { label: 'Which products are worst?', prompt: 'Show me my most problematic listings' },
    { label: 'How do I fix a suppressed listing?', prompt: 'How do I fix a suppressed listing?' },
    { label: 'Urgent issues only', prompt: 'Are there any urgent listing issues?' },
  ],
  listing_issues_asin: [
    { label: 'How do I fix these?', prompt: 'How do I fix the missing image issue?' },
    { label: 'All my listing issues', prompt: 'What issues do my listings have?' },
    { label: "This product's profitability", prompt: 'Show me the profitability for {asin}' },
  ],
  listing_issue_fix: [
    { label: 'Show all my listing issues', prompt: 'What issues do my listings have?' },
    { label: 'Which products are worst?', prompt: 'Show me my most problematic listings' },
  ],
  inventory_summary: [
    { label: 'What should I restock?', prompt: 'What should I restock?' },
    { label: 'Running low on stock?', prompt: 'Which products are running low on stock?' },
    { label: 'Any overstock?', prompt: 'Which products are overstocked?' },
  ],
  inventory_asin: [
    { label: 'What should I restock?', prompt: 'What should I restock?' },
    { label: 'Full inventory summary', prompt: 'Show me my FBA inventory breakdown' },
  ],
  low_stock: [
    { label: 'What should I restock?', prompt: 'What should I restock?' },
    { label: 'Full inventory summary', prompt: 'Show me my FBA inventory breakdown' },
  ],
  overstock: [
    { label: 'What should I restock instead?', prompt: 'What should I restock?' },
    { label: 'Full inventory summary', prompt: 'Show me my FBA inventory breakdown' },
  ],
  restock_advice: [
    { label: "What's running low?", prompt: 'Which products are running low on stock?' },
    { label: 'Full inventory summary', prompt: 'Show me my FBA inventory breakdown' },
  ],
  account_health: [
    { label: 'How do I improve it?', prompt: 'How do I improve my account health?' },
    { label: 'What metrics are at risk?', prompt: 'What metrics are in the danger zone?' },
  ],
  account_health_action: [
    { label: "What's my overall health?", prompt: 'What is my account health?' },
    { label: 'How do I reduce my defect rate?', prompt: 'How do I reduce my defect rate?' },
  ],
  reimbursement_summary: [
    { label: 'Any unclaimed reimbursements?', prompt: 'How much am I owed in reimbursements?' },
    { label: 'Show opportunities', prompt: 'Show me FBA reimbursement opportunities' },
  ],
  reimbursement_opportunities: [
    { label: "What I've already received", prompt: 'How much have I been reimbursed this month?' },
    { label: 'Lost or damaged inventory', prompt: 'Which products have lost or damaged inventory?' },
  ],
  product_summary: [
    { label: 'Which products lose money?', prompt: 'Which products are losing money?' },
    { label: 'My listing issues', prompt: 'What issues do my listings have?' },
  ],
  product_details: [
    { label: 'Issues for this product', prompt: "What's wrong with {asin}'s listing?" },
    { label: 'Should I keep it?', prompt: 'Should I discontinue {asin}?' },
  ],
  bsr_analysis: [
    { label: 'My product catalog', prompt: 'How many products do I have?' },
    { label: 'My top sellers', prompt: 'Which products sell fastest?' },
  ],
};

/**
 * Advisory follow-up templates, keyed by Advisory queryType. {asin} resolved by
 * generateAdvisoryFollowUps.
 */
const ADVISORY_FOLLOW_UP_TEMPLATES = {
  pricing_advice: [
    { label: 'Is a coupon worth it?', prompt: 'Is it worth running a coupon on {asin}?' },
    { label: 'Should I keep this product?', prompt: 'Should I discontinue {asin}?' },
    { label: "This product's profit", prompt: 'Show me the profitability for {asin}' },
  ],
  promotional_advice: [
    { label: 'Best discount percentage?', prompt: "What's the best discount percentage for {asin}?" },
    { label: 'Should I change the price instead?', prompt: 'Should I lower the price on {asin}?' },
  ],
  operational_advice: [
    { label: 'Show my listing issues', prompt: 'What issues do my listings have?' },
    { label: 'How do I get more reviews?', prompt: 'How do I get more reviews?' },
    { label: 'How do I improve a listing?', prompt: 'How do I improve my listing?' },
  ],
  product_decision: [
    { label: "This product's pricing", prompt: 'Should I lower the price on {asin}?' },
    { label: 'Its listing issues', prompt: "What's wrong with {asin}'s listing?" },
    { label: 'Its ad performance', prompt: "What's the ACOS for {asin}?" },
  ],
  capabilities: [
    { label: 'Show my profit', prompt: 'What is my profit?' },
    { label: 'Check my ads', prompt: 'What is my ACOS?' },
    { label: 'Find money I can recover', prompt: 'How much am I owed in reimbursements?' },
  ],
};

/**
 * Redirect follow-ups for when a SellerOps domain has no data yet
 * ({ available:false }). Point the seller at things QMate CAN answer today
 * (profitability, PPC, listing issues) instead of dead-ending.
 */
const SELLER_OPS_UNAVAILABLE_FOLLOW_UPS = [
  { label: 'Check my profitability', prompt: 'What is my profit?' },
  { label: 'Check my PPC performance', prompt: 'What is my ACOS?' },
  { label: 'Review my listing issues', prompt: 'What issues do my listings have?' },
];

/**
 * Generate SellerOps follow-ups for a queryType. Falls back to inventory_summary.
 * When `unavailable` is true (the domain returned { available:false }), returns
 * the redirect set instead — steering the seller to answerable domains.
 * @param {string} queryType
 * @param {Object} [entities] - for {asin}
 * @param {boolean} [unavailable] - true when the result was { available:false }
 * @returns {Array<{label:string, prompt:string}>}
 */
function generateSellerOpsFollowUps(queryType, entities, unavailable) {
  if (unavailable) return SELLER_OPS_UNAVAILABLE_FOLLOW_UPS.map((t) => ({ ...t }));
  const templates = SELLER_OPS_FOLLOW_UP_TEMPLATES[queryType] || SELLER_OPS_FOLLOW_UP_TEMPLATES.inventory_summary;
  const asin = (entities && entities.asins && entities.asins[0]) || '';
  return templates.slice(0, 3).map((t) => ({ label: t.label, prompt: t.prompt.replace('{asin}', asin) }));
}

/**
 * Generate Advisory follow-ups for a queryType. Falls back to capabilities.
 * @param {string} queryType
 * @param {Object} [entities] - for {asin}
 * @returns {Array<{label:string, prompt:string}>}
 */
function generateAdvisoryFollowUps(queryType, entities) {
  const templates = ADVISORY_FOLLOW_UP_TEMPLATES[queryType] || ADVISORY_FOLLOW_UP_TEMPLATES.capabilities;
  const asin = (entities && entities.asins && entities.asins[0]) || '';
  return templates.slice(0, 3).map((t) => ({ label: t.label, prompt: t.prompt.replace('{asin}', asin) }));
}

module.exports = {
  generateFollowUps,
  generateFinanceFollowUps,
  FINANCE_FOLLOW_UP_TEMPLATES,
  generateAdsFollowUps,
  ADS_FOLLOW_UP_TEMPLATES,
  generateStrategyFollowUps,
  STRATEGY_FOLLOW_UP_TEMPLATES,
  generateSellerOpsFollowUps,
  SELLER_OPS_FOLLOW_UP_TEMPLATES,
  SELLER_OPS_UNAVAILABLE_FOLLOW_UPS,
  generateAdvisoryFollowUps,
  ADVISORY_FOLLOW_UP_TEMPLATES,
};
