/**
 * DataKioskController.js
 * 
 * Controller for Data Kiosk API endpoints
 */

const asyncHandler = require('../../utils/AsyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const { ApiError } = require('../../utils/ApiError');
const DataKioskService = require('../../Services/MCP/DataKioskService');
const QueryBuilderService = require('../../Services/MCP/QueryBuilderService');
const { calculateEconomicsMetrics } = require('../../Services/Calculations/EconomicsMetricsCalculation');
const EconomicsMetricsService = require('../../Services/MCP/EconomicsMetricsService');
const logger = require('../../utils/Logger');

/**
 * List all queries
 * GET /app/mcp/queries
 */
const listQueries = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const { processingStatus, pageSize, createdSince } = req.query;

    const filters = {
        ...(processingStatus && { processingStatus }),
        ...(pageSize && { pageSize: parseInt(pageSize, 10) }),
        ...(createdSince && { createdSince })
    };

    const result = await DataKioskService.listQueries(userId, region, filters);

    res.status(200).json(
        new ApiResponse(200, result, 'Queries retrieved successfully')
    );
});

/**
 * Create a new query
 * POST /app/mcp/queries
 */
const createQuery = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const { graphqlQuery } = req.body;

    if (!graphqlQuery) {
        throw new ApiError(400, 'GraphQL query is required');
    }

    const result = await DataKioskService.createQuery(userId, region, graphqlQuery);

    res.status(201).json(
        new ApiResponse(201, result, 'Query created successfully')
    );
});

/**
 * Check query status
 * GET /app/mcp/queries/:queryId/status
 */
const checkQueryStatus = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const { queryId } = req.params;

    const result = await DataKioskService.checkQueryStatus(userId, region, queryId);

    res.status(200).json(
        new ApiResponse(200, result, 'Query status retrieved successfully')
    );
});

/**
 * Cancel a query
 * DELETE /app/mcp/queries/:queryId
 */
const cancelQuery = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const { queryId } = req.params;

    const result = await DataKioskService.cancelQuery(userId, region, queryId);

    res.status(200).json(
        new ApiResponse(200, result, 'Query cancelled successfully')
    );
});

/**
 * Get document details
 * GET /app/mcp/documents/:documentId
 */
const getDocumentDetails = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const { documentId } = req.params;

    const result = await DataKioskService.getDocumentDetails(userId, region, documentId);

    res.status(200).json(
        new ApiResponse(200, result, 'Document details retrieved successfully')
    );
});

/**
 * Download document
 * GET /app/mcp/documents/:documentId/download
 */
const downloadDocument = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const { documentId } = req.params;

    // First get document details to get the download URL
    const documentDetails = await DataKioskService.getDocumentDetails(userId, region, documentId);
    
    // Extract URL from document details - handle different possible field names
    const documentUrl = documentDetails.url || 
                       documentDetails.documentUrl || 
                       documentDetails.downloadUrl ||
                       (documentDetails.data && documentDetails.data.url) ||
                       (documentDetails.data && documentDetails.data.documentUrl);
    
    if (!documentUrl) {
        logger.error('Download URL not found in document details', {
            documentDetails,
            availableKeys: documentDetails ? Object.keys(documentDetails) : 'none'
        });
        throw new ApiError(404, `Download URL not found for this document. Available fields: ${documentDetails ? Object.keys(documentDetails).join(', ') : 'none'}`);
    }

    // Download the document content
    const documentContent = await DataKioskService.downloadDocument(documentUrl);

    // Return as JSONL (JSON Lines format)
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.status(200).send(documentContent);
});

/**
 * Build and execute Sales and Traffic query by date
 * POST /app/mcp/queries/sales-traffic/date
 */
const createSalesAndTrafficByDateQuery = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const { startDate, endDate, granularity, marketplace, includeB2B } = req.body;

    // Validate required fields
    if (!startDate || !endDate || !granularity || !marketplace) {
        throw new ApiError(400, 'startDate, endDate, granularity, and marketplace are required');
    }

    // Build the GraphQL query
    const graphqlQuery = QueryBuilderService.buildSalesAndTrafficByDateQuery({
        startDate,
        endDate,
        granularity,
        marketplace,
        includeB2B: includeB2B || false
    });

    // Create the query
    const result = await DataKioskService.createQuery(userId, region, graphqlQuery);

    res.status(201).json(
        new ApiResponse(201, result, 'Sales and Traffic query created successfully')
    );
});

/**
 * Build and execute Sales and Traffic query by ASIN
 * POST /app/mcp/queries/sales-traffic/asin
 */
const createSalesAndTrafficByAsinQuery = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const { startDate, endDate, granularity, marketplace, includeB2B } = req.body;

    // Validate required fields
    if (!startDate || !endDate || !granularity || !marketplace) {
        throw new ApiError(400, 'startDate, endDate, granularity, and marketplace are required');
    }

    // Build the GraphQL query
    const graphqlQuery = QueryBuilderService.buildSalesAndTrafficByAsinQuery({
        startDate,
        endDate,
        granularity,
        marketplace,
        includeB2B: includeB2B || false
    });

    // Create the query
    const result = await DataKioskService.createQuery(userId, region, graphqlQuery);

    res.status(201).json(
        new ApiResponse(201, result, 'Sales and Traffic by ASIN query created successfully')
    );
});

/**
 * Build and execute Economics query
 * POST /app/mcp/queries/economics
 */
const createEconomicsQuery = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const {
        startDate,
        endDate,
        dateGranularity,
        productIdGranularity,
        marketplace,
        includeFeeComponents,
        feeTypesForComponents
    } = req.body;

    // Validate required fields
    if (!startDate || !endDate || !dateGranularity || !productIdGranularity || !marketplace) {
        throw new ApiError(400, 'startDate, endDate, dateGranularity, productIdGranularity, and marketplace are required');
    }

    // Build the GraphQL query
    const graphqlQuery = QueryBuilderService.buildEconomicsQuery({
        startDate,
        endDate,
        dateGranularity,
        productIdGranularity,
        marketplace,
        includeFeeComponents: includeFeeComponents || false,
        feeTypesForComponents: feeTypesForComponents || []
    });

    // Create the query
    const result = await DataKioskService.createQuery(userId, region, graphqlQuery);

    res.status(201).json(
        new ApiResponse(201, result, 'Economics query created successfully')
    );
});

/**
 * Wait for query completion and return document
 * POST /app/mcp/queries/:queryId/wait
 * Note: No timeout - continues polling until query completes (DONE, FATAL, or CANCELLED)
 */
const waitForQueryCompletion = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const { queryId } = req.params;
    const { pollInterval } = req.body;

    logger.info(`Waiting for query completion via endpoint`, {
        userId,
        region,
        queryId,
        pollInterval: pollInterval ? `${parseInt(pollInterval, 10) / 1000}s` : '10s (default)'
    });

    const documentDetails = await DataKioskService.waitForQueryCompletion(
        userId,
        region,
        queryId,
        pollInterval ? parseInt(pollInterval, 10) : undefined
    );

    logger.info(`Query completed successfully via endpoint`, {
        queryId,
        hasDocument: !!documentDetails
    });

    res.status(200).json(
        new ApiResponse(200, documentDetails, 'Query completed and document ready')
    );
});

/**
 * Get economics metrics summary
 * POST /app/mcp/economics/metrics
 * Fetches and processes economics data to return:
 * - Gross Profit
 * - PPC Spent
 * - FBA Fees
 * - Storage Fees
 * - Refunds
 * 
 * Accepts either:
 * - userId + region (from auth middleware) OR
 * - refreshToken + region (in request body)
 */
const getEconomicsMetrics = asyncHandler(async (req, res) => {
    const {
        startDate,
        endDate,
        marketplace = 'US',
        refreshToken,
        region: bodyRegion,
        userId: bodyUserId
    } = req.body;

    // Validate required fields
    if (!startDate || !endDate) {
        throw new ApiError(400, 'startDate and endDate are required');
    }

    // Determine if using refreshToken or userId-based auth
    const useRefreshToken = !!refreshToken;
    // Accept userId from request body (for refresh token auth) or from auth middleware
    const userId = bodyUserId || req.userId;
    const region = bodyRegion || req.region;

    // Validate authentication method
    if (!useRefreshToken && !userId) {
        throw new ApiError(400, 'Either refreshToken (in body) or authenticated user session (via cookies) is required');
    }

    if (!region) {
        throw new ApiError(400, 'region is required (either in body or via location token)');
    }

    // Validate region format
    const validRegions = ['NA', 'EU', 'FE'];
    if (!validRegions.includes(region)) {
        throw new ApiError(400, `Invalid region. Must be one of: ${validRegions.join(', ')}`);
    }

    // Additional validation for refresh token
    if (useRefreshToken) {
        if (!refreshToken || typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
            throw new ApiError(400, 'refreshToken must be a non-empty string');
        }
    }

    // Build comprehensive economics query
    const { MARKETPLACES, REGION_DEFAULT_MARKETPLACES, REGION_VALID_MARKETPLACES } = require('../../Services/MCP/constants.js');
    
    // Determine the correct marketplace for the region
    let effectiveMarketplace = marketplace;
    
    // If marketplace is 'US' (default) but region is not NA, use region's default marketplace
    if (marketplace === 'US' && region !== 'NA') {
        effectiveMarketplace = REGION_DEFAULT_MARKETPLACES[region] || marketplace;
        logger.info(`Marketplace auto-adjusted for region`, { 
            originalMarketplace: marketplace, 
            effectiveMarketplace, 
            region 
        });
    }
    
    // Validate that marketplace is valid for the region
    const validMarketplaces = REGION_VALID_MARKETPLACES[region] || [];
    if (!validMarketplaces.includes(effectiveMarketplace)) {
        logger.warn(`Marketplace ${effectiveMarketplace} may not be valid for region ${region}. Valid marketplaces: ${validMarketplaces.join(', ')}`);
    }
    
    const marketplaceId = MARKETPLACES[effectiveMarketplace] || MARKETPLACES.US;
    
    // Use effectiveMarketplace as the country (they are the same: US, UK, DE, JP, etc.)
    const country = effectiveMarketplace;
    
    logger.info('Using marketplace for economics query', { 
        region, 
        requestedMarketplace: marketplace,
        effectiveMarketplace,
        country,
        marketplaceId 
    });

    const graphqlQuery = `
query EconomicsQuery {
  analytics_economics_2024_03_15 {
    economics(
      startDate: "${startDate}"
      endDate: "${endDate}"
      aggregateBy: {
        date: DAY
        productId: PARENT_ASIN
      }
      marketplaceIds: ["${marketplaceId}"]
    ) {
      startDate
      endDate
      marketplaceId
      parentAsin
      
      # Sales data
      sales {
        orderedProductSales {
          amount
          currencyCode
        }
        netProductSales {
          amount
          currencyCode
        }
        averageSellingPrice {
          amount
          currencyCode
        }
        unitsOrdered
        unitsRefunded
        netUnitsSold
      }
      
      # Fees data - includes FBA fees and storage fees
      fees {
        feeTypeName
        charges {
          aggregatedDetail {
            amount {
              amount
              currencyCode
            }
            totalAmount {
              amount
              currencyCode
            }
            quantity
          }
        }
      }
      
      # Ads data (PPC Spent)
      ads {
        adTypeName
        charge {
          amount {
            amount
            currencyCode
          }
          totalAmount {
            amount
            currencyCode
          }
        }
      }
      
      # Cost data
      cost {
        costOfGoodsSold {
          amount
          currencyCode
        }
      }
      
      # Net proceeds
      netProceeds {
        total {
          amount
          currencyCode
        }
      }
    }
  }
}`.trim();

    const logIdentifier = useRefreshToken ? 'refreshToken' : `user ${userId}`;
    logger.info(`Creating economics query for ${logIdentifier}, date range: ${startDate} to ${endDate}`);

    // Create the query
    const queryResult = useRefreshToken
        ? await DataKioskService.createQueryWithRefreshToken(refreshToken, region, graphqlQuery)
        : await DataKioskService.createQuery(userId, region, graphqlQuery);
    const queryId = queryResult.queryId;

    logger.info(`Query created with ID: ${queryId}, waiting for completion...`);

    // Wait for query completion (no timeout - continues until DONE, FATAL, or CANCELLED)
    logger.info(`Waiting for query to complete (no timeout)`, {
        queryId,
        useRefreshToken,
        pollInterval: '10s'
    });
    
    const documentDetails = useRefreshToken
        ? await DataKioskService.waitForQueryCompletionWithRefreshToken(
            refreshToken,
            region,
            queryId,
            10000   // Poll every 10 seconds
        )
        : await DataKioskService.waitForQueryCompletion(
            userId,
            region,
            queryId,
            10000   // Poll every 10 seconds
        );

    logger.info('Query completed, checking for document...', {
        documentDetails,
        hasDocument: documentDetails?.hasDocument !== false,
        hasUrl: !!documentDetails?.url,
        url: documentDetails?.url || 'not available',
        allKeys: documentDetails ? Object.keys(documentDetails) : 'no documentDetails'
    });

    // Check if query completed but no document was generated (no data matches query)
    if (documentDetails.hasDocument === false) {
        logger.info('Query completed but no document generated - no data matches query criteria', {
            queryId,
            message: documentDetails.message
        });
        
        // Return empty metrics with a message
        const emptyMetrics = {
            dateRange: {
                startDate,
                endDate
            },
            marketplace: effectiveMarketplace,
            region,
            totalSales: {
                amount: 0,
                currencyCode: 'USD'
            },
            grossProfit: {
                amount: 0,
                currencyCode: 'USD'
            },
            ppcSpent: {
                amount: 0,
                currencyCode: 'USD'
            },
            fbaFees: {
                amount: 0,
                currencyCode: 'USD'
            },
            storageFees: {
                amount: 0,
                currencyCode: 'USD'
            },
            refunds: {
                amount: 0,
                currencyCode: 'USD'
            },
            datewiseSales: [],
            datewiseGrossProfit: [],
            asinWiseSales: [],
            message: documentDetails.message || `No data matches the query criteria for the specified date range and marketplace (${effectiveMarketplace}).`
        };

        return res.status(200).json(
            new ApiResponse(200, emptyMetrics, 'Query completed but no data found for the specified criteria')
        );
    }

    // Extract URL and document ID from document details - handle different possible field names
    const documentUrl = documentDetails.url || 
                       documentDetails.downloadUrl || 
                       documentDetails.documentUrl ||
                       (documentDetails.data && documentDetails.data.url) ||
                       (documentDetails.data && documentDetails.data.downloadUrl);
    
    const documentId = documentDetails.documentId || 
                      documentDetails.dataDocumentId ||
                      (documentDetails.data && documentDetails.data.documentId) ||
                      (documentDetails.data && documentDetails.data.dataDocumentId) ||
                      queryId; // Fallback to queryId if documentId not available

    // Validate document details
    if (!documentDetails || !documentUrl) {
        logger.error('Document details missing or invalid', {
            documentDetails,
            hasUrl: !!documentDetails?.url,
            allKeys: documentDetails ? Object.keys(documentDetails) : 'no documentDetails'
        });
        throw new ApiError(500, `Document URL not found in document details. Available fields: ${documentDetails ? Object.keys(documentDetails).join(', ') : 'none'}`);
    }

    logger.info('Downloading document from URL', {
        urlLength: documentUrl.length,
        urlPreview: documentUrl.substring(0, 100) + '...'
    });

    // Download the document
    const documentContent = await DataKioskService.downloadDocument(documentUrl);

    // Calculate economics metrics using the calculation service
    logger.info('Calculating economics metrics from document content');
    const metrics = calculateEconomicsMetrics(documentContent, startDate, endDate, effectiveMarketplace);
    
    // Add region to metrics
    metrics.region = region;
    
    logger.info('Economics metrics calculated successfully');

    // Save to database if userId is available
    if (userId) {
        try {
            logger.info('Saving economics metrics to database', {
                userId,
                region,
                country,
                marketplace: effectiveMarketplace
            });
            
            const savedMetrics = await EconomicsMetricsService.saveEconomicsMetrics(
                userId,
                region,
                country,
                metrics,
                queryId,
                documentId
            );
            
            logger.info('Economics metrics saved to database successfully', {
                metricsId: savedMetrics._id,
                userId,
                region,
                country
            });
            
            // Add saved metrics ID to response
            metrics.savedToDatabase = true;
            metrics.metricsId = savedMetrics._id;
        } catch (saveError) {
            // Log error but don't fail the request - metrics are still returned
            logger.error('Failed to save economics metrics to database', {
                userId,
                region,
                error: saveError.message,
                stack: saveError.stack
            });
            metrics.savedToDatabase = false;
            metrics.saveError = saveError.message;
        }
    } else {
        logger.warn('Skipping database save - no userId provided. Pass userId in request body to save metrics.');
        metrics.savedToDatabase = false;
        metrics.saveNote = 'No userId provided. Pass userId in request body to save metrics to database.';
    }

    res.status(200).json(
        new ApiResponse(200, metrics, 'Economics metrics retrieved successfully')
    );
});

module.exports = {
    listQueries,
    createQuery,
    checkQueryStatus,
    cancelQuery,
    getDocumentDetails,
    downloadDocument,
    createSalesAndTrafficByDateQuery,
    createSalesAndTrafficByAsinQuery,
    createEconomicsQuery,
    waitForQueryCompletion,
    getEconomicsMetrics
};

