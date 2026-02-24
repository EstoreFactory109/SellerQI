/**
 * ProfitabilityService - Optimized Profitability Data Fetching
 * 
 * This service provides FAST profitability data by:
 * 1. Fetching ONLY the required collections (not all 24+ like Analyse.js)
 * 2. Computing ONLY profitability-related calculations
 * 3. Supporting phased loading (summary first, then table data)
 * 
 * Required data sources for profitability:
 * - EconomicsMetrics: Sales, fees, gross profit, datewiseSales, asinWiseSales
 * - ProductWiseSponsoredAds: PPC spend per ASIN
 * - Seller: TotalProducts, ActiveProducts
 * - GetDateWisePPCspendModel: dateWiseTotalCosts
 * - PPCMetrics (optional): Latest PPC summary
 */

const logger = require('../../utils/Logger.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const GetDateWisePPCspendModel = require('../../models/amazon-ads/GetDateWisePPCspendModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const { getProductWiseSponsoredAdsData, getAdsSpendByAsin } = require('../amazon-ads/ProductWiseSponsoredAdsService.js');
const Profitability = require('./ProfitabilityCalculation.js');
const { calculateSponsoredAdsMetrics } = require('./SponsoredAdsCalculation.js');
const { getRedisClient } = require('../../config/redisConn.js');

// Cache TTL for full profitability table data (10 minutes)
const PROFITABILITY_TABLE_CACHE_TTL = 600;

// Chunk size for yielding to event loop during large data processing
const YIELD_CHUNK_SIZE = 500;

/**
 * Yield to event loop to allow timers (like lock extension) to fire.
 * Critical for preventing job stalling during large data processing.
 * @returns {Promise<void>}
 */
async function yieldToEventLoop() {
    return new Promise(resolve => setImmediate(resolve));
}

/**
 * Fetch minimal data required for profitability dashboard
 * This is MUCH faster than the full Analyse.fetchAllDataModels (5-8 queries vs 24+)
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Promise<Object>} Profitability-specific raw data
 */
const fetchProfitabilityData = async (userId, country, region) => {
    const startTime = Date.now();
    logger.info(`[PERF] ProfitabilityService.fetchProfitabilityData starting for user ${userId}`);

    // Fetch all required data in parallel (only 5 queries instead of 24+)
    const [
        economicsMetricsData,
        sellerData,
        productWiseSponsoredAds,
        dateWisePPCspendData
    ] = await Promise.all([
        EconomicsMetrics.findLatest(userId, region, country),
        Seller.findOne(
            { User: userId },
            { 
                'sellerAccount': {
                    $elemMatch: { region, country }
                }
            }
        ).lean(),
        getProductWiseSponsoredAdsData(userId, country, region),
        GetDateWisePPCspendModel.findOne({ userId, country, region }).sort({ createdAt: -1 }).lean()
    ]);

    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityService.fetchProfitabilityData completed in ${fetchTime}ms`);

    // Process economics metrics data
    let processedEconomicsMetricsData = economicsMetricsData;
    if (economicsMetricsData && economicsMetricsData.toObject) {
        processedEconomicsMetricsData = economicsMetricsData.toObject();
    }

    // Extract products from seller data
    const products = sellerData?.sellerAccount?.[0]?.products || [];
    
    // Convert to array format for backward compatibility
    const ProductWiseSponsoredAdsArray = productWiseSponsoredAds ? [productWiseSponsoredAds] : [];

    // Calculate PPC spend from Amazon Ads API
    let adsPPCSpend = 0;
    if (ProductWiseSponsoredAdsArray.length > 0 && ProductWiseSponsoredAdsArray[0]?.sponsoredAds) {
        ProductWiseSponsoredAdsArray[0].sponsoredAds.forEach(item => {
            if (item && item.spend !== undefined) {
                adsPPCSpend += parseFloat(item.spend) || 0;
            }
        });
        adsPPCSpend = parseFloat(adsPPCSpend.toFixed(2));
    }

    return {
        economicsMetricsData: processedEconomicsMetricsData,
        products,
        ProductWiseSponsoredAds: ProductWiseSponsoredAdsArray,
        dateWisePPCspendData: dateWisePPCspendData?.data || [],
        adsPPCSpend,
        country,
        region
    };
};

/**
 * Get ASIN-wise PPC sales from EconomicsMetrics
 * Handles both normal and big accounts
 * 
 * @param {Object} economicsMetrics - EconomicsMetrics data
 * @returns {Promise<Object>} ASIN-wise PPC sales data
 */
const getAsinPpcSalesFromEconomics = async (economicsMetrics) => {
    if (!economicsMetrics) {
        return { asinPpcSales: {}, totalSales: 0, totalGrossProfit: 0 };
    }

    // Calculate totals from datewiseSales for consistency
    let totalSales = 0;
    let totalGrossProfit = 0;
    
    if (Array.isArray(economicsMetrics.datewiseSales) && economicsMetrics.datewiseSales.length > 0) {
        economicsMetrics.datewiseSales.forEach(item => {
            totalSales += item.sales?.amount || 0;
            totalGrossProfit += item.grossProfit?.amount || 0;
        });
        totalSales = parseFloat(totalSales.toFixed(2));
        totalGrossProfit = parseFloat(totalGrossProfit.toFixed(2));
    } else {
        totalSales = economicsMetrics.totalSales?.amount || 0;
        totalGrossProfit = economicsMetrics.grossProfit?.amount || 0;
    }

    const asinPpcSales = {};

    // Check if big account with data in separate collection
    const isBigAccount = economicsMetrics.isBig === true;
    const hasEmptyAsinData = !economicsMetrics.asinWiseSales || economicsMetrics.asinWiseSales.length === 0;
    const isLegacyBigAccount = hasEmptyAsinData && (economicsMetrics.totalSales?.amount > 5000);

    if ((isBigAccount || isLegacyBigAccount) && hasEmptyAsinData) {
        try {
            // OPTIMIZED: Use MongoDB aggregation instead of loading all docs into memory
            // getProfitabilityMapByMetricsId aggregates in DB and returns a Map
            const profitabilityMap = await AsinWiseSalesForBigAccounts.getProfitabilityMapByMetricsId(economicsMetrics._id);
            
            if (profitabilityMap && profitabilityMap.size > 0) {
                // Convert Map to asinPpcSales object format expected by the rest of the code
                profitabilityMap.forEach((data, asin) => {
                    asinPpcSales[asin] = {
                        sales: data.sales || 0,
                        ppcSpent: data.ads || 0,
                        grossProfit: data.grossProfit || 0,
                        fbaFees: data.fbaFees || 0,
                        storageFees: data.storageFees || 0,
                        totalFees: data.totalFees || 0,
                        amazonFees: data.amzFee || data.totalFees || 0,
                        unitsSold: data.unitsSold || 0,
                        parentAsin: data.parentAsin || asin
                    };
                });
            }
        } catch (error) {
            logger.error('Error fetching ASIN data for big account via aggregation', { error: error.message });
        }
    } else if (Array.isArray(economicsMetrics.asinWiseSales)) {
        const asinSalesArray = economicsMetrics.asinWiseSales;
        for (let i = 0; i < asinSalesArray.length; i++) {
            const item = asinSalesArray[i];
            if (item.asin) {
                const asin = item.asin;
                const parentAsin = item.parentAsin || asin; // Preserve parentAsin
                const fbaFees = item.fbaFees?.amount || 0;
                const storageFees = item.storageFees?.amount || 0;
                const totalFees = item.totalFees?.amount || 0;
                const amazonFees = item.amazonFees?.amount || totalFees;
                
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
                        unitsSold: item.unitsSold || 0,
                        parentAsin: parentAsin // Include parentAsin
                    };
                }
            }
            // Yield to event loop periodically to prevent blocking
            if ((i + 1) % YIELD_CHUNK_SIZE === 0) {
                await yieldToEventLoop();
            }
        }
    }

    return { asinPpcSales, totalSales, totalGrossProfit };
};

/**
 * Calculate date-wise total costs from PPC spend data
 * (Same logic as DashboardCalculation.calculateDateWiseTotalCosts)
 */
const calculateDateWiseTotalCosts = (dateWisePPCData) => {
    if (!Array.isArray(dateWisePPCData)) {
        return [];
    }
    
    const dateWiseCosts = {};
    
    dateWisePPCData.forEach((item) => {
        if (!item || !item.date) return;
        
        let dateStr;
        if (item.date instanceof Date) {
            dateStr = item.date.toISOString().split('T')[0];
        } else if (typeof item.date === 'string') {
            dateStr = item.date.split('T')[0].split(' ')[0];
        } else {
            return;
        }
        
        const cost = typeof item.cost === 'number' ? item.cost : parseFloat(String(item.cost)) || 0;
        
        if (!dateWiseCosts[dateStr]) {
            dateWiseCosts[dateStr] = { cost: 0, sales: 0 };
        }
        
        dateWiseCosts[dateStr].cost += cost;
        const sales = parseFloat(String(item.sales14d)) || parseFloat(String(item.sales7d)) || 0;
        dateWiseCosts[dateStr].sales += sales;
    });
    
    return Object.entries(dateWiseCosts).map(([date, { cost, sales }]) => ({
        date,
        totalCost: Math.round(cost * 100) / 100,
        sales: Math.round(sales * 100) / 100
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
};

/**
 * Convert EconomicsMetrics to legacy accountFinance format
 * (Same logic as Analyse.convertEconomicsToFinanceFormat)
 */
const convertToAccountFinance = (economicsMetrics, adsPPCSpend = 0) => {
    if (!economicsMetrics) {
        return {
            createdAt: new Date(),
            Gross_Profit: 0,
            Total_Sales: 0,
            ProductAdsPayment: adsPPCSpend,
            FBA_Fees: 0,
            Storage: 0,
            Amazon_Charges: 0,
            Amazon_Fees: 0,
            Other_Amazon_Fees: 0,
            Refunds: 0
        };
    }

    // Calculate totals from datewise data for consistency
    let totalSales = 0;
    let totalGrossProfit = 0;
    let fbaFees = 0;
    let storageFees = 0;
    let refunds = 0;
    
    if (Array.isArray(economicsMetrics.datewiseSales) && economicsMetrics.datewiseSales.length > 0) {
        economicsMetrics.datewiseSales.forEach(item => {
            totalSales += item.sales?.amount || 0;
            totalGrossProfit += item.grossProfit?.amount || 0;
        });
        totalSales = parseFloat(totalSales.toFixed(2));
        totalGrossProfit = parseFloat(totalGrossProfit.toFixed(2));
    } else {
        totalSales = economicsMetrics.totalSales?.amount || 0;
        totalGrossProfit = economicsMetrics.grossProfit?.amount || 0;
    }
    
    if (Array.isArray(economicsMetrics.datewiseFeesAndRefunds) && economicsMetrics.datewiseFeesAndRefunds.length > 0) {
        economicsMetrics.datewiseFeesAndRefunds.forEach(item => {
            fbaFees += item.fbaFulfillmentFee?.amount || 0;
            storageFees += item.storageFee?.amount || 0;
            refunds += item.refunds?.amount || 0;
        });
        fbaFees = parseFloat(fbaFees.toFixed(2));
        storageFees = parseFloat(storageFees.toFixed(2));
        refunds = parseFloat(refunds.toFixed(2));
    } else {
        fbaFees = economicsMetrics.fbaFees?.amount || 0;
        storageFees = economicsMetrics.storageFees?.amount || 0;
        refunds = economicsMetrics.refunds?.amount || 0;
    }
    
    // Get Amazon fees
    let amazonFees = 0;
    if (Array.isArray(economicsMetrics.datewiseAmazonFees) && economicsMetrics.datewiseAmazonFees.length > 0) {
        economicsMetrics.datewiseAmazonFees.forEach(item => {
            amazonFees += item.totalAmount?.amount || 0;
        });
        amazonFees = parseFloat(amazonFees.toFixed(2));
    } else {
        amazonFees = economicsMetrics.amazonFees?.amount || 0;
        if (amazonFees === 0) {
            amazonFees = fbaFees + storageFees;
        }
    }
    
    const grossProfit = totalSales - amazonFees - refunds;
    const otherAmazonFees = Math.max(0, amazonFees - fbaFees);

    return {
        createdAt: economicsMetrics.createdAt || new Date(),
        Gross_Profit: parseFloat(grossProfit.toFixed(2)),
        Total_Sales: totalSales,
        ProductAdsPayment: adsPPCSpend,
        FBA_Fees: fbaFees,
        Storage: storageFees,
        Amazon_Charges: 0,
        Amazon_Fees: amazonFees,
        Other_Amazon_Fees: otherAmazonFees,
        Refunds: refunds
    };
};

/**
 * Convert EconomicsMetrics to legacy TotalSales format
 */
const convertToTotalSales = (economicsMetrics) => {
    if (!economicsMetrics || !Array.isArray(economicsMetrics.datewiseSales)) {
        return [];
    }

    return economicsMetrics.datewiseSales.map(item => {
        const date = item.date ? new Date(item.date) : new Date();
        const dateStr = date.toISOString().split('T')[0];
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);
        
        return {
            interval: `${date.toISOString()}--${endDate.toISOString()}`,
            TotalAmount: item.sales?.amount || 0,
            TotalQuantity: item.unitsSold || 0,
            grossProfit: item.grossProfit?.amount || 0
        };
    });
};

/**
 * Calculate profitability errors
 * (Same logic as DashboardCalculation.calculateProfitabilityErrors)
 */
const calculateProfitabilityErrors = (profitibilityData, totalProducts = []) => {
    let totalErrors = 0;
    const errorDetails = [];
    
    const productNameMap = new Map();
    if (Array.isArray(totalProducts)) {
        totalProducts.forEach(product => {
            if (product.asin) {
                productNameMap.set(product.asin, product.itemName || product.title || product.productName || null);
            }
        });
    }
    
    profitibilityData.forEach((item) => {
        const netProfit = (item.sales || 0) - (item.ads || 0) - (item.amzFee || 0);
        const profitMargin = item.sales > 0 ? (netProfit / item.sales) * 100 : 0;
        
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
 * Calculate profitability dashboard data (FAST VERSION)
 * This replaces the full analyseData() call for profitability endpoints
 * 
 * @param {Object} rawData - Raw data from fetchProfitabilityData
 * @returns {Promise<Object>} Profitability dashboard data
 */
const calculateProfitabilityDashboard = async (rawData) => {
    const calcStartTime = Date.now();
    logger.info('[PERF] ProfitabilityService.calculateProfitabilityDashboard starting');

    const {
        economicsMetricsData,
        products,
        ProductWiseSponsoredAds,
        dateWisePPCspendData,
        adsPPCSpend,
        country,
        region
    } = rawData;

    // Get ASIN-wise PPC sales from economics (handles big accounts)
    const economicsData = await getAsinPpcSalesFromEconomics(economicsMetricsData);

    // Prepare TotalProducts array from seller data
    const TotalProducts = products.map(p => ({
        asin: p.asin,
        sku: p.sku,
        status: p.status,
        itemName: p.itemName,
        title: p.itemName,
        price: p.price,
        fbaFees: p.fbaFees
    }));

    // Get active products only
    const activeProductSet = new Set();
    const ActiveProducts = [];
    TotalProducts.forEach(p => {
        if (p.status === 'Active') {
            activeProductSet.add(p.asin);
            ActiveProducts.push(p.asin);
        }
    });

    // Filter sponsored ads for active products
    const activeProductWiseSponsoredAds = [];
    if (ProductWiseSponsoredAds.length > 0 && ProductWiseSponsoredAds[0]?.sponsoredAds) {
        ProductWiseSponsoredAds[0].sponsoredAds.forEach(item => {
            if (item && item.asin && activeProductSet.has(item.asin)) {
                activeProductWiseSponsoredAds.push(item);
            }
        });
    }

    // Calculate SalesByProducts from economics ASIN data
    const SalesByProducts = Object.entries(economicsData.asinPpcSales)
        .filter(([asin]) => activeProductSet.has(asin))
        .map(([asin, data]) => ({
            asin,
            amount: data.sales,
            quantity: data.unitsSold
        }));

    // Calculate profitability data
    const profitibilityData = Profitability(
        SalesByProducts,
        activeProductWiseSponsoredAds,
        [], // productWiseFBAData (legacy, not needed with EconomicsMetrics)
        [], // FBAFeesData (legacy, not needed with EconomicsMetrics)
        economicsData.asinPpcSales
    );

    // Calculate sponsored ads metrics
    const sponsoredAdsMetrics = calculateSponsoredAdsMetrics(activeProductWiseSponsoredAds);
    
    // Calculate ACOS and TACOS
    const totalPpcSpent = sponsoredAdsMetrics.totalCost || 0;
    const totalSales = economicsData.totalSales || 0;
    sponsoredAdsMetrics.acos = sponsoredAdsMetrics.totalSalesIn30Days > 0 
        ? Math.round((totalPpcSpent / sponsoredAdsMetrics.totalSalesIn30Days) * 100 * 100) / 100 
        : 0;
    sponsoredAdsMetrics.tacos = totalSales > 0 
        ? Math.round((totalPpcSpent / totalSales) * 100 * 100) / 100 
        : 0;

    // Calculate profitability errors
    const profitabilityErrorsData = calculateProfitabilityErrors(profitibilityData, TotalProducts);

    // Convert to legacy formats
    const accountFinance = convertToAccountFinance(economicsMetricsData, adsPPCSpend);
    const TotalSales = convertToTotalSales(economicsMetricsData);
    const dateWiseTotalCosts = calculateDateWiseTotalCosts(dateWisePPCspendData);

    // Build ProductWiseSponsoredAdsGraphData
    const ProductWiseSponsoredAdsGraphData = {};
    activeProductWiseSponsoredAds.forEach(item => {
        if (item.asin) {
            ProductWiseSponsoredAdsGraphData[item.asin] = {
                spend: item.spend || 0,
                impressions: item.impressions || 0,
                clicks: item.clicks || 0,
                attributedSales1d: item.attributedSales1d || item.attributedSales7d || 0
            };
        }
    });

    // Get date range from economics metrics
    const startDate = economicsMetricsData?.dateRange?.startDate || new Date().toISOString().split('T')[0];
    const endDate = economicsMetricsData?.dateRange?.endDate || new Date().toISOString().split('T')[0];

    const calcTime = Date.now() - calcStartTime;
    logger.info(`[PERF] ProfitabilityService.calculateProfitabilityDashboard completed in ${calcTime}ms`);

    return {
        // Core profitability data
        profitibilityData,
        totalProfitabilityErrors: profitabilityErrorsData.totalErrors,
        profitabilityErrorDetails: profitabilityErrorsData.errorDetails,
        
        // Product data
        TotalProduct: TotalProducts,
        ActiveProducts,
        SalesByProducts,
        
        // Finance and sales data
        accountFinance,
        TotalWeeklySale: economicsData.totalSales,
        TotalSales,
        economicsMetrics: economicsMetricsData ? {
            totalSales: economicsMetricsData.totalSales,
            grossProfit: economicsMetricsData.grossProfit,
            ppcSpent: economicsMetricsData.ppcSpent,
            fbaFees: economicsMetricsData.fbaFees,
            storageFees: economicsMetricsData.storageFees,
            totalFees: economicsMetricsData.totalFees,
            amazonFees: economicsMetricsData.amazonFees,
            refunds: economicsMetricsData.refunds,
            datewiseSales: economicsMetricsData.datewiseSales,
            datewiseGrossProfit: economicsMetricsData.datewiseGrossProfit,
            asinWiseSales: economicsMetricsData.isBig ? [] : (economicsMetricsData.asinWiseSales || []),
            dateRange: economicsMetricsData.dateRange,
            isBig: economicsMetricsData.isBig || false
        } : null,
        
        // PPC/Ads data
        ProductWiseSponsoredAdsGraphData,
        sponsoredAdsMetrics,
        dateWiseTotalCosts,
        
        // Date range
        calendarMode: 'default',
        Country: country,
        startDate,
        endDate
    };
};

/**
 * Get profitability summary data (PHASE 1 - FAST)
 * Returns only metrics and chart data, no product table
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Promise<Object>} Profitability summary data
 */
const getProfitabilitySummary = async (userId, country, region) => {
    const startTime = Date.now();
    logger.info(`[PERF] ProfitabilityService.getProfitabilitySummary starting for user ${userId}`);

    // Fetch minimal data (EconomicsMetrics + PPC spend only)
    // OPTIMIZED: Only select fields needed for summary
    const [economicsMetricsData, productWiseSponsoredAds] = await Promise.all([
        EconomicsMetrics.findLatest(userId, region, country)
            .select('datewiseSales totalSales grossProfit fbaFees storageFees refunds dateRange')
            .lean(),
        getProductWiseSponsoredAdsData(userId, country, region)
    ]);

    // With .lean(), economicsMetricsData is already a plain object
    const processedEconomicsMetrics = economicsMetricsData;

    // Calculate PPC spend from Amazon Ads API
    let adsPPCSpend = 0;
    const sponsoredAdsArray = productWiseSponsoredAds?.sponsoredAds || [];
    sponsoredAdsArray.forEach(item => {
        if (item && item.spend !== undefined) {
            adsPPCSpend += parseFloat(item.spend) || 0;
        }
    });
    adsPPCSpend = parseFloat(adsPPCSpend.toFixed(2));

    // Calculate totals
    let totalSales = 0;
    let totalGrossProfit = 0;
    
    if (processedEconomicsMetrics && Array.isArray(processedEconomicsMetrics.datewiseSales)) {
        processedEconomicsMetrics.datewiseSales.forEach(item => {
            totalSales += item.sales?.amount || 0;
            totalGrossProfit += item.grossProfit?.amount || 0;
        });
    }

    const accountFinance = convertToAccountFinance(processedEconomicsMetrics, adsPPCSpend);
    const TotalSales = convertToTotalSales(processedEconomicsMetrics);

    // Calculate sponsored ads metrics
    const sponsoredAdsMetrics = calculateSponsoredAdsMetrics(sponsoredAdsArray);
    sponsoredAdsMetrics.acos = sponsoredAdsMetrics.totalSalesIn30Days > 0 
        ? Math.round((adsPPCSpend / sponsoredAdsMetrics.totalSalesIn30Days) * 100 * 100) / 100 
        : 0;
    sponsoredAdsMetrics.tacos = totalSales > 0 
        ? Math.round((adsPPCSpend / totalSales) * 100 * 100) / 100 
        : 0;

    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityService.getProfitabilitySummary completed in ${fetchTime}ms`);

    return {
        accountFinance,
        TotalWeeklySale: parseFloat(totalSales.toFixed(2)),
        TotalSales,
        sponsoredAdsMetrics,
        economicsMetrics: processedEconomicsMetrics ? {
            totalSales: processedEconomicsMetrics.totalSales,
            grossProfit: processedEconomicsMetrics.grossProfit,
            ppcSpent: processedEconomicsMetrics.ppcSpent,
            fbaFees: processedEconomicsMetrics.fbaFees,
            storageFees: processedEconomicsMetrics.storageFees,
            amazonFees: processedEconomicsMetrics.amazonFees,
            refunds: processedEconomicsMetrics.refunds,
            datewiseSales: processedEconomicsMetrics.datewiseSales,
            dateRange: processedEconomicsMetrics.dateRange,
            isBig: processedEconomicsMetrics.isBig || false
        } : null,
        calendarMode: 'default',
        Country: country,
        startDate: processedEconomicsMetrics?.dateRange?.startDate || new Date().toISOString().split('T')[0],
        endDate: processedEconomicsMetrics?.dateRange?.endDate || new Date().toISOString().split('T')[0]
    };
};

/**
 * ============================================================================
 * PHASE-BASED ENDPOINTS FOR PARALLEL LOADING
 * ============================================================================
 * These endpoints are designed to be called in parallel for faster page load.
 * Phase 1 (Metrics): ~50-100ms - KPI boxes data
 * Phase 2 (Chart): ~50-100ms - Gross profit vs total sales chart
 * Phase 3 (Table): ~100-300ms - Paginated profitability table
 */

/**
 * PHASE 1: Get profitability metrics (KPI boxes)
 * Returns: Total Sales, Total PPC Sales, Total Ad Spend, ACOS%, Amazon Fees, Gross Profit
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Promise<Object>} Metrics data for KPI boxes
 */
const getProfitabilityMetrics = async (userId, country, region) => {
    const startTime = Date.now();
    logger.info(`[PERF] ProfitabilityService.getProfitabilityMetrics starting for user ${userId}`);

    // Fetch only what we need for metrics (EconomicsMetrics + PPCMetrics summary)
    // OPTIMIZED: Only select fields needed for metrics calculation
    const [economicsMetricsData, ppcMetricsData] = await Promise.all([
        EconomicsMetrics.findLatest(userId, region, country)
            .select('datewiseSales datewiseFeesAndRefunds datewiseAmazonFees totalSales grossProfit fbaFees storageFees refunds dateRange')
            .lean(),
        require('../../models/amazon-ads/PPCMetricsModel.js').findLatestForUser(userId, country, region)
    ]);

    // With .lean(), economicsMetricsData is already a plain object
    const processedEconomicsMetrics = economicsMetricsData;

    // Calculate totals from datewiseSales for consistency
    let totalSales = 0;
    let totalGrossProfit = 0;
    let fbaFees = 0;
    let storageFees = 0;
    let refunds = 0;
    let amazonFees = 0;
    
    if (processedEconomicsMetrics) {
        if (Array.isArray(processedEconomicsMetrics.datewiseSales) && processedEconomicsMetrics.datewiseSales.length > 0) {
            processedEconomicsMetrics.datewiseSales.forEach(item => {
                totalSales += item.sales?.amount || 0;
                totalGrossProfit += item.grossProfit?.amount || 0;
            });
            totalSales = parseFloat(totalSales.toFixed(2));
            totalGrossProfit = parseFloat(totalGrossProfit.toFixed(2));
        } else {
            totalSales = processedEconomicsMetrics.totalSales?.amount || 0;
            totalGrossProfit = processedEconomicsMetrics.grossProfit?.amount || 0;
        }
        
        // Calculate fees from datewise data
        if (Array.isArray(processedEconomicsMetrics.datewiseFeesAndRefunds) && processedEconomicsMetrics.datewiseFeesAndRefunds.length > 0) {
            processedEconomicsMetrics.datewiseFeesAndRefunds.forEach(item => {
                fbaFees += item.fbaFulfillmentFee?.amount || 0;
                storageFees += item.storageFee?.amount || 0;
                refunds += item.refunds?.amount || 0;
            });
            fbaFees = parseFloat(fbaFees.toFixed(2));
            storageFees = parseFloat(storageFees.toFixed(2));
            refunds = parseFloat(refunds.toFixed(2));
        } else {
            fbaFees = processedEconomicsMetrics.fbaFees?.amount || 0;
            storageFees = processedEconomicsMetrics.storageFees?.amount || 0;
            refunds = processedEconomicsMetrics.refunds?.amount || 0;
        }
        
        // Get Amazon fees
        if (Array.isArray(processedEconomicsMetrics.datewiseAmazonFees) && processedEconomicsMetrics.datewiseAmazonFees.length > 0) {
            processedEconomicsMetrics.datewiseAmazonFees.forEach(item => {
                amazonFees += item.totalAmount?.amount || 0;
            });
            amazonFees = parseFloat(amazonFees.toFixed(2));
        } else {
            amazonFees = processedEconomicsMetrics.amazonFees?.amount || 0;
            if (amazonFees === 0) {
                amazonFees = fbaFees + storageFees;
            }
        }
    }

    // Get PPC data from PPCMetrics model
    // Note: PPCMetrics stores totals in the 'summary' sub-object
    let totalPpcSales = 0;
    let totalAdSpend = 0;
    let acos = 0;
    
    if (ppcMetricsData) {
        // Access summary object where totals are stored
        const summary = ppcMetricsData.summary || {};
        totalPpcSales = summary.totalSales || 0;
        totalAdSpend = summary.totalSpend || 0;
        acos = summary.overallAcos || 0;
        
        logger.info(`[ProfitabilityMetrics] PPC data found: totalSales=${totalPpcSales}, totalSpend=${totalAdSpend}, acos=${acos}`);
        
        // Calculate ACOS if not stored
        if (!acos && totalPpcSales > 0 && totalAdSpend > 0) {
            acos = (totalAdSpend / totalPpcSales) * 100;
        }
    } else {
        logger.info(`[ProfitabilityMetrics] No PPCMetrics data found for user ${userId}, country ${country}, region ${region}`);
    }

    // Calculate gross profit (Sales - Amazon Fees - Refunds - Ad Spend)
    const grossProfit = totalGrossProfit - totalAdSpend;

    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityService.getProfitabilityMetrics completed in ${fetchTime}ms`);

    return {
        totalSales,
        totalPpcSales,
        totalAdSpend,
        acos: parseFloat(acos.toFixed(2)),
        amazonFees,
        grossProfit: parseFloat(grossProfit.toFixed(2)),
        fbaFees,
        storageFees,
        refunds,
        // Additional data for backward compatibility
        accountFinance: {
            Total_Sales: totalSales,
            Gross_Profit: totalGrossProfit,
            ProductAdsPayment: totalAdSpend,
            FBA_Fees: fbaFees,
            Storage: storageFees,
            Amazon_Fees: amazonFees,
            Refunds: refunds
        },
        dateRange: processedEconomicsMetrics?.dateRange || null,
        Country: country
    };
};

/**
 * PHASE 2: Get profitability chart data
 * Returns: Datewise gross profit and total sales for chart
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Promise<Object>} Chart data
 */
const getProfitabilityChart = async (userId, country, region) => {
    const startTime = Date.now();
    logger.info(`[PERF] ProfitabilityService.getProfitabilityChart starting for user ${userId}`);

    // Fetch only EconomicsMetrics for datewise data
    // OPTIMIZED: Only select fields needed for chart
    const economicsMetricsData = await EconomicsMetrics.findLatest(userId, region, country)
        .select('datewiseSales dateRange')
        .lean();

    // With .lean(), economicsMetricsData is already a plain object
    const processedEconomicsMetrics = economicsMetricsData;

    // Build chart data from datewiseSales
    let chartData = [];
    
    if (processedEconomicsMetrics && Array.isArray(processedEconomicsMetrics.datewiseSales) && processedEconomicsMetrics.datewiseSales.length > 0) {
        chartData = processedEconomicsMetrics.datewiseSales
            .map(item => {
                if (!item.date) return null;
                
                return {
                    date: item.date,
                    totalSales: parseFloat((item.sales?.amount || 0).toFixed(2)),
                    grossProfit: parseFloat((item.grossProfit?.amount || 0).toFixed(2))
                };
            })
            .filter(item => item !== null)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityService.getProfitabilityChart completed in ${fetchTime}ms`);

    return {
        chartData,
        dateRange: processedEconomicsMetrics?.dateRange || null,
        Country: country
    };
};

/**
 * INTERNAL: Compute full profitability table data (all parents, children, errors)
 * This is the same logic as before, but extracted for caching.
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Promise<Object>} Full computed profitability data
 */
const computeFullProfitabilityTableData = async (userId, country, region) => {
    const startTime = Date.now();
    logger.info(`[PERF] Computing full profitability table data for user ${userId}`);

    // Fetch initial data in parallel (same as before)
    // OPTIMIZED: Use getAdsSpendByAsin instead of loading all sponsored ads items
    const [economicsMetricsData, sellerData, adsSpendByAsin] = await Promise.all([
        EconomicsMetrics.findLatest(userId, region, country)
            .select('_id isBig asinWiseSales datewiseSales totalSales grossProfit dateRange')
            .lean(),
        Seller.findOne(
            { User: userId },
            { 
                'sellerAccount': {
                    $elemMatch: { region, country }
                }
            }
        ).lean(),
        getAdsSpendByAsin(userId, country, region)
    ]);

    const processedEconomicsMetrics = economicsMetricsData;

    // Get ASIN-wise data from economics (handles big accounts, includes parentAsin)
    const economicsData = await getAsinPpcSalesFromEconomics(processedEconomicsMetrics);

    // Extract products from seller data
    const products = sellerData?.sellerAccount?.[0]?.products || [];
    
    // Create product name map
    const productNameMap = new Map();
    products.forEach(p => {
        if (p.asin) {
            productNameMap.set(p.asin, {
                itemName: p.itemName,
                sku: p.sku,
                status: p.status,
                price: p.price
            });
        }
    });

    // Get active products only
    const activeProductSet = new Set();
    products.forEach(p => {
        if (p.status === 'Active') {
            activeProductSet.add(p.asin);
        }
    });

    // Step 1: Aggregate by child ASIN first (keeping parentAsin info)
    const asinAggregates = new Map();
    
    Object.entries(economicsData.asinPpcSales).forEach(([asin, data]) => {
        if (!activeProductSet.has(asin)) return;
        
        const parentAsin = data.parentAsin || asin;
        const productInfo = productNameMap.get(asin) || {};
        const adsSpend = adsSpendByAsin.get(asin) || 0;
        const sales = data.sales || 0;
        const totalFees = data.totalFees || 0;
        const grossProfit = sales - adsSpend - totalFees;
        const profitMargin = sales > 0 ? (grossProfit / sales) * 100 : 0;
        
        asinAggregates.set(asin, {
            asin,
            parentAsin,
            itemName: productInfo.itemName || null,
            sku: productInfo.sku || null,
            quantity: data.unitsSold || 0,
            sales: parseFloat(sales.toFixed(2)),
            ads: parseFloat(adsSpend.toFixed(2)),
            amzFee: parseFloat(totalFees.toFixed(2)),
            totalFees: parseFloat(totalFees.toFixed(2)),
            amazonFees: parseFloat((data.amazonFees || totalFees).toFixed(2)),
            fbaFees: parseFloat((data.fbaFees || 0).toFixed(2)),
            storageFees: parseFloat((data.storageFees || 0).toFixed(2)),
            grossProfit: parseFloat(grossProfit.toFixed(2)),
            profitMargin: parseFloat(profitMargin.toFixed(2)),
            source: 'economicsMetrics',
            adsSource: 'amazonAdsAPI'
        });
    });

    // Step 2: Group by parentAsin
    const parentGroups = new Map();
    
    asinAggregates.forEach((agg, asin) => {
        const parentAsin = agg.parentAsin || asin;
        
        if (!parentGroups.has(parentAsin)) {
            parentGroups.set(parentAsin, {
                parentAsin,
                children: [],
                totalSales: 0,
                totalQuantity: 0,
                totalAds: 0,
                totalFees: 0,
                totalAmazonFees: 0,
                totalFbaFees: 0,
                totalStorageFees: 0,
                totalGrossProfit: 0
            });
        }
        
        const parent = parentGroups.get(parentAsin);
        parent.children.push(agg);
        parent.totalSales += agg.sales;
        parent.totalQuantity += agg.quantity;
        parent.totalAds += agg.ads;
        parent.totalFees += agg.totalFees;
        parent.totalAmazonFees += agg.amazonFees;
        parent.totalFbaFees += agg.fbaFees;
        parent.totalStorageFees += agg.storageFees;
        parent.totalGrossProfit += agg.grossProfit;
    });

    // Step 3: Convert to display format with parent-child structure
    const allProfitabilityData = [];
    let totalChildCount = 0;
    
    parentGroups.forEach((parent, parentAsin) => {
        const productInfo = productNameMap.get(parentAsin) || {};
        const actualChildren = parent.children.filter(child => child.asin !== parentAsin);
        const actualChildCount = actualChildren.length;
        totalChildCount += actualChildCount;
        const isExpandable = actualChildCount > 0;
        const grossProfit = parseFloat(parent.totalGrossProfit.toFixed(2));
        const profitMargin = parent.totalSales > 0 ? (grossProfit / parent.totalSales) * 100 : 0;
        
        const childrenForDisplay = actualChildren
            .map(child => ({
                asin: child.asin,
                itemName: child.itemName,
                sku: child.sku,
                quantity: child.quantity,
                sales: child.sales,
                ads: child.ads,
                amzFee: child.amzFee,
                totalFees: child.totalFees,
                amazonFees: child.amazonFees,
                fbaFees: child.fbaFees,
                storageFees: child.storageFees,
                grossProfit: child.grossProfit,
                profitMargin: child.profitMargin,
                source: child.source,
                adsSource: child.adsSource
            }))
            .sort((a, b) => b.sales - a.sales);
        
        allProfitabilityData.push({
            asin: parentAsin,
            parentAsin: null,
            itemName: productInfo.itemName || null,
            sku: productInfo.sku || null,
            quantity: parent.totalQuantity,
            sales: parseFloat(parent.totalSales.toFixed(2)),
            ads: parseFloat(parent.totalAds.toFixed(2)),
            amzFee: parseFloat(parent.totalFees.toFixed(2)),
            totalFees: parseFloat(parent.totalFees.toFixed(2)),
            amazonFees: parseFloat(parent.totalAmazonFees.toFixed(2)),
            fbaFees: parseFloat(parent.totalFbaFees.toFixed(2)),
            storageFees: parseFloat(parent.totalStorageFees.toFixed(2)),
            grossProfit: grossProfit,
            profitMargin: parseFloat(profitMargin.toFixed(2)),
            source: 'economicsMetrics',
            adsSource: 'amazonAdsAPI',
            isParent: true,
            isExpandable: isExpandable,
            children: childrenForDisplay,
            childrenCount: actualChildCount
        });
    });

    // Sort by sales descending (highest revenue first)
    allProfitabilityData.sort((a, b) => b.sales - a.sales);

    // Calculate error counts (for the full dataset)
    const flatDataForErrors = [];
    allProfitabilityData.forEach(parent => {
        flatDataForErrors.push(parent);
        if (parent.children && parent.children.length > 0) {
            flatDataForErrors.push(...parent.children);
        }
    });
    const profitabilityErrorsData = calculateProfitabilityErrors(flatDataForErrors, products);

    const totalParents = allProfitabilityData.length;
    const totalProducts = totalParents + totalChildCount;

    const computeTime = Date.now() - startTime;
    logger.info(`[PERF] Full profitability table computed in ${computeTime}ms, ${totalParents} parents, ${totalChildCount} children`);

    return {
        allProfitabilityData,
        totalParents,
        totalChildCount,
        totalProducts,
        totalProfitabilityErrors: profitabilityErrorsData.totalErrors,
        profitabilityErrorDetails: profitabilityErrorsData.errorDetails.slice(0, 10),
        country,
        computedAt: Date.now()
    };
};

/**
 * PHASE 3: Get profitability table data (PAGINATED)
 * Returns: Paginated ASIN-wise profitability data
 * 
 * TRUE BACKEND PAGINATION: Only fetches the data needed for the requested page.
 * - Uses MongoDB aggregation with $skip/$limit to get only N parents
 * - Gets total counts via separate lightweight aggregation
 * - Gets error counts via separate aggregation (not building full list)
 * - Memory efficient: no OOM for large accounts
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated table data
 */
const getProfitabilityTable = async (userId, country, region, page = 1, limit = 10) => {
    const startTime = Date.now();
    logger.info(`[PERF] ProfitabilityService.getProfitabilityTable (V2 - True Pagination) starting for user ${userId}, page ${page}, limit ${limit}`);

    // Step 1: Get EconomicsMetrics to check if big account and get metricsId
    const economicsMetricsData = await EconomicsMetrics.findLatest(userId, region, country)
        .select('_id isBig totalSales')
        .lean();
    
    if (!economicsMetricsData) {
        logger.info(`[PERF] No EconomicsMetrics found for user ${userId}`);
        return {
            profitibilityData: [],
            pagination: { page, limit, totalItems: 0, totalPages: 0, hasMore: false },
            totalParents: 0,
            totalChildren: 0,
            totalProducts: 0,
            totalProfitabilityErrors: 0,
            profitabilityErrorDetails: [],
            Country: country
        };
    }

    const metricsId = economicsMetricsData._id;
    const isBigAccount = economicsMetricsData.isBig === true || 
        (economicsMetricsData.totalSales?.amount > 5000);

    // Step 2: Get product info (only asin, itemName, sku, status for the lookup)
    // Note: Can't combine $elemMatch with field projection on nested arrays
    // So we use $elemMatch to filter by region/country, then get full products array
    const sellerData = await Seller.findOne(
        { User: userId },
        { 
            'sellerAccount': {
                $elemMatch: { region, country }
            }
        }
    ).lean();

    const products = sellerData?.sellerAccount?.[0]?.products || [];
    
    // Create lightweight product name map
    const productNameMap = new Map();
    products.forEach(p => {
        if (p.asin) {
            productNameMap.set(p.asin, {
                itemName: p.itemName,
                sku: p.sku,
                status: p.status
            });
        }
    });

    // Step 3: Get aggregated ads spend by ASIN (optimized - uses MongoDB aggregation + Redis cache)
    // This is much faster than loading all sponsored ads items and aggregating in Node
    const adsSpendByAsin = await getAdsSpendByAsin(userId, country, region);

    let paginatedData = [];
    let totalParents = 0;
    let totalChildren = 0;
    let totalProfitabilityErrors = 0;
    let profitabilityErrorDetails = [];

    if (isBigAccount) {
        // BIG ACCOUNT: Use optimized MongoDB aggregation with true pagination
        logger.info(`[PERF] Big account detected, using aggregation-based pagination`);
        
        // Get paginated parent data + counts in parallel
        const [paginatedResult, errorsResult] = await Promise.all([
            AsinWiseSalesForBigAccounts.getPaginatedParentProfitability(metricsId, page, limit),
            AsinWiseSalesForBigAccounts.getProfitabilityErrors(metricsId, 10)
        ]);

        totalParents = paginatedResult.totalParents;
        totalChildren = paginatedResult.totalChildren;
        totalProfitabilityErrors = errorsResult.totalErrors;
        profitabilityErrorDetails = errorsResult.errorDetails;

        // Transform aggregation result to match expected format
        paginatedData = paginatedResult.parents.map(parent => {
            const productInfo = productNameMap.get(parent.parentAsin) || {};
            const adsSpend = adsSpendByAsin.get(parent.parentAsin) || 0;
            
            // Recalculate gross profit with ads spend from Amazon Ads API
            const salesMinusFees = parent.totalSales - parent.totalFees;
            const grossProfit = salesMinusFees - adsSpend;
            const profitMargin = parent.totalSales > 0 ? (grossProfit / parent.totalSales) * 100 : 0;
            
            // Transform children
            const childrenForDisplay = parent.children.map(child => {
                const childProductInfo = productNameMap.get(child.asin) || {};
                const childAdsSpend = adsSpendByAsin.get(child.asin) || 0;
                const childGrossProfit = child.sales - child.totalFees - childAdsSpend;
                const childProfitMargin = child.sales > 0 ? (childGrossProfit / child.sales) * 100 : 0;
                
                return {
                    asin: child.asin,
                    itemName: childProductInfo.itemName || null,
                    sku: childProductInfo.sku || null,
                    quantity: child.quantity,
                    sales: parseFloat(child.sales.toFixed(2)),
                    ads: parseFloat(childAdsSpend.toFixed(2)),
                    amzFee: parseFloat(child.totalFees.toFixed(2)),
                    totalFees: parseFloat(child.totalFees.toFixed(2)),
                    amazonFees: parseFloat(child.amazonFees.toFixed(2)),
                    fbaFees: parseFloat(child.fbaFees.toFixed(2)),
                    storageFees: parseFloat(child.storageFees.toFixed(2)),
                    grossProfit: parseFloat(childGrossProfit.toFixed(2)),
                    profitMargin: parseFloat(childProfitMargin.toFixed(2)),
                    source: 'economicsMetrics',
                    adsSource: 'amazonAdsAPI'
                };
            });

            return {
                asin: parent.parentAsin,
                parentAsin: null,
                itemName: productInfo.itemName || null,
                sku: productInfo.sku || null,
                quantity: parent.totalQuantity,
                sales: parseFloat(parent.totalSales.toFixed(2)),
                ads: parseFloat(adsSpend.toFixed(2)),
                amzFee: parseFloat(parent.totalFees.toFixed(2)),
                totalFees: parseFloat(parent.totalFees.toFixed(2)),
                amazonFees: parseFloat(parent.totalAmazonFees.toFixed(2)),
                fbaFees: parseFloat(parent.totalFbaFees.toFixed(2)),
                storageFees: parseFloat(parent.totalStorageFees.toFixed(2)),
                grossProfit: parseFloat(grossProfit.toFixed(2)),
                profitMargin: parseFloat(profitMargin.toFixed(2)),
                source: 'economicsMetrics',
                adsSource: 'amazonAdsAPI',
                isParent: true,
                isExpandable: childrenForDisplay.length > 0,
                children: childrenForDisplay,
                childrenCount: childrenForDisplay.length
            };
        });

        // Add product names to error details
        profitabilityErrorDetails = profitabilityErrorDetails.map(err => ({
            ...err,
            productName: productNameMap.get(err.asin)?.itemName || null
        }));

    } else {
        // SMALL ACCOUNT: Use in-memory processing (data fits in memory)
        // Fall back to original logic for small accounts
        logger.info(`[PERF] Small account, using in-memory pagination`);
        
        const fullData = await computeFullProfitabilityTableData(userId, country, region);
        
        totalParents = fullData.totalParents;
        totalChildren = fullData.totalChildCount;
        totalProfitabilityErrors = fullData.totalProfitabilityErrors;
        profitabilityErrorDetails = fullData.profitabilityErrorDetails;
        
        // Apply pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        paginatedData = fullData.allProfitabilityData.slice(startIndex, endIndex);
    }

    const totalProducts = totalParents + totalChildren;
    const totalPages = Math.ceil(totalParents / limit);

    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityService.getProfitabilityTable completed in ${fetchTime}ms, page ${page}/${totalPages}, ${paginatedData.length} items`);

    return {
        profitibilityData: paginatedData,
        pagination: {
            page,
            limit,
            totalItems: totalParents,
            totalPages,
            hasMore: page < totalPages
        },
        totalParents,
        totalChildren,
        totalProducts,
        totalProfitabilityErrors,
        profitabilityErrorDetails,
        Country: country
    };
};

module.exports = {
    fetchProfitabilityData,
    calculateProfitabilityDashboard,
    getProfitabilitySummary,
    getAsinPpcSalesFromEconomics,
    calculateDateWiseTotalCosts,
    convertToAccountFinance,
    convertToTotalSales,
    calculateProfitabilityErrors,
    // Phase-based endpoints
    getProfitabilityMetrics,
    getProfitabilityChart,
    getProfitabilityTable
};
