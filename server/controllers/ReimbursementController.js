const { ApiError } = require('../utils/ApiError.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const asyncHandler = require('../utils/AsyncHandler.js');
const ReimbursementModel = require('../models/ReimbursementModel.js');
const {
    getReimbursementSummary,
    getDetailedReimbursements,
    updateProductCosts
} = require('../Services/Calculations/EnhancedReimbursement.js');
const logger = require('../utils/Logger.js');

/**
 * @desc Get reimbursement summary for dashboard
 * @route GET /app/reimbursements/summary
 * @access Private
 */
const getReimbursementSummaryController = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    logger.info('Fetching reimbursement summary:', { userId, country, region });

    const summary = await getReimbursementSummary(userId, country, region);

    return res.status(200).json(
        new ApiResponse(200, summary, 'Reimbursement summary retrieved successfully')
    );
});

/**
 * @desc Get all reimbursements with optional filters
 * @route GET /app/reimbursements
 * @access Private
 */
const getAllReimbursements = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    // Extract filters from query parameters
    const filters = {
        status: req.query.status, // APPROVED, PENDING, POTENTIAL, DENIED
        type: req.query.type, // LOST, DAMAGED, etc.
        startDate: req.query.startDate,
        endDate: req.query.endDate
    };

    logger.info('Fetching reimbursements:', { userId, country, region, filters });

    const reimbursements = await getDetailedReimbursements(userId, country, region, filters);

    return res.status(200).json(
        new ApiResponse(200, reimbursements, 'Reimbursements retrieved successfully')
    );
});

/**
 * @desc Get potential reimbursement claims (not yet filed)
 * @route GET /app/reimbursements/potential
 * @access Private
 */
const getPotentialClaims = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    logger.info('Fetching potential claims:', { userId, country, region });

    const filters = { status: 'POTENTIAL' };
    const potentialClaims = await getDetailedReimbursements(userId, country, region, filters);

    // Sort by urgency (claims expiring soon first)
    potentialClaims.sort((a, b) => {
        const daysA = a.daysToDeadline || 999;
        const daysB = b.daysToDeadline || 999;
        return daysA - daysB;
    });

    return res.status(200).json(
        new ApiResponse(200, potentialClaims, 'Potential claims retrieved successfully')
    );
});

/**
 * @desc Get reimbursements by product (ASIN)
 * @route GET /app/reimbursements/product/:asin
 * @access Private
 */
const getReimbursementsByProduct = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;
    const asin = req.params.asin;

    if (!userId || !country || !region || !asin) {
        throw new ApiError(400, 'User ID, country, region, and ASIN are required');
    }

    logger.info('Fetching reimbursements by product:', { userId, country, region, asin });

    const reimbursementRecord = await ReimbursementModel.findOne({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!reimbursementRecord) {
        return res.status(200).json(
            new ApiResponse(200, [], 'No reimbursements found')
        );
    }

    const productReimbursements = reimbursementRecord.reimbursements.filter(
        r => r.asin === asin
    );

    // Calculate totals for this product
    const totalAmount = productReimbursements.reduce((sum, r) => sum + (r.amount || 0), 0);
    const totalQuantity = productReimbursements.reduce((sum, r) => sum + (r.quantity || 0), 0);

    return res.status(200).json(
        new ApiResponse(200, {
            reimbursements: productReimbursements,
            summary: {
                totalAmount,
                totalQuantity,
                count: productReimbursements.length
            }
        }, 'Product reimbursements retrieved successfully')
    );
});

/**
 * @desc Get reimbursement statistics by type
 * @route GET /app/reimbursements/stats/by-type
 * @access Private
 */
const getReimbursementStatsByType = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    logger.info('Fetching reimbursement stats by type:', { userId, country, region });

    const reimbursementRecord = await ReimbursementModel.findOne({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!reimbursementRecord) {
        return res.status(200).json(
            new ApiResponse(200, { byType: {}, total: 0 }, 'No reimbursements found')
        );
    }

    const stats = {
        byType: reimbursementRecord.summary.amountByType || {},
        countByType: reimbursementRecord.summary.countByType || {},
        total: reimbursementRecord.summary.totalReceived || 0
    };

    return res.status(200).json(
        new ApiResponse(200, stats, 'Reimbursement statistics retrieved successfully')
    );
});

/**
 * @desc Get reimbursement timeline data for charts
 * @route GET /app/reimbursements/timeline
 * @access Private
 */
const getReimbursementTimeline = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;
    const days = parseInt(req.query.days) || 30;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    logger.info('Fetching reimbursement timeline:', { userId, country, region, days });

    const reimbursementRecord = await ReimbursementModel.findOne({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!reimbursementRecord) {
        return res.status(200).json(
            new ApiResponse(200, [], 'No reimbursements found')
        );
    }

    // Filter reimbursements by date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const timelineData = {};

    reimbursementRecord.reimbursements
        .filter(r => {
            const date = r.reimbursementDate || r.discoveryDate;
            return date && date >= startDate;
        })
        .forEach(r => {
            const date = r.reimbursementDate || r.discoveryDate;
            const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD

            if (!timelineData[dateKey]) {
                timelineData[dateKey] = {
                    date: dateKey,
                    totalAmount: 0,
                    count: 0,
                    byType: {}
                };
            }

            timelineData[dateKey].totalAmount += r.amount || 0;
            timelineData[dateKey].count++;

            const type = r.reimbursementType || 'OTHER';
            if (!timelineData[dateKey].byType[type]) {
                timelineData[dateKey].byType[type] = 0;
            }
            timelineData[dateKey].byType[type] += r.amount || 0;
        });

    // Convert to array and sort by date
    const timeline = Object.values(timelineData).sort((a, b) => 
        new Date(a.date) - new Date(b.date)
    );

    return res.status(200).json(
        new ApiResponse(200, timeline, 'Reimbursement timeline retrieved successfully')
    );
});

/**
 * @desc Update product costs for cost-based reimbursement calculations
 * @route POST /app/reimbursements/update-costs
 * @access Private
 */
const updateReimbursementCosts = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.body.country || req.country;
    const region = req.body.region || req.region;
    const cogsValues = req.body.cogsValues;

    if (!userId || !country || !region || !cogsValues) {
        throw new ApiError(400, 'User ID, country, region, and COGS values are required');
    }

    logger.info('Updating product costs for reimbursements:', { userId, country, region });

    const updated = await updateProductCosts(userId, country, region, cogsValues);

    if (!updated) {
        return res.status(404).json(
            new ApiResponse(404, null, 'No reimbursement data found to update')
        );
    }

    return res.status(200).json(
        new ApiResponse(200, { updated: true }, 'Product costs updated successfully')
    );
});

/**
 * @desc Get urgent claims (expiring soon)
 * @route GET /app/reimbursements/urgent
 * @access Private
 */
const getUrgentClaims = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;
    const urgencyDays = parseInt(req.query.days) || 7;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    logger.info('Fetching urgent claims:', { userId, country, region, urgencyDays });

    const filters = { status: 'POTENTIAL' };
    const potentialClaims = await getDetailedReimbursements(userId, country, region, filters);

    // Filter claims expiring within urgency period
    const urgentClaims = potentialClaims.filter(claim => {
        return claim.daysToDeadline !== undefined && 
               claim.daysToDeadline >= 0 && 
               claim.daysToDeadline <= urgencyDays;
    });

    // Sort by urgency
    urgentClaims.sort((a, b) => a.daysToDeadline - b.daysToDeadline);

    return res.status(200).json(
        new ApiResponse(200, urgentClaims, 'Urgent claims retrieved successfully')
    );
});

module.exports = {
    getReimbursementSummaryController,
    getAllReimbursements,
    getPotentialClaims,
    getReimbursementsByProduct,
    getReimbursementStatsByType,
    getReimbursementTimeline,
    updateReimbursementCosts,
    getUrgentClaims
};

