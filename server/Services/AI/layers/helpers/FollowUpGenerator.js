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

module.exports = { generateFollowUps, generateFinanceFollowUps, FINANCE_FOLLOW_UP_TEMPLATES };
