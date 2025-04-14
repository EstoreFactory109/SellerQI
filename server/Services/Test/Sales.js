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
            "x-amz-access-token":"Atza|IwEBIGXpi1hA8BPXecq_S9V32TG7Ic2EjHRxUHxF-ozqdCE_Ky5vpB2sp_AEUuMJPXPbL0VfLvy1kksBmikPIC2iM2Q3lKI2e4sd_5dGT2Lb36_--TQQGckcNrd-wGGtKIM5VmroKISWjl7zKKUfAs57JzXfuzrFS8oHbSC-1AOCkHQa6tljWjqNpBwguYcn_Y4YZsbW5UHTWHFQFipBczV86yBMOC4tludY4HYgGDdvkEWj07gAZLe7W1Fewf559lGUbECnoOMMCY5OjZpfuEVAgBfyTDk3tGSCAcJRAKMm3kCyROlBGsekVYMfIRZYdSFZ5v7E87nxK1GR-zge8lWkRmKHs5uorycnr2OEpVvcHSNbfg"
        }
    };

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
