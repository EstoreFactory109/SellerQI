/**
 * Issues Paginated Controller
 * 
 * Provides optimized, paginated endpoints for the Issues pages.
 * These endpoints replace the heavy full-data endpoints with
 * lightweight, server-side paginated responses.
 * 
 * Endpoints:
 * - GET /api/pagewise/issues/summary - Get issue counts only
 * - GET /api/pagewise/issues/ranking - Paginated ranking issues
 * - GET /api/pagewise/issues/conversion - Paginated conversion issues
 * - GET /api/pagewise/issues/inventory - Paginated inventory issues
 * - GET /api/pagewise/issues/account - Account issues
 * - GET /api/pagewise/issues/products - Paginated products with issues
 */

const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const IssuesPaginationService = require('../../Services/Calculations/IssuesPaginationService.js');

/**
 * Get issues summary (counts only)
 * Fast endpoint for dashboard header display
 */
const getIssuesSummary = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    
    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, country, and region are required')
        );
    }
    
    try {
        const result = await IssuesPaginationService.getIssuesSummary(userId, country, region);
        
        if (!result.success) {
            logger.warn('[IssuesPaginatedController] No summary data found', {
                userId, country, region,
                error: result.error
            });
            return res.status(404).json(
                new ApiError(404, result.error || 'No issues data found')
            );
        }
        
        return res.status(200).json(
            new ApiResponse(200, result.data, 'Issues summary retrieved successfully')
        );
        
    } catch (error) {
        logger.error('[IssuesPaginatedController] Error getting issues summary', {
            error: error.message,
            userId, country, region
        });
        return res.status(500).json(
            new ApiError(500, `Error getting issues summary: ${error.message}`)
        );
    }
});

/**
 * Get paginated ranking issues
 * Query params: page (default 1), limit (default 10)
 */
const getRankingIssues = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || IssuesPaginationService.DEFAULT_PAGE_SIZE;
    
    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, country, and region are required')
        );
    }
    
    // Validate pagination parameters
    if (page < 1) {
        return res.status(400).json(
            new ApiError(400, 'Page must be greater than 0')
        );
    }
    
    if (limit < 1 || limit > 100) {
        return res.status(400).json(
            new ApiError(400, 'Limit must be between 1 and 100')
        );
    }
    
    try {
        const result = await IssuesPaginationService.getRankingIssues(userId, country, region, page, limit);
        
        if (!result.success) {
            return res.status(404).json(
                new ApiError(404, result.error || 'No ranking issues found')
            );
        }
        
        return res.status(200).json(
            new ApiResponse(200, {
                data: result.data,
                pagination: result.pagination
            }, 'Ranking issues retrieved successfully')
        );
        
    } catch (error) {
        logger.error('[IssuesPaginatedController] Error getting ranking issues', {
            error: error.message,
            userId, country, region, page, limit
        });
        return res.status(500).json(
            new ApiError(500, `Error getting ranking issues: ${error.message}`)
        );
    }
});

/**
 * Get paginated conversion issues (includes buy box data)
 * Query params: page (default 1), limit (default 10)
 */
const getConversionIssues = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || IssuesPaginationService.DEFAULT_PAGE_SIZE;
    
    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, country, and region are required')
        );
    }
    
    if (page < 1) {
        return res.status(400).json(
            new ApiError(400, 'Page must be greater than 0')
        );
    }
    
    if (limit < 1 || limit > 100) {
        return res.status(400).json(
            new ApiError(400, 'Limit must be between 1 and 100')
        );
    }
    
    try {
        const result = await IssuesPaginationService.getConversionIssues(userId, country, region, page, limit);
        
        if (!result.success) {
            return res.status(404).json(
                new ApiError(404, result.error || 'No conversion issues found')
            );
        }
        
        return res.status(200).json(
            new ApiResponse(200, {
                data: result.data,
                buyBoxData: result.buyBoxData,
                pagination: result.pagination
            }, 'Conversion issues retrieved successfully')
        );
        
    } catch (error) {
        logger.error('[IssuesPaginatedController] Error getting conversion issues', {
            error: error.message,
            userId, country, region, page, limit
        });
        return res.status(500).json(
            new ApiError(500, `Error getting conversion issues: ${error.message}`)
        );
    }
});

/**
 * Get paginated inventory issues
 * Query params: page (default 1), limit (default 10)
 */
const getInventoryIssues = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || IssuesPaginationService.DEFAULT_PAGE_SIZE;
    
    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, country, and region are required')
        );
    }
    
    if (page < 1) {
        return res.status(400).json(
            new ApiError(400, 'Page must be greater than 0')
        );
    }
    
    if (limit < 1 || limit > 100) {
        return res.status(400).json(
            new ApiError(400, 'Limit must be between 1 and 100')
        );
    }
    
    try {
        const result = await IssuesPaginationService.getInventoryIssues(userId, country, region, page, limit);
        
        if (!result.success) {
            return res.status(404).json(
                new ApiError(404, result.error || 'No inventory issues found')
            );
        }
        
        return res.status(200).json(
            new ApiResponse(200, {
                data: result.data,
                pagination: result.pagination
            }, 'Inventory issues retrieved successfully')
        );
        
    } catch (error) {
        logger.error('[IssuesPaginatedController] Error getting inventory issues', {
            error: error.message,
            userId, country, region, page, limit
        });
        return res.status(500).json(
            new ApiError(500, `Error getting inventory issues: ${error.message}`)
        );
    }
});

/**
 * Get account issues (no pagination - typically small data set)
 */
const getAccountIssues = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    
    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, country, and region are required')
        );
    }
    
    try {
        const result = await IssuesPaginationService.getAccountIssues(userId, country, region);
        
        if (!result.success) {
            return res.status(404).json(
                new ApiError(404, result.error || 'No account issues found')
            );
        }
        
        return res.status(200).json(
            new ApiResponse(200, result.data, 'Account issues retrieved successfully')
        );
        
    } catch (error) {
        logger.error('[IssuesPaginatedController] Error getting account issues', {
            error: error.message,
            userId, country, region
        });
        return res.status(500).json(
            new ApiError(500, `Error getting account issues: ${error.message}`)
        );
    }
});

/**
 * Get paginated products with issues for Issues by Product page
 * 
 * Query params:
 * - page (default 1): Page number
 * - limit (default 6): Items per page
 * - sort (default 'issues'): Sort field (issues, sessions, conversion, sales, acos, name, asin, price)
 * - sortOrder (default 'desc'): Sort order (asc, desc)
 * - priority (optional): Filter by priority (high, medium, low)
 * - search (optional): Search by name, asin, or sku
 */
const getProductsWithIssues = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    
    const options = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || IssuesPaginationService.PRODUCTS_PAGE_SIZE,
        sort: req.query.sort || 'issues',
        sortOrder: req.query.sortOrder || 'desc',
        priority: req.query.priority || null,
        search: req.query.search || null
    };
    
    if (!userId || !country || !region) {
        return res.status(400).json(
            new ApiError(400, 'User ID, country, and region are required')
        );
    }
    
    // Validate pagination parameters
    if (options.page < 1) {
        return res.status(400).json(
            new ApiError(400, 'Page must be greater than 0')
        );
    }
    
    if (options.limit < 1 || options.limit > 100) {
        return res.status(400).json(
            new ApiError(400, 'Limit must be between 1 and 100')
        );
    }
    
    // Validate sort field
    const validSortFields = ['issues', 'sessions', 'conversion', 'sales', 'acos', 'name', 'asin', 'price'];
    if (!validSortFields.includes(options.sort)) {
        return res.status(400).json(
            new ApiError(400, `Invalid sort field. Must be one of: ${validSortFields.join(', ')}`)
        );
    }
    
    // Validate sort order
    if (!['asc', 'desc'].includes(options.sortOrder)) {
        return res.status(400).json(
            new ApiError(400, 'Sort order must be "asc" or "desc"')
        );
    }
    
    // Validate priority filter
    if (options.priority && !['high', 'medium', 'low'].includes(options.priority)) {
        return res.status(400).json(
            new ApiError(400, 'Priority must be "high", "medium", or "low"')
        );
    }
    
    try {
        const result = await IssuesPaginationService.getProductsWithIssues(userId, country, region, options);
        
        if (!result.success) {
            return res.status(404).json(
                new ApiError(404, result.error || 'No products with issues found')
            );
        }
        
        return res.status(200).json(
            new ApiResponse(200, {
                data: result.data,
                pagination: result.pagination,
                filters: result.filters
            }, 'Products with issues retrieved successfully')
        );
        
    } catch (error) {
        logger.error('[IssuesPaginatedController] Error getting products with issues', {
            error: error.message,
            userId, country, region, options
        });
        return res.status(500).json(
            new ApiError(500, `Error getting products with issues: ${error.message}`)
        );
    }
});

module.exports = {
    getIssuesSummary,
    getRankingIssues,
    getConversionIssues,
    getInventoryIssues,
    getAccountIssues,
    getProductsWithIssues
};
