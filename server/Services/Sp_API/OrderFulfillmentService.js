/**
 * Seller-fulfilled (FBM) orders: list the unshipped ones, read one with its items,
 * and confirm a shipment with its tracking number (Orders v0 confirmShipment).
 *
 * Amazon is retiring the Orders v0 READ operations on 27 Mar 2027 (deprecated
 * 28 Jan 2026, replacement Orders API v2026-01-01) together with the rest of
 * SellerQI's order reads; confirmShipment is not on that list.
 */
const axios = require('axios');

const TIMEOUT_MS = 30000;
const auth = (accessToken) => ({ 'x-amz-access-token': accessToken });

async function listUnshippedMfnOrders({ accessToken, host, marketplaceId }, { days = 30, maxPages = 5 } = {}) {
    const orders = [];
    let nextToken = null;
    let pages = 0;
    do {
        const params = nextToken
            ? { MarketplaceIds: marketplaceId, NextToken: nextToken }
            : { MarketplaceIds: marketplaceId, CreatedAfter: new Date(Date.now() - days * 864e5).toISOString(), FulfillmentChannels: 'MFN', OrderStatuses: 'Unshipped,PartiallyShipped', MaxResultsPerPage: 100 };
        const res = await axios.get(`${host}/orders/v0/orders`, { headers: auth(accessToken), params, timeout: TIMEOUT_MS });
        orders.push(...(res.data?.payload?.Orders || []));
        nextToken = res.data?.payload?.NextToken || null;
        pages += 1;
    } while (nextToken && pages < maxPages);
    return orders.map(viewOrder);
}

/** The order fields SellerQI shows (no buyer details). */
function viewOrder(o) {
    return {
        orderId: o.AmazonOrderId,
        status: o.OrderStatus,
        fulfillmentChannel: o.FulfillmentChannel,
        purchaseDate: o.PurchaseDate || null,
        earliestShipDate: o.EarliestShipDate || null,
        latestShipDate: o.LatestShipDate || null,
        shipServiceLevel: o.ShipServiceLevel || '',
        itemsUnshipped: Number(o.NumberOfItemsUnshipped) || 0,
        itemsShipped: Number(o.NumberOfItemsShipped) || 0,
        isPrime: !!o.IsPrime,
        total: o.OrderTotal ? { amount: Number(o.OrderTotal.Amount), currency: o.OrderTotal.CurrencyCode } : null
    };
}

async function getOrder({ accessToken, host }, orderId) {
    const res = await axios.get(`${host}/orders/v0/orders/${encodeURIComponent(orderId)}`, { headers: auth(accessToken), timeout: TIMEOUT_MS });
    return res.data?.payload ? viewOrder(res.data.payload) : null;
}

async function getOrderItems({ accessToken, host }, orderId) {
    const res = await axios.get(`${host}/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`, { headers: auth(accessToken), timeout: TIMEOUT_MS });
    return (res.data?.payload?.OrderItems || []).map((i) => ({
        orderItemId: String(i.OrderItemId), sku: i.SellerSKU, asin: i.ASIN, title: i.Title || '',
        quantityOrdered: Number(i.QuantityOrdered) || 0, quantityShipped: Number(i.QuantityShipped) || 0
    }));
}

/** Amazon answers 204 with no body when it accepts the confirmation. */
async function confirmShipment({ accessToken, host, marketplaceId }, orderId, packageDetail) {
    await axios.post(`${host}/orders/v0/orders/${encodeURIComponent(orderId)}/shipmentConfirmation`,
        { marketplaceId, packageDetail }, { headers: { ...auth(accessToken), 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS });
    return { orderId, confirmed: true };
}

module.exports = { listUnshippedMfnOrders, getOrder, getOrderItems, confirmShipment, viewOrder };
