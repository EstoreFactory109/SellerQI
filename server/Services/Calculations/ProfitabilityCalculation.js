/**
 * Profitability Calculation Service
 * 
 * Calculates profitability data by aggregating sales, ads spend, and Amazon fees by ASIN.
 * 
 * Note: Now uses EconomicsMetrics data as the primary source for accurate calculations.
 * Legacy data sources are used as fallbacks for backward compatibility.
 */

const logger = require('../../utils/Logger.js');

/**
 * Calculate profitability data from sales, ads, and fees data
 * @param {Array} totalSales - Array of sales data with asin, quantity, amount (legacy)
 * @param {Array} productWiseSponsoredAds - Array of sponsored ads data with asin, spend (legacy)
 * @param {Array} productWiseFBAData - Array of FBA data (legacy format)
 * @param {Array} FBAFeesData - Array of FBA fees data (legacy format)
 * @param {Object} economicsAsinData - ASIN-wise data from EconomicsMetrics (preferred source)
 * @returns {Array} Array of profitability data by ASIN
 */
const Profitability = (totalSales, productWiseSponsoredAds, productWiseFBAData, FBAFeesData, economicsAsinData = {}) => {
    // Create a map to aggregate data by ASIN
    const profitabilityMap = new Map();

    // First, process EconomicsMetrics ASIN-wise data if available (preferred source)
    if (economicsAsinData && typeof economicsAsinData === 'object' && Object.keys(economicsAsinData).length > 0) {
        logger.info('Using EconomicsMetrics ASIN data for profitability calculations', {
            asinCount: Object.keys(economicsAsinData).length
        });
        
        Object.entries(economicsAsinData).forEach(([asin, data]) => {
            // Use totalFees from EconomicsMetrics (sum of all fee types)
            // Fallback to fbaFees + storageFees if totalFees not available
            const totalFees = data.totalFees !== undefined ? data.totalFees : 
                             ((data.fbaFees || 0) + (data.storageFees || 0));
            
            profitabilityMap.set(asin, {
                asin: asin,
                quantity: data.unitsSold || 0,
                sales: data.sales || 0,
                ads: data.ppcSpent || 0,
                amzFee: totalFees, // Use totalFees (all fee types combined)
                totalFees: totalFees, // Store totalFees separately for frontend
                grossProfit: data.grossProfit || 0,
                // New: detailed fee breakdown from EconomicsMetrics
                fbaFees: data.fbaFees || 0,
                storageFees: data.storageFees || 0,
                source: 'economicsMetrics'
            });
        });
    }

    // Process totalSales data (fallback/supplement for legacy data)
    if (Array.isArray(totalSales)) {
        totalSales.forEach(item => {
            const { asin, quantity, amount } = item;
            
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
                existing.quantity += quantity || 0;
                existing.sales += amount || 0;
            }
        });
    }

    // Process productWiseSponsoredAds data (fallback for legacy data)
    if (Array.isArray(productWiseSponsoredAds)) {
        productWiseSponsoredAds.forEach(item => {
            const { asin, spend } = item;
            
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
                existing.ads += spend || 0;
            }
        });
    }

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

    // Process FBAFeesData (legacy format - fallback)
    // Note: Amazon fees are NOT compulsory - if data is missing for any ASIN, it defaults to 0
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

