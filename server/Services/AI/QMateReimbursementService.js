/**
 * QMateReimbursementService
 * 
 * Specialized service for reimbursement data for QMate AI.
 * Provides:
 * 1. RECOVERABLE reimbursements (expected amounts that can be claimed) - matches dashboard
 *    - Shipment discrepancy
 *    - Lost inventory
 *    - Damaged inventory
 *    - Disposed inventory
 * 2. RECEIVED reimbursements (already processed by Amazon)
 *    - Historical reimbursements by reason
 *    - Monthly trends
 * 
 * Data Sources:
 * - FBAReimbursements: Amazon reimbursement data (already received)
 * - Reimbursement.js calculations: Expected/recoverable amounts
 * 
 * This service is INDEPENDENT and does not affect any existing flows.
 */

const logger = require('../../utils/Logger.js');
const FBAReimbursements = require('../../models/finance/FBAReimbursementsModel.js');
const mongoose = require('mongoose');

// Import calculation functions for recoverable reimbursements (matches dashboard)
const {
    calculateShipmentDiscrepancy,
    calculateLostInventoryReimbursement,
    calculateDamagedInventoryReimbursement,
    calculateDisposedInventoryReimbursement
} = require('../Calculations/Reimbursement.js');

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
 * Get RECOVERABLE reimbursements (expected amounts that can be claimed)
 * This matches what the Reimbursement Dashboard shows.
 * 
 * Categories:
 * 1. Shipment Discrepancy - items shipped but not received
 * 2. Lost Inventory - items lost in Amazon warehouse
 * 3. Damaged Inventory - items damaged in warehouse
 * 4. Disposed Inventory - items disposed by Amazon
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {number} limit - Max items per category
 * @returns {Promise<Object>} Recoverable reimbursement data
 */
async function getRecoverableReimbursements(userId, country, region, limit = 15) {
    const startTime = Date.now();
    
    try {
        // Calculate all recoverable reimbursements in parallel
        const [
            shipmentResult,
            lostResult,
            damagedResult,
            disposedResult
        ] = await Promise.all([
            calculateShipmentDiscrepancy(userId, country, region),
            calculateLostInventoryReimbursement(userId, country, region),
            calculateDamagedInventoryReimbursement(userId, country, region),
            calculateDisposedInventoryReimbursement(userId, country, region)
        ]);
        
        // Process shipment discrepancy data
        const shipmentData = (shipmentResult.data || [])
            .filter(item => (item.reimbursementAmount || 0) > 0)
            .sort((a, b) => (b.reimbursementAmount || 0) - (a.reimbursementAmount || 0))
            .slice(0, limit)
            .map(item => ({
                date: item.date || '',
                shipmentId: item.shipmentId || '',
                sku: item.sellerSKU || '',
                quantityShipped: item.quantityShipped || 0,
                quantityReceived: item.quantityReceived || 0,
                discrepancy: item.discrepancy || 0,
                expectedAmount: item.reimbursementAmount || 0
            }));
        
        // Process lost inventory data
        const lostData = (lostResult.data || [])
            .filter(item => (item.expectedAmount || 0) > 0)
            .sort((a, b) => (b.expectedAmount || 0) - (a.expectedAmount || 0))
            .slice(0, limit)
            .map(item => ({
                date: item.date || '',
                asin: item.asin || '',
                fnsku: item.fnsku || '',
                title: item.title || '',
                lostUnits: item.lostUnits || 0,
                foundUnits: item.foundUnits || 0,
                reimbursedUnits: item.reimbursedUnits || 0,
                discrepancyUnits: item.discrepancyUnits || 0,
                expectedAmount: item.expectedAmount || 0
            }));
        
        // Process damaged inventory data
        const damagedData = (damagedResult.data || [])
            .filter(item => (item.expectedAmount || 0) > 0)
            .sort((a, b) => (b.expectedAmount || 0) - (a.expectedAmount || 0))
            .slice(0, limit)
            .map(item => ({
                date: item.date || '',
                asin: item.asin || '',
                fnsku: item.fnsku || '',
                title: item.title || '',
                reasonCode: item.reasonCode || '',
                damagedUnits: item.damagedUnits || 0,
                expectedAmount: item.expectedAmount || 0
            }));
        
        // Process disposed inventory data
        const disposedData = (disposedResult.data || [])
            .filter(item => (item.expectedAmount || 0) > 0)
            .sort((a, b) => (b.expectedAmount || 0) - (a.expectedAmount || 0))
            .slice(0, limit)
            .map(item => ({
                date: item.date || '',
                asin: item.asin || '',
                fnsku: item.fnsku || '',
                title: item.title || '',
                disposition: item.disposition || '',
                disposedUnits: item.disposedUnits || 0,
                expectedAmount: item.expectedAmount || 0
            }));
        
        // Calculate totals
        const shipmentTotal = shipmentResult.totalReimbursement || 0;
        const lostTotal = lostResult.totalExpectedAmount || 0;
        const damagedTotal = damagedResult.totalExpectedAmount || 0;
        const disposedTotal = disposedResult.totalExpectedAmount || 0;
        const totalRecoverable = shipmentTotal + lostTotal + damagedTotal + disposedTotal;
        
        // Get total counts
        const shipmentCount = (shipmentResult.data || []).filter(item => (item.reimbursementAmount || 0) > 0).length;
        const lostCount = (lostResult.data || []).filter(item => (item.expectedAmount || 0) > 0).length;
        const damagedCount = (damagedResult.data || []).filter(item => (item.expectedAmount || 0) > 0).length;
        const disposedCount = (disposedResult.data || []).filter(item => (item.expectedAmount || 0) > 0).length;
        
        logger.info('[QMateReimbursementService] Got recoverable reimbursements', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalRecoverable,
            shipmentCount,
            lostCount,
            damagedCount,
            disposedCount
        });
        
        return {
            success: true,
            data: {
                summary: {
                    totalRecoverable: parseFloat(totalRecoverable.toFixed(2)),
                    shipmentDiscrepancyTotal: parseFloat(shipmentTotal.toFixed(2)),
                    lostInventoryTotal: parseFloat(lostTotal.toFixed(2)),
                    damagedInventoryTotal: parseFloat(damagedTotal.toFixed(2)),
                    disposedInventoryTotal: parseFloat(disposedTotal.toFixed(2)),
                    totalDiscrepancies: shipmentCount + lostCount + damagedCount + disposedCount
                },
                shipmentDiscrepancy: {
                    count: shipmentCount,
                    totalAmount: parseFloat(shipmentTotal.toFixed(2)),
                    items: shipmentData
                },
                lostInventory: {
                    count: lostCount,
                    totalAmount: parseFloat(lostTotal.toFixed(2)),
                    items: lostData
                },
                damagedInventory: {
                    count: damagedCount,
                    totalAmount: parseFloat(damagedTotal.toFixed(2)),
                    items: damagedData
                },
                disposedInventory: {
                    count: disposedCount,
                    totalAmount: parseFloat(disposedTotal.toFixed(2)),
                    items: disposedData
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateReimbursementService] Error getting recoverable reimbursements', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get complete reimbursement context for QMate AI
 * 
 * Includes:
 * 1. RECOVERABLE: Expected amounts that can be claimed (matches dashboard)
 * 2. RECEIVED: Already processed reimbursements from Amazon (historical data)
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Complete reimbursement context
 */
async function getQMateReimbursementContext(userId, country, region) {
    const startTime = Date.now();
    
    try {
        // Fetch ALL reimbursement data in parallel:
        // 1. Recoverable (expected amounts - matches dashboard)
        // 2. Received (historical from Amazon)
        const [
            recoverableResult,
            receivedSummaryResult,
            receivedTrendsResult
        ] = await Promise.all([
            getRecoverableReimbursements(userId, country, region, 15),
            getReimbursementSummary(userId, country, region),
            getReimbursementTrends(userId, country, region)
        ]);
        
        const context = {
            // RECOVERABLE: What can be claimed (matches dashboard)
            recoverable: null,
            // RECEIVED: Historical reimbursements from Amazon
            received: null,
            trends: null,
            insights: null
        };
        
        // Recoverable reimbursements (expected amounts)
        if (recoverableResult?.success) {
            context.recoverable = recoverableResult.data;
        }
        
        // Received reimbursements (from Amazon)
        if (receivedSummaryResult?.success) {
            context.received = receivedSummaryResult.data;
        }
        
        // Monthly trends
        if (receivedTrendsResult?.success) {
            context.trends = receivedTrendsResult.data;
        }
        
        // Generate insights
        const totalRecoverable = context.recoverable?.summary?.totalRecoverable || 0;
        const totalReceived = context.received?.summary?.totalAmount || 0;
        
        // Identify the largest recoverable category
        const categoryAmounts = {
            'Shipment Discrepancy': context.recoverable?.shipmentDiscrepancy?.totalAmount || 0,
            'Lost Inventory': context.recoverable?.lostInventory?.totalAmount || 0,
            'Damaged Inventory': context.recoverable?.damagedInventory?.totalAmount || 0,
            'Disposed Inventory': context.recoverable?.disposedInventory?.totalAmount || 0
        };
        
        const largestCategory = Object.entries(categoryAmounts)
            .sort((a, b) => b[1] - a[1])[0];
        
        context.insights = {
            totalRecoverable: parseFloat(totalRecoverable.toFixed(2)),
            totalReceived: parseFloat(totalReceived.toFixed(2)),
            largestRecoverableCategory: largestCategory[1] > 0 ? largestCategory[0] : null,
            largestRecoverableAmount: parseFloat(largestCategory[1].toFixed(2)),
            hasRecoverableAmount: totalRecoverable > 0,
            recommendation: totalRecoverable > 500 
                ? `You have ${totalRecoverable.toFixed(2)} in recoverable reimbursements. Focus on ${largestCategory[0]} claims first.`
                : totalRecoverable > 0
                    ? 'Small recoverable amount detected. Consider filing claims when you have time.'
                    : 'No significant recoverable amounts at this time.'
        };
        
        logger.info('[QMateReimbursementService] Got complete reimbursement context', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalRecoverable,
            totalReceived
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
    getRecoverableReimbursements,
    getQMateReimbursementContext
};
