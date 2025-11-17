const LedgerSummaryView = require('../../models/LedgerSummaryViewModel.js');
const ReimbursementModel = require('../../models/ReimbursementModel.js');
const ProductWiseFBAData = require('../../models/ProductWiseFBADataModel.js');
const BackendLostInventory = require('../../models/BackendLostInventoryModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Calculate Backend Lost Inventory and Underpaid Items
 * 
 * This service implements the formulas from Refunzo Final Documentation:
 * 1. Gets found and lost quantities from GET_LEDGER_SUMMARY_VIEW_DATA
 * 2. Gets reimbursed units from GET_FBA_REIMBURSEMENTS_DATA where reason is "Lost_warehouse"
 * 3. Calculates Discrepancy Units = Lost Units – Found Units – Reimbursed Units
 * 4. Calculates Expected Amount = Discrepancy Units × (Sales Price – Fees)
 * 5. Detects Underpaid items: Amount per Unit < ((Sales Price – Fees) × 0.4)
 * 6. Calculates Underpaid expected amount: ((Sales Price – Fees) - Amount per Unit) × quantity
 */
const calculateBackendLostInventory = async (userId, country, region) => {
    try {
        logger.info('Starting Backend Lost Inventory calculation', {
            userId,
            country,
            region
        });

        // Step 1: Get Ledger Summary View Data (found and lost quantities)
        const ledgerSummaryRecord = await LedgerSummaryView.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!ledgerSummaryRecord || !ledgerSummaryRecord.data || ledgerSummaryRecord.data.length === 0) {
            logger.warn('No ledger summary data found for Backend Lost Inventory calculation');
            return {
                success: false,
                message: 'No ledger summary data found. Please fetch GET_LEDGER_SUMMARY_VIEW_DATA first.',
                data: null
            };
        }

        // Step 2: Get Reimbursement Data (reimbursed units where reason is "Lost_warehouse")
        const reimbursementRecord = await ReimbursementModel.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // Step 3: Get ProductWiseFBAData (for Sales Price and Fees)
        const fbaDataRecord = await ProductWiseFBAData.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // Create maps for quick lookup
        const fbaDataMap = new Map();
        if (fbaDataRecord && fbaDataRecord.fbaData) {
            fbaDataRecord.fbaData.forEach(item => {
                if (item && item.asin) {
                    fbaDataMap.set(item.asin, item);
                }
            });
        }

        // Map reimbursed units by ASIN (filter for "Lost_warehouse" reason)
        const reimbursedUnitsMap = new Map();
        if (reimbursementRecord && reimbursementRecord.reimbursements) {
            reimbursementRecord.reimbursements.forEach(reimbursement => {
                // Check if reason code indicates Lost_warehouse
                const reasonCode = (reimbursement.reasonCode || '').toLowerCase();
                const reasonDescription = (reimbursement.reasonDescription || '').toLowerCase();
                
                if (reasonCode.includes('lost_warehouse') || 
                    reasonCode.includes('lost-warehouse') ||
                    reasonCode.includes('lost warehouse') ||
                    reasonDescription.includes('lost_warehouse') ||
                    reasonDescription.includes('lost-warehouse') ||
                    reasonDescription.includes('lost warehouse') ||
                    reimbursement.reimbursementType === 'LOST') {
                    
                    const asin = reimbursement.asin;
                    if (asin) {
                        const currentQuantity = reimbursedUnitsMap.get(asin) || 0;
                        reimbursedUnitsMap.set(asin, currentQuantity + (reimbursement.quantity || 0));
                    }
                }
            });
        }

        // Aggregate lost and found units by ASIN from ledger summary
        const lostUnitsMap = new Map();
        const foundUnitsMap = new Map();
        const asinMetadataMap = new Map(); // Store SKU, FNSKU for each ASIN

        ledgerSummaryRecord.data.forEach(item => {
            const asin = item.asin;
            if (!asin) return;

            // Aggregate lost units
            const lostQty = parseFloat(item.lost || '0') || 0;
            const currentLost = lostUnitsMap.get(asin) || 0;
            lostUnitsMap.set(asin, currentLost + lostQty);

            // Aggregate found units
            const foundQty = parseFloat(item.found || '0') || 0;
            const currentFound = foundUnitsMap.get(asin) || 0;
            foundUnitsMap.set(asin, currentFound + foundQty);

            // Store metadata (use first occurrence)
            if (!asinMetadataMap.has(asin)) {
                asinMetadataMap.set(asin, {
                    sku: item.msku || '',
                    fnsku: item.fnsku || ''
                });
            }
        });

        // Step 4: Calculate discrepancy units and expected amounts for each ASIN
        const calculatedItems = [];
        const allAsins = new Set([
            ...lostUnitsMap.keys(),
            ...foundUnitsMap.keys(),
            ...reimbursedUnitsMap.keys()
        ]);

        allAsins.forEach(asin => {
            const lostUnits = lostUnitsMap.get(asin) || 0;
            const foundUnits = foundUnitsMap.get(asin) || 0;
            const reimbursedUnits = reimbursedUnitsMap.get(asin) || 0;

            // Calculate Discrepancy Units = Lost Units – Found Units – Reimbursed Units
            const discrepancyUnits = lostUnits - foundUnits - reimbursedUnits;

            // Only process items with positive discrepancy
            if (discrepancyUnits <= 0) {
                return;
            }

            const metadata = asinMetadataMap.get(asin) || { sku: '', fnsku: '' };
            const fbaItem = fbaDataMap.get(asin);

            // Get Sales Price and Fees from FBA data
            let salesPrice = 0;
            let fees = 0;
            let reimbursementPerUnit = 0;
            let currency = 'USD';

            if (fbaItem) {
                salesPrice = parseFloat(fbaItem.salesPrice || '0') || 0;
                fees = parseFloat(fbaItem.totalAmzFee || '0') || 0;
                reimbursementPerUnit = parseFloat(fbaItem.reimbursementPerUnit || '0') || 0;
                currency = fbaItem.currency || 'USD';

                // If reimbursementPerUnit not pre-calculated, calculate it
                if (reimbursementPerUnit === 0 && salesPrice > 0) {
                    reimbursementPerUnit = salesPrice - fees;
                }
            }

            // Calculate Expected Amount = Discrepancy Units × (Sales Price – Fees)
            const expectedAmount = discrepancyUnits * reimbursementPerUnit;

            // Check for underpaid items
            // Get amount per unit from reimbursement data if available
            let amountPerUnit = 0;
            let isUnderpaid = false;
            let underpaidExpectedAmount = 0;

            if (reimbursementRecord && reimbursementRecord.reimbursements) {
                // Find reimbursement for this ASIN with Lost_warehouse reason
                const relevantReimbursement = reimbursementRecord.reimbursements.find(r => {
                    const reasonCode = (r.reasonCode || '').toLowerCase();
                    return r.asin === asin && (
                        reasonCode.includes('lost_warehouse') ||
                        reasonCode.includes('lost-warehouse') ||
                        reasonCode.includes('lost warehouse') ||
                        r.reimbursementType === 'LOST'
                    );
                });

                if (relevantReimbursement && relevantReimbursement.quantity > 0) {
                    amountPerUnit = relevantReimbursement.amount / relevantReimbursement.quantity;
                    
                    // Underpaid detection: Amount per Unit < ((Sales Price – Fees) × 0.4)
                    const threshold = reimbursementPerUnit * 0.4;
                    if (amountPerUnit < threshold) {
                        isUnderpaid = true;
                        // Underpaid expected amount: ((Sales Price – Fees) - Amount per Unit) × quantity
                        underpaidExpectedAmount = (reimbursementPerUnit - amountPerUnit) * relevantReimbursement.quantity;
                    }
                }
            }

            calculatedItems.push({
                asin: asin,
                sku: metadata.sku,
                fnsku: metadata.fnsku,
                lostUnits: lostUnits,
                foundUnits: foundUnits,
                reimbursedUnits: reimbursedUnits,
                discrepancyUnits: discrepancyUnits,
                salesPrice: salesPrice,
                fees: fees,
                reimbursementPerUnit: reimbursementPerUnit,
                expectedAmount: expectedAmount,
                currency: currency,
                isUnderpaid: isUnderpaid,
                amountPerUnit: amountPerUnit,
                underpaidExpectedAmount: underpaidExpectedAmount
            });
        });

        // Step 5: Save or update Backend Lost Inventory record
        let backendLostInventoryRecord = await BackendLostInventory.findOne({
            User: userId,
            country: country,
            region: region
        });

        if (backendLostInventoryRecord) {
            backendLostInventoryRecord.items = calculatedItems;
            backendLostInventoryRecord.calculateSummary();
            await backendLostInventoryRecord.save();
        } else {
            backendLostInventoryRecord = new BackendLostInventory({
                User: userId,
                country: country,
                region: region,
                items: calculatedItems
            });
            backendLostInventoryRecord.calculateSummary();
            await backendLostInventoryRecord.save();
        }

        logger.info('Backend Lost Inventory calculation completed', {
            userId,
            country,
            region,
            totalItems: calculatedItems.length,
            totalDiscrepancyUnits: backendLostInventoryRecord.summary.totalDiscrepancyUnits,
            totalExpectedAmount: backendLostInventoryRecord.summary.totalExpectedAmount,
            totalUnderpaidItems: backendLostInventoryRecord.summary.totalUnderpaidItems
        });

        return {
            success: true,
            message: 'Backend Lost Inventory calculated successfully',
            data: backendLostInventoryRecord,
            summary: backendLostInventoryRecord.summary
        };

    } catch (error) {
        logger.error('Error calculating Backend Lost Inventory:', error.message);
        throw error;
    }
};

/**
 * Get Backend Lost Inventory data
 */
const getBackendLostInventory = async (userId, country, region) => {
    try {
        const record = await BackendLostInventory.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!record) {
            return {
                success: false,
                message: 'No Backend Lost Inventory data found. Please run calculation first.',
                data: null
            };
        }

        return {
            success: true,
            message: 'Backend Lost Inventory data retrieved successfully',
            data: record,
            summary: record.summary
        };
    } catch (error) {
        logger.error('Error getting Backend Lost Inventory:', error.message);
        throw error;
    }
};

/**
 * Calculate Backend Damaged Inventory
 * 
 * This service implements the formulas from Refunzo Final Documentation:
 * 1. Gets damaged quantities from GET_LEDGER_SUMMARY_VIEW_DATA (LedgerSummaryViewModel)
 * 2. Gets Sales Price and Fees from ProductWiseFBAData
 * 3. Calculates Discrepancy Units = damaged quantity
 * 4. Calculates Expected Amount = Discrepancy Units × (Sales Price – Fees)
 * 
 * Note: This calculates on the fly from existing models, no separate storage model needed
 */
const calculateBackendDamagedInventory = async (userId, country, region) => {
    try {
        logger.info('Starting Backend Damaged Inventory calculation', {
            userId,
            country,
            region
        });

        // Step 1: Get Ledger Summary View Data (damaged quantities)
        const ledgerSummaryRecord = await LedgerSummaryView.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!ledgerSummaryRecord || !ledgerSummaryRecord.data || ledgerSummaryRecord.data.length === 0) {
            logger.warn('No ledger summary data found for Backend Damaged Inventory calculation');
            return {
                success: false,
                message: 'No ledger summary data found. Please fetch GET_LEDGER_SUMMARY_VIEW_DATA first.',
                data: null,
                items: [],
                summary: {
                    totalDamagedUnits: 0,
                    totalExpectedAmount: 0
                }
            };
        }

        // Step 2: Get ProductWiseFBAData (for Sales Price and Fees)
        const fbaDataRecord = await ProductWiseFBAData.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // Create maps for quick lookup
        const fbaDataMap = new Map();
        if (fbaDataRecord && fbaDataRecord.fbaData) {
            fbaDataRecord.fbaData.forEach(item => {
                if (item && item.asin) {
                    fbaDataMap.set(item.asin, item);
                }
            });
        }

        // Aggregate damaged units by ASIN from ledger summary
        const damagedUnitsMap = new Map();
        const asinMetadataMap = new Map(); // Store SKU, FNSKU for each ASIN

        ledgerSummaryRecord.data.forEach(item => {
            const asin = item.asin;
            if (!asin) return;

            // Aggregate damaged units
            const damagedQty = parseFloat(item.damaged || '0') || 0;
            if (damagedQty > 0) {
                const currentDamaged = damagedUnitsMap.get(asin) || 0;
                damagedUnitsMap.set(asin, currentDamaged + damagedQty);

                // Store metadata (use first occurrence)
                if (!asinMetadataMap.has(asin)) {
                    asinMetadataMap.set(asin, {
                        sku: item.msku || '',
                        fnsku: item.fnsku || ''
                    });
                }
            }
        });

        // Step 3: Calculate expected amounts for each ASIN
        const calculatedItems = [];
        let totalDamagedUnits = 0;
        let totalExpectedAmount = 0;

        damagedUnitsMap.forEach((damagedUnits, asin) => {
            // Discrepancy Units = damaged quantity (from documentation)
            const discrepancyUnits = damagedUnits;
            totalDamagedUnits += discrepancyUnits;

            const metadata = asinMetadataMap.get(asin) || { sku: '', fnsku: '' };
            const fbaItem = fbaDataMap.get(asin);

            // Get Sales Price and Fees from FBA data
            let salesPrice = 0;
            let fees = 0;
            let reimbursementPerUnit = 0;
            let currency = 'USD';

            if (fbaItem) {
                salesPrice = parseFloat(fbaItem.salesPrice || '0') || 0;
                fees = parseFloat(fbaItem.totalAmzFee || '0') || 0;
                reimbursementPerUnit = parseFloat(fbaItem.reimbursementPerUnit || '0') || 0;
                currency = fbaItem.currency || 'USD';

                // If reimbursementPerUnit not pre-calculated, calculate it
                if (reimbursementPerUnit === 0 && salesPrice > 0) {
                    reimbursementPerUnit = salesPrice - fees;
                }
            }

            // Calculate Expected Amount = Discrepancy Units × (Sales Price – Fees)
            const expectedAmount = discrepancyUnits * reimbursementPerUnit;
            totalExpectedAmount += expectedAmount;

            calculatedItems.push({
                asin: asin,
                sku: metadata.sku,
                fnsku: metadata.fnsku,
                damagedUnits: discrepancyUnits,
                salesPrice: salesPrice,
                fees: fees,
                reimbursementPerUnit: reimbursementPerUnit,
                expectedAmount: expectedAmount,
                currency: currency
            });
        });

        const summary = {
            totalDamagedUnits: totalDamagedUnits,
            totalExpectedAmount: totalExpectedAmount
        };

        logger.info('Backend Damaged Inventory calculation completed', {
            userId,
            country,
            region,
            totalItems: calculatedItems.length,
            totalDamagedUnits: summary.totalDamagedUnits,
            totalExpectedAmount: summary.totalExpectedAmount
        });

        return {
            success: true,
            message: 'Backend Damaged Inventory calculated successfully',
            items: calculatedItems,
            summary: summary
        };

    } catch (error) {
        logger.error('Error calculating Backend Damaged Inventory:', error.message);
        throw error;
    }
};

module.exports = {
    calculateBackendLostInventory,
    getBackendLostInventory,
    calculateBackendDamagedInventory
};

