const axios = require('axios');
const aws4 = require('aws4');

const TotalSales = async (SessionToken) => {
    const host = "sellingpartnerapi-na.amazon.com";

    const queryParams = "marketplaceIds=ATVPDKIKX0DER&interval=2025-03-01T00:00:00Z--2025-03-07T23:59:59Z&granularity=Day"

    const path = `/sales/v1/orderMetrics?${queryParams}`;

    // Construct request
    let request = {
        host: host,
        path: path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",
            "content-type": "application/json",
            "x-amz-access-token": process.env.SPAPI_ACCESS_TOKEN
        }
    };

    if (!process.env.SPAPI_ACCESS_TOKEN) {
        throw new Error('Missing SPAPI_ACCESS_TOKEN in environment (this is a test script).');
    }

    // AWS Signature V4 signing
    aws4.sign(request, {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        sessionToken: SessionToken
    });

    // Make the request
    try {
        const response = await axios.get(`https://${request.host}${request.path}`, { headers: request.headers });
        if (!response || !response.data) {
            return false;
        }

        return response.data;
    } catch (error) {
        console.error("❌ Error Fetching Sales Metrics:", error.response?.data || error.message);
        return false;
    }
};

module.exports = TotalSales;
