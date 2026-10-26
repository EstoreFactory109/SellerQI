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
const SalesOnlyMetrics = require('../../models/MCP/SalesOnlyMetricsModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const GetDateWisePPCspendModel = require('../../models/amazon-ads/GetDateWisePPCspendModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const { getProductWiseSponsoredAdsData } = require('../amazon-ads/ProductWiseSponsoredAdsService.js');
const Profitability = require('./ProfitabilityCalculation.js');
const { classifyProfitabilityRow } = require('./RecoverableAmountUtils.js');

// Per-unit COGS by ASIN, {} when none is entered or the read fails: the loss rule
// (tasks-logics.xlsx "Loss-making product") needs it, as the tasks do.
const loadCogsMap = async (userId, country) => {
    try {
        const cogs = await require('../Finance/CogsService.js').getCogs(userId, country);
        return (cogs && cogs.success && cogs.data?.cogsValues) || {};
    } catch (error) {
        logger.warn('[Profitability] COGS unavailable', { userId, country, error: error.message });
        return {};
    }
};

const { calculateSponsoredAdsMetrics } = require('./SponsoredAdsCalculation.js');
// AsinFinanceWindowService requires this module back, but only lazily inside
// resolveAsinFinance, so loading it here at the top is cycle-safe.
const { resolveAsinFinance } = require('../Finance/AsinFinanceWindowService.js');
// Fresh EconomicsMetrics, else live DailySkuFinance, else null (the collection stopped being written).
const { loadLiveEconomics, isStoredEconomicsDoc } = require('../Finance/LiveEconomicsService.js');
const PPCMetricsModel = require('../../models/amazon-ads/PPCMetricsModel.js');

/**
 * Account-wide ad spend (SP + SB + SD + ST) from PPCMetrics over `dateRange`, or null when there is
 * no range or no PPC data for it.
 *
 * WHY. Product-wise spend (ProductWiseSponsoredAdsItem) only covers SP + SD — Amazon has no
 * ASIN-level Sponsored Brands report — so TACoS computed from it left all SB spend out. TACoS is an
 * account-level ratio, so its numerator must be the account's whole ad spend, over the same days as
 * the total-sales denominator. Product-wise spend stays the source for per-ASIN figures and ACOS
 * (SP+SD spend ÷ SP+SD sales is a consistent pair).
 */
async function getAccountAdSpendForRange(userId, country, region, dateRange) {
    if (!dateRange?.startDate || !dateRange?.endDate) return null;
    try {
        const r = await PPCMetricsModel.calculateMetricsForDateRange(
            userId?.toString() || userId, country, region, dateRange.startDate, dateRange.endDate
        );
        return r?.found ? Number(r.summary?.totalSpend || 0) : null;
    } catch (err) {
        logger.warn('[ProfitabilityService] getAccountAdSpendForRange failed', { error: err.message });
        return null;
    }
}

// Chunk size for yielding to event loop during large data processing
const YIELD_CHUNK_SIZE = 500;

// Lookback for the date-wise PPC spend merge. Matches DASHBOARD_ADS_LOOKBACK_DAYS in
// Analyse.js so the Profitability page and the PPC dashboard cover the same window.
const PROFITABILITY_PPC_LOOKBACK_DAYS = Math.max(
    1,
    parseInt(process.env.DASHBOARD_ADS_LOOKBACK_DAYS || '30', 10) || 30
);

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
        dateWisePPCspendData,
        cogsMap
    ] = await Promise.all([
        loadLiveEconomics(userId, region, country),
        Seller.findOne(
            { User: userId },
            { 
                'sellerAccount': {
                    $elemMatch: { region, country }
                }
            }
        ).lean(),
        getProductWiseSponsoredAdsData(userId, country, region),
        // Returns the merged FLAT ROW ARRAY, not a document — see the unwrap below.
        GetDateWisePPCspendModel.findMergedDateWiseSpends(userId, country, region, { lookbackDays: PROFITABILITY_PPC_LOOKBACK_DAYS }),
        loadCogsMap(userId, country)
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

    const accountAdSpend = await getAccountAdSpendForRange(
        userId, country, region, processedEconomicsMetricsData?.dateRange
    );

    return {
        economicsMetricsData: processedEconomicsMetricsData,
        products,
        ProductWiseSponsoredAds: ProductWiseSponsoredAdsArray,
        // BUG FIX: this read `dateWisePPCspendData?.data`, but the field has always been
        // `dateWisePPCSpends` — so this was ALWAYS `[]` and the Profitability page's
        // `dateWiseTotalCosts` was permanently empty, while still loading a ~10MB document
        // into heap to discard it. The fetch above now returns the merged flat array
        // directly, so this is just a pass-through.
        dateWisePPCspendData: Array.isArray(dateWisePPCspendData) ? dateWisePPCspendData : [],
        adsPPCSpend,
        // All ad types (incl. Sponsored Brands) over the economics window — the TACoS numerator.
        accountAdSpend,
        cogsMap,
        // calculateProfitabilityDashboard needs the account key for the live
        // per-ASIN fallback (resolveAsinFinance) when EconomicsMetrics is stale.
        userId,
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
        // No economics = no data, not $0.
        return { asinPpcSales: {}, totalSales: null, totalGrossProfit: null };
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

    // Big-account rows are keyed by a stored doc's _id; a live-built doc has its rows inline.
    if ((isBigAccount || isLegacyBigAccount) && hasEmptyAsinData && isStoredEconomicsDoc(economicsMetrics)) {
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
        // No economics = no data (null), not $0.
        return {
            createdAt: new Date(),
            Gross_Profit: null,
            Total_Sales: null,
            ProductAdsPayment: adsPPCSpend,
            FBA_Fees: null,
            Storage: null,
            Amazon_Charges: null,
            Amazon_Fees: null,
            Other_Amazon_Fees: null,
            Refunds: null
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
const calculateProfitabilityErrors = (profitibilityData, totalProducts = [], { financeFresh = true, cogsMap = null } = {}) => {
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
        // Same rule as the tasks (RecoverableAmountUtils.classifyProfitabilityRow): no
        // verdict on a row with no sales unless it is fresh ad spend, and none at all
        // on stale finance.
        const verdict = classifyProfitabilityRow(item, { financeFresh, cogsMap });
        if (!verdict) return;
        totalErrors++;
        errorDetails.push({
            asin: item.asin,
            productName: productNameMap.get(item.asin) || null,
            sales: item.sales,
            ads: item.ads || 0,
            netProfit: verdict.netProfit,
            profitMargin: verdict.profitMargin,
            errorType: verdict.errorType
        });
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
        accountAdSpend,
        cogsMap = null,
        userId,
        country,
        region
    } = rawData;

    // Per-ASIN sales/fees via the shared rule (resolveAsinFinance): a stale
    // EconomicsMetrics map is dropped and live DailySkuFinance (default 30-day
    // window) takes over, so this legacy endpoint agrees with the dashboard and
    // the Profitability page instead of showing April-2026 numbers as current.
    // totalSales is the account-level figure of the same loaded economics; null = no data.
    const resolvedFinance = await resolveAsinFinance({
        economicsMetrics: economicsMetricsData,
        userId,
        country,
        region
    });
    const economicsData = {
        asinPpcSales: resolvedFinance.asinPpcSales,
        totalSales: resolvedFinance.totalSales ?? null,
        totalGrossProfit: resolvedFinance.totalGrossProfit ?? null
    };

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
    
    // Calculate ACOS and TACOS. ACOS pairs product-wise (SP+SD) spend with SP+SD sales; TACoS uses
    // the account's whole ad spend incl. Sponsored Brands (see getAccountAdSpendForRange).
    const totalPpcSpent = sponsoredAdsMetrics.totalCost || 0;
    const totalSales = economicsData.totalSales || 0;
    const tacosSpend = accountAdSpend != null ? accountAdSpend : totalPpcSpent;
    sponsoredAdsMetrics.acos = sponsoredAdsMetrics.totalSalesIn30Days > 0 
        ? Math.round((totalPpcSpent / sponsoredAdsMetrics.totalSalesIn30Days) * 100 * 100) / 100 
        : 0;
    sponsoredAdsMetrics.tacos = totalSales > 0 
        ? Math.round((tacosSpend / totalSales) * 100 * 100) / 100 
        : 0;

    // Calculate profitability errors
    // Only judged on fresh per-ASIN finance (a recent EconomicsMetrics map or live
    // DailySkuFinance): EconomicsMetrics stopped being written in April 2026 and
    // issues from that doc would describe April.
    const profitabilityErrorsData = calculateProfitabilityErrors(profitibilityData, TotalProducts, {
        financeFresh: resolvedFinance.financeFresh,
        cogsMap
    });

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

    // Fetch minimal data (economics + PPC spend only). Economics is fresh
    // EconomicsMetrics, else live DailySkuFinance, else null.
    const [economicsMetricsData, productWiseSponsoredAds] = await Promise.all([
        loadLiveEconomics(userId, region, country),
        getProductWiseSponsoredAdsData(userId, country, region)
    ]);

    // The loader returns plain objects
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
    // TACoS numerator: all ad types incl. Sponsored Brands (see getAccountAdSpendForRange).
    const accountAdSpend = await getAccountAdSpendForRange(
        userId, country, region, processedEconomicsMetrics?.dateRange
    );
    const tacosSpend = accountAdSpend != null ? accountAdSpend : adsPPCSpend;
    sponsoredAdsMetrics.acos = sponsoredAdsMetrics.totalSalesIn30Days > 0 
        ? Math.round((adsPPCSpend / sponsoredAdsMetrics.totalSalesIn30Days) * 100 * 100) / 100 
        : 0;
    sponsoredAdsMetrics.tacos = totalSales > 0 
        ? Math.round((tacosSpend / totalSales) * 100 * 100) / 100 
        : 0;

    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityService.getProfitabilitySummary completed in ${fetchTime}ms`);

    return {
        accountFinance,
        // null = no economics for the account (not $0)
        TotalWeeklySale: processedEconomicsMetrics ? parseFloat(totalSales.toFixed(2)) : null,
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

    // Fetch only what we need for metrics (SalesOnlyMetrics + PPCMetrics rollup for ~last 30 days)
    const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
    const [economicsMetricsData, ppcRollup] = await Promise.all([
        SalesOnlyMetrics.findLatest(userId, region, country),
        PPCMetrics.rollupLastDays(userId, country, region, 30)
    ]);
    const ppcMetricsData =
        ppcRollup && ppcRollup.found && ppcRollup.summary ? { summary: ppcRollup.summary } : null;

    // With .lean(), economicsMetricsData is already a plain object
    const processedEconomicsMetrics = economicsMetricsData;

    // =====================================================================
    // EXACT COPY OF Analyse.js convertEconomicsToFinanceFormat() LOGIC
    // This ensures Profitability page shows the same gross profit as Dashboard
    // =====================================================================
    
    let totalSales = 0;
    let fbaFees = 0;
    let storageFees = 0;
    let refunds = 0;
    let amazonFees = 0;
    
    if (processedEconomicsMetrics) {
        // Calculate totalSales by summing datewiseSales
        if (Array.isArray(processedEconomicsMetrics.datewiseSales) && processedEconomicsMetrics.datewiseSales.length > 0) {
            processedEconomicsMetrics.datewiseSales.forEach(item => {
                totalSales += item.sales?.amount || 0;
            });
            totalSales = parseFloat(totalSales.toFixed(2));
        } else {
            totalSales = processedEconomicsMetrics.totalSales?.amount || 0;
        }
        
        // Calculate fees from datewise data for consistency (SAME as Analyse.js)
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
        
        // Get Amazon fees - calculate from datewiseAmazonFees for consistency (SAME as Analyse.js)
        if (Array.isArray(processedEconomicsMetrics.datewiseAmazonFees) && processedEconomicsMetrics.datewiseAmazonFees.length > 0) {
            // PRIMARY: Calculate from datewiseAmazonFees (most accurate)
            processedEconomicsMetrics.datewiseAmazonFees.forEach(item => {
                amazonFees += item.totalAmount?.amount || 0;
            });
            amazonFees = parseFloat(amazonFees.toFixed(2));
        } else {
            // Fallback 1: Get from summary level
            amazonFees = processedEconomicsMetrics.amazonFees?.amount || 0;
            
            // Final fallback: use fbaFees + storageFees if still 0
            if (amazonFees === 0) {
                amazonFees = fbaFees + storageFees;
            }
        }
    }
    
    // Calculate BACKEND gross profit: Sales - Amazon Fees - Refunds (SAME FORMULA as Analyse.js line 659)
    const backendGrossProfit = totalSales - amazonFees - refunds;

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

    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityService.getProfitabilityMetrics completed in ${fetchTime}ms`);

    return {
        totalSales,
        totalPpcSales,
        totalAdSpend,
        acos: parseFloat(acos.toFixed(2)),
        amazonFees: parseFloat(amazonFees.toFixed(2)),
        grossProfit: parseFloat(backendGrossProfit.toFixed(2)),
        fbaFees: parseFloat(fbaFees.toFixed(2)),
        storageFees: parseFloat(storageFees.toFixed(2)),
        refunds: parseFloat(refunds.toFixed(2)),
        accountFinance: {
            Total_Sales: totalSales,
            Gross_Profit: parseFloat(backendGrossProfit.toFixed(2)),
            ProductAdsPayment: totalAdSpend,
            FBA_Fees: parseFloat(fbaFees.toFixed(2)),
            Storage: parseFloat(storageFees.toFixed(2)),
            Amazon_Fees: parseFloat(amazonFees.toFixed(2)),
            Refunds: parseFloat(refunds.toFixed(2))
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

    // Fetch sales-only metrics for datewise data
    // Per-day model: findLatest aggregates recent 31 days into { totalSales, datewiseSales, dateRange }
    const economicsMetricsData = await SalesOnlyMetrics.findLatest(userId, region, country);

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
                    grossProfit: 0
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
    logger.info(`[PERF] ProfitabilityService.getProfitabilityTable (sales-only) starting for user ${userId}, page ${page}, limit ${limit}`);

    // Sales-only mode: we do not persist ASIN-wise fee/gross-profit data required for the original table.
    // Return an empty but well-shaped response so the UI can render a sales-only view without crashing.
    // Per-day model: findLatest aggregates recent 31 days into { totalSales, datewiseSales, dateRange }
    const salesOnlyMetricsData = await SalesOnlyMetrics.findLatest(userId, region, country);

    const hasData = !!salesOnlyMetricsData;
    const totalItems = hasData ? 0 : 0;
    const totalPages = 0;

    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityService.getProfitabilityTable (sales-only) completed in ${fetchTime}ms`);

    return {
        profitibilityData: [],
        pagination: {
            page,
            limit,
            totalItems,
            totalPages,
            hasMore: false,
        },
        totalParents: 0,
        totalChildren: 0,
        totalProducts: 0,
        totalProfitabilityErrors: 0,
        profitabilityErrorDetails: [],
        Country: country,
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
