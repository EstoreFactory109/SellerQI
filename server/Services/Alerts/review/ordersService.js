// ─────────────────────────────────────────
// ordersService.js
// ─────────────────────────────────────────

const logger = require('../../../utils/Logger.js');

const SP_API_BASE = 'https://sellingpartnerapi-na.amazon.com';

async function fetchShippedOrders(accessToken, marketplaceId) {
  const createdAfter = new Date();
  createdAfter.setDate(createdAfter.getDate() - 35);

  const params = new URLSearchParams({
    MarketplaceIds: marketplaceId,
    OrderStatuses: 'Shipped',
    CreatedAfter: createdAfter.toISOString(),
    MaxResultsPerPage: '100',
  });

  try {
    const res = await fetch(`${SP_API_BASE}/orders/v0/orders?${params}`, {
      headers: {
        'x-amz-access-token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      let errBody = null;
      try {
        errBody = await res.json();
      } catch {
        // ignore JSON parse errors
      }
      const message = `Orders API error: status=${res.status}${
        errBody ? ` body=${JSON.stringify(errBody)}` : ''
      }`;
      logger.error('[OrdersService] Failed to fetch orders', { message });
      throw new Error(message);
    }

    const data = await res.json();
    return data.payload?.Orders ?? [];
  } catch (error) {
    logger.error('[OrdersService] Failed to fetch orders', {
      error: error?.message,
    });
    throw error;
  }
}

function filterEligibleOrders(orders) {
  const now = new Date();

  return (orders || []).filter((order) => {
    const latestShipDate = order.LatestDeliveryDate || order.LastUpdateDate;
    if (!latestShipDate) return false;

    const deliveryDate = new Date(latestShipDate);
    const daysSinceDelivery = (now - deliveryDate) / (1000 * 60 * 60 * 24);

    return daysSinceDelivery >= 5 && daysSinceDelivery <= 30;
  });
}

module.exports = {
  fetchShippedOrders,
  filterEligibleOrders,
};