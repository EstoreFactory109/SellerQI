const axios = require('axios');
const aws4 = require('aws4');

const getShipmentDetails = async (shipmentId, SessionToken) => {
    const host = "sellingpartnerapi-na.amazon.com";
    const path = `/fba/inbound/v0/shipments/${shipmentId}/items`;

    let request = {
        host,
        path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",
            "content-type": "application/json",
            "x-amz-access-token":"Atza|IwEBIJfGdqYYwnr8NBQY7Zp-xk1kWFmcZakyXrZEexqYzN7jpN8zEC3re9vtYXbpWwhGnU1ppPi9SE9h8cnPHEgN228rUbRvTOPuW2R6pTZs1x5PWEIyMkZnGutKA3rjXO_ruoFrhpvDTxqoCjPGHGsiKrgzlfXg77r_A279fLfQiranAoPMbNd7L441fUuL_0_V-UztlncY8ThydfULje_fiwNQDjA4i-gLzZPztPB2jg9HXOU8cyakxl1SXGlhDUvhM-ltpaVZJXGTpMFxhPaUJjqlfrNxGF2vaMf__G5TaeQwuBWH-RIX33TrHMxD9j4xEgehyYaSTnIR8rdeutJ6TCJXxhBCx69sP2vEAN6RaNg4CA" // You can pass this as an arg if needed
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

    let request = {
        host,
        path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",
            "content-type": "application/json",
            "x-amz-access-token": "Atza|IwEBIJfGdqYYwnr8NBQY7Zp-xk1kWFmcZakyXrZEexqYzN7jpN8zEC3re9vtYXbpWwhGnU1ppPi9SE9h8cnPHEgN228rUbRvTOPuW2R6pTZs1x5PWEIyMkZnGutKA3rjXO_ruoFrhpvDTxqoCjPGHGsiKrgzlfXg77r_A279fLfQiranAoPMbNd7L441fUuL_0_V-UztlncY8ThydfULje_fiwNQDjA4i-gLzZPztPB2jg9HXOU8cyakxl1SXGlhDUvhM-ltpaVZJXGTpMFxhPaUJjqlfrNxGF2vaMf__G5TaeQwuBWH-RIX33TrHMxD9j4xEgehyYaSTnIR8rdeutJ6TCJXxhBCx69sP2vEAN6RaNg4CA" // You can pass this too if needed
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
