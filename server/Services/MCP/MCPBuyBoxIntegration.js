/**
 * MCPBuyBoxIntegration.js
 * 
 * Service for fetching buybox data from Amazon Data Kiosk API
 * and storing calculated metrics in the database.
 */

const { buildSalesAndTrafficByAsinQuery } = require('./QueryBuilderService.js');
const {
    createQueryWithRefreshToken,
    waitForQueryCompletionWithRefreshToken,
    downloadDocument
} = require('./DataKioskService.js');
const { calculateBuyBoxMetrics } = require('../Calculations/BuyBoxCalculation.js');
const { saveBuyBoxData, getLatestBuyBoxData } = require('./BuyBoxService.js');
const logger = require('../../utils/Logger.js');
const LoggingHelper = require('../../utils/LoggingHelper.js');

/**
 * Fetch buybox data from MCP Data Kiosk API and store in database
 * @param {string} userId - User ID
 * @param {string} refreshToken - SP-API refresh token
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} country - Country/Marketplace code (US, CA, UK, etc.)
 * @param {string} startDate - Start date (YYYY-MM-DD), defaults to 30 days ago
 * @param {string} endDate - End date (YYYY-MM-DD), defaults to today
 * @returns {Promise<Object>} Result with success status and data
 */
async function fetchAndStoreBuyBoxData(userId, refreshToken, region, country, startDate = null, endDate = null) {
    logger.info('Starting MCP BuyBox data fetch', { userId, region, country, startDate, endDate });

    try {
        if (!refreshToken) {
            logger.warn('No refresh token provided for MCP BuyBox fetch', { userId, region, country });
            return {
                success: false,
                error: 'Refresh token not available',
                data: null
            };
        }

        // Validate region and country combination
        const { REGION_VALID_MARKETPLACES } = require('./constants.js');
        const validMarketplaces = REGION_VALID_MARKETPLACES[region] || [];
        if (!validMarketplaces.includes(country)) {
            logger.warn('Invalid country for region in MCP BuyBox fetch', { region, country, validMarketplaces });
            return {
                success: false,
                error: `Invalid country ${country} for region ${region}. Valid countries: ${validMarketplaces.join(', ')}`,
                data: null
            };
        }

        // Calculate date range if not provided (default to last 30 days ending yesterday)
        // Amazon data has a 24-hour delay, so we fetch up to yesterday
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1); // Yesterday
        const defaultEndDate = endDate || yesterday.toISOString().split('T')[0];
        const defaultStartDate = startDate || (() => {
            const start = new Date(yesterday);
            start.setDate(start.getDate() - 30); // 30 days before yesterday
            return start.toISOString().split('T')[0];
        })();

        logger.info('Building BuyBox query', {
            startDate: defaultStartDate,
            endDate: defaultEndDate,
            marketplace: country,
            granularity: 'CHILD'
        });

        // Build GraphQL query for buybox data (using sales and traffic by ASIN)
        const graphqlQuery = buildSalesAndTrafficByAsinQuery({
            startDate: defaultStartDate,
            endDate: defaultEndDate,
            granularity: 'CHILD', // Use CHILD to get individual product variations
            marketplace: country,
            includeB2B: false
        });

        logger.info('BuyBox query built', { queryLength: graphqlQuery.length });

        // Create query via Data Kiosk API
        let queryResult;
        let queryId;
        try {
            queryResult = await createQueryWithRefreshToken(
                refreshToken,
                region,
                graphqlQuery
            );

            // Extract queryId from response (handle different response structures)
            queryId = queryResult.queryId || queryResult.data?.queryId || queryResult.id;

            if (!queryId) {
                const errorMsg = 'Query created but no queryId returned in response';
                logger.error('Query created but no queryId found in response', {
                    queryResult: queryResult,
                    userId,
                    region,
                    country,
                    responseKeys: Object.keys(queryResult || {})
                });
                
                // Log to MongoDB for tracking
                await LoggingHelper.logStandaloneError({
                    userId,
                    region,
                    country,
                    functionName: 'fetchAndStoreBuyBoxData',
                    error: errorMsg,
                    source: 'MCP_BUYBOX',
                    additionalData: { step: 'create_query_no_id' }
                });
                
                return {
                    success: false,
                    error: errorMsg,
                    errorDetails: queryResult,
                    data: null
                };
            }
        } catch (createError) {
            logger.error('Exception thrown while creating BuyBox query', {
                error: createError.message,
                statusCode: createError.statusCode,
                stack: createError.stack,
                userId,
                region,
                country,
                queryPreview: graphqlQuery.substring(0, 200),
                fullError: createError
            });
            
            // Log to MongoDB for tracking
            await LoggingHelper.logStandaloneError({
                userId,
                region,
                country,
                functionName: 'fetchAndStoreBuyBoxData',
                error: createError,
                source: 'MCP_BUYBOX',
                additionalData: { 
                    step: 'create_query_exception',
                    tokenRefreshNeeded: createError.message?.includes('refresh_token') || createError.message?.includes('invalid grant')
                }
            });
            
            return {
                success: false,
                error: createError.message || `Exception creating query: ${createError.toString()}`,
                statusCode: createError.statusCode || 500,
                data: null
            };
        }
        logger.info('BuyBox query created', { queryId });

        // Wait for query completion
        let waitResult;
        try {
            waitResult = await waitForQueryCompletionWithRefreshToken(
                refreshToken,
                region,
                queryId,
                10000 // poll interval in milliseconds
            );
        } catch (waitError) {
            logger.error('Exception while waiting for BuyBox query completion', {
                queryId,
                error: waitError.message,
                statusCode: waitError.statusCode,
                stack: waitError.stack,
                userId,
                region,
                country
            });
            
            // Log to MongoDB for tracking
            await LoggingHelper.logStandaloneError({
                userId,
                region,
                country,
                functionName: 'fetchAndStoreBuyBoxData',
                error: waitError,
                source: 'MCP_BUYBOX',
                additionalData: { 
                    step: 'wait_query_completion',
                    queryId,
                    tokenRefreshNeeded: waitError.message?.includes('refresh_token') || waitError.message?.includes('invalid grant')
                }
            });
            
            return {
                success: false,
                error: waitError.message || 'Query failed or timed out',
                statusCode: waitError.statusCode || 500,
                data: null,
                queryId
            };
        }

        // Check if query completed but has no document (no data)
        if (waitResult && waitResult.hasDocument === false) {
            logger.warn('BuyBox query completed but no data available', {
                queryId,
                message: waitResult.message
            });

            // Return empty buybox structure
            const emptyBuyBox = {
                dateRange: { startDate: defaultStartDate, endDate: defaultEndDate },
                totalProducts: 0,
                productsWithBuyBox: 0,
                productsWithoutBuyBox: 0,
                productsWithLowBuyBox: 0,
                asinBuyBoxData: []
            };

            // Save empty buybox data to database
            const savedData = await saveBuyBoxData(
                userId,
                region,
                country,
                emptyBuyBox,
                queryId,
                null
            );

            return {
                success: true,
                data: {
                    buyBoxDataId: savedData._id,
                    totalProducts: 0,
                    productsWithBuyBox: 0,
                    productsWithoutBuyBox: 0,
                    productsWithLowBuyBox: 0,
                    dateRange: savedData.dateRange
                },
                message: 'Query completed but no data was available for the date range',
                queryId
            };
        }

        if (!waitResult) {
            const errorMsg = 'Query wait returned no result';
            logger.error('BuyBox query wait returned null/undefined', {
                queryId,
                userId,
                region,
                country
            });
            
            // Log to MongoDB for tracking
            await LoggingHelper.logStandaloneError({
                userId,
                region,
                country,
                functionName: 'fetchAndStoreBuyBoxData',
                error: errorMsg,
                source: 'MCP_BUYBOX',
                additionalData: { step: 'wait_result_null', queryId }
            });
            
            return {
                success: false,
                error: errorMsg,
                data: null,
                queryId
            };
        }

        // Extract documentId from response (handle different response structures)
        // waitResult is the document details object returned from waitForQueryCompletionWithRefreshToken
        const documentId = waitResult.documentId || waitResult.id || waitResult.dataDocumentId;

        if (!documentId) {
            logger.warn('No document ID in waitResult, using queryId as fallback', {
                queryId,
                waitResultKeys: Object.keys(waitResult || {}),
                userId,
                region,
                country
            });
        }

        logger.info('BuyBox query completed', {
            queryId,
            documentId: documentId || queryId,
            hasUrl: !!waitResult.url
        });

        // waitResult already contains document details with URL
        // Extract document URL from waitResult
        const documentUrl = waitResult.url || waitResult.documentUrl;

        if (!documentUrl) {
            const errorMsg = 'Failed to get document URL from completed query';
            logger.error('No document URL in BuyBox query result', {
                waitResult: waitResult,
                documentId,
                waitResultKeys: Object.keys(waitResult || {})
            });
            
            // Log to MongoDB for tracking
            await LoggingHelper.logStandaloneError({
                userId,
                region,
                country,
                functionName: 'fetchAndStoreBuyBoxData',
                error: errorMsg,
                source: 'MCP_BUYBOX',
                additionalData: { step: 'get_document_url', queryId, documentId }
            });
            
            return {
                success: false,
                error: errorMsg,
                errorDetails: waitResult,
                data: null,
                queryId,
                documentId
            };
        }
        const documentContent = await downloadDocument(documentUrl);

        if (!documentContent || documentContent.trim() === '') {
            logger.warn('Downloaded BuyBox document is empty', { queryId, documentId });

            // Return empty buybox structure
            const emptyBuyBox = {
                dateRange: { startDate: defaultStartDate, endDate: defaultEndDate },
                totalProducts: 0,
                productsWithBuyBox: 0,
                productsWithoutBuyBox: 0,
                productsWithLowBuyBox: 0,
                asinBuyBoxData: []
            };

            const savedData = await saveBuyBoxData(
                userId,
                region,
                country,
                emptyBuyBox,
                queryId,
                documentId
            );

            return {
                success: true,
                data: {
                    buyBoxDataId: savedData._id,
                    totalProducts: 0,
                    productsWithBuyBox: 0,
                    productsWithoutBuyBox: 0,
                    productsWithLowBuyBox: 0,
                    dateRange: savedData.dateRange
                },
                message: 'Document downloaded but was empty',
                queryId,
                documentId
            };
        }

        logger.info('BuyBox document downloaded', {
            documentId,
            contentLength: documentContent.length
        });

        // Calculate buybox metrics from document content
        const buyBoxMetrics = calculateBuyBoxMetrics(
            documentContent,
            defaultStartDate,
            defaultEndDate,
            country
        );

        logger.info('BuyBox metrics calculated', {
            totalProducts: buyBoxMetrics.totalProducts,
            productsWithoutBuyBox: buyBoxMetrics.productsWithoutBuyBox,
            productsWithLowBuyBox: buyBoxMetrics.productsWithLowBuyBox
        });

        // Save to database
        const savedData = await saveBuyBoxData(
            userId,
            region,
            country,
            buyBoxMetrics,
            queryId,
            documentId
        );

        logger.info('BuyBox data saved successfully', {
            buyBoxDataId: savedData._id,
            userId,
            region,
            country,
            productsWithoutBuyBox: savedData.productsWithoutBuyBox
        });

        return {
            success: true,
            data: {
                buyBoxDataId: savedData._id,
                totalProducts: savedData.totalProducts,
                productsWithBuyBox: savedData.productsWithBuyBox,
                productsWithoutBuyBox: savedData.productsWithoutBuyBox,
                productsWithLowBuyBox: savedData.productsWithLowBuyBox,
                dateRange: savedData.dateRange
            },
            queryId,
            documentId
        };

    } catch (error) {
        logger.error('Error in fetchAndStoreBuyBoxData', {
            userId,
            region,
            country,
            error: error.message,
            stack: error.stack
        });
        
        // Log to MongoDB for tracking
        await LoggingHelper.logStandaloneError({
            userId,
            region,
            country,
            functionName: 'fetchAndStoreBuyBoxData',
            error,
            source: 'MCP_BUYBOX',
            additionalData: { 
                step: 'unexpected_error',
                tokenRefreshNeeded: error.message?.includes('refresh_token') || error.message?.includes('invalid grant')
            }
        });
        
        return {
            success: false,
            error: error.message || 'Unknown error occurred',
            data: null
        };
    }
}

/**
 * Get buybox data from database
 * @param {string} userId - User ID
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} country - Country/Marketplace code
 * @returns {Promise<Object|null>} Latest buybox data or null
 */
async function getBuyBoxData(userId, region, country) {
    try {
        const buyBoxData = await getLatestBuyBoxData(userId, region, country);
        return buyBoxData;
    } catch (error) {
        logger.error('Error getting BuyBox data from database', {
            userId,
            region,
            country,
            error: error.message
        });
        
        // Log to MongoDB for tracking
        await LoggingHelper.logStandaloneError({
            userId,
            region,
            country,
            functionName: 'getBuyBoxData',
            error,
            source: 'MCP_BUYBOX',
            additionalData: { step: 'get_buybox_data' }
        });
        
        return null;
    }
}

module.exports = {
    fetchAndStoreBuyBoxData,
    getBuyBoxData
};

