/**
 * Page-wise Data Controller
 * 
 * This controller provides separate endpoints for each dashboard page.
 * Data is calculated in the backend and sent to the frontend ready for display.
 * 
 * NOTE: History recording is NOT done here. History is recorded:
 * 1. After first integration completes (in Integration.js)
 * 2. Weekly via dedicated WeeklyHistoryWorker (runs on Sundays)
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { AnalyseService } = require('../../Services/main/Analyse.js');
const { analyseData } = require('../../Services/Calculations/DashboardCalculation.js');
const CreateTaskService = require('../../Services/Calculations/CreateTasksService.js');
const logger = require('../../utils/Logger.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const NumberOfProductReviews = require('../../models/seller-performance/NumberOfProductReviewsModel.js');
const APlusContent = require('../../models/seller-performance/APlusContentModel.js');
const AccountHistory = require('../../models/user-auth/AccountHistory.js');
const User = require('../../models/user-auth/userModel.js');
const { getProductWiseSponsoredAdsData } = require('../../Services/amazon-ads/ProductWiseSponsoredAdsService.js');
const ProfitabilityService = require('../../Services/Calculations/ProfitabilityService.js');

/**
 * Get full dashboard data - calculates all data in backend
 * This is the main endpoint that replaces the old flow of:
 * 1. Frontend calling /getData
 * 2. Frontend calling calculation server
 * 3. Frontend displaying data
 */
const getDashboardData = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const adminId = req.query.adminId || null;

    // Validate required parameters
    if (!userId) {
        logger.error('Missing userId in request');
        return res.status(400).json(
            new ApiError(400, 'User ID is required')
        );
    }
    
    if (!Country || !Region) {
        logger.error('Missing country or region in request', { Country, Region });
        return res.status(400).json(
            new ApiError(400, 'Country and region are required')
        );
    }

    try {
        logger.info(`[PERF] Getting dashboard data for user ${userId}, region ${Region}, country ${Country}`);

        // Step 1: Get raw data from Analyse service
        let analyseResult;
        const analyseStartTime = Date.now();
        try {
            analyseResult = await AnalyseService.Analyse(userId, Country, Region, adminId);
            const analyseEndTime = Date.now();
            logger.info(`[PERF] Analyse service completed in ${analyseEndTime - analyseStartTime}ms, status: ${analyseResult?.status}`);
        } catch (analyseError) {
            logger.error('Error calling AnalyseService.Analyse:', {
                message: analyseError.message,
                stack: analyseError.stack,
                name: analyseError.name
            });
            return res.status(500).json(
                new ApiError(500, `Error fetching analysis data: ${analyseError.message || 'Unknown error'}`)
            );
        }
        
        if (!analyseResult || analyseResult.status !== 200) {
            logger.error('Analyse service returned error', { 
                status: analyseResult?.status, 
                message: analyseResult?.message 
            });
            return res.status(analyseResult?.status || 500).json(
                new ApiError(analyseResult?.status || 500, analyseResult?.message || 'Analysis failed')
            );
        }

        // Validate that analyseResult.message exists
        if (!analyseResult.message) {
            logger.error('Analyse service returned success but message is missing', { analyseResult });
            return res.status(500).json(
                new ApiError(500, 'Analysis data is missing')
            );
        }

        // Step 2: Calculate dashboard data using the calculation service
        let calculatedData;
        const calcStartTime = Date.now();
        try {
            logger.info('[PERF] Starting dashboard calculation...');
            logger.info(`analyseResult.message type: ${typeof analyseResult.message}, keys: ${Object.keys(analyseResult.message || {}).join(', ')}`);
            calculatedData = await analyseData(analyseResult.message, userId);
            const calcEndTime = Date.now();
            logger.info(`[PERF] Dashboard calculation completed in ${calcEndTime - calcStartTime}ms`);
            
            if (!calculatedData || !calculatedData.dashboardData) {
                throw new Error('Calculated data is missing dashboardData property');
            }
        } catch (calcError) {
            logger.error('Error in analyseData calculation:', {
                message: calcError.message,
                stack: calcError.stack,
                name: calcError.name
            });
            return res.status(500).json(
                new ApiError(500, `Error calculating dashboard data: ${calcError.message || 'Unknown error'}`)
            );
        }

        // NOTE: History recording removed from here
        // History is now recorded only:
        // 1. After first integration completes (Integration.js)
        // 2. Weekly via WeeklyHistoryWorker (runs on Sundays)

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Dashboard data total processing time: ${totalTime}ms`);

        // Return calculated dashboard data
        return res.status(200).json(
            new ApiResponse(200, {
                dashboardData: calculatedData.dashboardData
            }, "Dashboard data calculated successfully")
        );

    } catch (error) {
        logger.error("Unexpected error in getDashboardData:", {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        return res.status(500).json(
            new ApiError(500, `Error getting dashboard data: ${error.message || 'Unknown error'}`)
        );
    }
});

/**
 * Get profitability dashboard data (OPTIMIZED VERSION)
 * 
 * This endpoint uses the optimized ProfitabilityService which:
 * 1. Fetches only 5-8 collections instead of 24+ (3-4x faster)
 * 2. Computes only profitability-related calculations
 * 3. Returns the exact same data structure as before
 */
const getProfitabilityData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        const startTime = Date.now();
        logger.info(`[PERF] Getting profitability data (OPTIMIZED) for user ${userId}`);

        // OPTIMIZED: Fetch only profitability-required data (5 queries instead of 24+)
        const rawData = await ProfitabilityService.fetchProfitabilityData(userId, Country, Region);
        
        const fetchTime = Date.now() - startTime;
        logger.info(`[PERF] Profitability raw data fetched in ${fetchTime}ms`);

        // OPTIMIZED: Calculate only profitability-related data
        const profitabilityData = await ProfitabilityService.calculateProfitabilityDashboard(rawData);
        
        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Profitability data TOTAL time: ${totalTime}ms (optimized)`);

        return res.status(200).json(
            new ApiResponse(200, profitabilityData, "Profitability data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getProfitabilityData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting profitability data: ${error.message}`)
        );
    }
});

/**
 * Get profitability summary data (PHASE 1 - FAST)
 * Returns only metrics and chart data for instant rendering
 * The heavy product table data can be loaded separately
 */
const getProfitabilitySummary = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        const startTime = Date.now();
        logger.info(`[PERF] Getting profitability summary for user ${userId}`);

        const summaryData = await ProfitabilityService.getProfitabilitySummary(userId, Country, Region);
        
        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Profitability summary TOTAL time: ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, summaryData, "Profitability summary retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getProfitabilitySummary:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting profitability summary: ${error.message}`)
        );
    }
});

/**
 * ============================================================================
 * PHASED PROFITABILITY ENDPOINTS (for parallel loading)
 * ============================================================================
 * These endpoints load data in parallel for faster page rendering.
 * Each endpoint can be called independently and cached separately.
 */

/**
 * PHASE 1: Get profitability metrics (KPI boxes)
 * Returns: Total Sales, Total PPC Sales, Total Ad Spend, ACOS%, Amazon Fees, Gross Profit
 * Expected time: ~50-100ms
 */
const getProfitabilityMetrics = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        const startTime = Date.now();
        logger.info(`[PERF] Getting profitability metrics (PHASE 1) for user ${userId}`);

        const metricsData = await ProfitabilityService.getProfitabilityMetrics(userId, Country, Region);
        
        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Profitability metrics TOTAL time: ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, metricsData, "Profitability metrics retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getProfitabilityMetrics:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting profitability metrics: ${error.message}`)
        );
    }
});

/**
 * PHASE 2: Get profitability chart data
 * Returns: Datewise gross profit and total sales for chart
 * Expected time: ~50-100ms
 */
const getProfitabilityChart = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        const startTime = Date.now();
        logger.info(`[PERF] Getting profitability chart (PHASE 2) for user ${userId}`);

        const chartData = await ProfitabilityService.getProfitabilityChart(userId, Country, Region);
        
        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Profitability chart TOTAL time: ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, chartData, "Profitability chart retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getProfitabilityChart:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting profitability chart: ${error.message}`)
        );
    }
});

/**
 * PHASE 3: Get profitability table data (PAGINATED)
 * Returns: Paginated ASIN-wise profitability data
 * Expected time: ~100-300ms
 * 
 * Query params:
 * - page: Page number (1-indexed, default: 1)
 * - limit: Items per page (default: 10)
 */
const getProfitabilityTable = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    try {
        const startTime = Date.now();
        logger.info(`[PERF] Getting profitability table (PHASE 3) for user ${userId}, page ${page}, limit ${limit}`);

        const tableData = await ProfitabilityService.getProfitabilityTable(userId, Country, Region, page, limit);
        
        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Profitability table TOTAL time: ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, tableData, "Profitability table retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getProfitabilityTable:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting profitability table: ${error.message}`)
        );
    }
});

/**
 * Get profitability issues (detailed issues with recommendations)
 * Returns: Paginated list of products with profitability issues
 * Uses SAME logic as DashboardCalculation.calculateProfitabilityErrors
 * 
 * Query params:
 * - page: Page number (1-indexed, default: 1)
 * - limit: Items per page (default: 10)
 */
const getProfitabilityIssues = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    try {
        const startTime = Date.now();
        logger.info(`[PERF] Getting profitability issues for user ${userId}, page ${page}, limit ${limit}`);

        const ProfitabilityIssuesService = require('../../Services/Calculations/ProfitabilityIssuesService.js');
        const issuesData = await ProfitabilityIssuesService.getProfitabilityIssues(userId, Country, Region, page, limit);
        
        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Profitability issues TOTAL time: ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, issuesData, "Profitability issues retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getProfitabilityIssues:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting profitability issues: ${error.message}`)
        );
    }
});

/**
 * Get profitability issues summary (counts only, no pagination)
 * Fast endpoint for overview
 */
const getProfitabilityIssuesSummary = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        const startTime = Date.now();
        logger.info(`[PERF] Getting profitability issues summary for user ${userId}`);

        const ProfitabilityIssuesService = require('../../Services/Calculations/ProfitabilityIssuesService.js');
        const summaryData = await ProfitabilityIssuesService.getProfitabilityIssuesSummary(userId, Country, Region);
        
        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Profitability issues summary TOTAL time: ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, summaryData, "Profitability issues summary retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getProfitabilityIssuesSummary:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting profitability issues summary: ${error.message}`)
        );
    }
});

/**
 * Get PPC/Sponsored Ads dashboard data
 */
const getPPCData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting PPC data for user ${userId}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract PPC-specific data - all data needed by PPCDashboard.jsx
        const ppcData = {
            // Core PPC metrics
            sponsoredAdsMetrics: dashboardData.sponsoredAdsMetrics || {},
            negativeKeywordsMetrics: dashboardData.negativeKeywordsMetrics || [],
            ProductWiseSponsoredAds: dashboardData.ProductWiseSponsoredAds || [],
            ProductWiseSponsoredAdsGraphData: dashboardData.ProductWiseSponsoredAdsGraphData || [],
            totalSponsoredAdsErrors: dashboardData.totalSponsoredAdsErrors || 0,
            sponsoredAdsErrorDetails: dashboardData.sponsoredAdsErrorDetails || [],
            
            // Cost and sales data
            dateWiseTotalCosts: dashboardData.dateWiseTotalCosts || [],
            campaignWiseTotalSalesAndCost: dashboardData.campaignWiseTotalSalesAndCost || [],
            
            // Keywords and search terms
            keywords: dashboardData.keywords || [],
            searchTerms: dashboardData.searchTerms || [],
            adsKeywordsPerformanceData: dashboardData.adsKeywordsPerformanceData || [],
            negetiveKeywords: dashboardData.negetiveKeywords || [],
            
            // Campaign and ad group data
            campaignData: dashboardData.campaignData || [],
            AdsGroupData: dashboardData.AdsGroupData || [],
            
            // PPCUnitsSold data
            PPCUnitsSold: dashboardData.PPCUnitsSold || { totalUnits: 0, dateWiseUnits: [] },
            
            // Sales data for TACOS calculation
            TotalSales: dashboardData.TotalSales || [],
            TotalWeeklySale: dashboardData.TotalWeeklySale || 0,
            accountFinance: dashboardData.accountFinance || {},
            
            // Date range
            calendarMode: dashboardData.calendarMode || 'default',
            Country: dashboardData.Country,
            startDate: dashboardData.startDate,
            endDate: dashboardData.endDate
        };

        return res.status(200).json(
            new ApiResponse(200, ppcData, "PPC data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getPPCData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting PPC data: ${error.message}`)
        );
    }
});

/**
 * Get Issues page data
 * 
 * OPTIMIZED: Uses pre-computed data from MongoDB when available.
 * Falls back to full calculation only when data is stale/missing.
 */
const getIssuesData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const forceRefresh = req.query.forceRefresh === 'true';

    try {
        logger.info(`Getting issues data for user ${userId}`, { forceRefresh });

        // Use optimized service that reads from MongoDB when possible
        const IssuesDataService = require('../../Services/Calculations/IssuesDataService.js');
        const result = await IssuesDataService.getIssuesData(userId, Country, Region, forceRefresh);
        
        if (!result.success) {
            logger.error("Failed to get issues data from service:", result.error);
            
            // Fallback to direct calculation if service fails completely
            logger.info("Falling back to direct calculation for issues data");
            const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
            
            if (analyseResult.status !== 200) {
                return res.status(analyseResult.status).json(
                    new ApiError(analyseResult.status, analyseResult.message)
                );
            }

            const calculatedData = await analyseData(analyseResult.message, userId);
            const dashboardData = calculatedData.dashboardData;

            const issuesData = {
                productWiseError: dashboardData.productWiseError || [],
                rankingProductWiseErrors: dashboardData.rankingProductWiseErrors || [],
                conversionProductWiseErrors: dashboardData.conversionProductWiseErrors || [],
                inventoryProductWiseErrors: dashboardData.inventoryProductWiseErrors || [],
                totalErrorInAccount: dashboardData.totalErrorInAccount || 0,
                totalErrorInConversion: dashboardData.totalErrorInConversion || 0,
                TotalRankingerrors: dashboardData.TotalRankingerrors || 0,
                totalInventoryErrors: dashboardData.totalInventoryErrors || 0,
                totalProfitabilityErrors: dashboardData.totalProfitabilityErrors || 0,
                totalSponsoredAdsErrors: dashboardData.totalSponsoredAdsErrors || 0,
                profitabilityErrorDetails: dashboardData.profitabilityErrorDetails || [],
                sponsoredAdsErrorDetails: dashboardData.sponsoredAdsErrorDetails || [],
                AccountErrors: dashboardData.AccountErrors || {},
                accountHealthPercentage: dashboardData.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
                buyBoxData: dashboardData.buyBoxData || { asinBuyBoxData: [] },
                first: dashboardData.first,
                second: dashboardData.second,
                third: dashboardData.third,
                fourth: dashboardData.fourth,
                TotalProduct: dashboardData.TotalProduct || [],
                ActiveProducts: dashboardData.ActiveProducts || [],
                Country: dashboardData.Country
            };

            return res.status(200).json(
                new ApiResponse(200, issuesData, "Issues data retrieved successfully (fallback)")
            );
        }

        logger.info(`Issues data retrieved successfully`, {
            source: result.source,
            duration: result.duration,
            productCount: result.data?.productWiseError?.length || 0
        });

        return res.status(200).json(
            new ApiResponse(200, result.data, `Issues data retrieved successfully (${result.source})`)
        );

    } catch (error) {
        logger.error("Error in getIssuesData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting issues data: ${error.message}`)
        );
    }
});

/**
 * Get Issues by Product data
 * Enhanced with product performance metrics, recommendations, and optional WoW/MoM comparison
 * 
 * Query params:
 * - comparison: 'wow' | 'mom' | 'none' (default: 'none') - comparison type for performance deltas
 */
const getIssuesByProductData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    // Optional comparison type from query params (wow, mom, none)
    const comparisonType = req.query.comparison || 'none';

    try {
        logger.info(`Getting issues by product data for user ${userId}, comparison: ${comparisonType}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;
        
        // Get raw data for performance metrics
        const rawData = analyseResult.message;

        // Import performance and recommendation services
        const { aggregateProductPerformance, enrichProductsWithPerformance } = require('../../Services/Calculations/ProductPerformanceService.js');
        const { buildErrorMaps, generateAllRecommendations, enrichProductsWithRecommendations } = require('../../Services/Calculations/RecommendationService.js');
        const { fetchAndEnrichWithComparison, COMPARISON_TYPES } = require('../../Services/Calculations/ProductPerformanceComparisonService.js');
        
        // Aggregate performance metrics per ASIN
        const productList = dashboardData.productWiseError || [];
        const performanceMap = aggregateProductPerformance({
            productList,
            buyBoxData: rawData.BuyBoxData,
            productWiseSponsoredAds: rawData.ProductWiseSponsoredAds,
            economicsMetrics: rawData.EconomicsMetrics
        });
        
        // Enrich products with performance
        let enrichedProducts = enrichProductsWithPerformance(productList, performanceMap);
        
        // Optionally enrich with comparison data (WoW/MoM) - MUST be done BEFORE recommendations
        // so that recommendations can consider sales/traffic trends
        let comparisonMeta = null;
        if (comparisonType && comparisonType !== 'none') {
            logger.info('[PageWiseDataController] Calling fetchAndEnrichWithComparison', {
                userId,
                region: Region,
                country: Country,
                comparisonType,
                hasBuyBoxData: !!rawData.BuyBoxData,
                buyBoxDateRange: rawData.BuyBoxData?.dateRange,
                hasEconomicsData: !!rawData.EconomicsMetrics,
                economicsDateRange: rawData.EconomicsMetrics?.dateRange,
                productsCount: enrichedProducts?.length
            });
            
            const comparisonResult = await fetchAndEnrichWithComparison({
                userId,
                region: Region,
                country: Country,
                comparisonType,
                currentBuyBoxData: rawData.BuyBoxData,
                currentEconomicsData: rawData.EconomicsMetrics,
                products: enrichedProducts
            });
            enrichedProducts = comparisonResult.products;
            comparisonMeta = comparisonResult.comparisonMeta;
            
            logger.info('[PageWiseDataController] Comparison enrichment complete', {
                comparisonMeta,
                productsWithComparison: enrichedProducts.filter(p => p.comparison?.hasComparison).length,
                sampleComparison: enrichedProducts[0]?.comparison
            });
        }
        
        // Build error maps for recommendations (including inventory errors)
        const errorMaps = buildErrorMaps(
            dashboardData.conversionProductWiseErrors || [],
            dashboardData.rankingProductWiseErrors || [],
            dashboardData.inventoryProductWiseErrors || []
        );
        
        // Generate recommendations (now with comparison data available for trend-based recommendations)
        const recommendationsMap = generateAllRecommendations(enrichedProducts, errorMaps);
        
        // Enrich products with recommendations
        enrichedProducts = enrichProductsWithRecommendations(enrichedProducts, recommendationsMap);

        // Extract issues by product specific data (with enriched product data)
        const issuesByProductData = {
            productWiseError: enrichedProducts,
            rankingProductWiseErrors: dashboardData.rankingProductWiseErrors || [],
            conversionProductWiseErrors: dashboardData.conversionProductWiseErrors || [],
            inventoryProductWiseErrors: dashboardData.inventoryProductWiseErrors || [],
            TotalProduct: dashboardData.TotalProduct || [],
            ActiveProducts: dashboardData.ActiveProducts || [],
            InventoryAnalysis: dashboardData.InventoryAnalysis || {},
            Country: dashboardData.Country,
            // Include profitability data for Product Details page (grossProfit per ASIN)
            profitibilityData: dashboardData.profitibilityData || [],
            // Include BuyBox summary for reference
            buyBoxSummary: rawData.BuyBoxData ? {
                totalProducts: rawData.BuyBoxData.totalProducts,
                productsWithBuyBox: rawData.BuyBoxData.productsWithBuyBox,
                productsWithoutBuyBox: rawData.BuyBoxData.productsWithoutBuyBox,
                dateRange: rawData.BuyBoxData.dateRange
            } : null,
            // Comparison metadata (if comparison was requested)
            comparisonMeta: comparisonMeta
        };

        return res.status(200).json(
            new ApiResponse(200, issuesByProductData, "Issues by product data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getIssuesByProductData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting issues by product data: ${error.message}`)
        );
    }
});

/**
 * Get Keyword Analysis data
 */
const getKeywordAnalysisData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting keyword analysis data for user ${userId}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract keyword analysis specific data - all data needed by KeywordAnalysisDashboard.jsx
        const keywordData = {
            // Keywords and search terms
            keywords: dashboardData.keywords || [],
            searchTerms: dashboardData.searchTerms || [],
            negativeKeywordsMetrics: dashboardData.negativeKeywordsMetrics || [],
            negetiveKeywords: dashboardData.negetiveKeywords || [],
            adsKeywordsPerformanceData: dashboardData.adsKeywordsPerformanceData || [],
            keywordTrackingData: dashboardData.keywordTrackingData || {},
            
            // Campaign and ad group data
            campaignData: dashboardData.campaignData || [],
            AdsGroupData: dashboardData.AdsGroupData || [],
            
            // Product data for ASIN/SKU lookups
            TotalProduct: dashboardData.TotalProduct || [],
            productWiseError: dashboardData.productWiseError || [],
            
            Country: dashboardData.Country
        };

        return res.status(200).json(
            new ApiResponse(200, keywordData, "Keyword analysis data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getKeywordAnalysisData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting keyword analysis data: ${error.message}`)
        );
    }
});

/**
 * Get Reimbursement data
 */
const getReimbursementData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting reimbursement data for user ${userId}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract reimbursement specific data
        const reimbursementData = {
            reimbustment: dashboardData.reimbustment || { totalReimbursement: 0 },
            TotalProduct: dashboardData.TotalProduct || [],
            ActiveProducts: dashboardData.ActiveProducts || [],
            accountFinance: dashboardData.accountFinance || {},
            Country: dashboardData.Country,
            startDate: dashboardData.startDate,
            endDate: dashboardData.endDate
        };

        return res.status(200).json(
            new ApiResponse(200, reimbursementData, "Reimbursement data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getReimbursementData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting reimbursement data: ${error.message}`)
        );
    }
});

/**
 * Get Tasks data
 */
const getTasksData = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        logger.info(`Getting tasks data for user ${userId}`);

        // Get tasks from CreateTaskService
        const tasksDocument = await CreateTaskService.getUserTasks(userId);

        if (!tasksDocument) {
            return res.status(200).json(
                new ApiResponse(200, { tasks: [], taskRenewalDate: null }, "No tasks found")
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                tasks: tasksDocument.tasks || [],
                taskRenewalDate: tasksDocument.taskRenewalDate
            }, "Tasks data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getTasksData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting tasks data: ${error.message}`)
        );
    }
});

/**
 * Update task status
 */
const updateTaskStatus = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { taskId, status } = req.body;

    if (!taskId || !status) {
        return res.status(400).json(
            new ApiError(400, "taskId and status are required")
        );
    }

    try {
        logger.info(`Updating task ${taskId} status to ${status} for user ${userId}`);

        const updatedDocument = await CreateTaskService.updateTaskStatus(userId, taskId, status);

        return res.status(200).json(
            new ApiResponse(200, {
                tasks: updatedDocument.tasks,
                taskRenewalDate: updatedDocument.taskRenewalDate
            }, "Task status updated successfully")
        );

    } catch (error) {
        logger.error("Error in updateTaskStatus:", error);
        return res.status(500).json(
            new ApiError(500, `Error updating task status: ${error.message}`)
        );
    }
});

/**
 * Get inventory data
 */
const getInventoryData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting inventory data for user ${userId}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract inventory specific data
        const inventoryData = {
            InventoryAnalysis: dashboardData.InventoryAnalysis || {},
            inventoryProductWiseErrors: dashboardData.inventoryProductWiseErrors || [],
            totalInventoryErrors: dashboardData.totalInventoryErrors || 0,
            TotalProduct: dashboardData.TotalProduct || [],
            ActiveProducts: dashboardData.ActiveProducts || [],
            Country: dashboardData.Country
        };

        return res.status(200).json(
            new ApiResponse(200, inventoryData, "Inventory data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getInventoryData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting inventory data: ${error.message}`)
        );
    }
});

/**
 * Get ASIN-wise sales data for profitability table
 * This is a separate endpoint to handle big accounts where asinWiseSales is stored separately
 * to avoid memory issues with the main dashboard endpoint.
 * 
 * For normal accounts: Returns asinWiseSales from EconomicsMetrics
 * For big accounts (isBig=true): Returns asinWiseSales from AsinWiseSalesForBigAccounts collection
 */
const getAsinWiseSalesData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const country = req.country;

    try {
        logger.info(`Getting ASIN-wise sales data for user ${userId}`, { country, region });

        // Get the latest EconomicsMetrics document
        const economicsMetrics = await EconomicsMetrics.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!economicsMetrics) {
            logger.warn('No economics metrics found for ASIN-wise sales', { userId, country, region });
            return res.status(200).json(
                new ApiResponse(200, { asinWiseSales: [], isBig: false }, "No economics metrics data found")
            );
        }

        let asinWiseSales = [];
        const totalSalesAmount = economicsMetrics.totalSales?.amount || 0;

        // Debug: Check parentAsin in stored data
        const storedAsinData = economicsMetrics.asinWiseSales || [];
        const recordsWithParentAsin = storedAsinData.filter(item => item.parentAsin && item.parentAsin !== item.asin);
        
        logger.info('ASIN-wise sales endpoint - checking data source', {
            userId,
            country,
            region,
            isBig: economicsMetrics.isBig,
            totalSales: totalSalesAmount,
            asinWiseSalesInDoc: storedAsinData.length,
            recordsWithDifferentParentAsin: recordsWithParentAsin.length,
            sampleRecord: storedAsinData[0] ? {
                asin: storedAsinData[0].asin,
                parentAsin: storedAsinData[0].parentAsin,
                date: storedAsinData[0].date
            } : null
        });

        // Try to fetch from separate collection if:
        // 1. isBig is explicitly true, OR
        // 2. totalSales > 5000 and asinWiseSales is empty (legacy data that might have been migrated)
        const shouldTrySeparateCollection = economicsMetrics.isBig === true || 
            (totalSalesAmount > 5000 && (!economicsMetrics.asinWiseSales || economicsMetrics.asinWiseSales.length === 0));

        if (shouldTrySeparateCollection) {
            // Try fetching from separate collection for big accounts
            try {
                const bigAccountAsinDocs = await AsinWiseSalesForBigAccounts.findByMetricsId(economicsMetrics._id);
                
                if (bigAccountAsinDocs && bigAccountAsinDocs.length > 0) {
                    // Flatten all ASIN sales from all date documents
                    bigAccountAsinDocs.forEach(doc => {
                        const docDate = doc.date;
                        if (doc.asinSales && Array.isArray(doc.asinSales)) {
                            doc.asinSales.forEach(asinSale => {
                                asinWiseSales.push({
                                    date: docDate === 'no_date' ? null : docDate,
                                    asin: asinSale.asin,
                                    parentAsin: asinSale.parentAsin,
                                    sales: asinSale.sales,
                                    grossProfit: asinSale.grossProfit,
                                    unitsSold: asinSale.unitsSold,
                                    refunds: asinSale.refunds,
                                    ppcSpent: asinSale.ppcSpent,
                                    fbaFees: asinSale.fbaFees,
                                    storageFees: asinSale.storageFees,
                                    amazonFees: asinSale.amazonFees,
                                    totalFees: asinSale.totalFees,
                                    feeBreakdown: asinSale.feeBreakdown
                                });
                            });
                        }
                    });
                    
                    // Debug: Check parentAsin in fetched data
                    const fetchedRecordsWithParentAsin = asinWiseSales.filter(item => item.parentAsin && item.parentAsin !== item.asin);
                    
                    logger.info('Fetched ASIN-wise sales from separate collection for big account', {
                        userId,
                        country,
                        region,
                        totalRecords: asinWiseSales.length,
                        totalDates: bigAccountAsinDocs.length,
                        recordsWithDifferentParentAsin: fetchedRecordsWithParentAsin.length,
                        sampleRecord: asinWiseSales[0] ? {
                            asin: asinWiseSales[0].asin,
                            parentAsin: asinWiseSales[0].parentAsin,
                            date: asinWiseSales[0].date
                        } : null
                    });
                } else {
                    // No data in separate collection - fall back to main document (legacy data)
                    logger.info('No data in separate collection, falling back to main document', {
                        userId,
                        country,
                        region
                    });
                    asinWiseSales = economicsMetrics.asinWiseSales || [];
                }
            } catch (fetchError) {
                logger.error('Error fetching ASIN data for big account, falling back to main document', {
                    metricsId: economicsMetrics._id,
                    error: fetchError.message
                });
                // Fallback to main document
                asinWiseSales = economicsMetrics.asinWiseSales || [];
            }
        } else {
            // Normal account - get from main document
            asinWiseSales = economicsMetrics.asinWiseSales || [];
            logger.info('Returning ASIN-wise sales from main document', {
                userId,
                country,
                region,
                totalRecords: asinWiseSales.length
            });
        }

        return res.status(200).json(
            new ApiResponse(200, {
                asinWiseSales: asinWiseSales,
                isBig: economicsMetrics.isBig || false,
                dateRange: economicsMetrics.dateRange,
                metricsId: economicsMetrics._id
            }, "ASIN-wise sales data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getAsinWiseSalesData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting ASIN-wise sales data: ${error.message}`)
        );
    }
});

/**
 * Get Your Products data with pagination support
 * Returns products with their details including status, ratings, A+ content status
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - summaryOnly: If true, return only summary data (default: false)
 */
const getYourProductsData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    
    // Pagination parameters
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const summaryOnly = req.query.summaryOnly === 'true';
    
    // Status filter parameter (optional): 'Active', 'Inactive', 'Incomplete', or undefined (all)
    const statusFilter = req.query.status || undefined;

    try {
        logger.info(`Getting Your Products data for user ${userId}, region ${Region}, country ${Country}, page ${page}, limit ${limit}, status: ${statusFilter || 'all'}`);

        // Get seller data with products
        const seller = await Seller.findOne({ User: userId });
        
        if (!seller) {
            return res.status(404).json(
                new ApiError(404, 'Seller account not found')
            );
        }

        // Find the seller account for the current region
        const sellerAccount = seller.sellerAccount.find(
            acc => acc.region === Region
        );

        if (!sellerAccount) {
            return res.status(404).json(
                new ApiError(404, 'No seller account found for this region')
            );
        }

        // Get products from seller account - convert Mongoose subdocuments to plain objects
        // This ensures all fields including 'issues' array are properly accessible
        const allProducts = (sellerAccount.products || []).map(p => p.toObject ? p.toObject() : p);
        const totalProducts = allProducts.length;

        // Calculate summary metrics first (always needed)
        // We need to calculate this from all products, not just paginated
        let activeProducts = 0;
        let inactiveProducts = 0;
        let incompleteProducts = 0;
        
        allProducts.forEach(p => {
            if (p.status === 'Active') activeProducts++;
            else if (p.status === 'Inactive') inactiveProducts++;
            else if (p.status === 'Incomplete') incompleteProducts++;
        });
        
        // Filter products by status BEFORE pagination (if status filter is provided)
        let filteredProducts = allProducts;
        if (statusFilter && ['Active', 'Inactive', 'Incomplete'].includes(statusFilter)) {
            filteredProducts = allProducts.filter(p => p.status === statusFilter);
        }
        
        // IMPORTANT: Sort products consistently before pagination to ensure stable pagination
        // Sort by ASIN (ascending) to ensure the same products appear on the same page
        // This prevents pagination issues where the same page returns different products
        filteredProducts.sort((a, b) => {
            const asinA = (a.asin || '').toUpperCase();
            const asinB = (b.asin || '').toUpperCase();
            return asinA.localeCompare(asinB);
        });
        
        const filteredTotal = filteredProducts.length;

        // If only summary is requested, return early without processing all product details
        if (summaryOnly) {
            // Get A+ content count (quick aggregation)
            let productsWithAPlus = 0;
            let aPlusContent = await APlusContent.findOne({
                User: userId,
                region: Region,
                country: Country
            }).sort({ createdAt: -1 }).select('ApiContentDetails');

            if (!aPlusContent) {
                aPlusContent = await APlusContent.findOne({
                    User: userId
                }).sort({ createdAt: -1 }).select('ApiContentDetails');
            }

            if (aPlusContent && aPlusContent.ApiContentDetails) {
                // Create a set of product ASINs for quick lookup
                const productAsinSet = new Set(allProducts.map(p => p.asin?.toUpperCase()));
                
                aPlusContent.ApiContentDetails.forEach(item => {
                    const asinKey = item.Asins?.toUpperCase() || '';
                    if (productAsinSet.has(asinKey) && 
                        (item.status === 'APPROVED' || item.status === 'PUBLISHED')) {
                        productsWithAPlus++;
                    }
                });
            }
            
            // Check if any active product has brand story
            let hasBrandStory = false;
            const [productReviewsWithRegion, productReviewsWithoutRegion] = await Promise.all([
                NumberOfProductReviews.findOne({
                    User: userId,
                    region: Region,
                    country: Country
                }).sort({ createdAt: -1 }).lean(),
                NumberOfProductReviews.findOne({
                    User: userId
                }).sort({ createdAt: -1 }).lean()
            ]);
            
            const productReviews = productReviewsWithRegion || productReviewsWithoutRegion;
            if (productReviews && productReviews.Products) {
                // Create a set of active product ASINs for quick lookup
                const activeProductAsinSet = new Set(
                    allProducts
                        .filter(p => p.status === 'Active')
                        .map(p => (p.asin || '').toUpperCase())
                );
                
                // Check if any active product has brand story
                for (const product of productReviews.Products) {
                    const asinKey = (product.asin || '').toUpperCase();
                    if (activeProductAsinSet.has(asinKey) && product.has_brandstory === true) {
                        hasBrandStory = true;
                        break; // Found one, no need to check further
                    }
                }
            }

            return res.status(200).json(
                new ApiResponse(200, {
                    products: [], // Empty array for summary only
                    summary: {
                        totalProducts,
                        activeProducts,
                        inactiveProducts,
                        incompleteProducts,
                        productsWithAPlus,
                        productsWithoutAPlus: totalProducts - productsWithAPlus,
                        hasBrandStory: hasBrandStory
                    },
                    pagination: {
                        page,
                        limit,
                        totalItems: totalProducts,
                        totalPages: Math.ceil(totalProducts / limit),
                        hasMore: false
                    },
                    country: Country,
                    region: Region
                }, "Your Products summary retrieved successfully")
            );
        }

        // Apply pagination to FILTERED products (not all products)
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedProducts = filteredProducts.slice(startIndex, endIndex);
        
        // Debug logging for pagination
        logger.info(`[getYourProductsData] Pagination details:`, {
            page,
            limit,
            filteredTotal,
            startIndex,
            endIndex,
            paginatedCount: paginatedProducts.length,
            firstAsin: paginatedProducts[0]?.asin,
            lastAsin: paginatedProducts[paginatedProducts.length - 1]?.asin,
            statusFilter: statusFilter || 'all'
        });

        // Get product reviews data - OPTIMIZATION: Run both queries in parallel with fallback
        const [productReviewsWithRegion, productReviewsWithoutRegion, aPlusContentWithRegion, aPlusContentWithoutRegion, sponsoredAdsData] = await Promise.all([
            NumberOfProductReviews.findOne({
                User: userId,
                region: Region,
                country: Country
            }).sort({ createdAt: -1 }).lean(),
            NumberOfProductReviews.findOne({
                User: userId
            }).sort({ createdAt: -1 }).lean(),
            APlusContent.findOne({
                User: userId,
                region: Region,
                country: Country
            }).sort({ createdAt: -1 }).lean(),
            APlusContent.findOne({
                User: userId
            }).sort({ createdAt: -1 }).lean(),
            // Get ProductWiseSponsoredAds to determine which ASINs are targeted in ads
            getProductWiseSponsoredAdsData(userId, Country, Region).catch(err => {
                logger.warn('Could not fetch sponsored ads data for YourProducts:', err.message);
                return null;
            })
        ]);

        // Use the one with region/country if available, otherwise fallback
        const productReviews = productReviewsWithRegion || productReviewsWithoutRegion;
        const aPlusContent = aPlusContentWithRegion || aPlusContentWithoutRegion;

        // Create a map for quick lookup of reviews by ASIN
        const reviewsMap = new Map();
        if (productReviews && productReviews.Products) {
            productReviews.Products.forEach(product => {
                const asinKey = product.asin?.toUpperCase() || '';
                const videoUrls = product.video_url || [];
                reviewsMap.set(asinKey, {
                    numRatings: product.product_num_ratings || '0',
                    starRatings: product.product_star_ratings || '0',
                    title: product.product_title || '',
                    photos: product.product_photos || [],
                    hasVideo: Array.isArray(videoUrls) && videoUrls.length > 0
                });
            });
        }
        
        // Check if any active product has brand story
        let hasBrandStory = false;
        if (productReviews && productReviews.Products) {
            // Create a set of active product ASINs for quick lookup
            const activeProductAsinSet = new Set(
                allProducts
                    .filter(p => p.status === 'Active')
                    .map(p => (p.asin || '').toUpperCase())
            );
            
            // Check if any active product has brand story
            for (const product of productReviews.Products) {
                const asinKey = (product.asin || '').toUpperCase();
                if (activeProductAsinSet.has(asinKey) && product.has_brandstory === true) {
                    hasBrandStory = true;
                    break; // Found one, no need to check further
                }
            }
        }

        // Create a map for A+ content status by ASIN
        const aPlusMap = new Map();
        let productsWithAPlus = 0;
        if (aPlusContent && aPlusContent.ApiContentDetails) {
            // Create a set of all product ASINs for quick lookup
            const productAsinSet = new Set(allProducts.map(p => p.asin?.toUpperCase()));
            
            aPlusContent.ApiContentDetails.forEach(item => {
                const asinKey = item.Asins?.toUpperCase() || '';
                aPlusMap.set(asinKey, item.status);
                
                // Count products with A+ (only count if ASIN is in our products)
                if (productAsinSet.has(asinKey) && 
                    (item.status === 'APPROVED' || item.status === 'PUBLISHED' || 
                     item.status === 'true' || item.status === true)) {
                    productsWithAPlus++;
                }
            });
        }

        // Create a Set of ASINs that are targeted in ads (have any ad spend or activity)
        const asinsTargetedInAds = new Set();
        if (sponsoredAdsData && sponsoredAdsData.sponsoredAds && Array.isArray(sponsoredAdsData.sponsoredAds)) {
            sponsoredAdsData.sponsoredAds.forEach(adItem => {
                const asin = adItem.asin || adItem.ASIN;
                if (asin) {
                    // Add ASIN to Set (uppercase for consistent comparison)
                    asinsTargetedInAds.add(asin.toUpperCase());
                }
            });
            logger.info(`[getYourProductsData] Found ${asinsTargetedInAds.size} ASINs targeted in ads`);
        }

        // Enrich only paginated products
        const enrichedProducts = paginatedProducts.map(product => {
            const asinKey = product.asin?.toUpperCase() || '';
            const reviewData = reviewsMap.get(asinKey) || {};
            const aPlusStatus = aPlusMap.get(asinKey);
            
            const hasAPlusContent = aPlusStatus === 'APPROVED' || 
                                    aPlusStatus === 'PUBLISHED' || 
                                    aPlusStatus === 'true' ||
                                    aPlusStatus === true;
            
            // Check if this ASIN is targeted in ads
            const isTargetedInAds = asinsTargetedInAds.has(asinKey);
            
            return {
                asin: product.asin,
                sku: product.sku,
                title: product.itemName || reviewData.title || '',
                price: product.price || '0',
                status: product.status || 'Unknown',
                quantity: product.quantity !== undefined && product.quantity !== null ? product.quantity : 0,
                numRatings: reviewData.numRatings || '0',
                starRatings: reviewData.starRatings || '0',
                hasAPlus: hasAPlusContent,
                aPlusStatus: aPlusStatus || 'Not Available',
                hasVideo: reviewData.hasVideo || false,
                image: reviewData.photos && reviewData.photos.length > 0 ? reviewData.photos[0] : null,
                updatedAt: product.updatedAt || null,
                issues: product.issues || [], // Include issues from seller model for inactive/incomplete products
                has_b2b_pricing: product.has_b2b_pricing || false, // Include B2B pricing status
                isTargetedInAds: isTargetedInAds // Whether this product has ads targeting
            };
        });

        // Calculate pagination based on FILTERED products, not all products
        const totalPages = Math.ceil(filteredTotal / limit);
        const hasMore = page < totalPages;

        // Get issues data for frontend calculation (same as IssuesByProduct page)
        // OPTIMIZATION: Only load issues data for Active products (not needed for inactive/incomplete)
        // Also make it optional via query parameter to allow skipping for faster loads
        let issuesData = null;
        const includeIssues = req.query.includeIssues !== 'false' && statusFilter === 'Active';
        
        if (includeIssues) {
            try {
                logger.info('[getYourProductsData] Fetching issues data for Active products...');
                const analyseResult = await AnalyseService.Analyse(userId, Country, Region, null);
                logger.info('[getYourProductsData] AnalyseService result status:', analyseResult?.status);
                
                if (analyseResult && analyseResult.status === 200 && analyseResult.message) {
                    const calculatedData = await analyseData(analyseResult.message, userId);
                    logger.info('[getYourProductsData] calculatedData exists:', !!calculatedData);
                    logger.info('[getYourProductsData] dashboardData exists:', !!calculatedData?.dashboardData);
                    
                    if (calculatedData && calculatedData.dashboardData) {
                        const dashboardData = calculatedData.dashboardData;
                        issuesData = {
                            rankingProductWiseErrors: dashboardData.rankingProductWiseErrors || [],
                            TotalProduct: dashboardData.TotalProduct || [],
                            buyBoxData: dashboardData.buyBoxData || {}
                        };
                        logger.info('[getYourProductsData] issuesData populated:', {
                            rankingCount: issuesData.rankingProductWiseErrors.length,
                            totalProductCount: issuesData.TotalProduct.length,
                            hasBuyBoxData: !!issuesData.buyBoxData?.asinBuyBoxData
                        });
                    }
                }
            } catch (issueError) {
                logger.warn('Could not fetch issues data for YourProducts:', issueError.message);
            }
        } else {
            logger.info('[getYourProductsData] Skipping issues data (not needed for inactive/incomplete products or explicitly disabled)');
        }

        return res.status(200).json(
            new ApiResponse(200, {
                products: enrichedProducts,
                summary: {
                    totalProducts,
                    activeProducts,
                    inactiveProducts,
                    incompleteProducts,
                    productsWithAPlus,
                    productsWithoutAPlus: totalProducts - productsWithAPlus,
                    hasBrandStory: hasBrandStory
                },
                pagination: {
                    page,
                    limit,
                    totalItems: filteredTotal, // Use filtered total for pagination
                    totalPages,
                    hasMore
                },
                country: Country,
                region: Region,
                issuesData: issuesData
            }, "Your Products data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getYourProductsData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting Your Products data: ${error.message}`)
        );
    }
});

/**
 * Get navbar data - minimal data for top navigation bar
 * This endpoint is called on initial app load instead of full dashboard data
 * Returns only: user info, all seller accounts, brand name, account health
 */
const getNavbarData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting navbar data for user ${userId}, region ${Region}, country ${Country}`);

        // Get user data
        const user = await User.findById(userId).select('name email profilePic selectedPlan accessType isSuperAdminSession').lean();
        
        if (!user) {
            return res.status(404).json(
                new ApiError(404, 'User not found')
            );
        }

        // Get seller data with all accounts
        const seller = await Seller.findOne({ User: userId }).lean();
        
        let allSellerAccounts = [];
        let brandName = '';
        let accountHealthPercentage = 0;

        if (seller) {
            // Brand is stored at root level of seller document
            brandName = seller.brand || '';
            
            if (seller.sellerAccount) {
                // Get all seller accounts for account switcher
                allSellerAccounts = seller.sellerAccount.map(acc => ({
                    sellerId: acc.sellerId,
                    region: acc.region,
                    country: acc.country || acc.region,
                    marketplaceId: acc.marketplaceId,
                    isConnected: acc.isConnected || false,
                    brand: seller.brand || '' // Include brand in each account for display
                }));
            }
        }

        // Get account health percentage (lightweight query)
        // This is a simplified calculation - just checking if we have health data
        try {
            const economicsMetrics = await EconomicsMetrics.findOne({
                User: userId,
                country: Country,
                region: Region
            }).sort({ createdAt: -1 }).select('accountHealthPercentage').lean();

            if (economicsMetrics && economicsMetrics.accountHealthPercentage) {
                accountHealthPercentage = economicsMetrics.accountHealthPercentage;
            }
        } catch (healthError) {
            logger.warn('Could not fetch account health for navbar:', healthError.message);
        }

        return res.status(200).json(
            new ApiResponse(200, {
                user: {
                    _id: user._id,
                    name: user.name,
                    email: user.email,
                    profilePic: user.profilePic,
                    selectedPlan: user.selectedPlan,
                    accessType: user.accessType,
                    isSuperAdminSession: user.isSuperAdminSession
                },
                AllSellerAccounts: allSellerAccounts,
                Brand: brandName,
                accountHealthPercentage,
                Country,
                Region
            }, "Navbar data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getNavbarData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting navbar data: ${error.message}`)
        );
    }
});

/**
 * Get Account History data
 * Returns historical account metrics over time
 */
const getAccountHistoryData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Country = req.country;
    const Region = req.region;

    try {
        logger.info(`Getting account history data for user ${userId}, country ${Country}, region ${Region}`);

        if (!userId || !Country || !Region) {
            return res.status(400).json(
                new ApiError(400, 'User ID, country and region are required')
            );
        }

        const accountHistory = await AccountHistory.findOne({
            User: userId,
            country: Country,
            region: Region
        }).lean();

        if (!accountHistory) {
            return res.status(200).json(
                new ApiResponse(200, { accountHistory: [] }, "No account history found")
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                accountHistory: accountHistory.accountHistory || []
            }, "Account history data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getAccountHistoryData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting account history data: ${error.message}`)
        );
    }
});

/**
 * Get historical performance data for a specific product (ASIN)
 * Returns sessions, sales, conversion over time for trend graphs
 * 
 * Query params:
 * - limit: Max data points (default 30)
 * - granularity: 'daily' | 'weekly' | 'monthly' (default: 'daily')
 *   - 'weekly': Labels as "Week 1", "Week 2", etc. (for WoW comparison)
 *   - 'monthly': Labels as "Jan 2024", "Feb 2024", etc. (for MoM comparison)
 */
const getProductHistory = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const { asin } = req.params;
    const limit = parseInt(req.query.limit) || 30;
    const granularity = req.query.granularity || 'daily';

    try {
        if (!asin) {
            return res.status(400).json(
                new ApiError(400, "ASIN parameter is required")
            );
        }

        logger.info(`Getting product history for ASIN ${asin}, user ${userId}, granularity: ${granularity}`);

        const { getProductHistory: fetchHistory } = require('../../Services/Calculations/ProductHistoryService.js');
        
        const historyData = await fetchHistory({
            userId,
            region: Region,
            country: Country,
            asin,
            limit,
            granularity
        });

        return res.status(200).json(
            new ApiResponse(200, historyData, "Product history retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getProductHistory:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting product history: ${error.message}`)
        );
    }
});

/**
 * Debug endpoint: Check historical data availability for WoW/MoM comparison
 * Returns counts of BuyBoxData and EconomicsMetrics documents for the user
 */
const getComparisonDebugInfo = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
        
        // Get counts
        const buyBoxDocs = await BuyBoxData.find({
            User: userId,
            region: Region,
            country: Country
        }).sort({ createdAt: -1 }).select('createdAt dateRange').lean();
        
        const economicsDocs = await EconomicsMetrics.find({
            User: userId,
            region: Region,
            country: Country
        }).sort({ createdAt: -1 }).select('createdAt dateRange').lean();
        
        const debugInfo = {
            userId,
            region: Region,
            country: Country,
            buyBoxData: {
                count: buyBoxDocs.length,
                canCompare: buyBoxDocs.length >= 2,
                documents: buyBoxDocs.slice(0, 5).map(d => ({
                    createdAt: d.createdAt,
                    dateRange: d.dateRange
                }))
            },
            economicsMetrics: {
                count: economicsDocs.length,
                canCompare: economicsDocs.length >= 2,
                documents: economicsDocs.slice(0, 5).map(d => ({
                    createdAt: d.createdAt,
                    dateRange: d.dateRange
                }))
            },
            comparisonAvailable: buyBoxDocs.length >= 2 || economicsDocs.length >= 2,
            message: (buyBoxDocs.length >= 2 || economicsDocs.length >= 2) 
                ? 'WoW/MoM comparison is available' 
                : 'Need at least 2 data snapshots for comparison. Run analysis multiple times to build history.'
        };
        
        logger.info('[getComparisonDebugInfo] Debug info:', debugInfo);

        return res.status(200).json(
            new ApiResponse(200, debugInfo, "Comparison debug info retrieved")
        );

    } catch (error) {
        logger.error("Error in getComparisonDebugInfo:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting comparison debug info: ${error.message}`)
        );
    }
});

/**
 * Get dashboard summary data (lightweight, fast endpoint)
 * 
 * This endpoint is optimized for first-load performance:
 * - Only loads data needed for dashboard quick stats, account health, total sales
 * - Uses projections to avoid loading large arrays
 * - Uses .lean() for all queries
 * - Runs all queries in parallel
 * 
 * For full dashboard data (Product Checker, etc.), use /dashboard endpoint
 */
const getDashboardSummary = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    if (!userId || !Country || !Region) {
        logger.error('Missing required parameters for dashboard summary');
        return res.status(400).json(
            new ApiError(400, 'User ID, country, and region are required')
        );
    }

    try {
        logger.info(`[PERF] Getting dashboard summary for user ${userId}, region ${Region}, country ${Country}`);

        const { getDashboardSummary: fetchDashboardSummary } = require('../../Services/Calculations/DashboardSummaryService.js');
        
        const result = await fetchDashboardSummary(userId, Country, Region);
        
        if (!result.success) {
            return res.status(500).json(
                new ApiError(500, result.error || 'Failed to get dashboard summary')
            );
        }

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Dashboard summary total processing time: ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, {
                dashboardData: result.data
            }, "Dashboard summary retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getDashboardSummary:", {
            message: error.message,
            stack: error.stack
        });
        return res.status(500).json(
            new ApiError(500, `Error getting dashboard summary: ${error.message}`)
        );
    }
});

/**
 * Get Product Checker data (Phase 2 for progressive loading)
 * 
 * This endpoint provides the error analysis for Product Checker component.
 * Call this after getDashboardSummary for full dashboard experience.
 */
const getProductCheckerData = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    if (!userId || !Country || !Region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, country, and region are required')
        );
    }

    try {
        logger.info(`[PERF] Getting Product Checker data for user ${userId}`);

        // Use the existing Analyse + analyseData flow for full error analysis
        const { AnalyseService } = require('../../Services/main/Analyse.js');
        const { analyseData } = require('../../Services/Calculations/DashboardCalculation.js');
        
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region, null);
        
        if (!analyseResult || analyseResult.status !== 200) {
            return res.status(analyseResult?.status || 500).json(
                new ApiError(analyseResult?.status || 500, analyseResult?.message || 'Analysis failed')
            );
        }

        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract only Product Checker specific data
        const productCheckerData = {
            // Error counts
            totalProfitabilityErrors: dashboardData.totalProfitabilityErrors || 0,
            totalSponsoredAdsErrors: dashboardData.totalSponsoredAdsErrors || 0,
            totalInventoryErrors: dashboardData.totalInventoryErrors || 0,
            TotalRankingerrors: dashboardData.TotalRankingerrors || 0,
            totalErrorInConversion: dashboardData.totalErrorInConversion || 0,
            totalErrorInAccount: dashboardData.totalErrorInAccount || 0,
            
            // Error details
            profitabilityErrorDetails: dashboardData.profitabilityErrorDetails || [],
            sponsoredAdsErrorDetails: dashboardData.sponsoredAdsErrorDetails || [],
            
            // Top error products
            first: dashboardData.first,
            second: dashboardData.second,
            third: dashboardData.third,
            fourth: dashboardData.fourth,
            
            // Product-wise errors
            productWiseError: dashboardData.productWiseError || [],
            rankingProductWiseErrors: dashboardData.rankingProductWiseErrors || [],
            conversionProductWiseErrors: dashboardData.conversionProductWiseErrors || [],
            inventoryProductWiseErrors: dashboardData.inventoryProductWiseErrors || []
        };

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Product Checker data total time: ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, productCheckerData, "Product Checker data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getProductCheckerData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting Product Checker data: ${error.message}`)
        );
    }
});

/**
 * OPTIMIZED Phase 2: Get top 4 products for dashboard
 * 
 * This is a lightweight endpoint specifically for the main dashboard's Phase 2.
 * It ONLY returns the top 4 products (by sales with issues), nothing else.
 * 
 * Benefits over the full getProductCheckerData:
 * - Does NOT run full Analyse service (no loading 20+ collections)
 * - Does NOT run full analyseData calculation
 * - Single optimized MongoDB aggregation + single Seller query
 * - Returns minimal payload (~4 products vs 100KB+ payload)
 * 
 * Expected response time: 50-200ms vs 2-5 seconds for full endpoint
 */
const getTop4ProductsOptimized = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    if (!userId || !Country || !Region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, Country, and Region are required')
        );
    }

    try {
        logger.info(`[PERF] Starting getTop4ProductsOptimized for user ${userId}`);

        const { getProductCheckerOptimized } = require('../../Services/Calculations/DashboardSummaryService.js');
        
        const result = await getProductCheckerOptimized(userId, Country, Region);

        if (!result.success) {
            logger.warn('getTop4ProductsOptimized returned unsuccessful result', { error: result.error });
            return res.status(200).json(
                new ApiResponse(200, {
                    first: null,
                    second: null,
                    third: null,
                    fourth: null
                }, 'No data available')
            );
        }

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] getTop4ProductsOptimized completed in ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, result.data, 'Top 4 products fetched successfully')
        );

    } catch (error) {
        logger.error('Error in getTop4ProductsOptimized:', {
            message: error.message,
            stack: error.stack
        });
        
        return res.status(500).json(
            new ApiError(500, `Error getting top 4 products: ${error.message}`)
        );
    }
});

/**
 * =====================================================================
 * OPTIMIZED YOUR PRODUCTS ENDPOINTS (v2)
 * =====================================================================
 * Single optimized endpoint for first load, lazy load for other tabs.
 * Uses MongoDB aggregation - does NOT load full Seller document.
 * Uses pre-calculated issueCount from Seller model.
 */

/**
 * Get Your Products Initial Load (v2 - Optimized)
 * 
 * SINGLE ENDPOINT for first page load - returns everything needed:
 * 1. Summary counts (totalProducts, activeProducts, inactiveProducts, incompleteProducts)
 * 2. First 20 Active products (paginated, enriched)
 * 3. Count of products without A+ and not targeted in ads
 * 
 * This is the ONLY call needed on first render. Other tabs fetch on demand.
 */
const getYourProductsInitialV2 = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    try {
        logger.info(`[v2-initial] Getting Your Products Initial for user ${userId}, region ${Region}`);

        const userObjectId = require('mongoose').Types.ObjectId.createFromHexString(userId);

        // Single aggregation pipeline that returns:
        // 1. Counts by status
        // 2. First 20 Active products (sorted by ASIN)
        const pipeline = [
            { $match: { User: userObjectId } },
            { $unwind: '$sellerAccount' },
            { $match: { 'sellerAccount.region': Region } },
            { $unwind: { path: '$sellerAccount.products', preserveNullAndEmptyArrays: false } },
            {
                $facet: {
                    // Count by status
                    counts: [
                        {
                            $group: {
                                _id: '$sellerAccount.products.status',
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    // Total count
                    total: [{ $count: 'count' }],
                    // First 20 Active products
                    activeProducts: [
                        { $match: { 'sellerAccount.products.status': 'Active' } },
                        { $sort: { 'sellerAccount.products.asin': 1 } },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                asin: '$sellerAccount.products.asin',
                                sku: '$sellerAccount.products.sku',
                                itemName: '$sellerAccount.products.itemName',
                                price: '$sellerAccount.products.price',
                                status: '$sellerAccount.products.status',
                                quantity: '$sellerAccount.products.quantity',
                                issues: '$sellerAccount.products.issues',
                                issueCount: '$sellerAccount.products.issueCount',
                                has_b2b_pricing: '$sellerAccount.products.has_b2b_pricing',
                                updatedAt: '$sellerAccount.products.updatedAt'
                            }
                        }
                    ],
                    // Active products count (for pagination)
                    activeCount: [
                        { $match: { 'sellerAccount.products.status': 'Active' } },
                        { $count: 'count' }
                    ]
                }
            }
        ];

        const [result] = await Seller.aggregate(pipeline);

        if (!result) {
            return res.status(200).json(
                new ApiResponse(200, {
                    summary: {
                        totalProducts: 0,
                        activeProducts: 0,
                        inactiveProducts: 0,
                        incompleteProducts: 0,
                        productsWithAPlus: 0,
                        productsWithoutAPlus: 0,
                        productsNotTargetedInAds: 0
                    },
                    products: [],
                    pagination: { page: 1, limit, totalItems: 0, totalPages: 0, hasMore: false },
                    country: Country,
                    region: Region
                }, "Your Products Initial retrieved (no products)")
            );
        }

        // Parse counts
        const countsMap = {};
        (result.counts || []).forEach(c => { countsMap[c._id] = c.count; });
        
        const totalProducts = result.total[0]?.count || 0;
        const activeProductsCount = countsMap['Active'] || 0;
        const inactiveProductsCount = countsMap['Inactive'] || 0;
        const incompleteProductsCount = countsMap['Incomplete'] || 0;
        const activeProducts = result.activeProducts || [];
        const activeTotalForPagination = result.activeCount[0]?.count || 0;

        // If no active products, return early with just counts
        if (activeProducts.length === 0) {
            const elapsed = Date.now() - startTime;
            logger.info(`[v2-initial] Completed in ${elapsed}ms - no active products`);

            return res.status(200).json(
                new ApiResponse(200, {
                    summary: {
                        totalProducts,
                        activeProducts: activeProductsCount,
                        inactiveProducts: inactiveProductsCount,
                        incompleteProducts: incompleteProductsCount,
                        productsWithAPlus: 0,
                        productsWithoutAPlus: 0,
                        productsNotTargetedInAds: 0
                    },
                    products: [],
                    pagination: { page: 1, limit, totalItems: 0, totalPages: 0, hasMore: false },
                    country: Country,
                    region: Region
                }, "Your Products Initial retrieved")
            );
        }

        // Collect ASINs from active products for enrichment
        const pageAsins = activeProducts.map(p => p.asin?.toUpperCase()).filter(Boolean);
        const pageAsinSet = new Set(pageAsins);

        // Fetch enrichment data in parallel (minimal fields only)
        const [productReviews, aPlusContent, sponsoredAdsData] = await Promise.all([
            NumberOfProductReviews.findOne({
                User: userId,
                $or: [{ region: Region, country: Country }, {}]
            }).sort({ createdAt: -1 }).select('Products.asin Products.product_num_ratings Products.product_star_ratings Products.product_title Products.product_photos Products.video_url').lean(),
            APlusContent.findOne({
                User: userId,
                $or: [{ region: Region, country: Country }, {}]
            }).sort({ createdAt: -1 }).select('ApiContentDetails.Asins ApiContentDetails.status').lean(),
            getProductWiseSponsoredAdsData(userId, Country, Region).catch(err => {
                logger.warn('[v2-initial] Could not fetch sponsored ads data:', err.message);
                return null;
            })
        ]);

        // Build reviews map
        const reviewsMap = new Map();
        if (productReviews?.Products) {
            productReviews.Products.forEach(product => {
                const asinKey = product.asin?.toUpperCase() || '';
                if (pageAsinSet.has(asinKey)) {
                    const videoUrls = product.video_url || [];
                    reviewsMap.set(asinKey, {
                        numRatings: product.product_num_ratings || '0',
                        starRatings: product.product_star_ratings || '0',
                        title: product.product_title || '',
                        photos: product.product_photos || [],
                        hasVideo: Array.isArray(videoUrls) && videoUrls.length > 0
                    });
                }
            });
        }

        // Build A+ map and count for ALL products (not just current page)
        const aPlusMap = new Map();
        let productsWithAPlus = 0;
        if (aPlusContent?.ApiContentDetails) {
            aPlusContent.ApiContentDetails.forEach(item => {
                const asinKey = item.Asins?.toUpperCase() || '';
                const hasAPlus = item.status === 'APPROVED' || item.status === 'PUBLISHED';
                aPlusMap.set(asinKey, item.status);
                if (hasAPlus) productsWithAPlus++;
            });
        }

        // Build targeted-in-ads set and count products NOT targeted
        const asinsTargetedInAds = new Set();
        if (sponsoredAdsData?.sponsoredAds && Array.isArray(sponsoredAdsData.sponsoredAds)) {
            sponsoredAdsData.sponsoredAds.forEach(adItem => {
                const asin = (adItem.asin || adItem.ASIN || '').toUpperCase();
                if (asin) asinsTargetedInAds.add(asin);
            });
        }
        const productsNotTargetedInAds = activeProductsCount - asinsTargetedInAds.size;

        // Enrich products (use issueCount from DB - pre-calculated)
        const enrichedProducts = activeProducts.map(product => {
            const asinKey = product.asin?.toUpperCase() || '';
            const reviewData = reviewsMap.get(asinKey) || {};
            const aPlusStatus = aPlusMap.get(asinKey);

            const hasAPlusContent = aPlusStatus === 'APPROVED' || aPlusStatus === 'PUBLISHED';
            const isTargetedInAds = asinsTargetedInAds.has(asinKey);

            return {
                asin: product.asin,
                sku: product.sku,
                title: product.itemName || reviewData.title || '',
                price: product.price || '0',
                status: product.status || 'Active',
                quantity: product.quantity ?? 0,
                numRatings: reviewData.numRatings || '0',
                starRatings: reviewData.starRatings || '0',
                hasAPlus: hasAPlusContent,
                aPlusStatus: aPlusStatus || 'Not Available',
                hasVideo: reviewData.hasVideo || false,
                image: reviewData.photos?.[0] || null,
                updatedAt: product.updatedAt || null,
                issues: product.issues || [],
                issueCount: product.issueCount || 0, // Pre-calculated in Seller model
                has_b2b_pricing: product.has_b2b_pricing || false,
                isTargetedInAds
            };
        });

        const totalPages = Math.ceil(activeTotalForPagination / limit);
        const hasMore = activeTotalForPagination > limit;

        const elapsed = Date.now() - startTime;
        logger.info(`[v2-initial] Completed in ${elapsed}ms - ${enrichedProducts.length} products`);

        return res.status(200).json(
            new ApiResponse(200, {
                summary: {
                    totalProducts,
                    activeProducts: activeProductsCount,
                    inactiveProducts: inactiveProductsCount,
                    incompleteProducts: incompleteProductsCount,
                    productsWithAPlus,
                    productsWithoutAPlus: activeProductsCount - productsWithAPlus,
                    productsNotTargetedInAds: Math.max(0, productsNotTargetedInAds)
                },
                products: enrichedProducts,
                pagination: {
                    page: 1,
                    limit,
                    totalItems: activeTotalForPagination,
                    totalPages,
                    hasMore
                },
                country: Country,
                region: Region
            }, "Your Products Initial retrieved successfully")
        );

    } catch (error) {
        logger.error("[v2-initial] Error:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting Your Products Initial: ${error.message}`)
        );
    }
});

/**
 * Get Your Products by Status (v2 - Optimized)
 * Called when switching to Inactive/Incomplete tabs, or for Load More on any tab.
 * Uses MongoDB aggregation - paginated at DB level.
 * Uses pre-calculated issueCount from Seller model.
 * 
 * Query params:
 * - status: 'Active' | 'Inactive' | 'Incomplete' (required)
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 */
const getYourProductsByStatusV2 = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    const status = req.query.status;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    if (!status || !['Active', 'Inactive', 'Incomplete'].includes(status)) {
        return res.status(400).json(
            new ApiError(400, 'status query parameter is required and must be Active, Inactive, or Incomplete')
        );
    }

    try {
        logger.info(`[v2] Getting Your Products (status: ${status}) for user ${userId}, page ${page}`);

        const userObjectId = require('mongoose').Types.ObjectId.createFromHexString(userId);

        // Single aggregation with $facet for count + paginated products
        const pipeline = [
            { $match: { User: userObjectId } },
            { $unwind: '$sellerAccount' },
            { $match: { 'sellerAccount.region': Region } },
            { $unwind: { path: '$sellerAccount.products', preserveNullAndEmptyArrays: false } },
            { $match: { 'sellerAccount.products.status': status } },
            {
                $facet: {
                    count: [{ $count: 'total' }],
                    products: [
                        { $sort: { 'sellerAccount.products.asin': 1 } },
                        { $skip: (page - 1) * limit },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                asin: '$sellerAccount.products.asin',
                                sku: '$sellerAccount.products.sku',
                                itemName: '$sellerAccount.products.itemName',
                                price: '$sellerAccount.products.price',
                                status: '$sellerAccount.products.status',
                                quantity: '$sellerAccount.products.quantity',
                                issues: '$sellerAccount.products.issues',
                                issueCount: '$sellerAccount.products.issueCount',
                                has_b2b_pricing: '$sellerAccount.products.has_b2b_pricing',
                                updatedAt: '$sellerAccount.products.updatedAt'
                            }
                        }
                    ]
                }
            }
        ];

        const [result] = await Seller.aggregate(pipeline);
        const totalItems = result?.count[0]?.total || 0;
        const rawProducts = result?.products || [];

        if (rawProducts.length === 0) {
            return res.status(200).json(
                new ApiResponse(200, {
                    products: [],
                    pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit), hasMore: false },
                    country: Country,
                    region: Region,
                    status
                }, "Your Products retrieved")
            );
        }

        // Collect ASINs for enrichment
        const pageAsins = rawProducts.map(p => p.asin?.toUpperCase()).filter(Boolean);
        const pageAsinSet = new Set(pageAsins);

        // Fetch enrichment data in parallel
        const [productReviews, aPlusContent, sponsoredAdsData] = await Promise.all([
            NumberOfProductReviews.findOne({
                User: userId,
                $or: [{ region: Region, country: Country }, {}]
            }).sort({ createdAt: -1 }).select('Products.asin Products.product_num_ratings Products.product_star_ratings Products.product_title Products.product_photos Products.video_url').lean(),
            APlusContent.findOne({
                User: userId,
                $or: [{ region: Region, country: Country }, {}]
            }).sort({ createdAt: -1 }).select('ApiContentDetails.Asins ApiContentDetails.status').lean(),
            getProductWiseSponsoredAdsData(userId, Country, Region).catch(() => null)
        ]);

        // Build maps
        const reviewsMap = new Map();
        if (productReviews?.Products) {
            productReviews.Products.forEach(p => {
                const key = p.asin?.toUpperCase() || '';
                if (pageAsinSet.has(key)) {
                    reviewsMap.set(key, {
                        numRatings: p.product_num_ratings || '0',
                        starRatings: p.product_star_ratings || '0',
                        title: p.product_title || '',
                        photos: p.product_photos || [],
                        hasVideo: Array.isArray(p.video_url) && p.video_url.length > 0
                    });
                }
            });
        }

        const aPlusMap = new Map();
        if (aPlusContent?.ApiContentDetails) {
            aPlusContent.ApiContentDetails.forEach(item => {
                const key = item.Asins?.toUpperCase() || '';
                if (pageAsinSet.has(key)) aPlusMap.set(key, item.status);
            });
        }

        const asinsTargetedInAds = new Set();
        if (sponsoredAdsData?.sponsoredAds) {
            sponsoredAdsData.sponsoredAds.forEach(ad => {
                const asin = (ad.asin || ad.ASIN || '').toUpperCase();
                if (asin) asinsTargetedInAds.add(asin);
            });
        }

        // Enrich products
        const enrichedProducts = rawProducts.map(product => {
            const key = product.asin?.toUpperCase() || '';
            const reviewData = reviewsMap.get(key) || {};
            const aPlusStatus = aPlusMap.get(key);
            const hasAPlus = aPlusStatus === 'APPROVED' || aPlusStatus === 'PUBLISHED';

            return {
                asin: product.asin,
                sku: product.sku,
                title: product.itemName || reviewData.title || '',
                price: product.price || '0',
                status: product.status || status,
                quantity: product.quantity ?? 0,
                numRatings: reviewData.numRatings || '0',
                starRatings: reviewData.starRatings || '0',
                hasAPlus,
                aPlusStatus: aPlusStatus || 'Not Available',
                hasVideo: reviewData.hasVideo || false,
                image: reviewData.photos?.[0] || null,
                updatedAt: product.updatedAt || null,
                issues: product.issues || [],
                issueCount: product.issueCount || 0,
                has_b2b_pricing: product.has_b2b_pricing || false,
                isTargetedInAds: asinsTargetedInAds.has(key)
            };
        });

        const totalPages = Math.ceil(totalItems / limit);
        const elapsed = Date.now() - startTime;
        logger.info(`[v2] ${status} products completed in ${elapsed}ms`);

        return res.status(200).json(
            new ApiResponse(200, {
                products: enrichedProducts,
                pagination: { page, limit, totalItems, totalPages, hasMore: page < totalPages },
                country: Country,
                region: Region,
                status
            }, "Your Products retrieved")
        );

    } catch (error) {
        logger.error("[v2] Error:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting Your Products: ${error.message}`)
        );
    }
});

/**
 * =====================================================================
 * YOUR PRODUCTS V3 - HIGHLY OPTIMIZED ENDPOINTS
 * =====================================================================
 * Separate endpoints for each use case - minimal DB queries, no unnecessary data.
 * 
 * Endpoints:
 * - /your-products-v3/summary - Counts only (for summary boxes)
 * - /your-products-v3/active - Paginated Active products (no A+/Ads columns)
 * - /your-products-v3/inactive - Paginated Inactive products
 * - /your-products-v3/incomplete - Paginated Incomplete products
 * - /your-products-v3/without-aplus - ASINs without A+ content
 * - /your-products-v3/not-targeted-in-ads - ASINs not targeted in ads
 */

const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');

/**
 * V3 Summary Endpoint - COUNTS ONLY
 * Returns: totalProducts, activeProducts, inactiveProducts, incompleteProducts, 
 *          productsWithoutAPlus, hasBrandStory
 * 
 * Uses efficient aggregation on Seller + count queries on APlusContent and NumberOfProductReviews
 */
const getYourProductsSummaryV3 = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`[v3-summary] Getting summary for user ${userId}, region ${Region}`);

        const userObjectId = require('mongoose').Types.ObjectId.createFromHexString(userId);

        // Run all count queries in parallel for maximum speed
        const [
            productCounts,
            aPlusData,
            brandStoryData,
            activeProductAsins,
            latestAdsItem
        ] = await Promise.all([
            // 1. Count products by status from Seller model
            Seller.aggregate([
                { $match: { User: userObjectId } },
                { $unwind: '$sellerAccount' },
                { $match: { 'sellerAccount.region': Region } },
                { $unwind: { path: '$sellerAccount.products', preserveNullAndEmptyArrays: false } },
                {
                    $group: {
                        _id: '$sellerAccount.products.status',
                        count: { $sum: 1 }
                    }
                }
            ]),
            
            // 2. Get A+ content count - count ASINs with APPROVED/PUBLISHED status
            APlusContent.findOne({
                User: userObjectId,
                country: Country,
                region: Region
            }).sort({ createdAt: -1 }).select('ApiContentDetails').lean(),
            
            // 3. Check if any product has brand story
            NumberOfProductReviews.findOne({
                User: userObjectId,
                country: Country,
                region: Region
            }).sort({ createdAt: -1 }).select('Products.has_brandstory').lean(),
            
            // 4. Get all active product ASINs (for not-targeted count)
            Seller.aggregate([
                { $match: { User: userObjectId } },
                { $unwind: '$sellerAccount' },
                { $match: { 'sellerAccount.region': Region } },
                { $unwind: { path: '$sellerAccount.products', preserveNullAndEmptyArrays: false } },
                { $match: { 'sellerAccount.products.status': { $regex: /^active$/i } } },
                { $group: { _id: { $toUpper: '$sellerAccount.products.asin' } } },
                { $project: { _id: 0, asin: '$_id' } }
            ]),
            
            // 5. Get latest ads batch for targeted ASINs
            ProductWiseSponsoredAdsItem.findOne({
                userId: userObjectId,
                country: Country,
                region: Region
            }).sort({ createdAt: -1 }).select('batchId').lean()
        ]);

        // Parse product counts - normalize status keys to lowercase for case-insensitive matching
        const countsMap = {};
        let totalProducts = 0;
        productCounts.forEach(c => {
            const normalizedStatus = (c._id || '').toLowerCase();
            countsMap[normalizedStatus] = (countsMap[normalizedStatus] || 0) + c.count;
            totalProducts += c.count;
        });

        const activeProducts = countsMap['active'] || 0;
        const inactiveProducts = countsMap['inactive'] || 0;
        const incompleteProducts = countsMap['incomplete'] || 0;

        // Count products with A+ (APPROVED or PUBLISHED)
        let productsWithAPlus = 0;
        if (aPlusData?.ApiContentDetails) {
            productsWithAPlus = aPlusData.ApiContentDetails.filter(
                item => item.status === 'APPROVED' || item.status === 'PUBLISHED'
            ).length;
        }
        const productsWithoutAPlus = totalProducts - productsWithAPlus;

        // Check if any product has brand story
        let hasBrandStory = false;
        if (brandStoryData?.Products) {
            hasBrandStory = brandStoryData.Products.some(p => p.has_brandstory === true);
        }

        // Calculate "Not Targeted to Ads" count
        let productsNotTargetedInAds = 0;
        const activeAsinsSet = new Set((activeProductAsins || []).map(p => p.asin));
        
        if (latestAdsItem?.batchId && activeAsinsSet.size > 0) {
            // Get distinct ASINs targeted in ads for this batch
            const distinctTargetedAsins = await ProductWiseSponsoredAdsItem.aggregate([
                { $match: { batchId: latestAdsItem.batchId } },
                { $group: { _id: { $toUpper: '$asin' } } },
                { $project: { _id: 0, asin: '$_id' } }
            ]);
            const targetedAsinsSet = new Set(distinctTargetedAsins.map(item => item.asin).filter(Boolean));
            
            // Count active products NOT in targeted set
            productsNotTargetedInAds = [...activeAsinsSet].filter(asin => !targetedAsinsSet.has(asin)).length;
        } else {
            // No ads data - all active products are "not targeted"
            productsNotTargetedInAds = activeAsinsSet.size;
        }

        const elapsed = Date.now() - startTime;
        logger.info(`[v3-summary] Completed in ${elapsed}ms`);

        return res.status(200).json(
            new ApiResponse(200, {
                summary: {
                    totalProducts,
                    activeProducts,
                    inactiveProducts,
                    incompleteProducts,
                    productsWithAPlus,
                    productsWithoutAPlus,
                    hasBrandStory,
                    productsNotTargetedInAds
                },
                country: Country,
                region: Region
            }, "Summary retrieved successfully")
        );

    } catch (error) {
        logger.error("[v3-summary] Error:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting summary: ${error.message}`)
        );
    }
});

/**
 * V3 Active Products Endpoint
 * Returns: Paginated Active products with ratings (NO A+ or Ads columns)
 * 
 * Query params: page (default 1), limit (default 20)
 */
const getYourProductsActiveV3 = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    try {
        logger.info(`[v3-active] Getting Active products for user ${userId}, page ${page}`);

        const userObjectId = require('mongoose').Types.ObjectId.createFromHexString(userId);

        // Single aggregation with $facet for count + paginated products
        const pipeline = [
            { $match: { User: userObjectId } },
            { $unwind: '$sellerAccount' },
            { $match: { 'sellerAccount.region': Region } },
            { $unwind: { path: '$sellerAccount.products', preserveNullAndEmptyArrays: false } },
            { $match: { 'sellerAccount.products.status': 'Active' } },
            {
                $facet: {
                    count: [{ $count: 'total' }],
                    products: [
                        { $sort: { 'sellerAccount.products.asin': 1 } },
                        { $skip: (page - 1) * limit },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                asin: '$sellerAccount.products.asin',
                                sku: '$sellerAccount.products.sku',
                                itemName: '$sellerAccount.products.itemName',
                                price: '$sellerAccount.products.price',
                                status: '$sellerAccount.products.status',
                                quantity: '$sellerAccount.products.quantity',
                                issueCount: '$sellerAccount.products.issueCount',
                                has_b2b_pricing: '$sellerAccount.products.has_b2b_pricing'
                            }
                        }
                    ]
                }
            }
        ];

        const [result] = await Seller.aggregate(pipeline);
        const totalItems = result?.count[0]?.total || 0;
        const rawProducts = result?.products || [];

        if (rawProducts.length === 0) {
            return res.status(200).json(
                new ApiResponse(200, {
                    products: [],
                    pagination: { page, limit, totalItems, totalPages: 0, hasMore: false },
                    country: Country,
                    region: Region
                }, "Active products retrieved")
            );
        }

        // Collect ASINs for enrichment (ratings only - no A+ or Ads)
        const pageAsins = rawProducts.map(p => p.asin?.toUpperCase()).filter(Boolean);
        const pageAsinSet = new Set(pageAsins);

        // Fetch only ratings data (minimal)
        const productReviews = await NumberOfProductReviews.findOne({
            User: userObjectId,
            country: Country,
            region: Region
        }).sort({ createdAt: -1 }).select('Products.asin Products.product_num_ratings Products.product_star_ratings Products.product_title Products.product_photos').lean();

        // Build reviews map
        const reviewsMap = new Map();
        if (productReviews?.Products) {
            productReviews.Products.forEach(p => {
                const key = p.asin?.toUpperCase() || '';
                if (pageAsinSet.has(key)) {
                    reviewsMap.set(key, {
                        numRatings: p.product_num_ratings || '0',
                        starRatings: p.product_star_ratings || '0',
                        title: p.product_title || '',
                        image: p.product_photos?.[0] || null
                    });
                }
            });
        }

        // Enrich products (NO A+, NO Ads)
        const enrichedProducts = rawProducts.map(product => {
            const key = product.asin?.toUpperCase() || '';
            const reviewData = reviewsMap.get(key) || {};

            return {
                asin: product.asin,
                sku: product.sku,
                title: product.itemName || reviewData.title || '',
                price: product.price || '0',
                status: 'Active',
                quantity: product.quantity ?? 0,
                numRatings: reviewData.numRatings || '0',
                starRatings: reviewData.starRatings || '0',
                image: reviewData.image || null,
                issueCount: product.issueCount || 0,
                has_b2b_pricing: product.has_b2b_pricing || false
            };
        });

        const totalPages = Math.ceil(totalItems / limit);
        const elapsed = Date.now() - startTime;
        logger.info(`[v3-active] Completed in ${elapsed}ms - ${enrichedProducts.length} products`);

        return res.status(200).json(
            new ApiResponse(200, {
                products: enrichedProducts,
                pagination: { page, limit, totalItems, totalPages, hasMore: page < totalPages },
                country: Country,
                region: Region
            }, "Active products retrieved")
        );

    } catch (error) {
        logger.error("[v3-active] Error:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting Active products: ${error.message}`)
        );
    }
});

/**
 * V3 Inactive Products Endpoint
 * Returns: Paginated Inactive products with issues (from Seller model only)
 */
const getYourProductsInactiveV3 = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    try {
        logger.info(`[v3-inactive] Getting Inactive products for user ${userId}, page ${page}`);

        const userObjectId = require('mongoose').Types.ObjectId.createFromHexString(userId);

        // Single aggregation with $facet
        const pipeline = [
            { $match: { User: userObjectId } },
            { $unwind: '$sellerAccount' },
            { $match: { 'sellerAccount.region': Region } },
            { $unwind: { path: '$sellerAccount.products', preserveNullAndEmptyArrays: false } },
            { $match: { 'sellerAccount.products.status': { $regex: /^inactive$/i } } },
            {
                $facet: {
                    count: [{ $count: 'total' }],
                    products: [
                        { $sort: { 'sellerAccount.products.asin': 1 } },
                        { $skip: (page - 1) * limit },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                asin: '$sellerAccount.products.asin',
                                sku: '$sellerAccount.products.sku',
                                itemName: '$sellerAccount.products.itemName',
                                price: '$sellerAccount.products.price',
                                status: '$sellerAccount.products.status',
                                quantity: '$sellerAccount.products.quantity',
                                issues: { $ifNull: ['$sellerAccount.products.issues', []] },
                                has_b2b_pricing: '$sellerAccount.products.has_b2b_pricing'
                            }
                        }
                    ]
                }
            }
        ];

        const [result] = await Seller.aggregate(pipeline);
        const totalItems = result?.count[0]?.total || 0;
        const products = result?.products || [];

        // Map products to response format (no enrichment needed - all data from Seller)
        const responseProducts = products.map(p => ({
            asin: p.asin,
            sku: p.sku,
            title: p.itemName || '',
            price: p.price || '0',
            status: 'Inactive',
            quantity: p.quantity ?? 0,
            issues: Array.isArray(p.issues) ? p.issues : [],
            has_b2b_pricing: p.has_b2b_pricing || false
        }));

        const totalPages = Math.ceil(totalItems / limit);
        const elapsed = Date.now() - startTime;
        logger.info(`[v3-inactive] Completed in ${elapsed}ms - ${responseProducts.length} products`);

        return res.status(200).json(
            new ApiResponse(200, {
                products: responseProducts,
                pagination: { page, limit, totalItems, totalPages, hasMore: page < totalPages },
                country: Country,
                region: Region
            }, "Inactive products retrieved")
        );

    } catch (error) {
        logger.error("[v3-inactive] Error:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting Inactive products: ${error.message}`)
        );
    }
});

/**
 * V3 Incomplete Products Endpoint
 * Returns: Paginated Incomplete products with issues (from Seller model only)
 */
const getYourProductsIncompleteV3 = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    try {
        logger.info(`[v3-incomplete] Getting Incomplete products for user ${userId}, page ${page}`);

        const userObjectId = require('mongoose').Types.ObjectId.createFromHexString(userId);

        // Single aggregation with $facet
        const pipeline = [
            { $match: { User: userObjectId } },
            { $unwind: '$sellerAccount' },
            { $match: { 'sellerAccount.region': Region } },
            { $unwind: { path: '$sellerAccount.products', preserveNullAndEmptyArrays: false } },
            { $match: { 'sellerAccount.products.status': { $regex: /^incomplete$/i } } },
            {
                $facet: {
                    count: [{ $count: 'total' }],
                    products: [
                        { $sort: { 'sellerAccount.products.asin': 1 } },
                        { $skip: (page - 1) * limit },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                asin: '$sellerAccount.products.asin',
                                sku: '$sellerAccount.products.sku',
                                itemName: '$sellerAccount.products.itemName',
                                price: '$sellerAccount.products.price',
                                status: '$sellerAccount.products.status',
                                quantity: '$sellerAccount.products.quantity',
                                issues: { $ifNull: ['$sellerAccount.products.issues', []] },
                                has_b2b_pricing: '$sellerAccount.products.has_b2b_pricing'
                            }
                        }
                    ]
                }
            }
        ];

        const [result] = await Seller.aggregate(pipeline);
        const totalItems = result?.count[0]?.total || 0;
        const products = result?.products || [];

        // Map products to response format
        const responseProducts = products.map(p => ({
            asin: p.asin,
            sku: p.sku,
            title: p.itemName || '',
            price: p.price || '0',
            status: 'Incomplete',
            quantity: p.quantity ?? 0,
            issues: Array.isArray(p.issues) ? p.issues : [],
            has_b2b_pricing: p.has_b2b_pricing || false
        }));

        const totalPages = Math.ceil(totalItems / limit);
        const elapsed = Date.now() - startTime;
        logger.info(`[v3-incomplete] Completed in ${elapsed}ms - ${responseProducts.length} products`);

        return res.status(200).json(
            new ApiResponse(200, {
                products: responseProducts,
                pagination: { page, limit, totalItems, totalPages, hasMore: page < totalPages },
                country: Country,
                region: Region
            }, "Incomplete products retrieved")
        );

    } catch (error) {
        logger.error("[v3-incomplete] Error:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting Incomplete products: ${error.message}`)
        );
    }
});

/**
 * V3 Without A+ Content Endpoint
 * Returns: Paginated products that DON'T have A+ content (APPROVED/PUBLISHED)
 * 
 * Logic: Get all ASINs from Seller, subtract ASINs with A+ from APlusContent
 */
const getYourProductsWithoutAPlusV3 = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    try {
        logger.info(`[v3-without-aplus] Getting products without A+ for user ${userId}, page ${page}`);

        const userObjectId = require('mongoose').Types.ObjectId.createFromHexString(userId);

        // Get all ASINs with A+ (APPROVED or PUBLISHED)
        const aPlusDoc = await APlusContent.findOne({
            User: userObjectId,
            country: Country,
            region: Region
        }).sort({ createdAt: -1 }).select('ApiContentDetails').lean();

        const asinsWithAPlus = new Set();
        if (aPlusDoc?.ApiContentDetails) {
            aPlusDoc.ApiContentDetails.forEach(item => {
                if (item.status === 'APPROVED' || item.status === 'PUBLISHED') {
                    asinsWithAPlus.add(item.Asins?.toUpperCase() || '');
                }
            });
        }

        // Get products that are NOT in the A+ set
        // We use aggregation to filter products whose ASIN is NOT in the A+ set
        const asinsWithAPlusList = Array.from(asinsWithAPlus);

        const pipeline = [
            { $match: { User: userObjectId } },
            { $unwind: '$sellerAccount' },
            { $match: { 'sellerAccount.region': Region } },
            { $unwind: { path: '$sellerAccount.products', preserveNullAndEmptyArrays: false } },
            // Filter out products with A+ content
            {
                $match: {
                    $expr: {
                        $not: {
                            $in: [{ $toUpper: '$sellerAccount.products.asin' }, asinsWithAPlusList]
                        }
                    }
                }
            },
            {
                $facet: {
                    count: [{ $count: 'total' }],
                    products: [
                        { $sort: { 'sellerAccount.products.asin': 1 } },
                        { $skip: (page - 1) * limit },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                asin: '$sellerAccount.products.asin',
                                sku: '$sellerAccount.products.sku',
                                itemName: '$sellerAccount.products.itemName',
                                price: '$sellerAccount.products.price',
                                status: '$sellerAccount.products.status',
                                quantity: '$sellerAccount.products.quantity'
                            }
                        }
                    ]
                }
            }
        ];

        const [result] = await Seller.aggregate(pipeline);
        const totalItems = result?.count[0]?.total || 0;
        const products = result?.products || [];

        // Map to response format
        const responseProducts = products.map(p => ({
            asin: p.asin,
            sku: p.sku,
            title: p.itemName || '',
            price: p.price || '0',
            status: p.status || 'Unknown',
            quantity: p.quantity ?? 0,
            hasAPlus: false
        }));

        const totalPages = Math.ceil(totalItems / limit);
        const elapsed = Date.now() - startTime;
        logger.info(`[v3-without-aplus] Completed in ${elapsed}ms - ${responseProducts.length} products`);

        return res.status(200).json(
            new ApiResponse(200, {
                products: responseProducts,
                pagination: { page, limit, totalItems, totalPages, hasMore: page < totalPages },
                country: Country,
                region: Region
            }, "Products without A+ retrieved")
        );

    } catch (error) {
        logger.error("[v3-without-aplus] Error:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting products without A+: ${error.message}`)
        );
    }
});

/**
 * V3 Not Targeted In Ads Endpoint
 * Returns: Paginated products that are NOT targeted in any ads campaign
 * 
 * Logic: Get distinct ASINs from ProductWiseSponsoredAdsItem, subtract from all products
 */
const getYourProductsNotTargetedInAdsV3 = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    try {
        logger.info(`[v3-not-targeted] Getting products not targeted in ads for user ${userId}, page ${page}`);

        const userObjectId = require('mongoose').Types.ObjectId.createFromHexString(userId);

        // Get distinct ASINs targeted in ads (latest batch only)
        // First find latest batchId
        const latestItem = await ProductWiseSponsoredAdsItem.findOne({
            userId: userObjectId,
            country: Country,
            region: Region
        }).sort({ createdAt: -1 }).select('batchId').lean();

        const asinsTargetedInAds = new Set();
        if (latestItem?.batchId) {
            // Get distinct ASINs for this batch using aggregation
            const distinctAsins = await ProductWiseSponsoredAdsItem.aggregate([
                { $match: { batchId: latestItem.batchId } },
                { $group: { _id: { $toUpper: '$asin' } } },
                { $project: { _id: 0, asin: '$_id' } }
            ]);
            distinctAsins.forEach(item => {
                if (item.asin) asinsTargetedInAds.add(item.asin);
            });
        }

        const asinsTargetedList = Array.from(asinsTargetedInAds);

        // Get products that are NOT targeted in ads
        const pipeline = [
            { $match: { User: userObjectId } },
            { $unwind: '$sellerAccount' },
            { $match: { 'sellerAccount.region': Region } },
            { $unwind: { path: '$sellerAccount.products', preserveNullAndEmptyArrays: false } },
            // Only Active products (typically you target Active products in ads)
            { $match: { 'sellerAccount.products.status': 'Active' } },
            // Filter out products that ARE targeted
            {
                $match: {
                    $expr: {
                        $not: {
                            $in: [{ $toUpper: '$sellerAccount.products.asin' }, asinsTargetedList]
                        }
                    }
                }
            },
            {
                $facet: {
                    count: [{ $count: 'total' }],
                    products: [
                        { $sort: { 'sellerAccount.products.asin': 1 } },
                        { $skip: (page - 1) * limit },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                asin: '$sellerAccount.products.asin',
                                sku: '$sellerAccount.products.sku',
                                itemName: '$sellerAccount.products.itemName',
                                price: '$sellerAccount.products.price',
                                status: '$sellerAccount.products.status',
                                quantity: '$sellerAccount.products.quantity'
                            }
                        }
                    ]
                }
            }
        ];

        const [result] = await Seller.aggregate(pipeline);
        const totalItems = result?.count[0]?.total || 0;
        const products = result?.products || [];

        // Map to response format
        const responseProducts = products.map(p => ({
            asin: p.asin,
            sku: p.sku,
            title: p.itemName || '',
            price: p.price || '0',
            status: p.status || 'Active',
            quantity: p.quantity ?? 0,
            isTargetedInAds: false
        }));

        const totalPages = Math.ceil(totalItems / limit);
        const elapsed = Date.now() - startTime;
        logger.info(`[v3-not-targeted] Completed in ${elapsed}ms - ${responseProducts.length} products`);

        return res.status(200).json(
            new ApiResponse(200, {
                products: responseProducts,
                pagination: { page, limit, totalItems, totalPages, hasMore: page < totalPages },
                country: Country,
                region: Region
            }, "Products not targeted in ads retrieved")
        );

    } catch (error) {
        logger.error("[v3-not-targeted] Error:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting products not targeted in ads: ${error.message}`)
        );
    }
});

/**
 * V3 Optimization Products Endpoint - SELF-CONTAINED
 * 
 * Uses OptimizationService which is completely self-contained:
 * - Fetches ALL active products + performance/profitability data in parallel
 * - Generates recommendations in the backend (no frontend dependency)
 * - Paginates after enrichment for consistent results
 * 
 * Performance: ~90% faster than issues-by-product endpoint
 */
const getOptimizationProductsV3 = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    try {
        const { getOptimizationProducts } = require('../../Services/Calculations/OptimizationService.js');
        
        const result = await getOptimizationProducts(userId, Region, Country, { page, limit });

        return res.status(200).json(
            new ApiResponse(200, result, "Optimization products retrieved")
        );

    } catch (error) {
        logger.error("[v3-optimization] Error:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting optimization products: ${error.message}`)
        );
    }
});

/**
 * PHASE 1: Instant data - precomputed counts (~50ms)
 * Returns: error counts, product counts, date range
 */
const getDashboardPhase1 = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    if (!userId || !Country || !Region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, country, and region are required')
        );
    }

    try {
        const { getDashboardPhase1: fetchPhase1 } = require('../../Services/Calculations/DashboardSummaryService.js');
        const result = await fetchPhase1(userId, Country, Region);
        
        if (!result.success) {
            return res.status(500).json(
                new ApiError(500, result.error || 'Failed to get dashboard phase 1')
            );
        }

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Dashboard Phase 1 total time: ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, { dashboardData: result.data }, "Dashboard phase 1 retrieved")
        );
    } catch (error) {
        logger.error("Error in getDashboardPhase1:", { message: error.message, stack: error.stack });
        return res.status(500).json(
            new ApiError(500, `Error getting dashboard phase 1: ${error.message}`)
        );
    }
});

/**
 * PHASE 2: Core metrics (~150ms)
 * Returns: sales totals, account health, finance summary, PPC summary
 */
const getDashboardPhase2 = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    if (!userId || !Country || !Region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, country, and region are required')
        );
    }

    try {
        const { getDashboardPhase2: fetchPhase2 } = require('../../Services/Calculations/DashboardSummaryService.js');
        const result = await fetchPhase2(userId, Country, Region);
        
        if (!result.success) {
            return res.status(500).json(
                new ApiError(500, result.error || 'Failed to get dashboard phase 2')
            );
        }

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Dashboard Phase 2 total time: ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, { dashboardData: result.data }, "Dashboard phase 2 retrieved")
        );
    } catch (error) {
        logger.error("Error in getDashboardPhase2:", { message: error.message, stack: error.stack });
        return res.status(500).json(
            new ApiError(500, `Error getting dashboard phase 2: ${error.message}`)
        );
    }
});

/**
 * PHASE 3: Charts and arrays (~200ms)
 * Returns: datewiseSales, ppcDateWiseMetrics, orders, products, adsKeywordsData
 */
const getDashboardPhase3 = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    if (!userId || !Country || !Region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, country, and region are required')
        );
    }

    try {
        const { getDashboardPhase3: fetchPhase3 } = require('../../Services/Calculations/DashboardSummaryService.js');
        const result = await fetchPhase3(userId, Country, Region);
        
        if (!result.success) {
            return res.status(500).json(
                new ApiError(500, result.error || 'Failed to get dashboard phase 3')
            );
        }

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Dashboard Phase 3 total time: ${totalTime}ms`);

        return res.status(200).json(
            new ApiResponse(200, { dashboardData: result.data }, "Dashboard phase 3 retrieved")
        );
    } catch (error) {
        logger.error("Error in getDashboardPhase3:", { message: error.message, stack: error.stack });
        return res.status(500).json(
            new ApiError(500, `Error getting dashboard phase 3: ${error.message}`)
        );
    }
});

module.exports = {
    getDashboardData,
    getDashboardSummary,
    getProductCheckerData,
    getTop4ProductsOptimized,
    getProfitabilityData,
    getProfitabilitySummary,
    getPPCData,
    getIssuesData,
    getIssuesByProductData,
    getKeywordAnalysisData,
    getReimbursementData,
    getTasksData,
    updateTaskStatus,
    getInventoryData,
    getAsinWiseSalesData,
    getYourProductsData,
    getNavbarData,
    getAccountHistoryData,
    getProductHistory,
    getComparisonDebugInfo,
    // v2 optimized endpoints
    getYourProductsInitialV2,
    getYourProductsByStatusV2,
    // v3 highly optimized endpoints
    getYourProductsSummaryV3,
    getYourProductsActiveV3,
    getYourProductsInactiveV3,
    getYourProductsIncompleteV3,
    getYourProductsWithoutAPlusV3,
    getYourProductsNotTargetedInAdsV3,
    getOptimizationProductsV3,
    // Multi-phase dashboard endpoints
    getDashboardPhase1,
    getDashboardPhase2,
    getDashboardPhase3,
    // Phased profitability endpoints (parallel loading)
    getProfitabilityMetrics,
    getProfitabilityChart,
    getProfitabilityTable,
    // Profitability issues endpoints
    getProfitabilityIssues,
    getProfitabilityIssuesSummary
};

