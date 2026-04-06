/**
 * Sales-only test controller
 *
 * Manual testing endpoint that:
 * 1) Fetches Sales+Traffic data for the requested date range (DAY granularity)
 * 2) Calculates total sales + daily sales
 * 3) Computes cached "last 7" and "last 14" summaries based on the requested endDate
 * 4) Stores the results into SalesOnlyMetrics
 * 5) Returns the saved payload
 *
 * Expected body:
 *   {
 *     userId: string,
 *     country: string,           // e.g. 'AU'
 *     region: 'NA'|'EU'|'FE',   // MCP region
 *     startDate: 'YYYY-MM-DD',
 *     endDate: 'YYYY-MM-DD',
 *     refreshToken?: string     // optional override
 *   }
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');

const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { fetchSalesAndTrafficByDate } = require('../../Services/MCP/MCPSalesAndTrafficIntegration.js');
const { saveSalesOnlyMetrics } = require('../../Services/MCP/SalesOnlyMetricsService.js');

function toISODateString(d) {
  return d.toISOString().split('T')[0];
}

function parseUtcDayStart(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function parseUtcDayEnd(dateStr) {
  return new Date(`${dateStr}T23:59:59.999Z`);
}

function isValidISODate(dateStr) {
  // Minimal YYYY-MM-DD validation; controller uses UTC parsing for comparisons
  return typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

const testGetSalesOnlyByDateRange = asyncHandler(async (req, res) => {
  const { userId, country, region, startDate, endDate, refreshToken } = req.body || {};

  if (!userId) throw new ApiError(400, 'userId is required');
  if (!country) throw new ApiError(400, 'country is required');
  if (!region) throw new ApiError(400, 'region is required');
  if (!startDate || !endDate) throw new ApiError(400, 'startDate and endDate are required (YYYY-MM-DD)');
  if (!isValidISODate(startDate) || !isValidISODate(endDate)) {
    throw new ApiError(400, 'startDate/endDate must be in YYYY-MM-DD format');
  }

  const start = parseUtcDayStart(startDate);
  const end = parseUtcDayEnd(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(400, 'Invalid startDate/endDate');
  }
  if (start > end) throw new ApiError(400, 'startDate must be less than or equal to endDate');

  let effectiveRegion = region;
  let effectiveCountry = country;

  let finalRefreshToken = refreshToken;
  if (!finalRefreshToken) {
    // Load the user's Seller document to find spiRefreshToken for this region/country.
    const sellerDoc = await Seller.findOne({ User: userId }).lean();
    if (!sellerDoc) {
      throw new ApiError(404, 'No seller account found for this user');
    }

    const accounts = Array.isArray(sellerDoc.sellerAccount) ? sellerDoc.sellerAccount : [];

    let matchedAccount = accounts.find(
      (acc) => acc && acc.country === country && acc.region === region
    );

    // Fallback to first available account if exact match is not found
    if (!matchedAccount && accounts.length > 0) {
      matchedAccount = accounts[0];
      effectiveRegion = matchedAccount.region || region;
      effectiveCountry = matchedAccount.country || country;
    }

    if (!matchedAccount?.spiRefreshToken) {
      throw new ApiError(
        404,
        'spiRefreshToken not found for this user/region/country. Connect Amazon Seller Central first or pass refreshToken in request body.'
      );
    }

    finalRefreshToken = matchedAccount.spiRefreshToken;
  }

  // Fetch sales+traffic (DAY granularity) for the requested range
  const salesResult = await fetchSalesAndTrafficByDate(
    finalRefreshToken,
    effectiveRegion,
    effectiveCountry,
    startDate,
    endDate
  );

  if (!salesResult?.success || !salesResult?.data) {
    throw new ApiError(500, salesResult?.error || 'Failed to fetch sales-only data');
  }

  const { totalSales, datewiseSales } = salesResult.data;

  const currencyCode =
    totalSales?.currencyCode ||
    datewiseSales?.[0]?.sales?.currencyCode ||
    'USD';

  // Compute last7Days + last14Days based on the requested endDate
  const endDateObj = parseUtcDayStart(endDate); // midnight UTC for consistent date arithmetic
  const last7StartObj = new Date(endDateObj);
  last7StartObj.setDate(last7StartObj.getDate() - 6);
  const last14StartObj = new Date(endDateObj);
  last14StartObj.setDate(last14StartObj.getDate() - 13);

  const last7StartStr = toISODateString(last7StartObj);
  const last14StartStr = toISODateString(last14StartObj);

  const last7Items = (datewiseSales || []).filter(
    (d) => d.date >= last7StartStr && d.date <= endDate
  );
  const last14Items = (datewiseSales || []).filter(
    (d) => d.date >= last14StartStr && d.date <= endDate
  );

  const last7Total = last7Items.reduce((sum, item) => sum + (item.sales?.amount || 0), 0);
  const last14Total = last14Items.reduce((sum, item) => sum + (item.sales?.amount || 0), 0);

  const last7Days = {
    totalSales: {
      amount: parseFloat(last7Total.toFixed(2)),
      currencyCode,
    },
    startDate: last7StartStr,
    endDate,
  };

  const last14Days = {
    totalSales: {
      amount: parseFloat(last14Total.toFixed(2)),
      currencyCode,
    },
    startDate: last14StartStr,
    endDate,
  };

  // Map to SalesOnlyMetrics schema shape (grossProfit is kept as 0 always)
  const mappedDatewiseSales = (datewiseSales || []).map((d) => ({
    date: d.date,
    sales: d.sales,
    grossProfit: { amount: 0, currencyCode: d.sales?.currencyCode || currencyCode },
    unitsSold: 0,
  }));

  const saved = await saveSalesOnlyMetrics({
    userId,
    region: effectiveRegion,
    country: effectiveCountry,
    dateRange: { startDate, endDate },
    totalSales: {
      amount: parseFloat((totalSales?.amount || 0).toFixed(2)),
      currencyCode,
    },
    datewiseSales: mappedDatewiseSales,
    last7Days,
    last14Days,
    queryId: null,
    documentId: null,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        savedInDatabase: true,
        databaseId: saved?._id || null,
        totalSales: saved?.totalSales || {
          amount: parseFloat((totalSales?.amount || 0).toFixed(2)),
          currencyCode,
        },
        datewiseSales: mappedDatewiseSales,
        last7Days: saved?.last7Days || last7Days,
        last14Days: saved?.last14Days || last14Days,
        currencyCode,
        dateRange: { startDate, endDate },
        region: effectiveRegion,
        country: effectiveCountry,
      },
      'Sales-only data fetched, stored, and returned successfully'
    )
  );
});

module.exports = {
  testGetSalesOnlyByDateRange,
};

