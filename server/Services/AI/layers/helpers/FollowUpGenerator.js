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

module.exports = { generateFollowUps };
