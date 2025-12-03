/**
 * MCPEconomicsIntegration.js
 * 
 * Service for fetching economics data from Amazon Data Kiosk API
 * and storing calculated metrics in the database.
 * 
 * This replaces the separate sales/finance API calls with a unified MCP approach.
 */

const { buildEconomicsQuery } = require('./QueryBuilderService.js');
const { 
    createQueryWithRefreshToken, 
    waitForQueryCompletionWithRefreshToken,
    downloadDocument 
} = require('./DataKioskService.js');
const { calculateEconomicsMetrics } = require('../Calculations/EconomicsMetricsCalculation.js');
const { saveEconomicsMetrics, getLatestEconomicsMetrics } = require('./EconomicsMetricsService.js');
const logger = require('../../utils/Logger.js');

/**
 * Fetch economics data from MCP Data Kiosk API and store in database
 * @param {string} userId - User ID
 * @param {string} refreshToken - SP-API refresh token
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} country - Country/Marketplace code (US, CA, UK, etc.)
 * @returns {Promise<Object>} Result with success status and data
 */
async function fetchAndStoreEconomicsData(userId, refreshToken, region, country) {
    logger.info('Starting MCP Economics data fetch', { userId, region, country });

    try {
        if (!refreshToken) {
            logger.warn('No refresh token provided for MCP economics fetch', { userId, region, country });
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
            logger.warn('Invalid country for region in MCP Economics fetch', { region, country, validMarketplaces });
            return {
                success: false,
                error: `Invalid country ${country} for region ${region}. Valid countries: ${validMarketplaces.join(', ')}`,
                data: null
            };
        }

        // Calculate date range (last 30 days)
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);

        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        logger.info('Building economics query', { 
            startDate: startDateStr, 
            endDate: endDateStr, 
            country 
        });

        // Build the GraphQL query for economics data
        const graphqlQuery = buildEconomicsQuery({
            startDate: startDateStr,
            endDate: endDateStr,
            dateGranularity: 'DAY',
            productIdGranularity: 'PARENT_ASIN',
            marketplace: country,
            includeFeeComponents: false
        });

        logger.info('Creating Data Kiosk query', { region });

        // Create the query using MCP Data Kiosk API
        const queryResult = await createQueryWithRefreshToken(refreshToken, region, graphqlQuery);
        
        if (!queryResult || !queryResult.queryId) {
            logger.error('Failed to create Data Kiosk query', { queryResult });
            return {
                success: false,
                error: 'Failed to create Data Kiosk query',
                data: null
            };
        }

        const queryId = queryResult.queryId;
        logger.info('Query created successfully', { queryId });

        // Wait for query to complete (poll every 10 seconds)
        const documentDetails = await waitForQueryCompletionWithRefreshToken(
            refreshToken, 
            region, 
            queryId, 
            10000
        );

        // Check if query completed but has no document (no data)
        if (documentDetails.hasDocument === false) {
            logger.warn('Query completed but no data available', { queryId, message: documentDetails.message });
            
            // Return empty metrics structure
            const emptyMetrics = createEmptyMetrics(startDateStr, endDateStr, country);
            
            // Save empty metrics to database
            const savedMetrics = await saveEconomicsMetrics(
                userId,
                region,
                country,
                emptyMetrics,
                queryId,
                null
            );

            return {
                success: true,
                data: savedMetrics,
                message: 'Query completed but no data was available for the date range'
            };
        }

        if (!documentDetails || !documentDetails.documentUrl) {
            // Check for alternate URL field
            const documentUrl = documentDetails.documentUrl || documentDetails.url;
            
            if (!documentUrl) {
                logger.error('No document URL in query result', { documentDetails });
                return {
                    success: false,
                    error: 'Failed to get document URL from completed query',
                    data: null
                };
            }
        }

        // Download the document content
        const documentUrl = documentDetails.documentUrl || documentDetails.url;
        logger.info('Downloading document', { hasUrl: !!documentUrl });
        
        const documentContent = await downloadDocument(documentUrl);
        
        if (!documentContent || documentContent.trim() === '') {
            logger.warn('Downloaded document is empty', { queryId });
            
            // Return empty metrics structure
            const emptyMetrics = createEmptyMetrics(startDateStr, endDateStr, country);
            
            const savedMetrics = await saveEconomicsMetrics(
                userId,
                region,
                country,
                emptyMetrics,
                queryId,
                documentDetails.documentId
            );

            return {
                success: true,
                data: savedMetrics,
                message: 'Document downloaded but was empty'
            };
        }

        logger.info('Document downloaded, calculating metrics', { 
            contentLength: documentContent.length 
        });

        // Calculate metrics from the document
        const calculatedMetrics = calculateEconomicsMetrics(
            documentContent,
            startDateStr,
            endDateStr,
            country
        );

        logger.info('Metrics calculated', { 
            totalSales: calculatedMetrics.totalSales?.amount,
            grossProfit: calculatedMetrics.grossProfit?.amount,
            ppcSpent: calculatedMetrics.ppcSpent?.amount,
            asinCount: calculatedMetrics.asinWiseSales?.length
        });

        // Save metrics to database
        const savedMetrics = await saveEconomicsMetrics(
            userId,
            region,
            country,
            calculatedMetrics,
            queryId,
            documentDetails.documentId
        );

        logger.info('Economics metrics saved successfully', { 
            metricsId: savedMetrics._id,
            userId,
            region,
            country
        });

        return {
            success: true,
            data: savedMetrics,
            message: 'Economics data fetched and stored successfully'
        };

    } catch (error) {
        logger.error('Error in MCP economics data fetch', {
            userId,
            region,
            country,
            error: error.message,
            stack: error.stack
        });

        // Try to get cached data as fallback
        try {
            logger.info('Attempting to fetch cached EconomicsMetrics data as fallback', { userId, region, country });
            const cachedData = await getLatestEconomicsMetrics(userId, region, country);
            if (cachedData) {
                logger.info('Using cached EconomicsMetrics data', { userId, region, country });
                return {
                    success: true,
                    data: cachedData,
                    message: 'Using cached data due to fetch error',
                    error: null
                };
            }
        } catch (cacheError) {
            logger.warn('Failed to fetch cached EconomicsMetrics data', {
                error: cacheError.message,
                userId,
                region,
                country
            });
        }

        return {
            success: false,
            error: error.message || 'Unknown error in MCP economics fetch',
            data: null
        };
    }
}

/**
 * Create empty metrics structure when no data is available
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @param {string} marketplace - Marketplace code
 * @returns {Object} Empty metrics object
 */
function createEmptyMetrics(startDate, endDate, marketplace) {
    return {
        dateRange: {
            startDate,
            endDate
        },
        marketplace,
        totalSales: { amount: 0, currencyCode: 'USD' },
        grossProfit: { amount: 0, currencyCode: 'USD' },
        ppcSpent: { amount: 0, currencyCode: 'USD' },
        fbaFees: { amount: 0, currencyCode: 'USD' },
        storageFees: { amount: 0, currencyCode: 'USD' },
        refunds: { amount: 0, currencyCode: 'USD' },
        datewiseSales: [],
        datewiseGrossProfit: [],
        asinWiseSales: []
    };
}

/**
 * Get latest economics data for a user
 * Falls back to fetching new data if no cached data exists
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} country - Country/Marketplace code
 * @param {string} refreshToken - Optional refresh token for fetching new data
 * @returns {Promise<Object>} Economics metrics data
 */
async function getEconomicsData(userId, region, country, refreshToken = null) {
    try {
        // First try to get cached data from database
        const cachedMetrics = await getLatestEconomicsMetrics(userId, region, country);
        
        if (cachedMetrics) {
            // Check if data is less than 1 hour old
            const dataAge = Date.now() - new Date(cachedMetrics.updatedAt).getTime();
            const oneHour = 60 * 60 * 1000;
            
            if (dataAge < oneHour) {
                logger.info('Using cached economics data', { 
                    userId, 
                    region, 
                    country,
                    dataAge: Math.round(dataAge / 1000) + 's'
                });
                return {
                    success: true,
                    data: cachedMetrics,
                    source: 'cache'
                };
            }
        }

        // If no cached data or data is old, and we have refresh token, fetch new data
        if (refreshToken) {
            logger.info('Fetching fresh economics data', { userId, region, country });
            return await fetchAndStoreEconomicsData(userId, refreshToken, region, country);
        }

        // Return cached data even if old, or null if no data
        if (cachedMetrics) {
            logger.info('Using stale cached economics data (no refresh token available)', { 
                userId, 
                region, 
                country 
            });
            return {
                success: true,
                data: cachedMetrics,
                source: 'stale_cache'
            };
        }

        return {
            success: false,
            error: 'No economics data available and no refresh token to fetch new data',
            data: null
        };

    } catch (error) {
        logger.error('Error getting economics data', {
            userId,
            region,
            country,
            error: error.message
        });
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

module.exports = {
    fetchAndStoreEconomicsData,
    getEconomicsData,
    createEmptyMetrics
};

