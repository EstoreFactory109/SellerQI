const ReimbursementModel = require('../../models/ReimbursementModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Enhanced Reimbursement Calculation Service
 * 
 * This service combines reimbursement data from multiple sources:
 * 1. Amazon SP-API reimbursement reports (already processed)
 * 2. Shipment discrepancies (quantity shipped vs received)
 * 3. Inventory ledger analysis
 * 4. Fee overcharges detection
 * 
 * It identifies potential claims and calculates expected reimbursement amounts
 */

/**
 * Calculate potential reimbursements from shipment discrepancies
 * This analyzes inbound shipments where quantity shipped > quantity received
 */
const calculateShipmentDiscrepancies = (shipmentData, products, fbaData = null) => {
    const potentialClaims = [];
    
    if (!shipmentData || !Array.isArray(shipmentData)) {
        logger.warn('Invalid shipment data for reimbursement calculation');
        return potentialClaims;
    }

    if (!products || !Array.isArray(products)) {
        logger.warn('Invalid products data for reimbursement calculation');
        return potentialClaims;
    }

    // Create a map of FBA data by ASIN for quick lookup
    const fbaDataMap = new Map();
    if (fbaData && Array.isArray(fbaData)) {
        fbaData.forEach(item => {
            if (item && item.asin) {
                fbaDataMap.set(item.asin, item);
            }
        });
    }

    const now = new Date();

    shipmentData.forEach((shipment) => {
        if (!shipment || !shipment.shipmentName) {
            return;
        }

        // Extract shipment date from shipment name (format: "FBA... (MM/DD/YYYY)")
        const match = shipment.shipmentName.match(/\((\d{2}\/\d{2}\/\d{4})\)/);
        
        if (!match) {
            return;
        }

        const dateStr = match[1];
        const shipmentDate = new Date(dateStr);
        
        // Calculate age of shipment in days
        const ageInDays = Math.floor((now - shipmentDate) / (1000 * 60 * 60 * 24));
        
        // Amazon's claim window is 60 days (as of Oct 2024)
        const CLAIM_WINDOW_DAYS = 60;
        const daysRemaining = CLAIM_WINDOW_DAYS - ageInDays;
        
        // Skip if shipment is too old (outside claim window)
        if (daysRemaining <= 0) {
            return;
        }

        // Check for discrepancies in this shipment
        if (!shipment.itemDetails || !Array.isArray(shipment.itemDetails)) {
            return;
        }

        shipment.itemDetails.forEach(item => {
            if (!item || !item.SellerSKU) {
                return;
            }

            const quantityShipped = parseInt(item.QuantityShipped) || 0;
            const quantityReceived = parseInt(item.QuantityReceived) || 0;
            const discrepancy = quantityShipped - quantityReceived;

            // If there's a discrepancy (lost units)
            if (discrepancy > 0) {
                const product = products.find(p => p && p.sku === item.SellerSKU);
                
                if (!product) {
                    logger.warn(`Product not found for SKU: ${item.SellerSKU}`);
                    return;
                }

                const asin = product.asin || '';
                const price = product.price || 0;
                
                // Calculate Reimbursement Per Unit = (Sales Price – Fees)
                // Try to get from FBA data first, otherwise use product price
                let reimbursementPerUnit = price;
                let salesPrice = price;
                let fees = 0;
                
                const fbaItem = fbaDataMap.get(asin);
                if (fbaItem) {
                    // Use pre-calculated reimbursementPerUnit if available
                    if (fbaItem.reimbursementPerUnit !== undefined && fbaItem.reimbursementPerUnit !== null) {
                        reimbursementPerUnit = parseFloat(fbaItem.reimbursementPerUnit) || 0;
                    } else {
                        // Calculate on the fly: (Sales Price – Fees)
                        salesPrice = parseFloat(fbaItem.salesPrice) || price;
                        fees = parseFloat(fbaItem.totalAmzFee) || 0;
                        reimbursementPerUnit = salesPrice - fees;
                    }
                }
                
                // Calculate expected amount using formula: (Sales Price – Fees) × Discrepancy Units
                const expectedAmount = reimbursementPerUnit * discrepancy;
                
                // Calculate expiry date
                const expiryDate = new Date(shipmentDate);
                expiryDate.setDate(expiryDate.getDate() + CLAIM_WINDOW_DAYS);

                potentialClaims.push({
                    asin: asin,
                    sku: item.SellerSKU,
                    fnsku: item.FulfillmentNetworkSKU || '',
                    reimbursementType: 'INBOUND_SHIPMENT',
                    amount: expectedAmount,
                    quantity: discrepancy,
                    status: 'POTENTIAL',
                    discoveryDate: now,
                    expiryDate: expiryDate,
                    daysToDeadline: daysRemaining,
                    shipmentId: shipment.shipmentId || '',
                    shipmentName: shipment.shipmentName || '',
                    reasonCode: 'INBOUND_RECEIVE_DISCREPANCY',
                    reasonDescription: `${discrepancy} unit(s) not received in shipment`,
                    isAutomated: false,
                    productCost: 0, // Can be updated if COGS is available
                    retailValue: expectedAmount,
                    reimbursementPerUnit: reimbursementPerUnit,
                    salesPrice: salesPrice,
                    fees: fees
                });
            }
        });
    });

    logger.info(`Found ${potentialClaims.length} potential shipment discrepancy claims`);
    return potentialClaims;
};

/**
 * Merge potential claims with existing reimbursement data
 * Avoids duplicates and updates existing records
 */
const mergeReimbursementData = async (userId, country, region, newPotentialClaims, existingApiData) => {
    try {
        // Find existing record or create new one
        let reimbursementRecord = await ReimbursementModel.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        let allReimbursements = [];

        // Add existing API data (approved reimbursements from Amazon)
        if (existingApiData && existingApiData.reimbursements) {
            allReimbursements = [...existingApiData.reimbursements];
        } else if (reimbursementRecord && reimbursementRecord.reimbursements) {
            allReimbursements = [...reimbursementRecord.reimbursements];
        }

        // Add potential claims, avoiding duplicates
        newPotentialClaims.forEach(claim => {
            // Check if this claim already exists
            const exists = allReimbursements.some(existing => {
                return existing.sku === claim.sku &&
                       existing.shipmentId === claim.shipmentId &&
                       existing.reimbursementType === claim.reimbursementType &&
                       (existing.status === 'POTENTIAL' || existing.status === 'PENDING');
            });

            if (!exists) {
                allReimbursements.push(claim);
            }
        });

        // Update or create record
        if (reimbursementRecord) {
            reimbursementRecord.reimbursements = allReimbursements;
            reimbursementRecord.lastFetchDate = new Date();
            reimbursementRecord.dataSource = 'SP_API'; // Mixed source
        } else {
            reimbursementRecord = new ReimbursementModel({
                User: userId,
                region: region,
                country: country,
                reimbursements: allReimbursements,
                dataSource: 'SHIPMENT_CALCULATION',
                lastFetchDate: new Date()
            });
        }

        // Calculate summary statistics
        reimbursementRecord.calculateSummary();

        // Save to database
        await reimbursementRecord.save();

        logger.info('Successfully merged reimbursement data:', {
            userId,
            totalReimbursements: allReimbursements.length,
            approvedCount: allReimbursements.filter(r => r.status === 'APPROVED').length,
            potentialCount: allReimbursements.filter(r => r.status === 'POTENTIAL').length
        });

        return reimbursementRecord;

    } catch (error) {
        logger.error('Error merging reimbursement data:', error.message);
        throw error;
    }
};

/**
 * Calculate total expected reimbursement (wrapper for existing function + enhancements)
 * This maintains backward compatibility with existing code
 */
const calculateTotalReimbursement = (shipmentData, products, fbaData = null) => {
    const potentialClaims = calculateShipmentDiscrepancies(shipmentData, products, fbaData);
    
    let totalReimbursement = 0;
    const reimburstmentArr = [];

    potentialClaims.forEach(claim => {
        totalReimbursement += claim.amount;
        reimburstmentArr.push({
            asin: claim.asin,
            amount: claim.amount,
            sku: claim.sku,
            quantity: claim.quantity,
            shipmentId: claim.shipmentId,
            daysToDeadline: claim.daysToDeadline
        });
    });

    return {
        productWiseReimburstment: reimburstmentArr,
        totalReimbursement: totalReimbursement,
        potentialClaims: potentialClaims // Enhanced data
    };
};

/**
 * Get reimbursement summary for dashboard
 */
const getReimbursementSummary = async (userId, country, region) => {
    try {
        logger.info('getReimbursementSummary: Searching for reimbursement record', {
            userId: userId?.toString(),
            country,
            region
        });

        const reimbursementRecord = await ReimbursementModel.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!reimbursementRecord) {
            logger.info('getReimbursementSummary: No reimbursement record found', {
                userId: userId?.toString(),
                country,
                region
            });
            return {
                totalReceived: 0,
                totalPending: 0,
                totalPotential: 0,
                totalDenied: 0,
                last7Days: 0,
                last30Days: 0,
                last90Days: 0,
                claimsExpiringIn7Days: 0,
                claimsExpiringIn30Days: 0,
                reimbursementCount: 0,
                byType: {}
            };
        }

        logger.info('getReimbursementSummary: Found reimbursement record', {
            userId: userId?.toString(),
            country,
            region,
            recordId: reimbursementRecord._id?.toString(),
            totalCount: reimbursementRecord.totalCount || 0,
            hasSummary: !!reimbursementRecord.summary
        });

        // Ensure summary is calculated
        if (!reimbursementRecord.summary || !reimbursementRecord.summary.totalReceived) {
            reimbursementRecord.calculateSummary();
            await reimbursementRecord.save();
        }

        return {
            totalReceived: reimbursementRecord.summary.totalReceived || 0,
            totalPending: reimbursementRecord.summary.totalPending || 0,
            totalPotential: reimbursementRecord.summary.totalPotential || 0,
            totalDenied: reimbursementRecord.summary.totalDenied || 0,
            last7Days: reimbursementRecord.summary.last7Days || 0,
            last30Days: reimbursementRecord.summary.last30Days || 0,
            last90Days: reimbursementRecord.summary.last90Days || 0,
            claimsExpiringIn7Days: reimbursementRecord.summary.claimsExpiringIn7Days || 0,
            claimsExpiringIn30Days: reimbursementRecord.summary.claimsExpiringIn30Days || 0,
            reimbursementCount: reimbursementRecord.totalCount || 0,
            byType: {
                count: reimbursementRecord.summary.countByType || {},
                amount: reimbursementRecord.summary.amountByType || {}
            },
            automatedCount: reimbursementRecord.summary.automatedCount || 0,
            manualCount: reimbursementRecord.summary.manualCount || 0
        };

    } catch (error) {
        logger.error('Error getting reimbursement summary:', error.message);
        return {
            totalReceived: 0,
            totalPending: 0,
            totalPotential: 0,
            totalDenied: 0,
            last7Days: 0,
            last30Days: 0,
            last90Days: 0,
            claimsExpiringIn7Days: 0,
            claimsExpiringIn30Days: 0,
            reimbursementCount: 0,
            byType: {}
        };
    }
};

/**
 * Get detailed reimbursement data for dashboard table
 */
const getDetailedReimbursements = async (userId, country, region, filters = {}) => {
    try {
        const reimbursementRecord = await ReimbursementModel.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!reimbursementRecord || !reimbursementRecord.reimbursements) {
            return [];
        }

        let reimbursements = [...reimbursementRecord.reimbursements];

        // Apply filters
        if (filters.status) {
            reimbursements = reimbursements.filter(r => r.status === filters.status);
        }

        if (filters.type) {
            reimbursements = reimbursements.filter(r => r.reimbursementType === filters.type);
        }

        if (filters.startDate) {
            const startDate = new Date(filters.startDate);
            reimbursements = reimbursements.filter(r => {
                const date = r.reimbursementDate || r.discoveryDate;
                return date >= startDate;
            });
        }

        if (filters.endDate) {
            const endDate = new Date(filters.endDate);
            reimbursements = reimbursements.filter(r => {
                const date = r.reimbursementDate || r.discoveryDate;
                return date <= endDate;
            });
        }

        // Sort by date (most recent first)
        reimbursements.sort((a, b) => {
            const dateA = a.reimbursementDate || a.discoveryDate;
            const dateB = b.reimbursementDate || b.discoveryDate;
            return dateB - dateA;
        });

        return reimbursements;

    } catch (error) {
        logger.error('Error getting detailed reimbursements:', error.message);
        return [];
    }
};

/**
 * Update COGS values for cost-based reimbursement calculations
 */
const updateProductCosts = async (userId, country, region, cogsValues) => {
    try {
        const reimbursementRecord = await ReimbursementModel.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!reimbursementRecord) {
            return false;
        }

        // Update product costs in potential claims
        let updated = false;
        reimbursementRecord.reimbursements.forEach(item => {
            if (item.sku && cogsValues[item.sku]) {
                item.productCost = cogsValues[item.sku];
                // Recalculate amount based on cost if it's a potential claim
                if (item.status === 'POTENTIAL') {
                    item.amount = item.productCost * (item.quantity || 1);
                }
                updated = true;
            }
        });

        if (updated) {
            // Recalculate summary
            reimbursementRecord.calculateSummary();
            await reimbursementRecord.save();
            logger.info('Successfully updated product costs for reimbursements');
        }

        return updated;

    } catch (error) {
        logger.error('Error updating product costs:', error.message);
        return false;
    }
};

module.exports = {
    calculateShipmentDiscrepancies,
    mergeReimbursementData,
    calculateTotalReimbursement,
    getReimbursementSummary,
    getDetailedReimbursements,
    updateProductCosts
};

