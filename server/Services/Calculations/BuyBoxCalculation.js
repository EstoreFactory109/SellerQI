/**
 * BuyBoxCalculation.js
 * 
 * Service for calculating buybox metrics from Amazon Data Kiosk API JSONL data
 * Processes raw sales and traffic data and calculates:
 * - Total products
 * - Products with buybox (buyBoxPercentage > 0)
 * - Products without buybox (buyBoxPercentage = 0)
 * - Products with low buybox (buyBoxPercentage < 50)
 * - ASIN-wise buybox data
 */

const logger = require('../../utils/Logger');

/**
 * Process buybox data from JSONL format and calculate all metrics
 * @param {string} documentContent - JSONL document content from Data Kiosk API
 * @param {string} startDate - Start date of the query
 * @param {string} endDate - End date of the query
 * @param {string} marketplace - Marketplace code
 * @returns {Object} Calculated buybox metrics with all breakdowns
 */
function calculateBuyBoxMetrics(documentContent, startDate, endDate, marketplace) {
    // Parse JSONL data
    const lines = documentContent.trim().split('\n').filter(line => line.trim());
    logger.info(`Processing BuyBox JSONL document`, {
        totalLines: lines.length,
        startDate,
        endDate,
        marketplace
    });
    
    if (lines.length === 0) {
        logger.warn('No data in BuyBox JSONL document');
        return {
            dateRange: { startDate, endDate },
            totalProducts: 0,
            productsWithBuyBox: 0,
            productsWithoutBuyBox: 0,
            productsWithLowBuyBox: 0,
            asinBuyBoxData: []
        };
    }
    
    const data = lines.map(line => {
        try {
            return JSON.parse(line);
        } catch (error) {
            logger.error('Error parsing JSONL line in BuyBox data', { error: error.message });
            return null;
        }
    }).filter(item => item !== null);
    
    logger.info(`Parsed ${data.length} records from BuyBox JSONL`);

    // Initialize counters
    let totalProducts = 0;
    let productsWithBuyBox = 0;
    let productsWithoutBuyBox = 0;
    let productsWithLowBuyBox = 0;
    let currencyCode = 'USD';
    
    // Data structure for ASIN-wise buybox data
    const asinBuyBoxMap = {}; // { childAsin: { parentAsin, buyBoxPercentage, pageViews, sessions, unitSessionPercentage, sales, unitsOrdered, totalOrderItems } }

    /**
     * Process a single buybox item
     * @param {Object} item - Sales and traffic data item
     */
    const processBuyBoxItem = (item) => {
        // Get currency code from first record
        if (!currencyCode && item.sales?.orderedProductSales?.currencyCode) {
            currencyCode = item.sales.orderedProductSales.currencyCode;
        }

        // Get ASINs
        const childAsin = item.childAsin || item.parentAsin || 'UNKNOWN';
        const parentAsin = item.parentAsin || childAsin;
        
        if (childAsin === 'UNKNOWN') {
            logger.warn('Skipping item with unknown ASIN', { item });
            return;
        }

        // Get buybox percentage
        const buyBoxPercentage = parseFloat(item.traffic?.buyBoxPercentage || 0);
        
        // Get sales data
        const salesAmount = parseFloat(item.sales?.orderedProductSales?.amount || 0);
        const unitsOrdered = parseInt(item.sales?.unitsOrdered || 0, 10);
        const totalOrderItems = parseInt(item.sales?.totalOrderItems || 0, 10);
        
        // Get traffic data
        const pageViews = parseInt(item.traffic?.pageViews || 0, 10);
        const sessions = parseInt(item.traffic?.sessions || 0, 10);
        const unitSessionPercentage = parseFloat(item.traffic?.unitSessionPercentage || 0);

        // Update counters
        totalProducts++;
        
        if (buyBoxPercentage > 0) {
            productsWithBuyBox++;
        } else {
            productsWithoutBuyBox++;
        }
        
        if (buyBoxPercentage < 50 && buyBoxPercentage > 0) {
            productsWithLowBuyBox++;
        }

        // Store or update ASIN-wise data
        // Use childAsin as key to avoid duplicates
        if (!asinBuyBoxMap[childAsin]) {
            asinBuyBoxMap[childAsin] = {
                parentAsin: parentAsin,
                childAsin: childAsin,
                buyBoxPercentage: buyBoxPercentage,
                pageViews: pageViews,
                sessions: sessions,
                unitSessionPercentage: unitSessionPercentage,
                sales: {
                    amount: salesAmount,
                    currencyCode: currencyCode
                },
                unitsOrdered: unitsOrdered,
                totalOrderItems: totalOrderItems
            };
        } else {
            // If ASIN already exists, aggregate the data (in case of multiple entries)
            const existing = asinBuyBoxMap[childAsin];
            existing.buyBoxPercentage = Math.max(existing.buyBoxPercentage, buyBoxPercentage); // Take the higher percentage
            existing.pageViews += pageViews;
            existing.sessions += sessions;
            existing.sales.amount += salesAmount;
            existing.unitsOrdered += unitsOrdered;
            existing.totalOrderItems += totalOrderItems;
            // Recalculate unitSessionPercentage based on aggregated data
            if (existing.sessions > 0) {
                existing.unitSessionPercentage = (existing.unitsOrdered / existing.sessions) * 100;
            }
        }
    };

    // Process all items
    data.forEach(processBuyBoxItem);

    // Convert ASIN map to array
    const asinBuyBoxData = Object.values(asinBuyBoxMap);

    logger.info('BuyBox metrics calculated', {
        totalProducts,
        productsWithBuyBox,
        productsWithoutBuyBox,
        productsWithLowBuyBox,
        asinCount: asinBuyBoxData.length
    });

    return {
        dateRange: {
            startDate,
            endDate
        },
        totalProducts,
        productsWithBuyBox,
        productsWithoutBuyBox,
        productsWithLowBuyBox,
        asinBuyBoxData
    };
}

module.exports = {
    calculateBuyBoxMetrics
};

