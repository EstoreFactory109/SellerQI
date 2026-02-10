/**
 * AlertsController.js
 *
 * Serves alerts from the unified alerts collection for the frontend.
 * All alert types (ProductContentChange, BuyBoxMissing, NegativeReviews) are stored
 * in one collection; this API returns them in one list, sorted by createdAt.
 */

const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { Alert, SalesDropAlert, ConversionRatesAlert } = require('../../models/alerts/Alert.js');
const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { sendAlertsEmail } = require('../../Services/Email/SendAlertsEmail.js');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * GET /api/alerts (or /list)
 * Requires: auth + getLocation (req.userId, req.country, req.region)
 * Query: status (optional), alertType (optional), limit, skip
 * Returns: { alerts: [...], total } - each alert has _id, alertType, message, status, products, createdAt, etc.
 */
const getAlerts = asyncHandler(async (req, res) => {
  const userId = req.userId;
  const country = req.country;
  const region = req.region;

  if (!userId) {
    return res.status(400).json(new ApiResponse(400, null, 'User ID is required'));
  }
  if (!country || !region) {
    return res.status(400).json(new ApiResponse(400, null, 'Country and region are required (set location)'));
  }

  const status = req.query.status; // optional: active | acknowledged | resolved
  const alertType = req.query.alertType; // optional: ProductContentChange | BuyBoxMissing | NegativeReviews
  let limit = parseInt(req.query.limit, 10) || DEFAULT_LIMIT;
  const skip = parseInt(req.query.skip, 10) || 0;

  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  if (limit < 1) limit = DEFAULT_LIMIT;

  const filter = { User: userId, country, region };
  if (status) filter.status = status;
  if (alertType) filter.alertType = alertType;

  const [alerts, total] = await Promise.all([
    Alert.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Alert.countDocuments(filter),
  ]);

  return res.status(200).json(
    new ApiResponse(200, { alerts, total }, 'Alerts retrieved successfully')
  );
});

/**
 * GET /api/alerts/latest
 * Requires: auth + getLocation (req.userId, req.country, req.region)
 * Query: limit (number) - e.g. ?limit=10 returns the last 10 alerts
 * Returns: { alerts: [...] } - latest N alerts sorted by createdAt desc
 */
const getLatestAlerts = asyncHandler(async (req, res) => {
  const userId = req.userId;
  const country = req.country;
  const region = req.region;

  if (!userId) {
    return res.status(400).json(new ApiResponse(400, null, 'User ID is required'));
  }
  if (!country || !region) {
    return res.status(400).json(new ApiResponse(400, null, 'Country and region are required (set location)'));
  }

  let limit = parseInt(req.query.limit, 10);
  if (Number.isNaN(limit) || limit < 1) limit = 10;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const filter = { User: userId, country, region };
  const alerts = await Alert.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

  return res.status(200).json(
    new ApiResponse(200, { alerts }, 'Latest alerts retrieved successfully')
  );
});

/**
 * GET /api/alerts/:id
 * Requires: auth (req.userId)
 * Params: id - alert _id
 * Returns: single alert with full details (products, etc.) for the notification details page.
 */
const getAlertById = asyncHandler(async (req, res) => {
  const userId = req.userId;
  const alertId = req.params.id;

  if (!userId) {
    return res.status(400).json(new ApiResponse(400, null, 'User ID is required'));
  }
  if (!alertId) {
    return res.status(400).json(new ApiResponse(400, null, 'Alert ID is required'));
  }

  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(alertId)) {
    return res.status(400).json(new ApiResponse(400, null, 'Invalid alert ID'));
  }

  const alert = await Alert.findOne({ _id: alertId, User: userId }).lean();
  if (!alert) {
    return res.status(404).json(new ApiResponse(404, null, 'Alert not found'));
  }

  // Enrich products with sku and title (itemName) from Seller model
  if (alert.country != null && alert.region != null && Array.isArray(alert.products) && alert.products.length > 0) {
    const seller = await Seller.findOne({ User: userId })
      .select('sellerAccount')
      .lean();
    const account = (seller?.sellerAccount || []).find(
      (acc) => acc.country === alert.country && acc.region === alert.region
    );
    const productList = account?.products || [];
    const byAsin = {};
    for (const p of productList) {
      const a = (p.asin || '').toString().trim();
      if (a && !byAsin[a]) {
        byAsin[a] = { sku: p.sku != null ? String(p.sku) : undefined, title: p.itemName != null ? String(p.itemName) : undefined };
      }
    }
    alert.products = alert.products.map((prod) => {
      const asinKey = (prod.asin || '').toString().trim();
      const fromSeller = byAsin[asinKey];
      return {
        ...prod,
        sku: fromSeller?.sku ?? prod.sku ?? undefined,
        title: fromSeller?.title ?? prod.title ?? undefined,
      };
    });
  }

  return res.status(200).json(
    new ApiResponse(200, alert, 'Alert retrieved successfully')
  );
});

/**
 * PATCH /api/alerts/:id/viewed
 * Requires: auth (req.userId)
 * Params: id - alert _id
 * Sets viewed = true for the alert if it belongs to the current user.
 */
const updateAlertViewed = asyncHandler(async (req, res) => {
  const userId = req.userId;
  const alertId = req.params.id;

  if (!userId) {
    return res.status(400).json(new ApiResponse(400, null, 'User ID is required'));
  }
  if (!alertId) {
    return res.status(400).json(new ApiResponse(400, null, 'Alert ID is required'));
  }

  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(alertId)) {
    return res.status(400).json(new ApiResponse(400, null, 'Invalid alert ID'));
  }

  const alert = await Alert.findOne({ _id: alertId, User: userId });
  if (!alert) {
    return res.status(404).json(new ApiResponse(404, null, 'Alert not found'));
  }

  alert.viewed = true;
  await alert.save();

  return res.status(200).json(
    new ApiResponse(200, { alert: alert.toObject ? alert.toObject() : alert }, 'Alert viewed status updated')
  );
});

const VALID_REGIONS = ['NA', 'EU', 'FE'];

function parseAlertsTestBody(req, res) {
  const { userId, country, region } = req.body;
  if (!userId) {
    res.status(400).json(new ApiResponse(400, null, 'userId is required'));
    return null;
  }
  if (!country) {
    res.status(400).json(new ApiResponse(400, null, 'country is required (e.g., US, UK, DE)'));
    return null;
  }
  if (!region) {
    res.status(400).json(new ApiResponse(400, null, 'region is required (NA, EU, or FE)'));
    return null;
  }
  if (!VALID_REGIONS.includes(region)) {
    res.status(400).json(
      new ApiResponse(400, null, `Invalid region: ${region}. Valid values are: ${VALID_REGIONS.join(', ')}`)
    );
    return null;
  }
  const mongoose = require('mongoose');
  let userIdQuery = userId;
  if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
    userIdQuery = new mongoose.Types.ObjectId(userId);
  }
  return { userId: userIdQuery, country, region };
}

/**
 * POST /api/alerts/test
 * Body: { userId, country, region }
 * Runs product content + negative reviews and buybox missing alerts. Each service stores alerts and sends email when it creates alerts.
 */
const testAlerts = asyncHandler(async (req, res) => {
  const parsed = parseAlertsTestBody(req, res);
  if (!parsed) return;

  const { userId, country, region } = parsed;
  const { detectAndStoreAlerts } = require('../../Services/Alerts/Other-Alerts/ProductContentChangeAlertService.js');
  const { detectAndStoreBuyBoxMissingAlerts } = require('../../Services/Alerts/Other-Alerts/BuyBoxMissingAlertService.js');

  const [contentResult, buyBoxResult] = await Promise.all([
    detectAndStoreAlerts(userId, region, country),
    detectAndStoreBuyBoxMissingAlerts(userId, region, country),
  ]);

  if (contentResult.error) {
    return res.status(500).json(
      new ApiResponse(500, null, contentResult.error || 'Alerts service error')
    );
  }

  const productContentChange = {
    created: contentResult.productContentChange?.created ?? false,
    productsWithChanges: contentResult.productContentChange?.productsWithChanges ?? 0,
  };
  if (contentResult.productContentChange?.alert?._id) {
    productContentChange.alertId = contentResult.productContentChange.alert._id.toString();
  }

  const negativeReviews = {
    created: contentResult.negativeReviews?.created ?? false,
    productsWithChanges: contentResult.negativeReviews?.productsWithChanges ?? 0,
  };
  if (contentResult.negativeReviews?.alert?._id) {
    negativeReviews.alertId = contentResult.negativeReviews.alert._id.toString();
  }

  const buyBoxMissing = {
    created: buyBoxResult.created ?? false,
    productsWithChanges: buyBoxResult.productsWithChanges ?? 0,
  };
  if (buyBoxResult.alert?._id) {
    buyBoxMissing.alertId = buyBoxResult.alert._id.toString();
  }
  if (buyBoxResult.error) {
    buyBoxMissing.error = buyBoxResult.error;
  }

  return res.status(200).json(
    new ApiResponse(200, {
      productContentChange,
      negativeReviews,
      buyBoxMissing,
    }, 'Alerts check completed. Each service sends an email when it creates alerts.')
  );
});

/**
 * POST /api/alerts/testProductContentChange
 * Body: { userId, country, region }
 * Runs only product content change + negative reviews detection (NumberOfProductReviews). No buybox.
 */
const testProductContentChangeAlerts = asyncHandler(async (req, res) => {
  const parsed = parseAlertsTestBody(req, res);
  if (!parsed) return;

  const { userId, country, region } = parsed;
  const { detectAndStoreAlerts } = require('../../Services/Alerts/Other-Alerts/ProductContentChangeAlertService.js');
  const result = await detectAndStoreAlerts(userId, region, country);

  if (result.error) {
    return res.status(500).json(
      new ApiResponse(500, null, result.error || 'Product content change / negative reviews service error')
    );
  }

  const productContentChange = {
    created: result.productContentChange?.created ?? false,
    productsWithChanges: result.productContentChange?.productsWithChanges ?? 0,
  };
  if (result.productContentChange?.alert?._id) {
    productContentChange.alertId = result.productContentChange.alert._id.toString();
  }

  const negativeReviews = {
    created: result.negativeReviews?.created ?? false,
    productsWithChanges: result.negativeReviews?.productsWithChanges ?? 0,
  };
  if (result.negativeReviews?.alert?._id) {
    negativeReviews.alertId = result.negativeReviews.alert._id.toString();
  }

  return res.status(200).json(
    new ApiResponse(200, {
      productContentChange,
      negativeReviews,
    }, 'Product content change + negative reviews check completed.')
  );
});

/**
 * POST /api/alerts/testBuyBoxMissing
 * Body: { userId, country, region }
 * Runs only buybox missing detection using latest BuyBoxData.
 */
const testBuyBoxMissingAlerts = asyncHandler(async (req, res) => {
  const parsed = parseAlertsTestBody(req, res);
  if (!parsed) return;

  const { userId, country, region } = parsed;
  const { detectAndStoreBuyBoxMissingAlerts } = require('../../Services/Alerts/Other-Alerts/BuyBoxMissingAlertService.js');
  const result = await detectAndStoreBuyBoxMissingAlerts(userId, region, country);

  if (result.error) {
    return res.status(500).json(
      new ApiResponse(500, null, result.error || 'Buybox missing alerts service error')
    );
  }

  const buyBoxMissing = {
    created: result.created ?? false,
    productsWithChanges: result.productsWithChanges ?? 0,
  };
  if (result.alert?._id) {
    buyBoxMissing.alertId = result.alert._id.toString();
  }

  return res.status(200).json(
    new ApiResponse(200, { buyBoxMissing }, 'Buybox missing check completed')
  );
});

/**
 * POST /api/alerts/testSalesDrop
 * Body: { userId, country, region } plus optional { startDate, endDate, unitsDropThresholdPct, revenueDropThresholdPct }
 * Loads datewise sales from Economics Metrics for the user and detects sales velocity drops for the last 7 days.
 */
const testSalesDrop = asyncHandler(async (req, res) => {
  const parsed = parseAlertsTestBody(req, res);
  if (!parsed) return;

  const { userId, country, region } = parsed;
  const mongoose = require('mongoose');
  const userIdQuery = typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;

  const options = {};
  if (req.body.startDate) options.startDate = req.body.startDate;
  if (req.body.endDate) options.endDate = req.body.endDate;
  if (req.body.unitsDropThresholdPct != null) options.unitsDropThresholdPct = Number(req.body.unitsDropThresholdPct);
  if (req.body.revenueDropThresholdPct != null) options.revenueDropThresholdPct = Number(req.body.revenueDropThresholdPct);

  const { detectSalesDrop } = require('../../Services/Alerts/Other-Alerts/SalesDropAlertService.js');
  const result = await detectSalesDrop(userIdQuery, region, country, options);

  if (result.error) {
    return res.status(500).json(
      new ApiResponse(500, null, result.error)
    );
  }

  let alert = null;
  if (result.detected && result.drops?.length > 0) {
    alert = await SalesDropAlert.create({
      User: userIdQuery,
      region,
      country,
      message: `${result.drops.length} sales drop(s) detected`,
      status: 'active',
      dateRange: result.dateRange,
      marketplace: result.marketplace,
      drops: result.drops,
      metadata: {
        unitsDropThresholdPct: options.unitsDropThresholdPct,
        revenueDropThresholdPct: options.revenueDropThresholdPct,
      },
    });

    try {
      const user = await User.findById(userIdQuery).select('email firstName').lean();
      if (user?.email) {
        const payload = {
          productContentChange: { count: 0, products: [] },
          negativeReviews: { count: 0, products: [] },
          buyBoxMissing: { count: 0, products: [] },
          aplusMissing: { count: 0, products: [] },
          salesDrop: { count: result.drops.length, drops: result.drops },
        };
        await sendAlertsEmail(user.email, user.firstName || 'Seller', payload, undefined, userIdQuery);
      }
    } catch (emailErr) {
      // Non-fatal: log and continue
      const logger = require('../../utils/Logger.js');
      logger.warn('[testSalesDrop] Alerts email failed (non-fatal)', { userId: userIdQuery?.toString(), error: emailErr?.message });
    }
  }

  return res.status(200).json(
    new ApiResponse(200, {
      detected: result.detected,
      drops: result.drops,
      dateRange: result.dateRange,
      marketplace: result.marketplace,
      datewiseSales: result.datewiseSales,
      alertId: alert?._id?.toString() ?? null,
    }, result.detected ? 'Sales drop(s) detected' : 'No sales drop detected in the date range')
  );
});

/**
 * POST /api/alerts/testConversionRates
 * Body: { userId, country, region } plus optional { startDate, endDate }
 * Fetches conversion rates (sessions + unitSessionPercentage) for the last 7 days via Sales and Traffic API.
 */
const testConversionRates = asyncHandler(async (req, res) => {
  const parsed = parseAlertsTestBody(req, res);
  if (!parsed) return;

  const { userId, country, region } = parsed;
  const mongoose = require('mongoose');
  const Seller = require('../../models/user-auth/sellerCentralModel.js');
  const userIdQuery = typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;

  const sellerCentral = await Seller.findOne({ User: userIdQuery }).sort({ createdAt: -1 });
  if (!sellerCentral?.sellerAccount?.length) {
    return res.status(404).json(
      new ApiResponse(404, null, 'Seller account not found for the provided userId')
    );
  }

  const sellerAccount = sellerCentral.sellerAccount.find(
    (acc) => acc.country === country && acc.region === region
  );
  if (!sellerAccount?.spiRefreshToken) {
    return res.status(400).json(
      new ApiResponse(400, null, 'SP-API refresh token not found for this account. Connect Amazon Seller Central first.')
    );
  }

  const options = {};
  if (req.body.startDate) options.startDate = req.body.startDate;
  if (req.body.endDate) options.endDate = req.body.endDate;

  const { getConversionRates } = require('../../Services/Alerts/Other-Alerts/ConversionAlertService.js');
  const result = await getConversionRates(sellerAccount.spiRefreshToken, region, country, options);

  if (!result.success) {
    return res.status(500).json(
      new ApiResponse(500, null, result.error || 'Failed to fetch conversion rates')
    );
  }

  const alert = await ConversionRatesAlert.create({
    User: userIdQuery,
    region,
    country,
    message: `Conversion rates for last 7 days (${result.dateRange.startDate} to ${result.dateRange.endDate})`,
    status: 'active',
    dateRange: result.dateRange,
    marketplace: result.marketplace,
    conversionRates: result.conversionRates,
  });

  try {
    const user = await User.findById(userIdQuery).select('email firstName').lean();
    if (user?.email) {
      const payload = {
        productContentChange: { count: 0, products: [] },
        negativeReviews: { count: 0, products: [] },
        buyBoxMissing: { count: 0, products: [] },
        aplusMissing: { count: 0, products: [] },
        salesDrop: { count: 0 },
        conversionRates: { count: 1, dateRange: result.dateRange, conversionRates: result.conversionRates },
      };
      await sendAlertsEmail(user.email, user.firstName || 'Seller', payload, undefined, userIdQuery);
    }
  } catch (emailErr) {
    const logger = require('../../utils/Logger.js');
    logger.warn('[testConversionRates] Alerts email failed (non-fatal)', { userId: userIdQuery?.toString(), error: emailErr?.message });
  }

  return res.status(200).json(
    new ApiResponse(200, {
      dateRange: result.dateRange,
      marketplace: result.marketplace,
      conversionRates: result.conversionRates,
      alertId: alert?._id?.toString() ?? null,
    }, 'Conversion rates retrieved and stored successfully')
  );
});

/**
 * POST /api/alerts/testLowInventory
 * Body: { userId, country, region }
 * Runs low inventory / out of stock detection from stored Restock Inventory document. Only creates alert if document was created within the last 3 days.
 */
const testLowInventoryAlerts = asyncHandler(async (req, res) => {
  const parsed = parseAlertsTestBody(req, res);
  if (!parsed) return;

  const { userId, country, region } = parsed;
  const { detectAndStoreLowInventoryAlerts } = require('../../Services/Alerts/Other-Alerts/LowInventoryAlertService.js');
  const result = await detectAndStoreLowInventoryAlerts(userId, region, country);

  if (result.error) {
    return res.status(500).json(
      new ApiResponse(500, null, result.error || 'Low inventory alerts service error')
    );
  }

  const lowInventory = {
    created: result.created ?? false,
    productsCount: result.productsCount ?? 0,
  };
  if (result.alert?._id) {
    lowInventory.alertId = result.alert._id.toString();
  }
  if (result.warning) {
    lowInventory.warning = result.warning;
  }
  if (result.skipped) {
    lowInventory.skipped = result.skipped;
  }

  return res.status(200).json(
    new ApiResponse(200, { lowInventory }, result.created ? 'Low inventory alert(s) created' : (result.warning || result.skipped || 'No low inventory issues found'))
  );
});

/**
 * POST /api/alerts/testStrandedInventory
 * Body: { userId, country, region }
 * Runs stranded inventory detection from stored Stranded Inventory UI document. Only creates alert if document was created within the last 3 days.
 */
const testStrandedInventoryAlerts = asyncHandler(async (req, res) => {
  const parsed = parseAlertsTestBody(req, res);
  if (!parsed) return;

  const { userId, country, region } = parsed;
  const { detectAndStoreStrandedInventoryAlerts } = require('../../Services/Alerts/Other-Alerts/StrandedInventoryAlertService.js');
  const result = await detectAndStoreStrandedInventoryAlerts(userId, region, country);

  if (result.error) {
    return res.status(500).json(
      new ApiResponse(500, null, result.error || 'Stranded inventory alerts service error')
    );
  }

  const strandedInventory = {
    created: result.created ?? false,
    productsCount: result.productsCount ?? 0,
  };
  if (result.alert?._id) {
    strandedInventory.alertId = result.alert._id.toString();
  }
  if (result.warning) {
    strandedInventory.warning = result.warning;
  }
  if (result.skipped) {
    strandedInventory.skipped = result.skipped;
  }

  return res.status(200).json(
    new ApiResponse(200, { strandedInventory }, result.created ? 'Stranded inventory alert(s) created' : (result.warning || result.skipped || 'No stranded inventory found'))
  );
});

/**
 * POST /api/alerts/testInboundShipment
 * Body: { userId, country, region }
 * Runs inbound shipment issues detection from stored Inbound Non-Compliance document. Only creates alert if document was created within the last 3 days.
 */
const testInboundShipmentAlerts = asyncHandler(async (req, res) => {
  const parsed = parseAlertsTestBody(req, res);
  if (!parsed) return;

  const { userId, country, region } = parsed;
  const { detectAndStoreInboundShipmentAlerts } = require('../../Services/Alerts/Other-Alerts/InboundShipmentAlertService.js');
  const result = await detectAndStoreInboundShipmentAlerts(userId, region, country);

  if (result.error) {
    return res.status(500).json(
      new ApiResponse(500, null, result.error || 'Inbound shipment alerts service error')
    );
  }

  const inboundShipment = {
    created: result.created ?? false,
    productsCount: result.productsCount ?? 0,
  };
  if (result.alert?._id) {
    inboundShipment.alertId = result.alert._id.toString();
  }
  if (result.warning) {
    inboundShipment.warning = result.warning;
  }
  if (result.skipped) {
    inboundShipment.skipped = result.skipped;
  }

  return res.status(200).json(
    new ApiResponse(200, { inboundShipment }, result.created ? 'Inbound shipment alert(s) created' : (result.warning || result.skipped || 'No inbound shipment issues found'))
  );
});

/**
 * POST /api/alerts/testInventoryAlerts
 * Body: { userId, country, region }
 * Runs all three inventory alert services: low inventory, stranded inventory, inbound shipment. Each only creates alert if its document was created within the last 3 days.
 */
const testInventoryAlerts = asyncHandler(async (req, res) => {
  const parsed = parseAlertsTestBody(req, res);
  if (!parsed) return;

  const { userId, country, region } = parsed;
  const { detectAndStoreLowInventoryAlerts } = require('../../Services/Alerts/Other-Alerts/LowInventoryAlertService.js');
  const { detectAndStoreStrandedInventoryAlerts } = require('../../Services/Alerts/Other-Alerts/StrandedInventoryAlertService.js');
  const { detectAndStoreInboundShipmentAlerts } = require('../../Services/Alerts/Other-Alerts/InboundShipmentAlertService.js');

  const [lowInvResult, strandedResult, inboundResult] = await Promise.all([
    detectAndStoreLowInventoryAlerts(userId, region, country),
    detectAndStoreStrandedInventoryAlerts(userId, region, country),
    detectAndStoreInboundShipmentAlerts(userId, region, country),
  ]);

  const lowInventory = {
    created: lowInvResult.created ?? false,
    productsCount: lowInvResult.productsCount ?? 0,
    alertId: lowInvResult.alert?._id?.toString() ?? null,
    warning: lowInvResult.warning ?? null,
    skipped: lowInvResult.skipped ?? null,
  };
  const strandedInventory = {
    created: strandedResult.created ?? false,
    productsCount: strandedResult.productsCount ?? 0,
    alertId: strandedResult.alert?._id?.toString() ?? null,
    warning: strandedResult.warning ?? null,
    skipped: strandedResult.skipped ?? null,
  };
  const inboundShipment = {
    created: inboundResult.created ?? false,
    productsCount: inboundResult.productsCount ?? 0,
    alertId: inboundResult.alert?._id?.toString() ?? null,
    warning: inboundResult.warning ?? null,
    skipped: inboundResult.skipped ?? null,
  };

  if (lowInvResult.error || strandedResult.error || inboundResult.error) {
    const errors = [lowInvResult.error, strandedResult.error, inboundResult.error].filter(Boolean);
    return res.status(500).json(
      new ApiResponse(500, { lowInventory, strandedInventory, inboundShipment }, errors.join('; ') || 'Inventory alerts service error')
    );
  }

  return res.status(200).json(
    new ApiResponse(200, {
      lowInventory,
      strandedInventory,
      inboundShipment,
    }, 'Inventory alerts check completed. Alerts are only created when data from the last 3 days is available.')
  );
});

module.exports = {
  getAlerts,
  getLatestAlerts,
  getAlertById,
  updateAlertViewed,
  testAlerts,
  testProductContentChangeAlerts,
  testBuyBoxMissingAlerts,
  testSalesDrop,
  testConversionRates,
  testLowInventoryAlerts,
  testStrandedInventoryAlerts,
  testInboundShipmentAlerts,
  testInventoryAlerts,
};
