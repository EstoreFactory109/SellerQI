const axios = require('axios');
const aws4 = require('aws4');
const ReimbursementModel = require('../../models/ReimbursementModel.js');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError');

/**
 * Service to fetch FBA Reimbursement data from Amazon SP-API
 * 
 * Amazon provides reimbursements through the Reports API
 * Report Type: GET_FBA_REIMBURSEMENTS_DATA
 * 
 * This report includes:
 * - Reimbursement ID
 * - Reimbursement type (Lost, Damaged, Customer Return, etc.)
 * - ASIN, SKU, FNSKU
 * - Quantity and Amount
 * - Reason codes
 * - Approval and reimbursement dates
 */

// Helper function to create a report request
const createReportRequest = async (dataToReceive, baseuri, reportType) => {
    const host = baseuri;
    const path = '/reports/2021-06-30/reports';
    
    // Calculate date range (last 90 days by default)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    
    const requestBody = {
        reportType: reportType,
        marketplaceIds: [dataToReceive.marketplaceId],
        dataStartTime: startDate.toISOString(),
        dataEndTime: endDate.toISOString()
    };

    let request = {
        host: host,
        path: path,
        method: 'POST',
        headers: {
            'host': host,
            'user-agent': 'MyApp/1.0',
            'content-type': 'application/json',
            'x-amz-access-token': dataToReceive.AccessToken
        },
        body: JSON.stringify(requestBody)
    };

    // Sign the request
    aws4.sign(request, {
        accessKeyId: dataToReceive.AccessKey,
        secretAccessKey: dataToReceive.SecretKey,
        sessionToken: dataToReceive.SessionToken,
        service: 'execute-api',
        region: 'us-east-1'
    });

    try {
        const response = await axios.post(
            `https://${host}${path}`,
            requestBody,
            { headers: request.headers }
        );

        logger.info('Reimbursement report request created:', {
            reportId: response.data?.reportId,
            reportType: reportType
        });

        return response.data.reportId;
    } catch (error) {
        logger.error('Error creating reimbursement report request:', error.response?.data || error.message);
        throw error;
    }
};

// Helper function to check report status
const checkReportStatus = async (dataToReceive, baseuri, reportId, maxAttempts = 30) => {
    const host = baseuri;
    const path = `/reports/2021-06-30/reports/${reportId}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let request = {
            host: host,
            path: path,
            method: 'GET',
            headers: {
                'host': host,
                'user-agent': 'MyApp/1.0',
                'content-type': 'application/json',
                'x-amz-access-token': dataToReceive.AccessToken
            }
        };

        aws4.sign(request, {
            accessKeyId: dataToReceive.AccessKey,
            secretAccessKey: dataToReceive.SecretKey,
            sessionToken: dataToReceive.SessionToken,
            service: 'execute-api',
            region: 'us-east-1'
        });

        try {
            const response = await axios.get(
                `https://${host}${path}`,
                { headers: request.headers }
            );

            const processingStatus = response.data.processingStatus;
            
            logger.info(`Report status check (attempt ${attempt}/${maxAttempts}):`, {
                reportId: reportId,
                status: processingStatus
            });

            if (processingStatus === 'DONE') {
                return response.data.reportDocumentId;
            } else if (processingStatus === 'FATAL' || processingStatus === 'CANCELLED') {
                throw new Error(`Report processing failed with status: ${processingStatus}`);
            }

            // Wait before next check (exponential backoff)
            const waitTime = Math.min(2000 * attempt, 30000);
            await new Promise(resolve => setTimeout(resolve, waitTime));

        } catch (error) {
            if (attempt === maxAttempts) {
                throw error;
            }
            logger.warn(`Report status check attempt ${attempt} failed, retrying...`);
        }
    }

    throw new Error(`Report did not complete after ${maxAttempts} attempts`);
};

// Helper function to get report document
const getReportDocument = async (dataToReceive, baseuri, reportDocumentId) => {
    const host = baseuri;
    const path = `/reports/2021-06-30/documents/${reportDocumentId}`;

    let request = {
        host: host,
        path: path,
        method: 'GET',
        headers: {
            'host': host,
            'user-agent': 'MyApp/1.0',
            'content-type': 'application/json',
            'x-amz-access-token': dataToReceive.AccessToken
        }
    };

    aws4.sign(request, {
        accessKeyId: dataToReceive.AccessKey,
        secretAccessKey: dataToReceive.SecretKey,
        sessionToken: dataToReceive.SessionToken,
        service: 'execute-api',
        region: 'us-east-1'
    });

    try {
        const response = await axios.get(
            `https://${host}${path}`,
            { headers: request.headers }
        );

        return response.data;
    } catch (error) {
        logger.error('Error getting report document:', error.response?.data || error.message);
        throw error;
    }
};

// Helper function to download and parse report data
const downloadReportData = async (reportDocumentInfo) => {
    try {
        const response = await axios.get(reportDocumentInfo.url, {
            responseType: 'text'
        });

        // Parse TSV (Tab-separated values) format
        const lines = response.data.split('\n');
        if (lines.length < 2) {
            logger.warn('Reimbursement report is empty or invalid');
            return [];
        }

        const headers = lines[0].split('\t');
        const reimbursements = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = line.split('\t');
            const item = {};

            headers.forEach((header, index) => {
                item[header.trim()] = values[index] ? values[index].trim() : '';
            });

            reimbursements.push(item);
        }

        logger.info(`Parsed ${reimbursements.length} reimbursement records from report`);
        return reimbursements;

    } catch (error) {
        logger.error('Error downloading or parsing report data:', error.message);
        throw error;
    }
};

// Helper function to map Amazon reason codes to reimbursement types
const mapReasonCodeToType = (reasonCode) => {
    if (!reasonCode) return 'OTHER';

    const reasonCodeUpper = reasonCode.toUpperCase();

    // Lost inventory
    if (reasonCodeUpper.includes('LOST') || reasonCodeUpper.includes('MISSING')) {
        return 'LOST';
    }
    // Damaged inventory
    if (reasonCodeUpper.includes('DAMAGE') || reasonCodeUpper.includes('DEFECTIVE')) {
        return 'DAMAGED';
    }
    // Customer returns
    if (reasonCodeUpper.includes('CUSTOMER_RETURN') || reasonCodeUpper.includes('RETURN')) {
        return 'CUSTOMER_RETURN';
    }
    // Fee corrections
    if (reasonCodeUpper.includes('FEE') || reasonCodeUpper.includes('OVERCHARGE')) {
        return 'FEE_CORRECTION';
    }
    // Inbound shipment
    if (reasonCodeUpper.includes('INBOUND') || reasonCodeUpper.includes('RECEIVE')) {
        return 'INBOUND_SHIPMENT';
    }
    // Removal orders
    if (reasonCodeUpper.includes('REMOVAL') || reasonCodeUpper.includes('DISPOSAL')) {
        return 'REMOVAL_ORDER';
    }
    // Warehouse damage
    if (reasonCodeUpper.includes('WAREHOUSE')) {
        return 'WAREHOUSE_DAMAGE';
    }
    // Inventory difference
    if (reasonCodeUpper.includes('INVENTORY') || reasonCodeUpper.includes('RECONCILIATION')) {
        return 'INVENTORY_DIFFERENCE';
    }

    return 'OTHER';
};

// Helper function to transform raw report data to our schema format
const transformReimbursementData = (rawData, marketplace) => {
    return rawData.map(item => {
        const reimbursementType = mapReasonCodeToType(item['reason'] || item['reason-code']);
        
        // Parse dates
        const approvalDate = item['approval-date'] ? new Date(item['approval-date']) : null;
        const reimbursementDate = item['reimbursed-date'] || item['reimbursement-date'] 
            ? new Date(item['reimbursed-date'] || item['reimbursement-date']) 
            : null;

        return {
            reimbursementId: item['reimbursement-id'] || item['case-id'] || '',
            asin: item['asin'] || '',
            sku: item['sku'] || '',
            fnsku: item['fnsku'] || '',
            reimbursementType: reimbursementType,
            amount: parseFloat(item['amount-total'] || item['reimbursed-amount'] || 0),
            currency: item['currency-unit'] || item['currency'] || 'USD',
            quantity: parseInt(item['quantity-reimbursed-total'] || item['quantity'] || 0),
            reasonCode: item['reason'] || item['reason-code'] || '',
            reasonDescription: item['reason-description'] || '',
            caseId: item['case-id'] || '',
            status: 'APPROVED', // Data from report means it's already approved
            approvalDate: approvalDate,
            reimbursementDate: reimbursementDate || approvalDate || new Date(),
            isAutomated: true, // Assume automated unless marked otherwise
            marketplace: marketplace,
            retailValue: parseFloat(item['original-reimbursement-amount'] || 0),
            shipmentId: item['shipment-id'] || '',
            notes: item['comments'] || ''
        };
    });
};

/**
 * Main function to fetch and process FBA reimbursement data
 */
const GET_FBA_REIMBURSEMENT_DATA = async (dataToReceive, userId, baseuri, country, region) => {
    try {
        logger.info('Starting FBA reimbursement data fetch', {
            userId,
            country,
            region
        });

        // Step 1: Create report request
        const reportId = await createReportRequest(
            dataToReceive,
            baseuri,
            'GET_FBA_REIMBURSEMENTS_DATA'
        );

        if (!reportId) {
            logger.warn('Failed to create reimbursement report request');
            return null;
        }

        // Step 2: Wait for report to be ready and get document ID
        const reportDocumentId = await checkReportStatus(dataToReceive, baseuri, reportId);

        if (!reportDocumentId) {
            logger.warn('Report document ID not received');
            return null;
        }

        // Step 3: Get report document info (including download URL)
        const reportDocumentInfo = await getReportDocument(dataToReceive, baseuri, reportDocumentId);

        if (!reportDocumentInfo || !reportDocumentInfo.url) {
            logger.warn('Report document URL not available');
            return null;
        }

        // Step 4: Download and parse report data
        const rawReimbursements = await downloadReportData(reportDocumentInfo);

        if (!rawReimbursements || rawReimbursements.length === 0) {
            logger.info('No reimbursement data found in report');
            
            // Create empty record
            const emptyRecord = await ReimbursementModel.create({
                User: userId,
                region: region,
                country: country,
                reimbursements: [],
                summary: {
                    totalReceived: 0,
                    totalPending: 0,
                    totalPotential: 0,
                    totalDenied: 0
                },
                dataSource: 'SP_API'
            });

            return emptyRecord;
        }

        // Step 5: Transform data to our schema format
        const transformedData = transformReimbursementData(
            rawReimbursements,
            dataToReceive.marketplaceId
        );

        // Step 6: Save to database
        const reimbursementRecord = new ReimbursementModel({
            User: userId,
            region: region,
            country: country,
            reimbursements: transformedData,
            dataSource: 'SP_API',
            lastFetchDate: new Date()
        });

        // Calculate summary statistics
        reimbursementRecord.calculateSummary();

        // Save to database
        await reimbursementRecord.save();

        logger.info('Successfully saved reimbursement data:', {
            userId,
            totalReimbursements: transformedData.length,
            totalAmount: reimbursementRecord.summary.totalReceived
        });

        return reimbursementRecord;

    } catch (error) {
        logger.error('Error in GET_FBA_REIMBURSEMENT_DATA:', {
            error: error.message,
            userId,
            country,
            region
        });

        // Don't throw error, return null to allow other processes to continue
        return null;
    }
};

module.exports = GET_FBA_REIMBURSEMENT_DATA;

