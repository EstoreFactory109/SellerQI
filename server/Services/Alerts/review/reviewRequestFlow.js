// ─────────────────────────────────────────
// reviewRequestFlow.js
// Core flow — runs per seller
// ─────────────────────────────────────────

const logger = require('../../../utils/Logger.js');
const { getLWAAccessToken } = require('./authService.js');
const { fetchShippedOrders, filterEligibleOrders } = require('./ordersService.js');
const {
  hasAlreadySentSolicitation,
  checkSolicitationEligibility,
  sendSolicitation,
  logSolicitationResult,
  sleep,
} = require('./solicitationService.js');

/**
 * Run Amazon "Request a review" flow for a single seller.
 * @param {{ sellerId: string, clientId: string, clientSecret: string, refreshToken: string, marketplaceId: string }} seller
 * @returns {Promise<{ sent: number, skipped: number, failed: number }>}
 */
async function runReviewRequestFlow(seller) {
  const { sellerId, clientId, clientSecret, refreshToken, marketplaceId } = seller || {};

  if (!sellerId || !clientId || !clientSecret || !refreshToken || !marketplaceId) {
    logger.error('[ReviewRequestFlow] Missing required seller credentials or marketplaceId', {
      sellerId,
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasRefreshToken: !!refreshToken,
      marketplaceId,
    });
    throw new Error('Missing required seller credentials for review request flow');
  }

  logger.info(`[ReviewRequestFlow] ── Starting flow for seller: ${sellerId} ──`);

  const results = { sent: 0, skipped: 0, failed: 0 };

  // STEP 1: Get Amazon access token
  const accessToken = await getLWAAccessToken(clientId, clientSecret, refreshToken);
  logger.info('[ReviewRequestFlow] Access token obtained');

  // STEP 2: Fetch shipped orders from last 35 days
  const orders = await fetchShippedOrders(accessToken, marketplaceId);
  logger.info('[ReviewRequestFlow] Orders fetched', { count: orders.length });

  // STEP 3: Filter to 5–30 day delivery window
  const eligible = filterEligibleOrders(orders);
  logger.info('[ReviewRequestFlow] Orders in eligible window', { count: eligible.length });

  // STEP 4–9: Process each eligible order
  for (const order of eligible) {
    const orderId = order.AmazonOrderId;

    // STEP 4: Check MongoDB — already sent?
    const alreadySent = await hasAlreadySentSolicitation(sellerId, orderId);
    if (alreadySent) {
      logger.info('[ReviewRequestFlow] Skipping order — already processed', { orderId });
      results.skipped++;
      continue;
    }

    // STEP 5: Check Amazon — is it eligible?
    const isEligible = await checkSolicitationEligibility(accessToken, orderId, marketplaceId);
    if (!isEligible) {
      logger.info('[ReviewRequestFlow] Skipping order — Amazon says ineligible', { orderId });
      await logSolicitationResult(sellerId, orderId, null, 'amazon_ineligible');
      results.skipped++;
      continue;
    }

    // STEP 6: Send the review request
    const result = await sendSolicitation(accessToken, orderId, marketplaceId);

    // STEP 7: Log to MongoDB
    await logSolicitationResult(sellerId, orderId, result);

    if (result.ok) {
      logger.info('[ReviewRequestFlow] Review request sent', { orderId, status: result.status });
      results.sent++;
    } else {
      logger.warn('[ReviewRequestFlow] Review request failed', {
        orderId,
        status: result.status,
      });
      results.failed++;
    }

    // STEP 8: Respect Amazon rate limit (1 req/sec)
    await sleep(1100);
  }

  logger.info(
    `[ReviewRequestFlow] ── Done for ${sellerId} ── Sent: ${results.sent}, Skipped: ${results.skipped}, Failed: ${results.failed}`
  );

  return results;
}

module.exports = {
  runReviewRequestFlow,
};