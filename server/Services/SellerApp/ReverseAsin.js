const axios = require('axios');

const reverseAsin = async (asin, geo = 'US') => {
    const options={
        method: 'GET',
        url: `https://api.sellerapp.com/sellmetricsv2/keyword_research`,
        headers: {
            'client-id': "access-estorefactory",
            'token': "819425ba-22db-4df9-a945-f7a061d69182",
            'Content-Type': 'application/json'
        },
        params: {
            key: asin,
            type: 'asin',
            geo: geo
        }
    }
    const response = await axios.request(options);
    return response.data;
}

module.exports = reverseAsin;