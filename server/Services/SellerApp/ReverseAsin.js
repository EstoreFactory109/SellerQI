const axios = require('axios');

const axiosInstance = axios.create({
    timeout: 30000,
    validateStatus: function (status) {
        return status >= 200 && status < 500;
    }
});

const reverseAsin = async (asin, geo = 'US') => {
    console.log("Reverse Asin: ", asin, geo);
    try {
        const options={
            method: 'GET',
            url: `https://api.sellerapp.com/sellmetricsv2/keyword_research`,
            headers: {
                'client-id': process.env.SELLERAPPCLIENTID || "access-estorefactory",
                'token': process.env.SELLERAPPTOKEN || "819425ba-22db-4df9-a945-f7a061d69182",
                'Content-Type': 'application/json'
            },
            params: {
                key: asin,
                type: 'asin',
                geo: geo
            }
        }
        const response = await axiosInstance.request(options);
        if (response.status >= 400) {
            const payload = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            throw new Error(`ReverseAsin request failed with status ${response.status}: ${payload}`);
        }
        console.log("Reverse Asin Response: ", response.data);
        return response.data;
    } catch (error) {
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            throw new Error(`Cannot connect to SellerApp API. Please check network/DNS. Error: ${error.message}`);
        }
        if (error.code === 'ETIMEDOUT') {
            throw new Error('ReverseAsin request timed out. Please try again later.');
        }
        throw error;
    }
}

module.exports = reverseAsin;