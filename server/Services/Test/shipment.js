const axios = require('axios');
const aws4 = require('aws4');

const getShipmentDetails = async (shipmentId, SessionToken) => {
    const host = "sellingpartnerapi-na.amazon.com";
    const path = `/fba/inbound/v0/shipments/${shipmentId}/items`;

    if (!process.env.SPAPI_ACCESS_TOKEN) {
        throw new Error('Missing SPAPI_ACCESS_TOKEN in environment (this is a test script).');
    }

    let request = {
        host,
        path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",
            "content-type": "application/json",
            "x-amz-access-token": process.env.SPAPI_ACCESS_TOKEN
        }
    };

    aws4.sign(request, {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        sessionToken: SessionToken
    });

    try {
        const response = await axios.get(`https://${host}${path}`, { headers: request.headers });
        return response.data || false;
    } catch (error) {
        console.error(`❌ Error fetching shipment details for ${shipmentId}:`, error.response?.data || error.message);
        return false;
    }
};

const getshipment = async (SessionToken) => {
    const host = "sellingpartnerapi-na.amazon.com";
    const queryParams = "ShipmentStatusList=WORKING,SHIPPED,RECEIVING,CLOSED,CANCELLED,DELETED,ERROR,IN_TRANSIT&QueryType=SHIPMENT&MarketplaceId=ATVPDKIKX0DER";
    const path = `/fba/inbound/v0/shipments?${queryParams}`;

    if (!process.env.SPAPI_ACCESS_TOKEN) {
        throw new Error('Missing SPAPI_ACCESS_TOKEN in environment (this is a test script).');
    }

    let request = {
        host,
        path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",
            "content-type": "application/json",
            "x-amz-access-token": process.env.SPAPI_ACCESS_TOKEN
        }
    };

    aws4.sign(request, {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        sessionToken: SessionToken
    });

    try {
        const response = await axios.get(`https://${host}${path}`, { headers: request.headers });
        if (!response || !response.data || !response.data.payload) return false;

       

        const result = [];
        for (const shipment of response.data.payload.ShipmentData) {
            if (shipment.ShipmentStatus === "CLOSED") {
                const details = await getShipmentDetails(shipment.ShipmentId, SessionToken);
                if (details) {
                    result.push(details);
                }
            }
        }

        return result;
    } catch (error) {
        console.error("❌ Error fetching shipment list:", error.response?.data || error.message);
        return false;
    }
};

module.exports = getshipment;
