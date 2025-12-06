const axios = require('axios');
const aws4 = require('aws4');
const promiseLimit = require('promise-limit');
const ShipmentModel = require('../../models/inventory/ShipmentModel.js');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError');

/**
 * Extract date from shipment name
 * Shipment names follow patterns like: "Think Tank - SH2 - FBA STA (05/02/2025 16:43)-SBD1"
 * The date is in format (MM/DD/YYYY HH:mm)
 * @param {string} shipmentName - The shipment name containing the date
 * @returns {Date|null} - Parsed date or null if not found
 */
const extractDateFromShipmentName = (shipmentName) => {
    if (!shipmentName) return null;
    
    // Regex to match date pattern (MM/DD/YYYY HH:mm) in parentheses
    const datePattern = /\((\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\)/;
    const match = shipmentName.match(datePattern);
    
    if (match) {
        const [, month, day, year, hour, minute] = match;
        // Create date object (month is 0-indexed in JavaScript)
        const parsedDate = new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            parseInt(hour),
            parseInt(minute)
        );
        
        // Validate the date is valid
        if (!isNaN(parsedDate.getTime())) {
            return parsedDate;
        }
    }
    
    return null;
};

/**
 * Check if a date is within the last N days from today
 * @param {Date} date - The date to check
 * @param {number} days - Number of days to look back (default 30)
 * @returns {boolean} - True if date is within the range
 */
const isWithinLastNDays = (date, days = 30) => {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        return false;
    }
    
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
    
    // Date should be between cutoffDate and now (inclusive)
    return date >= cutoffDate && date <= now;
};

// Helper function to fetch shipment item details
const getShipmentDetails = async (shipmentId, SessionToken, baseURI, AccessToken) => {
    const host = baseURI;
    const path = `/fba/inbound/v0/shipments/${shipmentId}/items`;

    let request = {
        host,
        path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",
            "content-type": "application/json",
            "x-amz-access-token": AccessToken
        }
    };

    aws4.sign(request, {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        sessionToken: SessionToken
    });

    try {
        const response = await axios.get(`https://${host}${path}`, { headers: request.headers });

        let resultData = []

        response.data.payload.ItemData.forEach(item => {
            const data = {
                SellerSKU: item.SellerSKU,
                FulfillmentNetworkSKU: item.FulfillmentNetworkSKU,
                QuantityShipped: item.QuantityShipped,
                QuantityReceived: item.QuantityReceived
            };
            resultData.push(data);
        });

        return resultData;
    } catch (error) {
        console.error(`❌ Error fetching shipment details for ${shipmentId}:`, error.response?.data || error.message);
        return false;
    }
};

const getshipment = async (dataToReceive, UserId, baseuri, country, region) => {
    const host = baseuri;

    const queryParams = `ShipmentStatusList=WORKING,SHIPPED,RECEIVING,CLOSED,CANCELLED,DELETED,ERROR,IN_TRANSIT&QueryType=SHIPMENT&MarketplaceId=${dataToReceive.marketplaceId}`;
    const path = `/fba/inbound/v0/shipments?${queryParams}`;

    let request = {
        host,
        path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",
            "content-type": "application/json",
            "x-amz-access-token": dataToReceive.AccessToken
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
        const response = await axios.get(`https://${host}${path}`, { headers: request.headers });
        if (!response || !response.data || !response.data.payload) return false;

        const limit = promiseLimit(3); // Limit to 3 concurrent getShipmentDetails requests

        // Filter for CLOSED shipments that are within the last 30 days
        const closedShipments = response.data.payload.ShipmentData.filter(shipment => {
            if (shipment.ShipmentStatus !== "CLOSED") {
                return false;
            }
            
            // Extract date from shipment name and check if within last 30 days
            const shipmentDate = extractDateFromShipmentName(shipment.ShipmentName);
            
            if (shipmentDate) {
                const isRecent = isWithinLastNDays(shipmentDate, 30);
                if (!isRecent) {
                    logger.info(`Skipping shipment ${shipment.ShipmentId} - date ${shipmentDate.toISOString()} is older than 30 days`);
                }
                return isRecent;
            } else {
                // If no date found in name, log warning but still include (fallback behavior)
                logger.warn(`Could not extract date from shipment name: ${shipment.ShipmentName}. Including shipment anyway.`);
                return true;
            }
        });

        logger.info(`Filtered ${closedShipments.length} shipments from last 30 days out of ${response.data.payload.ShipmentData.filter(s => s.ShipmentStatus === "CLOSED").length} total CLOSED shipments`);

        const result = await Promise.all(
            closedShipments.map(shipment =>
                limit(async () => {
                    const details = await getShipmentDetails(
                        shipment.ShipmentId,
                        dataToReceive.SessionToken,
                        baseuri,
                        dataToReceive.AccessToken
                    );

                    if (details) {
                        // Extract and store the shipment date for reference
                        const shipmentDate = extractDateFromShipmentName(shipment.ShipmentName);
                        
                        return {
                            shipmentId: shipment.ShipmentId,
                            shipmentName: shipment.ShipmentName,
                            shipmentDate: shipmentDate ? shipmentDate.toISOString() : null,
                            itemDetails: details
                        };
                    }

                    return null;
                })
            )
        );

        const filteredResult = result.filter(Boolean);

        const createShipping = await ShipmentModel.create({
            User: UserId,
            region: region,
            country: country,
            shipmentData: filteredResult
        });

        if (!createShipping) {
            logger.error(new ApiError(400, "Error in creating shipment"));
            return false;
        }

        logger.info(`Successfully stored ${filteredResult.length} shipments from last 30 days for user ${UserId}`);
        return createShipping;
    } catch (error) {
        console.error("❌ Error fetching shipment list:", error.response?.data || error.message);
        return false;
    }
};

module.exports = getshipment;
