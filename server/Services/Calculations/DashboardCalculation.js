/**
 * Dashboard Calculation Service
 * 
 * This service handles all dashboard calculations that were previously done
 * in the separate calculation server. All calculations are now performed
 * in the IBEX backend.
 * 
 * Note: Sales and PPC data are now fetched from EconomicsMetrics model
 * for accurate ACOS/TACOS calculations.
 */

const Profitability = require('./ProfitabilityCalculation.js');
const { calculateSponsoredAdsMetrics, calculateNegativeKeywordsMetrics } = require('./SponsoredAdsCalculation.js');
const { createDefaultDashboardData, mergeWithDefaults } = require('./DefaultDataStructure.js');
const CreateTaskService = require('./CreateTasksService.js');
const logger = require('../../utils/Logger.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');

/**
 * Get PPC sales from EconomicsMetrics for ACOS/TACOS calculations
 * 
 * IMPORTANT: To ensure consistency with custom date range filters,
 * totalSales is calculated by summing datewiseSales instead of using
 * the stored pre-aggregated value. This guarantees that:
 * - Page load totalSales === Custom filter totalSales (for same dates)
 * 
 * NOTE: For big accounts (isBig=true), asinWiseSales is fetched from separate collection
 * to avoid memory issues. The data is aggregated to asinPpcSales (smaller object).
 * 
 * @param {Object} economicsMetrics - EconomicsMetrics data
 * @returns {Promise<Object>} PPC sales data with total and per-ASIN breakdown
 */
const getPpcSalesFromEconomics = async (economicsMetrics) => {
    if (!economicsMetrics) {
        return { totalPpcSales: 0, asinPpcSales: {}, totalSales: 0, totalGrossProfit: 0 };
    }
    
    // Get total PPC spent from economics (this is used for ACOS/TACOS)
    const totalPpcSpent = economicsMetrics.ppcSpent?.amount || 0;
    
    // CRITICAL: Calculate totalSales by summing datewiseSales for consistency
    // This ensures page load shows same value as custom filter for same dates
    let totalSales = 0;
    let totalGrossProfit = 0;
    
    if (Array.isArray(economicsMetrics.datewiseSales) && economicsMetrics.datewiseSales.length > 0) {
        economicsMetrics.datewiseSales.forEach(item => {
            totalSales += item.sales?.amount || 0;
            totalGrossProfit += item.grossProfit?.amount || 0;
        });
        // Round to 2 decimal places for consistency
        totalSales = parseFloat(totalSales.toFixed(2));
        totalGrossProfit = parseFloat(totalGrossProfit.toFixed(2));
    } else {
        // Fallback to stored value if datewiseSales not available
        totalSales = economicsMetrics.totalSales?.amount || 0;
        totalGrossProfit = economicsMetrics.grossProfit?.amount || 0;
    }
    
    // Get ASIN-wise PPC data
    // For big accounts, aggregate from separate collection to avoid loading full array into memory
    const asinPpcSales = {};
    
    // Debug: Log what we're receiving
    logger.debug('getPpcSalesFromEconomics - ASIN data check', {
        isBig: economicsMetrics.isBig,
        hasAsinWiseSales: !!economicsMetrics.asinWiseSales,
        isArray: Array.isArray(economicsMetrics.asinWiseSales),
        asinWiseSalesLength: economicsMetrics.asinWiseSales?.length || 0,
        totalSales: economicsMetrics.totalSales?.amount || 0,
        metricsId: economicsMetrics._id?.toString()
    });
    
    // Check if this is a big account with data in separate collection
    // Also handle legacy data: if totalSales > 5000 but no asinWiseSales, try fetching from separate collection
    const isBigAccount = economicsMetrics.isBig === true;
    const hasEmptyAsinData = !economicsMetrics.asinWiseSales || economicsMetrics.asinWiseSales.length === 0;
    const isLegacyBigAccount = hasEmptyAsinData && (economicsMetrics.totalSales?.amount > 5000);
    
    if ((isBigAccount || isLegacyBigAccount) && hasEmptyAsinData) {
        try {
            // Fetch and aggregate ASIN data from separate collection for big accounts
            const bigAccountAsinDocs = await AsinWiseSalesForBigAccounts.findByMetricsId(economicsMetrics._id);
            
            if (bigAccountAsinDocs && bigAccountAsinDocs.length > 0) {
                bigAccountAsinDocs.forEach(doc => {
                    if (doc.asinSales && Array.isArray(doc.asinSales)) {
                        doc.asinSales.forEach(item => {
                            if (item.asin) {
                                const asin = item.asin;
                                const fbaFees = item.fbaFees?.amount || 0;
                                const storageFees = item.storageFees?.amount || 0;
                                const totalFees = item.totalFees?.amount || 0;
                                const amazonFees = item.amazonFees?.amount || totalFees;
                                
                                // Aggregate values for same ASIN across dates
                                if (asinPpcSales[asin]) {
                                    asinPpcSales[asin].sales += item.sales?.amount || 0;
                                    asinPpcSales[asin].ppcSpent += item.ppcSpent?.amount || 0;
                                    asinPpcSales[asin].grossProfit += item.grossProfit?.amount || 0;
                                    asinPpcSales[asin].fbaFees += fbaFees;
                                    asinPpcSales[asin].storageFees += storageFees;
                                    asinPpcSales[asin].totalFees += totalFees;
                                    asinPpcSales[asin].amazonFees += amazonFees;
                                    asinPpcSales[asin].unitsSold += item.unitsSold || 0;
                                } else {
                                    asinPpcSales[asin] = {
                                        sales: item.sales?.amount || 0,
                                        ppcSpent: item.ppcSpent?.amount || 0,
                                        grossProfit: item.grossProfit?.amount || 0,
                                        fbaFees: fbaFees,
                                        storageFees: storageFees,
                                        totalFees: totalFees,
                                        amazonFees: amazonFees,
                                        unitsSold: item.unitsSold || 0
                                    };
                                }
                            }
                        });
                    }
                });
                logger.debug('Aggregated ASIN PPC sales for big account', {
                    metricsId: economicsMetrics._id,
                    uniqueAsins: Object.keys(asinPpcSales).length
                });
            }
        } catch (error) {
            logger.error('Error fetching ASIN data for big account in DashboardCalculation', {
                metricsId: economicsMetrics._id,
                error: error.message
            });
        }
    } else if (Array.isArray(economicsMetrics.asinWiseSales)) {
        // Normal account - process from main document
        economicsMetrics.asinWiseSales.forEach(item => {
            if (item.asin) {
                const asin = item.asin;
                const fbaFees = item.fbaFees?.amount || 0;
                const storageFees = item.storageFees?.amount || 0;
                const totalFees = item.totalFees?.amount || 0;
                const amazonFees = item.amazonFees?.amount || totalFees;
                
                // Aggregate values for same ASIN across dates
                if (asinPpcSales[asin]) {
                    asinPpcSales[asin].sales += item.sales?.amount || 0;
                    asinPpcSales[asin].ppcSpent += item.ppcSpent?.amount || 0;
                    asinPpcSales[asin].grossProfit += item.grossProfit?.amount || 0;
                    asinPpcSales[asin].fbaFees += fbaFees;
                    asinPpcSales[asin].storageFees += storageFees;
                    asinPpcSales[asin].totalFees += totalFees;
                    asinPpcSales[asin].amazonFees += amazonFees;
                    asinPpcSales[asin].unitsSold += item.unitsSold || 0;
                } else {
                    asinPpcSales[asin] = {
                        sales: item.sales?.amount || 0,
                        ppcSpent: item.ppcSpent?.amount || 0,
                        grossProfit: item.grossProfit?.amount || 0,
                        fbaFees: fbaFees,
                        storageFees: storageFees,
                        totalFees: totalFees,
                        amazonFees: amazonFees,
                        unitsSold: item.unitsSold || 0
                    };
                }
            }
        });
    }
    
    return { 
        totalPpcSpent, 
        totalSales,
        totalGrossProfit,
        asinPpcSales 
    };
};

/**
 * OPTIMIZED: Get top 4 products sorted by highest issues
 * 
 * Simple and fast - single query to Seller model:
 * 1. Get products from Seller.sellerAccount[].products for (region, country)
 * 2. Filter to Active products with issueCount > 0
 * 3. Sort by issueCount descending (highest issues first)
 * 4. Return top 4
 * 
 * @param {string} userId - User ID
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} country - Country code
 * @returns {Promise<Object>} Top 4 products { first, second, third, fourth }
 */
const getTop4ProductsByIssuesOptimized = async (userId, region, country) => {
    const startTime = Date.now();
    
    try {
        const sellerData = await Seller.findOne(
            { User: userId },
            { 
                'sellerAccount': {
                    $elemMatch: { region, country }
                }
            }
        ).lean();

        if (!sellerData?.sellerAccount?.[0]?.products) {
            logger.debug('No seller products found for top 4 calculation', { userId, region, country });
            return { first: null, second: null, third: null, fourth: null };
        }

        const products = sellerData.sellerAccount[0].products;

        const productsWithIssues = products
            .filter(p => p.status === 'Active' && (p.issueCount || 0) > 0)
            .sort((a, b) => (b.issueCount || 0) - (a.issueCount || 0))
            .slice(0, 4)
            .map(p => ({
                asin: p.asin,
                name: p.itemName || 'N/A',
                errors: p.issueCount || 0
            }));

        const elapsed = Date.now() - startTime;
        logger.info('getTop4ProductsByIssuesOptimized completed', {
            userId,
            region,
            country,
            totalProducts: products.length,
            productsWithIssues: productsWithIssues.length,
            elapsedMs: elapsed
        });

        return {
            first: productsWithIssues[0] || null,
            second: productsWithIssues[1] || null,
            third: productsWithIssues[2] || null,
            fourth: productsWithIssues[3] || null
        };

    } catch (error) {
        logger.error('Error in getTop4ProductsByIssuesOptimized', {
            userId,
            region,
            country,
            error: error.message,
            stack: error.stack
        });
        return { first: null, second: null, third: null, fourth: null };
    }
};

/**
 * Calculate ACOS (Advertising Cost of Sales) using EconomicsMetrics PPC data
 * ACOS = (Ad Spend / Ad Sales) * 100
 * @param {number} adSpend - Total advertising spend
 * @param {number} adSales - Total sales from advertising (PPC sales)
 * @returns {number} ACOS percentage
 */
const calculateAcos = (adSpend, adSales) => {
    if (!adSales || adSales === 0) return 0;
    return Math.round((adSpend / adSales) * 100 * 100) / 100; // Round to 2 decimal places
};

/**
 * Calculate TACOS (Total Advertising Cost of Sales) using EconomicsMetrics data
 * TACOS = (Ad Spend / Total Sales) * 100
 * @param {number} adSpend - Total advertising spend
 * @param {number} totalSales - Total sales (all sales, not just from ads)
 * @returns {number} TACOS percentage
 */
const calculateTacos = (adSpend, totalSales) => {
    if (!totalSales || totalSales === 0) return 0;
    return Math.round((adSpend / totalSales) * 100 * 100) / 100; // Round to 2 decimal places
};

/**
 * Calculate date-wise total costs from PPC spend data
 * @param {Array} dateWisePPCData - Array of PPC spend data
 * @returns {Array} Date-wise costs array
 */
const calculateDateWiseTotalCosts = (dateWisePPCData) => {
    if (!Array.isArray(dateWisePPCData)) {
        return [];
    }
    
    const dateWiseCosts = {};
    
    dateWisePPCData.forEach((item) => {
        if (!item || !item.date) {
            return; // Skip invalid items
        }
        
        // Handle different date formats
        let dateStr;
        if (item.date instanceof Date) {
            // If it's a Date object, convert to YYYY-MM-DD string
            dateStr = item.date.toISOString().split('T')[0];
        } else if (typeof item.date === 'string') {
            // If it's a string, extract date part (handles ISO format or YYYY-MM-DD)
            dateStr = item.date.split('T')[0].split(' ')[0]; // Handle both ISO and space-separated formats
        } else {
            // Skip if date is not a valid format
            logger.warn('Invalid date format in calculateDateWiseTotalCosts:', item.date);
            return;
        }
        
        // Validate cost is a number (can be string or number)
        const cost = typeof item.cost === 'number' ? item.cost : parseFloat(String(item.cost)) || 0;
        
        if (!dateWiseCosts[dateStr]) {
            dateWiseCosts[dateStr] = { cost: 0, sales: 0 };
        }
        
        dateWiseCosts[dateStr].cost += cost;
        // Use sales14d (14-day attribution) to match Seller Central, fallback to sales7d
        const sales = parseFloat(String(item.sales14d)) || parseFloat(String(item.sales7d)) || 0;
        dateWiseCosts[dateStr].sales += sales;
    });
    
    // Convert to array format and sort by date
    return Object.entries(dateWiseCosts).map(([date, { cost, sales }]) => ({
        date,
        totalCost: Math.round(cost * 100) / 100, // Round to 2 decimal places
        sales: Math.round(sales * 100) / 100 // Round to 2 decimal places
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
};

/**
 * Calculate campaign-wise total sales and cost from PPC spend data
 * @param {Array} dateWisePPCData - Array of PPC spend data
 * @returns {Array} Campaign-wise sales and cost array
 */
const calculateCampaignWiseTotalSalesAndCost = (dateWisePPCData) => {
    if (!Array.isArray(dateWisePPCData)) {
        return [];
    }
    
    const campaignWiseData = {};
    
    dateWisePPCData.forEach((item) => {
        if (item && item.campaignId) {
            const campaignId = item.campaignId;
            
            if (!campaignWiseData[campaignId]) {
                campaignWiseData[campaignId] = {
                    campaignName: item.campaignName || 'Unknown Campaign',
                    spend: 0,
                    sales: 0
                };
            }
            
            campaignWiseData[campaignId].spend += parseFloat(String(item.cost)) || 0;
            // Use sales14d (14-day attribution) to match Seller Central, fallback to sales7d
            const campaignSales = parseFloat(String(item.sales14d)) || parseFloat(String(item.sales7d)) || 0;
            campaignWiseData[campaignId].sales += campaignSales;
        }
    });
    
    // Convert to array format and sort by totalSpend (descending)
    return Object.entries(campaignWiseData).map(([campaignId, { campaignName, spend, sales }]) => ({
        campaignId,
        campaignName,
        totalSpend: Math.round(spend * 100) / 100, // Round to 2 decimal places
        totalSales: Math.round(sales * 100) / 100 // Round to 2 decimal places
    })).sort((a, b) => b.totalSpend - a.totalSpend);
};

/**
 * Calculate profitability errors
 * @param {Array} profitibilityData - Array of profitability data
 * @param {Array} totalProducts - Array of all products with names
 * @returns {Object} Total errors and error details
 */
const calculateProfitabilityErrors = (profitibilityData, totalProducts = []) => {
    let totalErrors = 0;
    const errorDetails = [];
    
    // Create a map of ASIN to product name for quick lookup
    const productNameMap = new Map();
    if (Array.isArray(totalProducts)) {
        totalProducts.forEach(product => {
            if (product.asin) {
                productNameMap.set(product.asin, product.itemName || product.title || product.productName || null);
            }
        });
    }
    
    profitibilityData.forEach((item) => {
        // Calculate net profit (assuming COGS is 0 initially, will be updated when user enters values)
        const netProfit = (item.sales || 0) - (item.ads || 0) - (item.amzFee || 0);
        
        // Determine status based on profit margin
        const profitMargin = item.sales > 0 ? (netProfit / item.sales) * 100 : 0;
        
        // Count as error if profit margin is below 10% or negative
        if (profitMargin < 10 || netProfit < 0) {
            totalErrors++;
            errorDetails.push({
                asin: item.asin,
                productName: productNameMap.get(item.asin) || null,
                sales: item.sales,
                netProfit: netProfit,
                profitMargin: profitMargin,
                errorType: netProfit < 0 ? 'negative_profit' : 'low_margin'
            });
        }
    });
    
    return { totalErrors, errorDetails };
};

/**
 * Calculate sponsored ads errors
 * @param {Array} productWiseSponsoredAds - Array of sponsored ads data
 * @param {Array} negativeKeywordsMetrics - Array of negative keywords metrics
 * @returns {Object} Total errors and error details
 */
/**
 * Calculate sponsored ads errors based on campaign/keyword-level analysis
 * This matches the PPC Dashboard Campaign Analysis logic
 * @param {Array} campaignWiseTotalSalesAndCost - Campaign-level spend and sales data
 * @param {Array} adsKeywordsPerformanceData - Keyword performance data
 * @param {Array} searchTerms - Search terms data
 * @param {Array} campaignData - Campaign metadata
 * @param {Array} keywords - Keywords data for manual campaign lookup
 * @returns {Object} { totalErrors, errorDetails }
 */
const calculateSponsoredAdsErrors = (
    campaignWiseTotalSalesAndCost = [],
    adsKeywordsPerformanceData = [],
    searchTerms = [],
    campaignData = [],
    keywords = []
) => {
    let totalErrors = 0;
    const errorDetails = [];
    
    // 1. High ACOS Campaigns (ACOS > 40% and sales > 0)
    if (Array.isArray(campaignWiseTotalSalesAndCost)) {
        campaignWiseTotalSalesAndCost.forEach((campaign) => {
            const spend = parseFloat(String(campaign.totalSpend)) || 0;
            const sales = parseFloat(String(campaign.totalSales)) || 0;
            const acos = sales > 0 ? (spend / sales) * 100 : 0;
            
            // Count as error if ACOS > 40% and has sales
            if (acos > 40 && sales > 0) {
                totalErrors++;
                errorDetails.push({
                    campaignId: campaign.campaignId,
                    campaignName: campaign.campaignName || 'Unknown Campaign',
                    spend: spend,
                    sales: sales,
                    acos: acos,
                    errorType: 'high_acos_campaign',
                    source: 'campaign'
                });
            }
        });
    }
    
    // 2. Wasted Spend Keywords (cost > 0 and sales < 0.01)
    // Aggregate keywords by keyword+campaign+adGroup to avoid duplicates
    const aggregatedKeywordsMap = new Map();
    
    if (Array.isArray(adsKeywordsPerformanceData)) {
        adsKeywordsPerformanceData.forEach((keyword) => {
            const uniqueKey = `${keyword.keyword || ''}|${keyword.campaignId || ''}|${keyword.adGroupId || keyword.adGroupName || ''}`;
            
            if (aggregatedKeywordsMap.has(uniqueKey)) {
                const existing = aggregatedKeywordsMap.get(uniqueKey);
                existing.cost += parseFloat(keyword.cost) || 0;
                existing.attributedSales30d += parseFloat(keyword.attributedSales30d) || 0;
            } else {
                aggregatedKeywordsMap.set(uniqueKey, {
                    keyword: keyword.keyword,
                    keywordId: keyword.keywordId,
                    campaignName: keyword.campaignName,
                    campaignId: keyword.campaignId,
                    adGroupName: keyword.adGroupName,
                    adGroupId: keyword.adGroupId,
                    cost: parseFloat(keyword.cost) || 0,
                    attributedSales30d: parseFloat(keyword.attributedSales30d) || 0
                });
            }
        });
    }
    
    const aggregatedKeywords = Array.from(aggregatedKeywordsMap.values());
    
    aggregatedKeywords.forEach((keyword) => {
        // Count as error if cost > 0 and sales < 0.01 (wasted spend)
        if (keyword.cost > 0 && keyword.attributedSales30d < 0.01) {
            totalErrors++;
            errorDetails.push({
                keyword: keyword.keyword,
                keywordId: keyword.keywordId,
                campaignName: keyword.campaignName || 'Unknown Campaign',
                campaignId: keyword.campaignId,
                adGroupName: keyword.adGroupName,
                spend: keyword.cost,
                sales: keyword.attributedSales30d,
                errorType: 'wasted_spend_keyword',
                source: 'keyword'
            });
        }
    });
    
    // 3. Search Terms with Zero Sales (clicks >= 10 and sales < 0.01)
    // Aggregate search terms by searchTerm+campaign+adGroup to avoid duplicates
    const aggregatedSearchTermsMap = new Map();
    
    if (Array.isArray(searchTerms)) {
        searchTerms.forEach((term) => {
            const uniqueKey = `${term.searchTerm || ''}|${term.campaignId || ''}|${term.adGroupId || term.adGroupName || ''}`;
            
            if (aggregatedSearchTermsMap.has(uniqueKey)) {
                const existing = aggregatedSearchTermsMap.get(uniqueKey);
                existing.sales += parseFloat(term.sales) || 0;
                existing.spend += parseFloat(term.spend) || 0;
                existing.clicks += parseFloat(term.clicks) || 0;
            } else {
                aggregatedSearchTermsMap.set(uniqueKey, {
                    searchTerm: term.searchTerm,
                    keyword: term.keyword,
                    campaignName: term.campaignName,
                    campaignId: term.campaignId,
                    adGroupName: term.adGroupName,
                    adGroupId: term.adGroupId,
                    sales: parseFloat(term.sales) || 0,
                    spend: parseFloat(term.spend) || 0,
                    clicks: parseFloat(term.clicks) || 0
                });
            }
        });
    }
    
    const aggregatedSearchTerms = Array.from(aggregatedSearchTermsMap.values());
    
    aggregatedSearchTerms.forEach((term) => {
        // Count as error if clicks >= 10 and sales < 0.01
        if (term.clicks >= 10 && term.sales < 0.01) {
            totalErrors++;
            errorDetails.push({
                searchTerm: term.searchTerm,
                keyword: term.keyword,
                campaignName: term.campaignName || 'Unknown Campaign',
                campaignId: term.campaignId,
                adGroupName: term.adGroupName,
                clicks: term.clicks,
                spend: term.spend,
                sales: term.sales,
                errorType: 'search_term_zero_sales',
                source: 'search_term'
            });
        }
    });
    
    // 4. Auto Campaign Insights - Only count those that need migration
    // Get auto campaigns
    const autoCampaigns = Array.isArray(campaignData) 
        ? campaignData.filter(campaign => campaign.targetingType === 'auto')
        : [];
    const autoCampaignIds = autoCampaigns.map(campaign => campaign.campaignId);
    
    // Get manual campaigns for checking if keywords exist there
    const manualCampaigns = Array.isArray(campaignData)
        ? campaignData.filter(campaign => campaign.targetingType === 'manual')
        : [];
    const manualCampaignIds = manualCampaigns.map(campaign => campaign.campaignId);
    
    // Get keywords from manual campaigns
    const manualKeywords = Array.isArray(keywords)
        ? keywords
            .filter(keyword => manualCampaignIds.includes(keyword.campaignId))
            .map(keyword => keyword.keywordText?.toLowerCase() || '')
        : [];
    
    // Filter aggregated search terms for auto campaigns with sales > 30
    aggregatedSearchTerms.forEach((term) => {
        // Check if sales > 30 and belongs to an auto campaign
        if (term.sales > 30 && 
            term.campaignId && 
            autoCampaignIds.includes(term.campaignId)) {
            
            // Check if this search term exists as a keyword in manual campaigns
            const existsInManual = manualKeywords.includes((term.searchTerm || '').toLowerCase());
            
            // Only count as error if it needs migration (doesn't exist in manual campaigns)
            if (!existsInManual) {
                totalErrors++;
                const acos = term.sales > 0 ? (term.spend / term.sales) * 100 : 0;
                errorDetails.push({
                    searchTerm: term.searchTerm,
                    keyword: term.keyword || '',
                    campaignName: term.campaignName || 'Unknown Campaign',
                    campaignId: term.campaignId,
                    adGroupName: term.adGroupName,
                    sales: term.sales,
                    spend: term.spend,
                    clicks: term.clicks,
                    acos: acos,
                    errorType: 'auto_campaign_migration_needed',
                    source: 'auto_campaign_insight'
                });
            }
        }
    });
    
    return { totalErrors, errorDetails };
};

/**
 * Main analysis function - calculates dashboard data from raw input
 * @param {Object} data - Raw input data from Analyse service
 * @param {string} userId - User ID for task creation
 * @returns {Object} Calculated dashboard data
 */
const analyseData = async (data, userId = null) => {
    const calcStartTime = Date.now();
    logger.info("[PERF] === DashboardCalculation: Processing data ===");

    // Check if we have any meaningful data
    const hasValidData = data && (
        (Array.isArray(data.TotalProducts) && data.TotalProducts.length > 0) ||
        (data.SalesByProducts && Array.isArray(data.SalesByProducts) && data.SalesByProducts.length > 0) ||
        (data.ProductWiseSponsoredAds && Array.isArray(data.ProductWiseSponsoredAds) && data.ProductWiseSponsoredAds.length > 0) ||
        (data.FinanceData && Object.keys(data.FinanceData).length > 0) ||
        (data.EconomicsMetrics && Object.keys(data.EconomicsMetrics).length > 0)
    );

    // If no meaningful data is available, return default empty data structure
    if (!hasValidData) {
        logger.warn("No valid data found, returning default empty data structure");
        const defaultData = createDefaultDashboardData();
        // Preserve any available country or date information
        if (data?.Country) defaultData.Country = data.Country;
        if (data?.createdAccountDate) defaultData.createdAccountDate = data.createdAccountDate;
        if (data?.startDate) defaultData.startDate = data.startDate;
        if (data?.endDate) defaultData.endDate = data.endDate;
        if (data?.keywordTrackingData) defaultData.keywordTrackingData = data.keywordTrackingData;
        
        return { dashboardData: defaultData };
    }

    logger.info("Valid data found, proceeding with analysis");
    
    // Extract region from AllSellerAccounts based on Country
    const country = data.Country || 'US';
    let region = 'NA'; // Default to NA
    if (Array.isArray(data.AllSellerAccounts)) {
        const matchingAccount = data.AllSellerAccounts.find(acc => acc.country === country);
        if (matchingAccount?.region) {
            region = matchingAccount.region;
        }
    }
    
    // OPTIMIZATION: Start async operations in parallel
    // 1. Get PPC and sales data from EconomicsMetrics
    // 2. Get optimized top 4 products (uses MongoDB aggregation - much faster)
    let stepStart = Date.now();
    const [economicsData, optimizedTop4] = await Promise.all([
        getPpcSalesFromEconomics(data.EconomicsMetrics),
        userId ? getTop4ProductsByIssuesOptimized(userId, region, country) : Promise.resolve(null)
    ]);
    logger.info(`[PERF] getPpcSalesFromEconomics + getTop4ProductsByIssuesOptimized completed in ${Date.now() - stepStart}ms`);
    logger.info("EconomicsMetrics data extracted", {
        totalPpcSpent: economicsData.totalPpcSpent,
        totalSales: economicsData.totalSales,
        asinCount: Object.keys(economicsData.asinPpcSales).length
    });

    // Get BuyBox data from MCP BuyBox service
    let productsWithoutBuyBox = 0;
    if (data.BuyBoxData && data.BuyBoxData.productsWithoutBuyBox !== undefined) {
        productsWithoutBuyBox = data.BuyBoxData.productsWithoutBuyBox;
        logger.info("BuyBox data extracted from MCP", {
            totalProducts: data.BuyBoxData.totalProducts,
            productsWithoutBuyBox: productsWithoutBuyBox,
            productsWithBuyBox: data.BuyBoxData.productsWithBuyBox,
            productsWithLowBuyBox: data.BuyBoxData.productsWithLowBuyBox
        });
    } else {
        logger.warn("BuyBox data not available, using legacy calculation");
    }
    
    // Calculate and log date-wise total costs
    const dateWiseTotalCosts = calculateDateWiseTotalCosts(data.GetDateWisePPCspendData || []);
    
    // Calculate and log campaign-wise total sales and cost
    const campaignWiseTotalSalesAndCost = calculateCampaignWiseTotalSalesAndCost(data.GetDateWisePPCspendData || []);
    
    // Safely extract data with fallbacks
    const TotalProducts = data.TotalProducts || [];
    const accountHealthPercentage = data.AccountData?.getAccountHealthPercentge || { Percentage: 0, status: 'UNKNOWN' };
    const accountFinance = data.FinanceData || {};
    const totalErrorInAccount = data.AccountData?.accountHealth?.TotalErrors || 0;
    const amazonReadyProducts = data.ConversionData?.AmazonReadyproducts || [];
    
    // Get active products first - this will be used to filter all analysis
    const activeProducts = [];
    const activeProductSet = new Set();
    
    // Safely process TotalProducts
    if (Array.isArray(TotalProducts)) {
        TotalProducts.forEach((elm) => {
            if (elm && elm.asin && elm.status === "Active") {
                activeProducts.push(elm.asin);
                activeProductSet.add(elm.asin);
            }
        });
    }

    // Filter all input data to only include active products with better error handling
    const activeSalesByProducts = Array.isArray(data.SalesByProducts) ? 
        data.SalesByProducts.filter((product) => product && product.asin && activeProductSet.has(product.asin)) : [];
    const activeProductWiseSponsoredAds = Array.isArray(data.ProductWiseSponsoredAds) ? 
        data.ProductWiseSponsoredAds.filter((product) => product && product.asin && activeProductSet.has(product.asin)) : [];
    const activeProductWiseFBAData = Array.isArray(data.ProductWiseFBAData) ? 
        data.ProductWiseFBAData.filter((product) => product && product.asin && activeProductSet.has(product.asin)) : [];
    const activeFBAFeesData = Array.isArray(data.FBAFeesData) ? 
        data.FBAFeesData.filter((product) => product && product.asin && activeProductSet.has(product.asin)) : [];

    // PERFORMANCE OPTIMIZATION: Create Maps for O(1) lookups instead of O(n) array.find()
    // This significantly improves performance for large datasets
    const salesByAsinMap = new Map();
    activeSalesByProducts.forEach(p => {
        if (p && p.asin) salesByAsinMap.set(p.asin, p);
    });

    const totalProductsByAsinMap = new Map();
    if (Array.isArray(TotalProducts)) {
        TotalProducts.forEach(p => {
            if (p && p.asin) totalProductsByAsinMap.set(p.asin, p);
        });
    }

    // Only calculate profitability for active products with error handling
    let profitibilityData = [];
    let sponsoredAdsMetrics = { totalCost: 0, totalSalesIn30Days: 0, totalProductsPurchased: 0, acos: 0, tacos: 0 };
    let negativeKeywordsMetrics = [];
    
    try {
        // Pass EconomicsMetrics asinWiseSales data to profitability calculation
        profitibilityData = Profitability(
            activeSalesByProducts, 
            activeProductWiseSponsoredAds, 
            activeProductWiseFBAData, 
            activeFBAFeesData,
            economicsData.asinPpcSales // New: Pass economics data for accurate fee calculations
        );
    } catch (error) {
        logger.error("Error calculating profitability data:", error);
        profitibilityData = [];
    }
    
    try {
        sponsoredAdsMetrics = calculateSponsoredAdsMetrics(activeProductWiseSponsoredAds);
        
        // Calculate ACOS and TACOS using Amazon Ads API PPC data as PRIMARY source
        // Use sponsoredAdsMetrics.totalCost from Amazon Ads API (GetPPCProductWise.js)
        const totalPpcSpent = sponsoredAdsMetrics.totalCost || 0;
        const totalSales = economicsData.totalSales || (data.FinanceData?.Total_Sales || 0);
        
        // ACOS = Ad Spend / PPC Sales * 100 (PPC sales = sales attributed to ads)
        sponsoredAdsMetrics.acos = calculateAcos(totalPpcSpent, sponsoredAdsMetrics.totalSalesIn30Days);
        
        // TACOS = Ad Spend / Total Sales * 100 (all sales, not just from ads)
        sponsoredAdsMetrics.tacos = calculateTacos(totalPpcSpent, totalSales);
        
        // Store both for reference (Ads API is primary)
        sponsoredAdsMetrics.adsPpcSpent = totalPpcSpent; // PRIMARY: Amazon Ads API
        sponsoredAdsMetrics.economicsPpcSpent = economicsData.totalPpcSpent; // Reference only
        
        logger.info("ACOS/TACOS calculated from Amazon Ads API", {
            acos: sponsoredAdsMetrics.acos,
            tacos: sponsoredAdsMetrics.tacos,
            totalPpcSpent,
            ppcSales: sponsoredAdsMetrics.totalSalesIn30Days,
            totalSales,
            source: 'Amazon Ads API (GetPPCProductWise)'
        });
    } catch (error) {
        logger.error("Error calculating sponsored ads metrics:", error);
        sponsoredAdsMetrics = { totalCost: 0, totalSalesIn30Days: 0, totalProductsPurchased: 0, acos: 0, tacos: 0 };
    }
    
    try {
        negativeKeywordsMetrics = calculateNegativeKeywordsMetrics(data.negetiveKeywords || [], data.adsKeywordsPerformanceData || []);
    } catch (error) {
        logger.error("Error calculating negative keywords metrics:", error);
        negativeKeywordsMetrics = [];
    }

    // Process inventory analysis data (filter for active products)
    const inventoryAnalysis = data.InventoryAnalysis || {
        inventoryPlanning: [],
        strandedInventory: [],
        inboundNonCompliance: [],
        replenishment: []
    };
    
    // Filter inventory analysis to only include active products
    const activeInventoryAnalysis = {
        inventoryPlanning: inventoryAnalysis.inventoryPlanning ? inventoryAnalysis.inventoryPlanning.filter((item) => item && item.asin && activeProductSet.has(item.asin)) : [],
        strandedInventory: inventoryAnalysis.strandedInventory ? inventoryAnalysis.strandedInventory.filter((item) => item && item.asin && activeProductSet.has(item.asin)) : [],
        inboundNonCompliance: inventoryAnalysis.inboundNonCompliance ? inventoryAnalysis.inboundNonCompliance.filter((item) => item && item.asin && activeProductSet.has(item.asin)) : [],
        replenishment: inventoryAnalysis.replenishment ? inventoryAnalysis.replenishment.filter((item) => item && item.asin && activeProductSet.has(item.asin)) : []
    };
    
    // Initialize error counters (will be calculated by summing actual errors, not products)
    let totalErrorInConversion = 0;
    let totalInventoryErrors = 0;

    const productWiseError = [];
    const rankingProductWiseErrors = [];
    const conversionProductWiseErrors = [];
    const inventoryProductWiseErrors = [];

    const seenAsins = new Set();

    // Conversion error arrays (filter for active products only) with safe data access
    const aplusError = Array.isArray(data.ConversionData?.aPlusResult) ? 
        data.ConversionData.aPlusResult.filter((p) => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const imageResultError = Array.isArray(data.ConversionData?.imageResult) ? 
        data.ConversionData.imageResult.filter((p) => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const videoResultError = Array.isArray(data.ConversionData?.videoResult) ? 
        data.ConversionData.videoResult.filter((p) => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const productStarRatingResultError = Array.isArray(data.ConversionData?.productStarRatingResult) ? 
        data.ConversionData.productStarRatingResult.filter((p) => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const brandStoryError = Array.isArray(data.ConversionData?.brandStoryResult) ? 
        data.ConversionData.brandStoryResult.filter((p) => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];

    // PERFORMANCE OPTIMIZATION: Create Maps for conversion error lookups (O(1) instead of O(n))
    const aplusErrorMap = new Map(aplusError.map(p => [p.asin, p]));
    const imageResultErrorMap = new Map(imageResultError.map(p => [p.asin, p]));
    const videoResultErrorMap = new Map(videoResultError.map(p => [p.asin, p]));
    const productStarRatingResultErrorMap = new Map(productStarRatingResultError.map(p => [p.asin, p]));
    const brandStoryErrorMap = new Map(brandStoryError.map(p => [p.asin, p]));

    // PERFORMANCE OPTIMIZATION: Create Maps for inventory error lookups
    const inventoryPlanningMap = new Map();
    if (activeInventoryAnalysis.inventoryPlanning) {
        activeInventoryAnalysis.inventoryPlanning.forEach(item => {
            if (item && item.asin) inventoryPlanningMap.set(item.asin, item);
        });
    }
    const strandedInventoryMap = new Map();
    if (activeInventoryAnalysis.strandedInventory) {
        activeInventoryAnalysis.strandedInventory.forEach(item => {
            if (item && item.asin) strandedInventoryMap.set(item.asin, item);
        });
    }
    const inboundNonComplianceMap = new Map();
    if (activeInventoryAnalysis.inboundNonCompliance) {
        activeInventoryAnalysis.inboundNonCompliance.forEach(item => {
            if (item && item.asin) inboundNonComplianceMap.set(item.asin, item);
        });
    }
    // Replenishment can have multiple entries per ASIN, so use Map of arrays
    const replenishmentMap = new Map();
    if (activeInventoryAnalysis.replenishment) {
        activeInventoryAnalysis.replenishment.forEach(item => {
            if (item && item.asin && item.status === "Error") {
                if (!replenishmentMap.has(item.asin)) {
                    replenishmentMap.set(item.asin, []);
                }
                replenishmentMap.get(item.asin).push(item);
            }
        });
    }

    // PERFORMANCE OPTIMIZATION: Create Map for image result (for MainImage lookup)
    const imageResultMap = new Map();
    if (Array.isArray(data.ConversionData?.imageResult)) {
        data.ConversionData.imageResult.forEach(item => {
            if (item && item.asin) imageResultMap.set(item.asin, item);
        });
    }

    // PERFORMANCE OPTIMIZATION: Create Map for A+ content lookup
    const aplusResultMap = new Map();
    if (Array.isArray(data.ConversionData?.aPlusResult)) {
        data.ConversionData.aPlusResult.forEach(item => {
            if (item && item.asin) aplusResultMap.set(item.asin, item);
        });
    }

    // Get products without buybox - prioritize MCP BuyBox data, fallback to legacy ConversionData
    let productsWithOutBuyboxError = [];
    if (data.BuyBoxData && Array.isArray(data.BuyBoxData.asinBuyBoxData)) {
        // Use MCP BuyBox data - filter products with buyBoxPercentage = 0
        productsWithOutBuyboxError = data.BuyBoxData.asinBuyBoxData
            .filter((p) => p && p.buyBoxPercentage === 0 && p.childAsin && activeProductSet.has(p.childAsin))
            .map((p) => ({ 
                asin: p.childAsin, 
                data: { 
                    status: "Error", 
                    asin: p.childAsin,
                    buyBoxPercentage: p.buyBoxPercentage,
                    pageViews: p.pageViews,
                    sessions: p.sessions
                } 
            }));
        logger.info("Using MCP BuyBox data for products without buybox", {
            count: productsWithOutBuyboxError.length,
            totalProducts: data.BuyBoxData.totalProducts,
            productsWithoutBuyBox: data.BuyBoxData.productsWithoutBuyBox,
            asinBuyBoxDataLength: data.BuyBoxData.asinBuyBoxData.length,
            activeProductSetSize: activeProductSet.size
        });
    } else {
        // Fallback to legacy ConversionData
        productsWithOutBuyboxError = Array.isArray(data.ConversionData?.ProductWithOutBuybox) ? 
            data.ConversionData.ProductWithOutBuybox
                .filter((p) => p && p.status === "Error" && p.asin && activeProductSet.has(p.asin))
                .map((p) => ({ asin: p.asin, data: p })) : [];
        logger.info("Using legacy ConversionData for products without buybox", {
            count: productsWithOutBuyboxError.length,
            hasBuyBoxData: !!data.BuyBoxData,
            buyBoxDataKeys: data.BuyBoxData ? Object.keys(data.BuyBoxData) : []
        });
    }
    
    // Override count with MCP data if available (for dashboard display)
    // Use the stored count from database, which is more accurate than filtering
    const productsWithoutBuyBoxCount = (data.BuyBoxData && data.BuyBoxData.productsWithoutBuyBox !== undefined && data.BuyBoxData.productsWithoutBuyBox !== null) 
        ? data.BuyBoxData.productsWithoutBuyBox 
        : productsWithOutBuyboxError.length;
    
    logger.info("Final productsWithoutBuyBoxCount", {
        count: productsWithoutBuyBoxCount,
        fromBuyBoxData: data.BuyBoxData?.productsWithoutBuyBox,
        fromFilteredArray: productsWithOutBuyboxError.length
    });

    // PERFORMANCE OPTIMIZATION: Create Map for buybox errors
    const buyboxErrorMap = new Map(productsWithOutBuyboxError.map(p => [p.asin, p]));

    // This is for getting conversion error for each product
    // OPTIMIZED: Uses Maps for O(1) lookups instead of O(n) array.find()
    const getConversionErrors = (asin) => {
        let errorCount = 0;
        const convData = { asin };

        // Use Map lookups (O(1)) instead of array.find() (O(n))
        const aplusFound = aplusErrorMap.get(asin);
        if (aplusFound) {
            convData.aplusErrorData = aplusFound.data;
            errorCount++;
        }

        const imageFound = imageResultErrorMap.get(asin);
        if (imageFound) {
            convData.imageResultErrorData = imageFound.data;
            errorCount++;
        }

        const videoFound = videoResultErrorMap.get(asin);
        if (videoFound) {
            convData.videoResultErrorData = videoFound.data;
            errorCount++;
        }

        const ratingFound = productStarRatingResultErrorMap.get(asin);
        if (ratingFound) {
            convData.productStarRatingResultErrorData = ratingFound.data;
            errorCount++;
        }

        const buyboxFound = buyboxErrorMap.get(asin);
        if (buyboxFound) {
            convData.productsWithOutBuyboxErrorData = buyboxFound.data;
            errorCount++;
        }

        const brandStoryFound = brandStoryErrorMap.get(asin);
        if (brandStoryFound) {
            convData.brandStoryErrorData = brandStoryFound.data;
            errorCount++;
        }

        return { data: convData, errorCount };
    };

    // This is for getting inventory errors for each product (using filtered active inventory data)
    // OPTIMIZED: Uses Maps for O(1) lookups instead of O(n) array.find()
    const getInventoryErrors = (asin) => {
        let errorCount = 0;
        const invData = { asin };

        // Check inventory planning errors (O(1) Map lookup)
        const planningError = inventoryPlanningMap.get(asin);
        if (planningError) {
            invData.inventoryPlanningErrorData = planningError;
            // Count individual errors within planning data
            if (planningError.longTermStorageFees?.status === "Error") errorCount++;
            if (planningError.unfulfillable?.status === "Error") errorCount++;
        }

        // Check stranded inventory errors (O(1) Map lookup)
        const strandedError = strandedInventoryMap.get(asin);
        if (strandedError) {
            invData.strandedInventoryErrorData = strandedError;
            errorCount++;
        }

        // Check inbound non-compliance errors (O(1) Map lookup)
        const complianceError = inboundNonComplianceMap.get(asin);
        if (complianceError) {
            invData.inboundNonComplianceErrorData = complianceError;
            errorCount++;
        }

        // Check replenishment/restock errors (O(1) Map lookup, pre-filtered for status=Error)
        const replenishmentErrors = replenishmentMap.get(asin) || [];
        if (replenishmentErrors.length > 0) {
            // Store all errors as an array
            invData.replenishmentErrorData = replenishmentErrors.length === 1 ? replenishmentErrors[0] : replenishmentErrors;
            invData.replenishmentErrorCount = replenishmentErrors.length;
            errorCount += replenishmentErrors.length;
        }

        return { data: invData, errorCount };
    };

    let TotalRankingerrors = 0;

    // Helper function to check if A+ content is present for an ASIN
    // OPTIMIZED: Uses Map for O(1) lookup instead of O(n) array.find()
    const hasAplusContent = (asin) => {
        if (!asin) return false;
        const aplusData = aplusResultMap.get(asin);
        return aplusData && aplusData.data && aplusData.data.status === "Success";
    };

    // Helper function to filter description errors if A+ content is present
    const filterDescriptionErrors = (elm, asin) => {
        if (!elm || !elm.data) return elm;
        
        // Check if A+ content is present
        if (hasAplusContent(asin)) {
            // Create a copy of elm to avoid mutating the original
            const filteredElm = JSON.parse(JSON.stringify(elm));
            
            // If Description exists and has errors, mark them as Success
            if (filteredElm.data.Description) {
                const description = filteredElm.data.Description;
                
                // Mark all description error checks as Success if they were Error
                if (description.charLim && description.charLim.status === "Error") {
                    description.charLim = {
                        status: "Success",
                        Message: "A+ Content is present, so description errors are not applicable.",
                        HowTOSolve: ""
                    };
                }
                if (description.RestictedWords && description.RestictedWords.status === "Error") {
                    description.RestictedWords = {
                        status: "Success",
                        Message: "A+ Content is present, so description errors are not applicable.",
                        HowTOSolve: ""
                    };
                }
                if (description.checkSpecialCharacters && description.checkSpecialCharacters.status === "Error") {
                    description.checkSpecialCharacters = {
                        status: "Success",
                        Message: "A+ Content is present, so description errors are not applicable.",
                        HowTOSolve: ""
                    };
                }
                
                // Recalculate NumberOfErrors for Description
                let descriptionErrorCount = 0;
                if (description.charLim?.status === "Error") descriptionErrorCount++;
                if (description.RestictedWords?.status === "Error") descriptionErrorCount++;
                if (description.checkSpecialCharacters?.status === "Error") descriptionErrorCount++;
                description.NumberOfErrors = descriptionErrorCount;
                
                // Recalculate TotalErrors
                const titleErrors = (filteredElm.data.TitleResult?.NumberOfErrors || 0);
                const bulletErrors = (filteredElm.data.BulletPoints?.NumberOfErrors || 0);
                filteredElm.data.TotalErrors = titleErrors + bulletErrors + descriptionErrorCount;
            }
            
            return filteredElm;
        }
        
        // If A+ content is not present, return original elm
        return elm;
    };

    // Process ranking data only for active products with safe data access
    const rankingResultArray = data.RankingsData?.RankingResultArray || [];
    if (Array.isArray(rankingResultArray)) {
        rankingResultArray.forEach((elm) => {
            if (!elm || !elm.asin) return;
            
            const asin = elm.asin;
            
            // Skip if product is not active
            if (!activeProductSet.has(asin)) {
                return;
            }
            
            if (seenAsins.has(asin)) return;
            seenAsins.add(asin);

            // Filter description errors if A+ content is present
            const filteredElm = filterDescriptionErrors(elm, asin);

            const title = filteredElm.data?.Title || "N/A";
            // OPTIMIZED: O(1) Map lookup instead of O(n) array.find()
            const productDetails = salesByAsinMap.get(asin);
            const sales = productDetails?.amount || 0;
            const quantity = productDetails?.quantity || 0;

            const { data: conversionData, errorCount: conversionErrors } = getConversionErrors(asin);
            const { data: inventoryData, errorCount: inventoryErrors } = getInventoryErrors(asin);

            // Accumulate actual error counts (not products)
            totalErrorInConversion += conversionErrors;
            totalInventoryErrors += inventoryErrors;

            // OPTIMIZED: O(1) Map lookup instead of O(n) array.find()
            const totalProduct = totalProductsByAsinMap.get(asin);

            const elmTotalErrors = filteredElm.data?.TotalErrors || 0;
            let productwiseTotalError = elmTotalErrors + conversionErrors + inventoryErrors;
            if (elmTotalErrors > 0) {
                TotalRankingerrors += elmTotalErrors;
            }

            conversionProductWiseErrors.push(conversionData);
            conversionProductWiseErrors[conversionProductWiseErrors.length - 1].Title = elm.data?.Title || "N/A";

            // Add inventory errors to inventoryProductWiseErrors array
            if (inventoryErrors > 0) {
                inventoryProductWiseErrors.push({
                    ...inventoryData,
                    Title: elm.data?.Title || "N/A"
                });
            }

            rankingProductWiseErrors.push(
                elmTotalErrors > 0
                    ? filteredElm
                    : { asin, data: { Title: title } }
            );
            
            // OPTIMIZED: O(1) Map lookup instead of O(n) array.find()
            const imageItem = imageResultMap.get(asin);
            productWiseError.push({
                asin,
                sku: totalProduct?.sku || "N/A",
                name: title,
                price: totalProduct?.price || 0,
                MainImage: imageItem?.data?.MainImage || null,
                errors: productwiseTotalError,
                rankingErrors: elmTotalErrors > 0 ? filteredElm : undefined,
                conversionErrors: conversionData,
                inventoryErrors: inventoryData,
                sales,
                quantity
            });
        });
    }

    // Process all active products for inventory errors that weren't captured in ranking processing
    activeProducts.forEach((asin) => {
        // Skip if already processed in ranking data
        if (seenAsins.has(asin)) return;
        
        const { data: inventoryData, errorCount: inventoryErrors } = getInventoryErrors(asin);
        const { data: conversionData, errorCount: conversionErrors } = getConversionErrors(asin);
        
        // Accumulate actual error counts (not products)
        totalErrorInConversion += conversionErrors;
        totalInventoryErrors += inventoryErrors;
        
        if (inventoryErrors > 0) {
            // OPTIMIZED: O(1) Map lookup instead of O(n) array.find()
            const totalProduct = totalProductsByAsinMap.get(asin);
            const title = totalProduct?.itemName || totalProduct?.title || "N/A";
            
            // Add to inventoryProductWiseErrors array
            inventoryProductWiseErrors.push({
                ...inventoryData,
                Title: title
            });
            
            // Also add to productWiseError array for completeness
            const { data: conversionData, errorCount: conversionErrors } = getConversionErrors(asin);
            // OPTIMIZED: O(1) Map lookup instead of O(n) array.find()
            const productDetails = salesByAsinMap.get(asin);
            const sales = productDetails?.amount || 0;
            const quantity = productDetails?.quantity || 0;
            
            // OPTIMIZED: O(1) Map lookup instead of O(n) array.find()
            const imageItem = imageResultMap.get(asin);
            productWiseError.push({
                asin,
                sku: totalProduct?.sku || "N/A",
                name: title,
                price: totalProduct?.price || 0,
                MainImage: imageItem?.data?.MainImage || null,
                errors: inventoryErrors + conversionErrors,
                rankingErrors: undefined,
                conversionErrors: conversionData,
                inventoryErrors: inventoryData,
                sales,
                quantity
            });
        }
    });

    // Backend keyword errors (only for active products) with safe data access
    const backendKeywordResultArray = data.RankingsData?.BackendKeywordResultArray || [];
    if (Array.isArray(backendKeywordResultArray)) {
        backendKeywordResultArray.forEach((elm) => {
            if (!elm || !elm.asin || !elm.data) return;
            
            const asin = elm.asin;
            
            // Skip if product is not active
            if (!activeProductSet.has(asin)) {
                return;
            }
            
            const numberOfErrors = elm.data.NumberOfErrors || 0;
            if (numberOfErrors > 0) {
                TotalRankingerrors += numberOfErrors;

                // OPTIMIZED: Use index lookup for productWiseError instead of array.find()
                // First, we'll check using the seenAsins Set (faster than array.find for large arrays)
                const existingProductIndex = productWiseError.findIndex((p) => p.asin === asin);
                if (existingProductIndex !== -1) {
                    productWiseError[existingProductIndex].errors += numberOfErrors;
                } else {
                    // If product doesn't exist in productWiseError array yet, create it
                    const { data: conversionData, errorCount: conversionErrors } = getConversionErrors(asin);
                    const { data: inventoryData, errorCount: inventoryErrors } = getInventoryErrors(asin);
                    
                    // Accumulate actual error counts if product wasn't processed before
                    if (!seenAsins.has(asin)) {
                        totalErrorInConversion += conversionErrors;
                        totalInventoryErrors += inventoryErrors;
                        seenAsins.add(asin);
                    }
                    // OPTIMIZED: O(1) Map lookup instead of O(n) array.find()
                    const totalProduct = totalProductsByAsinMap.get(asin);
                    const title = totalProduct?.itemName || totalProduct?.title || "N/A";
                    
                    // OPTIMIZED: O(1) Map lookup instead of O(n) array.find()
                    const imageItem = imageResultMap.get(asin);
                    productWiseError.push({
                        asin,
                        sku: totalProduct?.sku || "N/A",
                        name: title,
                        price: totalProduct?.price || 0,
                        MainImage: imageItem?.data?.MainImage || null,
                        errors: numberOfErrors + conversionErrors + inventoryErrors,
                        rankingErrors: undefined,
                        conversionErrors: conversionData,
                        inventoryErrors: inventoryData,
                        sales: 0,
                        quantity: 0
                    });
                }

                // Note: rankingProductWiseErrors lookup still uses find since it's typically a smaller array
                // and we need to modify it by reference
                let rankingErrors = rankingProductWiseErrors.find((p) => p.asin === asin);
                if (!rankingErrors) {
                    // OPTIMIZED: O(1) Map lookup instead of O(n) array.find()
                    const totalProduct = totalProductsByAsinMap.get(asin);
                    const fallbackTitle =
                        totalProduct?.itemName ||
                        totalProduct?.title ||
                        elm.data?.Title ||
                        "N/A";

                    rankingErrors = {
                        asin,
                        data: {
                            Title: fallbackTitle
                        }
                    };
                    rankingProductWiseErrors.push(rankingErrors);
                }

                if (elm.data.charLim?.status === "Error") {
                    rankingErrors.data.charLim = elm.data.charLim;
                }
                if (elm.data.dublicateWords === "Error") {
                    rankingErrors.data.dublicateWords = elm.data.dublicateWords;
                }
            }
        });
    }

  
    // Top priority products with issues
    // OPTIMIZED: Use getTop4ProductsByIssuesOptimized() which fetches sales from 
    // AsinWiseSalesForBigAccounts (last 30 days Economics data) and issue counts from 
    // Seller model products using MongoDB aggregation for maximum speed.
    // Falls back to legacy calculation if optimized query returns no data.
    
    let first, second, third, fourth;
    
    // Use optimized results if available (calculated at start of function in parallel)
    if (optimizedTop4 && (optimizedTop4.first || optimizedTop4.second || optimizedTop4.third || optimizedTop4.fourth)) {
        first = optimizedTop4.first;
        second = optimizedTop4.second;
        third = optimizedTop4.third;
        fourth = optimizedTop4.fourth;
        logger.info('Using optimized top 4 products from Economics + Seller aggregation');
    } else {
        // FALLBACK: Legacy calculation using productWiseError from SalesByProducts
        logger.info('Fallback to legacy top 4 calculation (optimized query returned no data)');
        
        const UniqueProductWisError = Array.from(
            new Map(productWiseError.map(obj => [obj.asin, obj])).values()
        )
            .filter(product => product.errors > 0)
            .sort((a, b) => {
                const salesDiff = (b.sales || 0) - (a.sales || 0);
                if (salesDiff !== 0) return salesDiff;
                return (b.errors || 0) - (a.errors || 0);
            });

        const getTopErrorProduct = (errorData, index) =>
            errorData[index]
                ? {
                    asin: errorData[index].asin,
                    name: errorData[index].name || "N/A",
                    errors: errorData[index].errors,
                    sales: errorData[index].sales || 0,
                }
                : null;

        first = getTopErrorProduct(UniqueProductWisError, 0);
        second = getTopErrorProduct(UniqueProductWisError, 1);
        third = getTopErrorProduct(UniqueProductWisError, 2);
        fourth = getTopErrorProduct(UniqueProductWisError, 3);
    }

    // Add backend keyword errors to top 4 if applicable (only for active products) with safe data access
    const uniqueBackendKeywordData = Array.isArray(backendKeywordResultArray) ? 
        Array.from(
            new Map(backendKeywordResultArray.filter((obj) => obj && obj.asin && activeProductSet.has(obj.asin)).map(obj => [obj.asin, obj])).values()
        ) : [];

    uniqueBackendKeywordData.forEach((elm) => {
        if (elm.data?.NumberOfErrors === 1) {
            [first, second, third, fourth].forEach(slot => {
                if (slot && slot.asin === elm.asin) {
                    slot.errors++;
                }
            });
        }
    });

    // Calculate profitability and sponsored ads errors (already filtered for active products) with error handling
    let profitabilityErrorsData = { totalErrors: 0, errorDetails: [] };
    let sponsoredAdsErrorsData = { totalErrors: 0, errorDetails: [] };
    
    try {
        profitabilityErrorsData = calculateProfitabilityErrors(profitibilityData, TotalProducts);
    } catch (error) {
        logger.error("Error calculating profitability errors:", error);
    }
    
    try {
        // Calculate sponsored ads errors using campaign/keyword-level analysis
        // This matches the PPC Dashboard Campaign Analysis logic
        sponsoredAdsErrorsData = calculateSponsoredAdsErrors(
            campaignWiseTotalSalesAndCost,
            data.adsKeywordsPerformanceData || [],
            data.searchTerms || [],
            data.campaignData || [],
            data.keywords || []
        );
    } catch (error) {
        logger.error("Error calculating sponsored ads errors:", error);
    }

    const dashboardData = {
        Country: data.Country || "US",
        createdAccountDate: data.createdAccountDate || null,
        Brand: data.Brand || null, // Add brand name to dashboard data
        accountHealthPercentage,
        accountFinance,
        totalErrorInAccount,
        totalErrorInConversion,
        TotalRankingerrors,
        totalInventoryErrors,
        first,
        second,
        third,
        fourth,
        productsWithOutBuyboxError: productsWithoutBuyBoxCount, // Use MCP BuyBox count if available
        productsWithoutBuyBox: productsWithoutBuyBoxCount, // Also set this for frontend compatibility
        productsWithoutBuyBox: productsWithoutBuyBoxCount, // Add explicit field for frontend
        buyBoxData: data.BuyBoxData || null, // Include full BuyBox data for frontend
        amazonReadyProducts,
        TotalProduct: TotalProducts,
        ActiveProducts: activeProducts,
        // Use EconomicsMetrics total sales if available, fallback to legacy
        TotalWeeklySale: economicsData.totalSales || data.FinanceData?.Total_Sales || 0,
        TotalSales: data.TotalSales || [],
        reimbustment: data.Reimburstment || { totalReimbursement: 0 },
        productWiseError: productWiseError,
        rankingProductWiseErrors: rankingProductWiseErrors,
        conversionProductWiseErrors: conversionProductWiseErrors,
        inventoryProductWiseErrors: inventoryProductWiseErrors,
        InventoryAnalysis: activeInventoryAnalysis,
        AccountErrors: data.AccountData?.accountHealth || {},
        // Calendar date range from DataFetchTracking (via Analyse.js)
        // No calculation - these dates come directly from the database
        startDate: data.startDate || new Date().toISOString().split('T')[0],
        endDate: data.endDate || new Date().toISOString().split('T')[0],
        profitibilityData: profitibilityData,
        sponsoredAdsMetrics: sponsoredAdsMetrics,
        negativeKeywordsMetrics: negativeKeywordsMetrics,
        ProductWiseSponsoredAdsGraphData: data.ProductWiseSponsoredAdsGraphData || [],
        totalProfitabilityErrors: profitabilityErrorsData.totalErrors,
        totalSponsoredAdsErrors: sponsoredAdsErrorsData.totalErrors,
        ProductWiseSponsoredAds: activeProductWiseSponsoredAds,
        profitabilityErrorDetails: profitabilityErrorsData.errorDetails,
        sponsoredAdsErrorDetails: sponsoredAdsErrorsData.errorDetails,
        keywords: data.keywords || [],
        searchTerms: data.searchTerms || [],
        campaignData: data.campaignData || [],
        adsKeywordsPerformanceData: (() => {
            const adsData = data.adsKeywordsPerformanceData || [];
            logger.info('=== DEBUG: adsKeywordsPerformanceData in DashboardCalculation ===');
            logger.info(`adsKeywordsPerformanceData length: ${adsData.length}`);
            if (adsData.length > 0) {
                logger.info('Sample keyword:', JSON.stringify(adsData[0]));
                const wastedCount = adsData.filter(k => {
                    const cost = parseFloat(k.cost) || 0;
                    const sales = parseFloat(k.attributedSales30d) || 0;
                    return cost > 0 && sales < 0.01;
                }).length;
                logger.info(`Keywords matching wasted criteria: ${wastedCount}`);
            }
            return adsData;
        })(),
        GetOrderData: data.GetOrderData || [],
        dateWiseTotalCosts: dateWiseTotalCosts,
        campaignWiseTotalSalesAndCost: campaignWiseTotalSalesAndCost,
        negetiveKeywords: data.negetiveKeywords || [],
        AdsGroupData: data.AdsGroupData || [],
        keywordTrackingData: data.keywordTrackingData || {},
        isEmptyData: false,
        dataAvailabilityStatus: 'DATA_AVAILABLE',
        DifferenceData: data.DifferenceData || 0,
        // New: EconomicsMetrics data for dashboard boxes and profitability page
        // NOTE: For big accounts (isBig=true), asinWiseSales is NOT included to avoid memory issues
        // The aggregated asinPpcSales is used instead for calculations
        economicsMetrics: data.EconomicsMetrics ? {
            totalSales: data.EconomicsMetrics.totalSales,
            grossProfit: data.EconomicsMetrics.grossProfit,
            ppcSpent: data.EconomicsMetrics.ppcSpent,
            fbaFees: data.EconomicsMetrics.fbaFees,
            storageFees: data.EconomicsMetrics.storageFees,
            totalFees: data.EconomicsMetrics.totalFees,
            amazonFees: data.EconomicsMetrics.amazonFees,
            refunds: data.EconomicsMetrics.refunds,
            datewiseSales: data.EconomicsMetrics.datewiseSales,
            datewiseGrossProfit: data.EconomicsMetrics.datewiseGrossProfit,
            // For big accounts, don't include asinWiseSales to avoid memory issues (can be 15,000+ records)
            asinWiseSales: data.EconomicsMetrics.isBig ? [] : (data.EconomicsMetrics.asinWiseSales || []),
            dateRange: data.EconomicsMetrics.dateRange,
            isBig: data.EconomicsMetrics.isBig || false
        } : null,
        // New: ACOS and TACOS calculated from EconomicsMetrics PPC data
        acos: sponsoredAdsMetrics.acos || 0,
        tacos: sponsoredAdsMetrics.tacos || 0,
        // All seller accounts for account switching
        AllSellerAccounts: data.AllSellerAccounts || []
    };

    logger.info(`Dashboard data processed successfully with ${activeProducts.length} active products`);
    
    // Call CreateTask service if userId is provided
    if (userId) {
        try {
            logger.info(`Creating tasks for user: ${userId}`);
            await CreateTaskService.createTasksFromCalculateServiceData(userId, {
                rankingProductWiseErrors: rankingProductWiseErrors,
                conversionProductWiseErrors: conversionProductWiseErrors,
                inventoryProductWiseErrors: inventoryProductWiseErrors,
                profitabilityErrorDetails: profitabilityErrorsData.errorDetails,
                sponsoredAdsErrorDetails: sponsoredAdsErrorsData.errorDetails,
                AccountErrors: data.AccountData?.accountHealth || {},
                TotalProducts: TotalProducts
            });
            logger.info(`Tasks created successfully for user: ${userId}`);
        } catch (error) {
            logger.error("Error creating tasks:", {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            // Don't throw error to avoid affecting the main functionality
        }
    }
    
    const totalCalcTime = Date.now() - calcStartTime;
    logger.info(`[PERF] DashboardCalculation TOTAL time: ${totalCalcTime}ms`);
    logger.info("=== DashboardCalculation: Returning dashboard data ===");
    return { dashboardData };
};

module.exports = {
    analyseData,
    calculateDateWiseTotalCosts,
    calculateCampaignWiseTotalSalesAndCost,
    calculateProfitabilityErrors,
    calculateSponsoredAdsErrors,
    getPpcSalesFromEconomics,
    calculateAcos,
    calculateTacos,
    getTop4ProductsByIssuesOptimized
};

