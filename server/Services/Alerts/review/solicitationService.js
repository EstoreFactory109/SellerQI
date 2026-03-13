// ─────────────────────────────────────────
// solicitationService.js
// ─────────────────────────────────────────

const logger = require('../../../utils/Logger.js');
const { SolicitationLog } = require('../../../models/alerts/SolicitationLog.js');

const SP_API_BASE = 'https://sellingpartnerapi-na.amazon.com';

// Check MongoDB — has this order already been processed?
async function hasAlreadySentSolicitation(sellerId, orderId) {
  if (!sellerId || !orderId) return false;
  const existing = await SolicitationLog.findOne({ sellerId, orderId }).lean();
  return !!existing;
}

// Check Amazon — is this order eligible right now?
async function checkSolicitationEligibility(accessToken, orderId, marketplaceId) {
  try {
    const params = new URLSearchParams({ marketplaceIds: marketplaceId });

    const res = await fetch(
      `${SP_API_BASE}/solicitations/v1/orders/${orderId}?${params}`,
      {
        headers: {
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!res.ok) {
      logger.warn('[SolicitationService] Eligibility check failed', {
        orderId,
        status: res.status,
      });
      return false;
    }

    const data = await res.json();
    const actions = data._embedded?.actions ?? [];

    return actions.some(
      (a) => a._embedded?.schema?.name === 'productReviewAndSellerFeedback'
    );
  } catch (error) {
    logger.error('[SolicitationService] Error checking eligibility', {
      orderId,
      error: error?.message,
    });
    return false;
  }
}

// Send the actual review request to Amazon
async function sendSolicitation(accessToken, orderId, marketplaceId) {
  const params = new URLSearchParams({ marketplaceIds: marketplaceId });

  const res = await fetch(
    `${SP_API_BASE}/solicitations/v1/orders/${orderId}/solicitations/productReviewAndSellerFeedback?${params}`,
    {
      method: 'POST',
      headers: {
        'x-amz-access-token': accessToken,
        'Content-Type': 'application/json',
      },
    }
  );

  return { status: res.status, ok: res.status === 201 };
}

// Save result to MongoDB
async function logSolicitationResult(sellerId, orderId, result, skipReason = null) {
  try {
    await SolicitationLog.create({
      sellerId,
      orderId,
      status: skipReason ? 'skipped' : result?.ok ? 'sent' : 'failed',
      skipReason,
      httpStatus: result?.status ?? null,
      sentAt: new Date(),
    });
  } catch (error) {
    // Ignore duplicate key errors — means it was already logged
    if (error.code === 11000) {
      logger.info('[SolicitationService] Duplicate log (already recorded)', {
        sellerId,
        orderId,
      });
    } else {
      logger.error('[SolicitationService] Failed to log solicitation', {
        sellerId,
        orderId,
        error: error?.message,
      });
    }
  }
}

// Pause between requests — Amazon rate limit is 1 req/sec
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  hasAlreadySentSolicitation,
  checkSolicitationEligibility,
  sendSolicitation,
  logSolicitationResult,
  sleep,
};