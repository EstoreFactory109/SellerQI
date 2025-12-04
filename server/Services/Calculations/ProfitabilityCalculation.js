/**
 * Profitability Calculation Service
 * 
 * Calculates profitability data by aggregating sales, ads spend, and Amazon fees by ASIN.
 * 
 * Data Sources:
 * - Sales, Fees, Storage: EconomicsMetrics (MCP Data Kiosk API)
 * - Ads Spend: productWiseSponsoredAds (Amazon Ads API - PRIMARY source for PPC)
 */

const logger = require('../../utils/Logger.js');

/**
 * Calculate profitability data from sales, ads, and fees data
 * @param {Array} totalSales - Array of sales data with asin, quantity, amount (legacy)
 * @param {Array} productWiseSponsoredAds - Array of sponsored ads data with asin, spend (PRIMARY source for PPC)
 * @param {Array} productWiseFBAData - Array of FBA data (legacy format)
 * @param {Array} FBAFeesData - Deprecated: Array of FBA fees data (legacy format, replaced by EconomicsMetrics)
 * @param {Object} economicsAsinData - ASIN-wise data from EconomicsMetrics (for sales, fees - NOT for ads)
 * @returns {Array} Array of profitability data by ASIN
 */
const Profitability = (totalSales, productWiseSponsoredAds, productWiseFBAData, FBAFeesData, economicsAsinData = {}) => {
    // Create a map to aggregate data by ASIN
    const profitabilityMap = new Map();
    
    // Create a map of ASIN to ads spend from Amazon Ads API (PRIMARY source for PPC)
    const adsSpendByAsin = new Map();
    if (Array.isArray(productWiseSponsoredAds)) {
        productWiseSponsoredAds.forEach(item => {
            const asin = item.asin || item.ASIN;
            const spend = parseFloat(item.spend) || 0;
            if (asin) {
                // Accumulate spend for each ASIN (in case of multiple entries)
                adsSpendByAsin.set(asin, (adsSpendByAsin.get(asin) || 0) + spend);
            }
        });
        logger.info('ASIN-wise ads spend calculated from Amazon Ads API', {
            asinCount: adsSpendByAsin.size,
            totalAdsSpend: Array.from(adsSpendByAsin.values()).reduce((sum, v) => sum + v, 0)
        });
    }

    // First, process EconomicsMetrics ASIN-wise data if available (for sales, fees - NOT for ads)
    if (economicsAsinData && typeof economicsAsinData === 'object' && Object.keys(economicsAsinData).length > 0) {
        logger.info('Using EconomicsMetrics ASIN data for sales/fees (Ads from Amazon Ads API)', {
            asinCount: Object.keys(economicsAsinData).length
        });
        
        Object.entries(economicsAsinData).forEach(([asin, data]) => {
            // Use totalFees from EconomicsMetrics (sum of all fee types)
            const totalFees = data.totalFees !== undefined ? data.totalFees : 
                             ((data.fbaFees || 0) + (data.storageFees || 0));
            
            // Get ads spend from Amazon Ads API (PRIMARY source), NOT from economicsMetrics
            const adsSpend = adsSpendByAsin.get(asin) || 0;
            
            // Calculate gross profit using Ads API spend
            const sales = data.sales || 0;
            const grossProfit = sales - adsSpend - totalFees;
            
            profitabilityMap.set(asin, {
                asin: asin,
                quantity: data.unitsSold || 0,
                sales: sales,
                ads: adsSpend, // PRIMARY: Amazon Ads API spend (NOT MCP ppcSpent)
                amzFee: totalFees,
                totalFees: totalFees,
                grossProfit: grossProfit, // Recalculated with Ads API spend
                fbaFees: data.fbaFees || 0,
                storageFees: data.storageFees || 0,
                source: 'economicsMetrics',
                adsSource: 'amazonAdsAPI' // Track that ads came from Ads API
            });
        });
    }

    // Process totalSales data (fallback/supplement for legacy data)
    if (Array.isArray(totalSales)) {
        totalSales.forEach(item => {
            const { asin, quantity, amount } = item;
            
            if (!profitabilityMap.has(asin)) {
                // Get ads spend from Amazon Ads API for this ASIN
                const adsSpend = adsSpendByAsin.get(asin) || 0;
                
                profitabilityMap.set(asin, {
                    asin: asin,
                    quantity: 0,
                    sales: 0,
                    ads: adsSpend, // PRIMARY: Amazon Ads API spend
                    amzFee: 0,
                    fbaFees: 0,
                    storageFees: 0,
                    source: 'legacy',
                    adsSource: 'amazonAdsAPI'
                });
            }
            
            const existing = profitabilityMap.get(asin);
            // Only update sales/quantity if we don't have economicsMetrics data
            if (existing.source !== 'economicsMetrics') {
                existing.quantity += quantity || 0;
                existing.sales += amount || 0;
            }
        });
    }

    // Add any ASINs from Ads API that aren't in other data sources
    adsSpendByAsin.forEach((spend, asin) => {
        if (!profitabilityMap.has(asin)) {
            profitabilityMap.set(asin, {
                asin: asin,
                quantity: 0,
                sales: 0,
                ads: spend,
                amzFee: 0,
                fbaFees: 0,
                storageFees: 0,
                source: 'adsOnly',
                adsSource: 'amazonAdsAPI'
            });
        }
    });

    // Process productWiseFBAData (legacy format - fallback)
    if (Array.isArray(productWiseFBAData)) {
        productWiseFBAData.forEach(item => {
            const { asin, totalFba, totalAmzFee } = item;
            
            if (!profitabilityMap.has(asin)) {
                profitabilityMap.set(asin, {
                    asin: asin,
                    quantity: 0,
                    sales: 0,
                    ads: 0,
                    amzFee: 0,
                    fbaFees: 0,
                    storageFees: 0,
                    source: 'legacy'
                });
            }
            
            const existing = profitabilityMap.get(asin);
            // Only update if we don't have economicsMetrics data
            if (existing.source !== 'economicsMetrics') {
                // Convert string values to numbers
                const fbaAmount = parseFloat(totalFba) || 0;
                const amzFeeAmount = parseFloat(totalAmzFee) || 0;
                
                // Add FBA amount to amzFee (assuming totalFba should be included in fees)
                existing.amzFee += fbaAmount + amzFeeAmount;
            }
        });
    }

    // Process FBAFeesData (legacy format - fallback, deprecated)
    // Note: This is deprecated - use EconomicsMetrics.asinWiseSales for ASIN-wise fees instead
    // Amazon fees are NOT compulsory - if data is missing for any ASIN, it defaults to 0
    if (Array.isArray(FBAFeesData) && FBAFeesData.length > 0) {
        FBAFeesData.forEach(item => {
            // Skip if item is invalid or missing ASIN
            if (!item || !item.asin) {
                return;
            }
            
            const { asin, fees } = item;
            
            if (!profitabilityMap.has(asin)) {
                profitabilityMap.set(asin, {
                    asin: asin,
                    quantity: 0,
                    sales: 0,
                    ads: 0,
                    amzFee: 0,
                    fbaFees: 0,
                    storageFees: 0,
                    source: 'legacy'
                });
            }
            
            const existing = profitabilityMap.get(asin);
            // Only update if we don't have economicsMetrics data
            if (existing.source !== 'economicsMetrics') {
                // Convert fees to number - fees could be a number or object with amount
                // Default to 0 if fees data is missing or invalid
                let feeAmount = 0;
                
                if (fees !== null && fees !== undefined) {
                    if (typeof fees === 'number' && !isNaN(fees)) {
                        feeAmount = fees;
                    } else if (fees && typeof fees === 'object' && fees.amount !== null && fees.amount !== undefined) {
                        feeAmount = parseFloat(fees.amount) || 0;
                    } else if (typeof fees === 'string' && fees.trim() !== '') {
                        feeAmount = parseFloat(fees) || 0;
                    }
                }
                
                // Add fee amount to amzFee (will be 0 if no valid fee data found)
                existing.amzFee += feeAmount;
            }
        });
    }
    
    // Ensure all entries have valid values
    profitabilityMap.forEach((value, key) => {
        if (value.amzFee === null || value.amzFee === undefined || isNaN(value.amzFee)) {
            value.amzFee = 0;
        }
        if (value.ads === null || value.ads === undefined || isNaN(value.ads)) {
            value.ads = 0;
        }
        if (value.sales === null || value.sales === undefined || isNaN(value.sales)) {
            value.sales = 0;
        }
        
        // Ensure totalFees is set (use amzFee if totalFees not set)
        if (value.totalFees === null || value.totalFees === undefined || isNaN(value.totalFees)) {
            value.totalFees = value.amzFee || 0;
        }
        
        // Calculate gross profit if not already set
        if (!value.grossProfit) {
            value.grossProfit = value.sales - value.ads - value.totalFees;
        }
        
        // Calculate profit margin
        value.profitMargin = value.sales > 0 
            ? Math.round((value.grossProfit / value.sales) * 100 * 100) / 100 
            : 0;
    });

    // Convert map to array
    const profitibilityData = Array.from(profitabilityMap.values());
    
    logger.info('Profitability calculation completed', {
        totalAsins: profitibilityData.length,
        economicsMetricsCount: profitibilityData.filter(p => p.source === 'economicsMetrics').length,
        legacyCount: profitibilityData.filter(p => p.source === 'legacy').length
    });
    
    return profitibilityData;
};

module.exports = Profitability;

