/**
 * MCPSalesAndTrafficIntegration.js
 * 
 * Service for fetching sales and traffic data from Amazon Data Kiosk API
 * This provides accurate TOTAL SALES and DATE-WISE SALES data.
 * 
 * IMPORTANT: Use this for Total Sales and Date-wise Sales,
 * Use Economics API for Gross Profit, Fees, and ASIN breakdown.
 */

const { buildSalesAndTrafficByDateQuery } = require('./QueryBuilderService.js');
const { 
    createQueryWithRefreshToken, 
    waitForQueryCompletionWithRefreshToken,
    downloadDocument 
} = require('./DataKioskService.js');
const logger = require('../../utils/Logger.js');

/**
 * Fetch sales and traffic data by date from MCP Data Kiosk API
 * @param {string} refreshToken - SP-API refresh token
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} country - Country/Marketplace code (US, CA, UK, etc.)
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Result with success status and data
 */
async function fetchSalesAndTrafficByDate(refreshToken, region, country, startDate, endDate) {
    logger.info('Starting MCP Sales and Traffic data fetch', { 
        region, 
        country,
        startDate,
        endDate
    });

    try {
        if (!refreshToken) {
            logger.error('[MCP Sales] No refresh token provided', { region, country });
            return {
                success: false,
                error: 'Refresh token not available',
                data: null
            };
        }

        // Build the GraphQL query for sales and traffic data (DAY granularity)
        const graphqlQuery = buildSalesAndTrafficByDateQuery({
            startDate: startDate,
            endDate: endDate,
            granularity: 'DAY',
            marketplace: country,
            includeB2B: false
        });

        logger.info('Creating Sales and Traffic query', { region });

        // Create the query using MCP Data Kiosk API
        const queryResult = await createQueryWithRefreshToken(refreshToken, region, graphqlQuery);
        
        if (!queryResult || !queryResult.queryId) {
            logger.error('Failed to create Sales and Traffic query', { queryResult });
            return {
                success: false,
                error: 'Failed to create Data Kiosk query',
                data: null
            };
        }

        const queryId = queryResult.queryId;
        logger.info('Sales and Traffic query created successfully', { queryId });

        // Wait for query to complete (poll every 10 seconds)
        const documentDetails = await waitForQueryCompletionWithRefreshToken(
            refreshToken, 
            region, 
            queryId, 
            10000
        );

        // Check if query completed but has no document (no data)
        if (documentDetails.hasDocument === false) {
            logger.warn('Sales query completed but no data available', { queryId });
            return {
                success: true,
                data: {
                    totalSales: 0,
                    datewiseSales: [],
                    currencyCode: 'USD'
                },
                message: 'Query completed but no data was available for the date range'
            };
        }

        // Download the document content
        const documentUrl = documentDetails.documentUrl || documentDetails.url;
        if (!documentUrl) {
            logger.error('No document URL in query result', { documentDetails });
            return {
                success: false,
                error: 'Failed to get document URL from completed query',
                data: null
            };
        }

        logger.info('Downloading Sales and Traffic document', { hasUrl: !!documentUrl });
        const documentContent = await downloadDocument(documentUrl);
        
        if (!documentContent || documentContent.trim() === '') {
            logger.warn('Downloaded document is empty', { queryId });
            return {
                success: true,
                data: {
                    totalSales: 0,
                    datewiseSales: [],
                    currencyCode: 'USD'
                },
                message: 'Document downloaded but was empty'
            };
        }

        // Parse and calculate metrics from the document
        const metrics = calculateSalesMetrics(documentContent, startDate, endDate, country);

        logger.info('Sales and Traffic metrics calculated', { 
            totalSales: metrics.totalSales,
            datewiseSalesCount: metrics.datewiseSales.length
        });

        return {
            success: true,
            data: metrics,
            message: 'Sales and Traffic data fetched successfully'
        };

    } catch (error) {
        logger.error('Error in MCP Sales and Traffic data fetch', {
            region,
            country,
            error: error.message,
            stack: error.stack
        });

        return {
            success: false,
            error: error.message || 'Unknown error in MCP sales fetch',
            data: null
        };
    }
}

/**
 * Calculate sales metrics from JSONL document
 * @param {string} documentContent - JSONL document content
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @param {string} marketplace - Marketplace code
 * @returns {Object} Calculated sales metrics
 */
function calculateSalesMetrics(documentContent, startDate, endDate, marketplace) {
    // Parse JSONL data
    const lines = documentContent.trim().split('\n').filter(line => line.trim());
    const data = lines.map(line => JSON.parse(line));
    
    logger.info(`Processing Sales and Traffic JSONL`, { totalLines: data.length });

    let totalSales = 0;
    let totalUnitsOrdered = 0;
    let currencyCode = 'USD';
    const datewiseSales = [];

    data.forEach(item => {
        const orderedSales = parseFloat(item.sales?.orderedProductSales?.amount || 0);
        const unitsOrdered = parseFloat(item.sales?.unitsOrdered || 0);
        
        // Get currency code
        if (item.sales?.orderedProductSales?.currencyCode) {
            currencyCode = item.sales.orderedProductSales.currencyCode;
        }

        totalSales += orderedSales;
        totalUnitsOrdered += unitsOrdered;

        // Add datewise entry
        datewiseSales.push({
            date: item.startDate,
            sales: {
                amount: parseFloat(orderedSales.toFixed(2)),
                currencyCode: currencyCode
            },
            unitsOrdered: unitsOrdered,
            sessions: item.traffic?.sessions || 0,
            pageViews: item.traffic?.pageViews || 0,
            buyBoxPercentage: item.traffic?.buyBoxPercentage || 0,
            unitSessionPercentage: item.traffic?.unitSessionPercentage || 0
        });
    });

    // Sort by date
    datewiseSales.sort((a, b) => a.date.localeCompare(b.date));

    return {
        dateRange: {
            startDate,
            endDate
        },
        marketplace,
        totalSales: {
            amount: parseFloat(totalSales.toFixed(2)),
            currencyCode
        },
        totalUnitsOrdered,
        datewiseSales,
        currencyCode
    };
}

module.exports = {
    fetchSalesAndTrafficByDate,
    calculateSalesMetrics
};

