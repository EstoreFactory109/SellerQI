/**
 * Which Buy Box issue, if any, a product's `buyBoxDetails` row describes.
 *
 * Rows come from the server's effective Buy Box doc (classifyBuyBoxLoss), so:
 *   - `buyBoxPercentage` can be null: never seen with the Buy Box, never confirmed
 *     without it. `null < 50` is true in JS, which used to show these as "Low",
 *     and `null.toFixed` threw.
 *   - `buyBoxLost: true` (percentage 0) is the confirmed loss the No Buy Box task
 *     is raised for.
 *   - `buyBoxPercentageCarriedForward: true` means today's reading was a one-day
 *     0% blip and the last non-zero value was carried forward; that number is not
 *     today's, so it is never reported as "Low".
 *
 * @param {Object|null|undefined} details
 * @returns {'noBuyBox'|'low'|null}
 */
export function classifyBuyBoxIssue(details) {
  if (!details) return null;
  const pct = details.buyBoxPercentage;
  if (details.buyBoxLost === true || pct === 0) return 'noBuyBox';
  if (typeof pct === 'number' && pct > 0 && pct < 50 && details.buyBoxPercentageCarriedForward !== true) {
    return 'low';
  }
  return null;
}
