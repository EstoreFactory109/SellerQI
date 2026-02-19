/**
 * PPC Campaign Analysis Controller
 * 
 * Provides lightweight, paginated endpoints for the Campaign Audit page.
 * Each endpoint returns only the data needed for its specific tab,
 * avoiding the full Analyse pipeline.
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const PPCCampaignAnalysisService = require('../../Services/Calculations/PPCCampaignAnalysisService.js');

/**
 * Get PPC KPI Summary for the top boxes
 * Returns: spend, sales, acos, tacos, unitsSold, totalIssues
 */
const getPPCKPISummary = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    if (!userId || !Country || !Region) {
        logger.error('[PPCCampaignAnalysis] Missing required parameters', { userId, Country, Region });
        return res.status(400).json(
            new ApiError(400, 'User ID, Country, and Region are required')
        );
    }

    try {
        logger.info(`[PPCCampaignAnalysis] Getting KPI summary for user: ${userId}`);
        
        const summary = await PPCCampaignAnalysisService.getPPCKPISummary(userId, Country, Region);
        
        logger.info(`[PPCCampaignAnalysis] KPI summary returned in ${Date.now() - startTime}ms`);
        return res.status(200).json(
            new ApiResponse(200, summary, 'PPC KPI summary retrieved successfully')
        );
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting KPI summary:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching PPC KPI summary: ${error.message}`)
        );
    }
});

/**
 * Get High ACOS Campaigns (Tab 0)
 * Query params: page, limit, startDate, endDate
 */
const getHighAcosCampaigns = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    if (!userId || !Country || !Region) {
        logger.error('[PPCCampaignAnalysis] Missing required parameters', { userId, Country, Region });
        return res.status(400).json(
            new ApiError(400, 'User ID, Country, and Region are required')
        );
    }

    try {
        logger.info(`[PPCCampaignAnalysis] Getting high ACOS campaigns for user: ${userId}, page: ${page}`);
        
        const result = await PPCCampaignAnalysisService.getHighAcosCampaigns(
            userId, Country, Region, page, limit, startDate, endDate
        );
        
        logger.info(`[PPCCampaignAnalysis] High ACOS campaigns returned in ${Date.now() - startTime}ms`);
        return res.status(200).json(
            new ApiResponse(200, result, 'High ACOS campaigns retrieved successfully')
        );
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting high ACOS campaigns:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching high ACOS campaigns: ${error.message}`)
        );
    }
});

/**
 * Get Wasted Spend Keywords (Tab 1)
 * Query params: page, limit, startDate, endDate
 */
const getWastedSpendKeywords = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    if (!userId || !Country || !Region) {
        logger.error('[PPCCampaignAnalysis] Missing required parameters', { userId, Country, Region });
        return res.status(400).json(
            new ApiError(400, 'User ID, Country, and Region are required')
        );
    }

    try {
        logger.info(`[PPCCampaignAnalysis] Getting wasted spend keywords for user: ${userId}, page: ${page}`);
        
        const result = await PPCCampaignAnalysisService.getWastedSpendKeywords(
            userId, Country, Region, page, limit, startDate, endDate
        );
        
        logger.info(`[PPCCampaignAnalysis] Wasted spend keywords returned in ${Date.now() - startTime}ms`);
        return res.status(200).json(
            new ApiResponse(200, result, 'Wasted spend keywords retrieved successfully')
        );
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting wasted spend keywords:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching wasted spend keywords: ${error.message}`)
        );
    }
});

/**
 * Get Campaigns Without Negative Keywords (Tab 2)
 * Query params: page, limit
 */
const getCampaignsWithoutNegatives = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));

    if (!userId || !Country || !Region) {
        logger.error('[PPCCampaignAnalysis] Missing required parameters', { userId, Country, Region });
        return res.status(400).json(
            new ApiError(400, 'User ID, Country, and Region are required')
        );
    }

    try {
        logger.info(`[PPCCampaignAnalysis] Getting campaigns without negatives for user: ${userId}, page: ${page}`);
        
        const result = await PPCCampaignAnalysisService.getCampaignsWithoutNegatives(
            userId, Country, Region, page, limit
        );
        
        logger.info(`[PPCCampaignAnalysis] Campaigns without negatives returned in ${Date.now() - startTime}ms`);
        return res.status(200).json(
            new ApiResponse(200, result, 'Campaigns without negative keywords retrieved successfully')
        );
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting campaigns without negatives:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching campaigns without negatives: ${error.message}`)
        );
    }
});

/**
 * Get Top Performing Keywords (Tab 3)
 * Query params: page, limit, startDate, endDate
 */
const getTopPerformingKeywords = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    if (!userId || !Country || !Region) {
        logger.error('[PPCCampaignAnalysis] Missing required parameters', { userId, Country, Region });
        return res.status(400).json(
            new ApiError(400, 'User ID, Country, and Region are required')
        );
    }

    try {
        logger.info(`[PPCCampaignAnalysis] Getting top performing keywords for user: ${userId}, page: ${page}`);
        
        const result = await PPCCampaignAnalysisService.getTopPerformingKeywords(
            userId, Country, Region, page, limit, startDate, endDate
        );
        
        logger.info(`[PPCCampaignAnalysis] Top performing keywords returned in ${Date.now() - startTime}ms`);
        return res.status(200).json(
            new ApiResponse(200, result, 'Top performing keywords retrieved successfully')
        );
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting top performing keywords:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching top performing keywords: ${error.message}`)
        );
    }
});

/**
 * Get Search Terms with Zero Sales (Tab 4)
 * Query params: page, limit, startDate, endDate
 */
const getSearchTermsZeroSales = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    if (!userId || !Country || !Region) {
        logger.error('[PPCCampaignAnalysis] Missing required parameters', { userId, Country, Region });
        return res.status(400).json(
            new ApiError(400, 'User ID, Country, and Region are required')
        );
    }

    try {
        logger.info(`[PPCCampaignAnalysis] Getting search terms with zero sales for user: ${userId}, page: ${page}`);
        
        const result = await PPCCampaignAnalysisService.getSearchTermsZeroSales(
            userId, Country, Region, page, limit, startDate, endDate
        );
        
        logger.info(`[PPCCampaignAnalysis] Search terms with zero sales returned in ${Date.now() - startTime}ms`);
        return res.status(200).json(
            new ApiResponse(200, result, 'Search terms with zero sales retrieved successfully')
        );
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting search terms with zero sales:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching search terms with zero sales: ${error.message}`)
        );
    }
});

/**
 * Get Auto Campaign Insights (Tab 5)
 * Query params: page, limit, startDate, endDate
 */
const getAutoCampaignInsights = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    if (!userId || !Country || !Region) {
        logger.error('[PPCCampaignAnalysis] Missing required parameters', { userId, Country, Region });
        return res.status(400).json(
            new ApiError(400, 'User ID, Country, and Region are required')
        );
    }

    try {
        logger.info(`[PPCCampaignAnalysis] Getting auto campaign insights for user: ${userId}, page: ${page}`);
        
        const result = await PPCCampaignAnalysisService.getAutoCampaignInsights(
            userId, Country, Region, page, limit, startDate, endDate
        );
        
        logger.info(`[PPCCampaignAnalysis] Auto campaign insights returned in ${Date.now() - startTime}ms`);
        return res.status(200).json(
            new ApiResponse(200, result, 'Auto campaign insights retrieved successfully')
        );
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting auto campaign insights:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching auto campaign insights: ${error.message}`)
        );
    }
});

/**
 * Get tab counts for all campaign analysis tabs
 * Used to show counts in tab labels without loading full data
 */
const getTabCounts = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    if (!userId || !Country || !Region) {
        logger.error('[PPCCampaignAnalysis] Missing required parameters', { userId, Country, Region });
        return res.status(400).json(
            new ApiError(400, 'User ID, Country, and Region are required')
        );
    }

    try {
        logger.info(`[PPCCampaignAnalysis] Getting tab counts for user: ${userId}`);
        
        const counts = await PPCCampaignAnalysisService.getTabCounts(userId, Country, Region);
        
        logger.info(`[PPCCampaignAnalysis] Tab counts returned in ${Date.now() - startTime}ms`);
        return res.status(200).json(
            new ApiResponse(200, counts, 'Tab counts retrieved successfully')
        );
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting tab counts:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching tab counts: ${error.message}`)
        );
    }
});

module.exports = {
    getPPCKPISummary,
    getHighAcosCampaigns,
    getWastedSpendKeywords,
    getCampaignsWithoutNegatives,
    getTopPerformingKeywords,
    getSearchTermsZeroSales,
    getAutoCampaignInsights,
    getTabCounts
};
