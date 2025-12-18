/**
 * Inventory Reports Test Controller
 *
 * Test endpoints to manually trigger SP-API inventory reports:
 * - Stranded Inventory (GET_STRANDED_INVENTORY_UI_DATA)
 * - Inbound Non-Compliance (GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA)
 * - Restock Inventory Recommendations (GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT)
 * - FBA Inventory Planning (GET_FBA_INVENTORY_PLANNING_DATA) - uses csv-parse for TSV parsing
 *
 * Each endpoint accepts: { userId, region, country }
 */

const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');

const { Integration } = require('../../Services/main/Integration.js');

const getStrandedReport = require('../../Services/Sp_API/GET_STRANDED_INVENTORY_UI_DATA.js');
const getInboundNonComplianceReport = require('../../Services/Sp_API/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA.js');
const getRestockRecommendationsReport = require('../../Services/Sp_API/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT.js');
const getFbaInventoryPlanningReport = require('../../Services/Sp_API/GET_FBA_INVENTORY_PLANNING_DATA.js');

/**
 * Helper to fetch SP-API access token, marketplaceIds, baseURI for user/region/country
 */
const resolveSpApiContext = async (userId, region, country) => {
  // Reuse the same helpers as main Integration flow
  const validation = await Integration.validateInputs(userId, region, country);
  if (!validation.success) {
    throw new ApiError(validation.statusCode || 400, validation.error || 'Invalid inputs');
  }

  const regionConfigResult = Integration.getConfiguration(region, country);
  if (!regionConfigResult.success) {
    throw new ApiError(
      regionConfigResult.statusCode || 400,
      regionConfigResult.error || 'Failed to load region configuration'
    );
  }

  const sellerConfig = await Integration.getSellerDataAndTokens(userId, region, country);
  if (!sellerConfig.success) {
    throw new ApiError(
      sellerConfig.statusCode || 400,
      sellerConfig.error || 'Failed to load seller account / tokens'
    );
  }

  // Reuse token generation logic from Integration: generate SP-API access token only
  const tokensResult = await Integration.generateTokens(
    userId,
    sellerConfig.RefreshToken,
    null,
    null
  );

  const AccessToken = tokensResult.AccessToken;

  if (!AccessToken) {
    throw new ApiError(400, tokensResult.error || 'Failed to generate SP-API access token');
  }

  return {
    accessToken: AccessToken,
    marketplaceIds: regionConfigResult.marketplaceIds,
    baseURI: regionConfigResult.Base_URI
  };
};

const validateBody = (req) => {
  const { userId, region, country } = req.body;

  if (!userId) {
    throw new ApiError(400, 'userId is required');
  }
  if (!region) {
    throw new ApiError(400, 'region is required (NA, EU, FE)');
  }
  if (!country) {
    throw new ApiError(400, 'country is required (e.g. US, CA, UK)');
  }

  return { userId, region, country };
};

/**
 * POST /api/test/inventory/stranded
 */
const testStrandedInventoryReport = asyncHandler(async (req, res) => {
  const { userId, region, country } = validateBody(req);

  logger.info('Test stranded inventory report triggered', { userId, region, country });

  const { accessToken, marketplaceIds, baseURI } = await resolveSpApiContext(
    userId,
    region,
    country
  );

  const result = await getStrandedReport(
    accessToken,
    marketplaceIds,
    userId,
    baseURI,
    country,
    region
  );

  if (result && result.success === false && result.message === 'Error in generating the report') {
    return res.status(502).json(
      new ApiResponse(
        502,
        result,
        'Stranded Inventory report returned "Error in generating the report"'
      )
    );
  }

  return res.status(200).json(
    new ApiResponse(200, result, 'Stranded Inventory report executed successfully')
  );
});

/**
 * POST /api/test/inventory/inbound-noncompliance
 */
const testInboundNonComplianceReport = asyncHandler(async (req, res) => {
  const { userId, region, country } = validateBody(req);

  logger.info('Test inbound non-compliance report triggered', { userId, region, country });

  const { accessToken, marketplaceIds, baseURI } = await resolveSpApiContext(
    userId,
    region,
    country
  );

  const result = await getInboundNonComplianceReport(
    accessToken,
    marketplaceIds,
    userId,
    baseURI,
    country,
    region
  );

  if (result && result.success === false && result.message === 'Error in generating the report') {
    return res.status(502).json(
      new ApiResponse(
        502,
        result,
        'Inbound Non-Compliance report returned "Error in generating the report"'
      )
    );
  }

  return res.status(200).json(
    new ApiResponse(200, result, 'Inbound Non-Compliance report executed successfully')
  );
});

/**
 * POST /api/test/inventory/restock
 */
const testRestockInventoryReport = asyncHandler(async (req, res) => {
  const { userId, region, country } = validateBody(req);

  logger.info('Test restock inventory recommendations report triggered', {
    userId,
    region,
    country
  });

  const { accessToken, marketplaceIds, baseURI } = await resolveSpApiContext(
    userId,
    region,
    country
  );

  const result = await getRestockRecommendationsReport(
    accessToken,
    marketplaceIds,
    userId,
    baseURI,
    country,
    region
  );

  if (result && result.success === false && result.message === 'Error in generating the report') {
    return res.status(502).json(
      new ApiResponse(
        502,
        result,
        'Restock Inventory Recommendations report returned "Error in generating the report"'
      )
    );
  }

  return res.status(200).json(
    new ApiResponse(200, result, 'Restock Inventory Recommendations report executed successfully')
  );
});

/**
 * POST /api/test/inventory/planning
 * 
 * Tests GET_FBA_INVENTORY_PLANNING_DATA report with csv-parse TSV parsing
 * This report uses the new csv-parse library for more robust TSV handling
 */
const testFbaInventoryPlanningReport = asyncHandler(async (req, res) => {
  const { userId, region, country } = validateBody(req);

  logger.info('Test FBA inventory planning report triggered (csv-parse)', {
    userId,
    region,
    country
  });

  const { accessToken, marketplaceIds, baseURI } = await resolveSpApiContext(
    userId,
    region,
    country
  );

  const startTime = Date.now();
  
  const result = await getFbaInventoryPlanningReport(
    accessToken,
    marketplaceIds,
    userId,
    baseURI,
    country,
    region
  );

  const duration = Date.now() - startTime;

  if (result && result.success === false) {
    return res.status(502).json(
      new ApiResponse(
        502,
        { ...result, durationMs: duration },
        `FBA Inventory Planning report failed: ${result.message || 'Unknown error'}`
      )
    );
  }

  if (!result) {
    return res.status(502).json(
      new ApiResponse(
        502,
        { durationMs: duration },
        'FBA Inventory Planning report returned null/false'
      )
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200, 
      { 
        recordCount: result.data ? result.data.length : 0,
        durationMs: duration,
        data: result
      }, 
      'FBA Inventory Planning report executed successfully (csv-parse)'
    )
  );
});

module.exports = {
  testStrandedInventoryReport,
  testInboundNonComplianceReport,
  testRestockInventoryReport,
  testFbaInventoryPlanningReport
};


