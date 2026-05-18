const mongoose = require('mongoose');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAccessToken } = require('../../Services/Sp_API/GenerateTokens.js');
const { syncFinanceData, getSyncStatus } = require('../../Services/Sp_API/FinanceService.js');
const FinanceDashboardReadService = require('../../Services/Finance/FinanceDashboardReadService.js');
const logger = require('../../utils/Logger.js');

function r2(v) { return Math.round(Number(v || 0) * 100) / 100; }

function buildExpenseBreakdown(row) {
  const refundedAmount    = r2(row.refundedAmount);
  const refundCommission  = r2(row.refundCommission);
  const refundedReferralFee = r2(row.refundedReferralFee);
  const refundedPromotion = r2(row.refundedPromotion);
  const refundCost = r2(refundedAmount + refundCommission + refundedReferralFee + refundedPromotion);

  const fbaPerUnitFulfillmentFee = r2(row.fbaFulfillmentFee);
  const referralFee       = r2(row.referralCommission);
  const closingFee        = r2(row.closingFee);
  const technologyFee     = r2(row.technologyFee);
  const shippingChargeback = r2(row.shippingChargeback);
  const giftWrapChargeback = r2(row.giftWrapChargeback);
  const fbaDisposalFee    = r2(row.fbaDisposalFee);
  const fbaReversedReimbursement = r2(row.fbaReversedReimbursement);
  const amazonFees = r2(
    fbaPerUnitFulfillmentFee + referralFee + closingFee + technologyFee +
    shippingChargeback + giftWrapChargeback + fbaDisposalFee + fbaReversedReimbursement
  );

  const promotionsDiscount = r2(row.promotionsDiscount);
  const shippingDiscount   = r2(row.shippingDiscount);

  const otherExpenses = r2(row.otherExpenses);
  const otherExpensesBreakdown = row.otherExpensesBreakdown || [];

  return {
    refundCost: {
      total: refundCost,
      refundedAmount,
      refundCommission,
      refundedReferralFee,
      refundedPromotion,
    },
    amazonFees: {
      total: amazonFees,
      fbaPerUnitFulfillmentFee,
      referralFee,
      closingFee,
      technologyFee,
      shippingChargeback,
      giftWrapChargeback,
      fbaDisposalFee,
      fbaReversedReimbursement,
    },
    promotions: {
      total: r2(promotionsDiscount + shippingDiscount),
      promotionsDiscount,
      shippingDiscount,
    },
    otherExpenses: {
      total: otherExpenses,
      breakdown: otherExpensesBreakdown,
    },
    totalExpenses: r2(row.totalExpenses),
  };
}


async function testFinanceDashboardSync(req, res) {
  try {
    const { userId, country, region, startDate, endDate } = req.body || {};

    if (!userId || !country || !region || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'userId, country, region, startDate (YYYY-MM-DD), and endDate (YYYY-MM-DD) are required',
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Use YYYY-MM-DD.',
      });
    }

    if (startDate > endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate must be <= endDate.',
      });
    }

    const countryUpper = String(country).toUpperCase();
    const regionUpper = String(region).toUpperCase();
    if (!['NA', 'EU', 'FE'].includes(regionUpper)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid region. Expected one of: NA, EU, FE',
      });
    }

    let userIdQuery = userId;
    if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
      userIdQuery = new mongoose.Types.ObjectId(userId);
    }

    const sellerCentral = await Seller.findOne({ User: userIdQuery }).sort({ createdAt: -1 });
    if (!sellerCentral) {
      return res.status(404).json({
        success: false,
        message: 'Seller account not found for the provided userId',
      });
    }

    const sellerAccount = sellerCentral.sellerAccount?.find(
      (acc) => acc?.country === countryUpper && acc?.region === regionUpper
    );

    if (!sellerAccount) {
      return res.status(404).json({
        success: false,
        message: `Seller account not found for country: ${countryUpper} and region: ${regionUpper}`,
      });
    }

    if (!sellerAccount.spiRefreshToken) {
      return res.status(400).json({
        success: false,
        message: 'SP-API refresh token not found. Connect Amazon Seller Central first.',
      });
    }

    const refreshToken = sellerAccount.spiRefreshToken;

    logger.info('[testFinanceDashboardSync] Generating SP-API access token...');
    const accessToken = await generateAccessToken(userIdQuery, refreshToken);
    if (!accessToken) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate SP-API access token.',
      });
    }

    const forceDates = [startDate, endDate];
    logger.info(`[testFinanceDashboardSync] Fetching ${startDate} → ${endDate}...`);

    const syncResult = await syncFinanceData({
      userId: userIdQuery,
      country: countryUpper,
      regionModel: regionUpper,
      refreshToken,
      accessToken,
      forceDates,
    });

    logger.info(`[testFinanceDashboardSync] Sync complete. Fetching dashboard data...`);

    const dashboardData = await FinanceDashboardReadService.getDashboard({
      userId: userIdQuery,
      country: countryUpper,
      region: regionUpper,
      startDate,
      endDate,
    });

    const syncStatus = await getSyncStatus({
      userId: userIdQuery,
      country: countryUpper,
      regionModel: regionUpper,
    });

    return res.status(200).json({
      success: true,
      message: `Finance data synced and dashboard fetched for ${startDate} to ${endDate}`,
      syncResult,
      syncStatus,
      dashboard: {
        totals: dashboardData.totals,
        asinWiseCount: dashboardData.asinWise?.length || 0,
        dateWiseCount: dashboardData.dateWise?.length || 0,
        overheadCount: dashboardData.overhead?.length || 0,
        overheadTotal: dashboardData.overheadTotal,
        metadata: dashboardData.metadata,
        asinWiseSample: (dashboardData.asinWise || []).slice(0, 5),
        dateWiseSample: (dashboardData.dateWise || []).slice(0, 5),
      },
    });
  } catch (error) {
    logger.error(`[testFinanceDashboardSync] Error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}

/**
 * Read-only test endpoint: returns total + ASIN-wise sales and expense summary
 * using the same DB-backed calculation used by profitability dashboard.
 *
 * Body: { userId, country, region, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD) }
 */
async function testFinanceDashboardRead(req, res) {
  try {
    const { userId, country, region, startDate, endDate } = req.body || {};

    if (!userId || !country || !region || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'userId, country, region, startDate (YYYY-MM-DD), and endDate (YYYY-MM-DD) are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ success: false, message: 'startDate must be <= endDate.' });
    }

    const countryUpper = String(country).toUpperCase();
    const regionUpper = String(region).toUpperCase();
    if (!['NA', 'EU', 'FE'].includes(regionUpper)) {
      return res.status(400).json({ success: false, message: 'Invalid region. Expected one of: NA, EU, FE' });
    }

    const userIdQuery = typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId) : userId;

    const ctx = { userId: userIdQuery, country: countryUpper, region: regionUpper, startDate, endDate };

    const [totals, asinWise] = await Promise.all([
      FinanceDashboardReadService.getTotals(ctx),
      FinanceDashboardReadService.getAsinWisePL(ctx),
    ]);

    const asinWiseResults = asinWise.map(row => ({
      asin: row.asin,
      sku: row.sku,
      productSales: r2(row.productSales),
      units: r2(row.units),
      expenses: buildExpenseBreakdown(row),
    }));

    return res.status(200).json({
      success: true,
      dateRange: { startDate, endDate },
      totalSales: r2(totals.productSales),
      totalExpenses: buildExpenseBreakdown(totals),
      asinWise: {
        count: asinWiseResults.length,
        rows: asinWiseResults,
      },
    });
  } catch (error) {
    logger.error(`[testFinanceDashboardRead] Error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}

module.exports = { testFinanceDashboardSync, testFinanceDashboardRead };
