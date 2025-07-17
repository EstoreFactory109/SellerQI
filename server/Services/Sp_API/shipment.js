const axios = require('axios');
const aws4 = require('aws4');
const promiseLimit = require('promise-limit');
const ShipmentModel = require('../../models/ShipmentModel.js');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError');

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

        const closedShipments = response.data.payload.ShipmentData.filter(
            shipment => shipment.ShipmentStatus === "CLOSED"
        );

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
                        return {
                            shipmentId: shipment.ShipmentId,
                            shipmentName: shipment.ShipmentName,
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

        return createShipping;
    } catch (error) {
        console.error("❌ Error fetching shipment list:", error.response?.data || error.message);
        return false;
    }
};

module.exports = getshipment;
