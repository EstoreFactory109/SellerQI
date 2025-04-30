const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const aws4 = require('aws4');
const logger = require('../../utils/Logger.js');
const ApiError = require('../../utils/ApiError.js'); // If you're using custom ApiError

// ✅ Setup axios-retry globally
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return (
      axiosRetry.isNetworkError(error) ||
      axiosRetry.isRetryableError(error) ||
      error.response?.status === 429 ||
      error.response?.status >= 500
    );
  }
});

const GetListingItem = async (dataToReceive, sku, asin, userId, baseuri, Country, Region) => {
  const host = baseuri;

  const queryParams = new URLSearchParams({
    marketplaceIds: dataToReceive.marketplaceId,
    issueLocale: dataToReceive.issueLocale,
    includedData: dataToReceive.includedData
  }).toString();

  const path = `/listings/2021-08-01/items/A2MS927NNLJTSX/${sku}?${queryParams}`;
  const fullUrl = `https://${host}${path}`;

  let request = {
    host: host,
    path: path,
    method: "GET",
    headers: {
      "user-agent": "MyApp/1.0",
      "content-type": "application/json",
      "x-amz-access-token": dataToReceive.AccessToken
    }
  };

  // ✅ AWS signing
  aws4.sign(request, {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
    sessionToken: dataToReceive.SessionToken,
    service: 'execute-api',
    region: 'us-east-1'
  });

  try {
    const response = await axios.get(fullUrl, {
      headers: request.headers
    });

    const keywordData = response.data?.attributes?.generic_keyword?.[0];

    if (!keywordData) {
      logger.error(`❌ No generic_keyword found for SKU: ${sku}`);
      return false;
    }

    const generic_Keyword = {
      asin: asin,
      value: keywordData.value,
      marketplace_id: keywordData.marketplace_id
    };

    return generic_Keyword;

  } catch (error) {
    console.error(`❌ Error fetching catalog for SKU: ${sku}:`, error.response?.data || error.message);
    return false;
  }
};

module.exports = { GetListingItem };
