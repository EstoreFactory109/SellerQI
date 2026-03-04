/**
 * QMateReimbursementService
 * 
 * Specialized service for reimbursement data for QMate AI.
 * Provides recoverable amounts, expiring claims, and breakdown by reason.
 * 
 * Data Sources:
 * - FBAReimbursements: Amazon reimbursement data
 * - IssuesDataChunks: Reimbursement-related issues
 * 
 * This service is INDEPENDENT and does not affect any existing flows.
 */

const logger = require('../../utils/Logger.js');
const FBAReimbursements = require('../../models/finance/FBAReimbursementsModel.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const mongoose = require('mongoose');

/**
 * Get reimbursement summary
 * Total reimbursements received and breakdown by reason
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Reimbursement summary
 */
async function getReimbursementSummary(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const reimbursementData = await FBAReimbursements.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!reimbursementData || !reimbursementData.data?.length) {
            return {
                success: true,
                source: 'fba_reimbursements',
                data: {
                    hasReimbursements: false,
                    summary: { totalAmount: 0, totalUnits: 0, byReason: {} },
                    recentReimbursements: []
                }
            };
        }
        
        let totalAmount = 0;
        let totalUnits = 0;
        const byReason = {};
        const byAsin = {};
        
        // Process all reimbursements
        reimbursementData.data.forEach(item => {
            const amount = parseFloat(item.amount_total) || 0;
            const units = parseInt(item.quantity_reimbursed_total) || 0;
            const reason = item.reason || 'Unknown';
            const asin = item.asin || 'Unknown';
            
            totalAmount += amount;
            totalUnits += units;
            
            // Group by reason
            if (!byReason[reason]) {
                byReason[reason] = { amount: 0, units: 0, count: 0 };
            }
            byReason[reason].amount += amount;
            byReason[reason].units += units;
            byReason[reason].count++;
            
            // Group by ASIN
            if (!byAsin[asin]) {
                byAsin[asin] = { amount: 0, units: 0, productName: item.product_name || '' };
            }
            byAsin[asin].amount += amount;
            byAsin[asin].units += units;
        });
        
        // Format reason breakdown
        const reasonBreakdown = Object.entries(byReason)
            .map(([reason, data]) => ({
                reason,
                amount: parseFloat(data.amount.toFixed(2)),
                units: data.units,
                count: data.count
            }))
            .sort((a, b) => b.amount - a.amount);
        
        // Get top ASINs by reimbursement amount
        const topAsinsByReimbursement = Object.entries(byAsin)
            .map(([asin, data]) => ({
                asin,
                productName: data.productName,
                amount: parseFloat(data.amount.toFixed(2)),
                units: data.units
            }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 15);
        
        // Get recent reimbursements
        const recentReimbursements = reimbursementData.data
            .filter(item => item.approval_date)
            .sort((a, b) => new Date(b.approval_date) - new Date(a.approval_date))
            .slice(0, 15)
            .map(item => ({
                reimbursementId: item.reimbursement_id,
                asin: item.asin,
                productName: item.product_name || '',
                reason: item.reason || 'Unknown',
                amount: parseFloat(item.amount_total) || 0,
                units: parseInt(item.quantity_reimbursed_total) || 0,
                approvalDate: item.approval_date,
                currency: item.currency_unit || 'USD'
            }));
        
        logger.info('[QMateReimbursementService] Got reimbursement summary', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalAmount,
            totalItems: reimbursementData.data.length
        });
        
        return {
            success: true,
            source: 'fba_reimbursements',
            data: {
                hasReimbursements: true,
                summary: {
                    totalAmount: parseFloat(totalAmount.toFixed(2)),
                    totalUnits,
                    totalClaims: reimbursementData.data.length,
                    currency: reimbursementData.data[0]?.currency_unit || 'USD'
                },
                byReason: reasonBreakdown,
                topAsinsByReimbursement,
                recentReimbursements
            }
        };
        
    } catch (error) {
        logger.error('[QMateReimbursementService] Error getting reimbursement summary', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get lost inventory analysis
 * Analyze lost_warehouse reimbursements specifically
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Lost inventory data
 */
async function getLostInventoryAnalysis(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const reimbursementData = await FBAReimbursements.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!reimbursementData || !reimbursementData.data?.length) {
            return {
                success: true,
                source: 'fba_reimbursements',
                data: {
                    hasLostInventory: false,
                    lostItems: [],
                    summary: { totalLost: 0, totalAmount: 0 }
                }
            };
        }
        
        // Filter for lost warehouse items
        const lostItems = reimbursementData.data.filter(item => {
            const reason = (item.reason || '').toLowerCase();
            return reason.includes('lost') || reason.includes('warehouse');
        });
        
        if (lostItems.length === 0) {
            return {
                success: true,
                source: 'fba_reimbursements',
                data: {
                    hasLostInventory: false,
                    lostItems: [],
                    summary: { totalLost: 0, totalAmount: 0 }
                }
            };
        }
        
        let totalAmount = 0;
        let totalUnits = 0;
        
        const formattedItems = lostItems
            .map(item => {
                const amount = parseFloat(item.amount_total) || 0;
                const units = parseInt(item.quantity_reimbursed_total) || 0;
                totalAmount += amount;
                totalUnits += units;
                
                return {
                    asin: item.asin,
                    productName: item.product_name || '',
                    amount: parseFloat(amount.toFixed(2)),
                    units,
                    approvalDate: item.approval_date,
                    reimbursementId: item.reimbursement_id
                };
            })
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 20);
        
        logger.info('[QMateReimbursementService] Got lost inventory analysis', {
            userId, country, region,
            duration: Date.now() - startTime,
            lostItemsCount: lostItems.length
        });
        
        return {
            success: true,
            source: 'fba_reimbursements',
            data: {
                hasLostInventory: true,
                lostItems: formattedItems,
                summary: {
                    totalLostClaims: lostItems.length,
                    totalLostUnits: totalUnits,
                    totalAmountReimbursed: parseFloat(totalAmount.toFixed(2))
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateReimbursementService] Error getting lost inventory analysis', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get customer return analysis
 * Analyze customer_return reimbursements
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Customer return data
 */
async function getCustomerReturnAnalysis(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const reimbursementData = await FBAReimbursements.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!reimbursementData || !reimbursementData.data?.length) {
            return {
                success: true,
                source: 'fba_reimbursements',
                data: {
                    hasReturns: false,
                    returns: [],
                    summary: { totalReturns: 0, totalAmount: 0 }
                }
            };
        }
        
        // Filter for customer returns
        const returnItems = reimbursementData.data.filter(item => {
            const reason = (item.reason || '').toLowerCase();
            return reason.includes('return') || reason.includes('customer');
        });
        
        if (returnItems.length === 0) {
            return {
                success: true,
                source: 'fba_reimbursements',
                data: {
                    hasReturns: false,
                    returns: [],
                    summary: { totalReturns: 0, totalAmount: 0 }
                }
            };
        }
        
        let totalAmount = 0;
        let totalUnits = 0;
        
        // Group by ASIN
        const byAsin = {};
        returnItems.forEach(item => {
            const asin = item.asin || 'Unknown';
            const amount = parseFloat(item.amount_total) || 0;
            const units = parseInt(item.quantity_reimbursed_total) || 0;
            
            totalAmount += amount;
            totalUnits += units;
            
            if (!byAsin[asin]) {
                byAsin[asin] = {
                    asin,
                    productName: item.product_name || '',
                    totalAmount: 0,
                    totalUnits: 0,
                    count: 0
                };
            }
            byAsin[asin].totalAmount += amount;
            byAsin[asin].totalUnits += units;
            byAsin[asin].count++;
        });
        
        const topReturnedProducts = Object.values(byAsin)
            .map(item => ({
                ...item,
                totalAmount: parseFloat(item.totalAmount.toFixed(2))
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 15);
        
        logger.info('[QMateReimbursementService] Got customer return analysis', {
            userId, country, region,
            duration: Date.now() - startTime,
            returnItemsCount: returnItems.length
        });
        
        return {
            success: true,
            source: 'fba_reimbursements',
            data: {
                hasReturns: true,
                topReturnedProducts,
                summary: {
                    totalReturnClaims: returnItems.length,
                    totalReturnedUnits: totalUnits,
                    totalAmountReimbursed: parseFloat(totalAmount.toFixed(2))
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateReimbursementService] Error getting customer return analysis', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get reimbursement trends
 * Monthly breakdown of reimbursements
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Reimbursement trends
 */
async function getReimbursementTrends(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const reimbursementData = await FBAReimbursements.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!reimbursementData || !reimbursementData.data?.length) {
            return {
                success: true,
                source: 'fba_reimbursements',
                data: {
                    monthlyTrends: [],
                    summary: { averageMonthly: 0 }
                }
            };
        }
        
        // Group by month
        const monthlyData = {};
        
        reimbursementData.data.forEach(item => {
            if (!item.approval_date) return;
            
            const date = new Date(item.approval_date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = { amount: 0, units: 0, count: 0 };
            }
            
            monthlyData[monthKey].amount += parseFloat(item.amount_total) || 0;
            monthlyData[monthKey].units += parseInt(item.quantity_reimbursed_total) || 0;
            monthlyData[monthKey].count++;
        });
        
        const monthlyTrends = Object.entries(monthlyData)
            .map(([month, data]) => ({
                month,
                amount: parseFloat(data.amount.toFixed(2)),
                units: data.units,
                claims: data.count
            }))
            .sort((a, b) => a.month.localeCompare(b.month))
            .slice(-12); // Last 12 months
        
        const totalAmount = monthlyTrends.reduce((sum, m) => sum + m.amount, 0);
        const averageMonthly = monthlyTrends.length > 0 
            ? parseFloat((totalAmount / monthlyTrends.length).toFixed(2))
            : 0;
        
        logger.info('[QMateReimbursementService] Got reimbursement trends', {
            userId, country, region,
            duration: Date.now() - startTime,
            monthsAnalyzed: monthlyTrends.length
        });
        
        return {
            success: true,
            source: 'fba_reimbursements',
            data: {
                monthlyTrends,
                summary: {
                    averageMonthly,
                    totalInPeriod: parseFloat(totalAmount.toFixed(2)),
                    monthsAnalyzed: monthlyTrends.length
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateReimbursementService] Error getting reimbursement trends', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get complete reimbursement context for QMate AI
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Complete reimbursement context
 */
async function getQMateReimbursementContext(userId, country, region) {
    const startTime = Date.now();
    
    try {
        // Fetch all reimbursement data in parallel
        const [
            summaryResult,
            lostInventoryResult,
            returnAnalysisResult,
            trendsResult
        ] = await Promise.all([
            getReimbursementSummary(userId, country, region),
            getLostInventoryAnalysis(userId, country, region),
            getCustomerReturnAnalysis(userId, country, region),
            getReimbursementTrends(userId, country, region)
        ]);
        
        const context = {
            summary: null,
            lostInventory: null,
            customerReturns: null,
            trends: null
        };
        
        if (summaryResult?.success) {
            context.summary = summaryResult.data;
        }
        
        if (lostInventoryResult?.success) {
            context.lostInventory = lostInventoryResult.data;
        }
        
        if (returnAnalysisResult?.success) {
            context.customerReturns = returnAnalysisResult.data;
        }
        
        if (trendsResult?.success) {
            context.trends = trendsResult.data;
        }
        
        // Generate insights
        const totalReimbursed = context.summary?.summary?.totalAmount || 0;
        const lostInventoryAmount = context.lostInventory?.summary?.totalAmountReimbursed || 0;
        const returnAmount = context.customerReturns?.summary?.totalAmountReimbursed || 0;
        
        context.insights = {
            totalRecovered: parseFloat(totalReimbursed.toFixed(2)),
            primarySource: lostInventoryAmount > returnAmount ? 'Lost Inventory' : 'Customer Returns',
            recommendation: totalReimbursed > 1000 
                ? 'Consider auditing inventory regularly to minimize losses'
                : 'Reimbursement levels appear normal'
        };
        
        logger.info('[QMateReimbursementService] Got complete reimbursement context', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalRecovered: totalReimbursed
        });
        
        return {
            success: true,
            source: 'combined_reimbursement_sources',
            data: context
        };
        
    } catch (error) {
        logger.error('[QMateReimbursementService] Error getting reimbursement context', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

module.exports = {
    getReimbursementSummary,
    getLostInventoryAnalysis,
    getCustomerReturnAnalysis,
    getReimbursementTrends,
    getQMateReimbursementContext
};
