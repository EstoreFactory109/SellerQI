/**
 * UpdateProductContentService
 * Standalone service to update product content (name, bullet points, description) via SP-API Listings Items API.
 * Does not modify or depend on other application flows.
 */

const axios = require('axios');
const aws4 = require('aws4');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAccessToken } = require('./GenerateTokens.js');
const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');
const { URIs, marketplaceConfig, spapiRegions } = require('../../controllers/config/config.js');

/** Allowed values for dataToBeUpdated */
const DATA_TYPES = Object.freeze({
  title: 'title',
  description: 'description',
  bulletpoints: 'bulletpoints'
});

/** Attribute paths and value shape for PATCH */
const ATTRIBUTE_PATHS = Object.freeze({
  title: '/attributes/item_name',
  description: '/attributes/product_description',
  bulletpoints: '/attributes/bullet_point'
});

/**
 * Resolve base URI, marketplace ID, and AWS region from country and region.
 * @returns {{ baseUri: string, marketplaceId: string, awsRegion: string }}
 */
function getRegionConfig(region, country) {
  if (!URIs || !marketplaceConfig || !spapiRegions) {
    throw new ApiError(500, 'Server configuration error - URIs or marketplace config not available');
  }
  const baseUri = URIs[region];
  let marketplaceId = marketplaceConfig[country];
  if (!marketplaceId && country) {
    const upper = country.toUpperCase();
    marketplaceId = marketplaceConfig[upper];
    if (!marketplaceId) {
      const key = Object.keys(marketplaceConfig).find(k => k.toLowerCase() === country.toLowerCase());
      if (key) marketplaceId = marketplaceConfig[key];
    }
  }
  const awsRegion = spapiRegions[region];
  if (!baseUri || !marketplaceId || !awsRegion) {
    throw new ApiError(400, `Unsupported region/country: ${region}/${country}`);
  }
  return { baseUri, marketplaceId, awsRegion };
}

/**
 * Get SP-API refresh token for the given user and region/country from Seller model.
 * @returns {{ refreshToken: string, sellerId: string }}
 */
async function getRefreshTokenForSeller(userId, country, region, sellerId) {
  const seller = await Seller.findOne({ User: userId });
  if (!seller) {
    throw new ApiError(404, 'No seller account found for this user');
  }
  const accounts = Array.isArray(seller.sellerAccount) ? seller.sellerAccount : [];
  const account = accounts.find(
    acc => acc && acc.country === country && acc.region === region
  );
  if (!account) {
    throw new ApiError(404, `No seller account found for region ${region} and country ${country}`);
  }
  if (!account.spiRefreshToken) {
    throw new ApiError(400, 'SP-API refresh token not found for this account. Connect Amazon Seller Central first.');
  }
  const resolvedSellerId = account.selling_partner_id;
  if (sellerId && resolvedSellerId !== sellerId) {
    logger.warn('UpdateProductContentService: passed sellerId does not match account', {
      passed: sellerId,
      resolved: resolvedSellerId
    });
  }
  return { refreshToken: account.spiRefreshToken, sellerId: resolvedSellerId };
}

/**
 * Build request options and sign with AWS SigV4 for SP-API.
 */
function signRequest(host, path, method, accessToken, credentials, awsRegion, body) {
  const request = {
    host,
    path,
    method,
    headers: {
      'user-agent': 'MyApp/1.0',
      'content-type': 'application/json',
      'x-amz-access-token': accessToken
    }
  };
  if (body !== undefined && body !== null && (method === 'PATCH' || method === 'PUT' || method === 'POST')) {
    request.body = typeof body === 'string' ? body : JSON.stringify(body);
    request.headers['content-type'] = 'application/json';
  }
  aws4.sign(request, {
    accessKeyId: credentials.AccessKey,
    secretAccessKey: credentials.SecretKey,
    sessionToken: credentials.SessionToken,
    service: 'execute-api',
    region: awsRegion
  });
  return request;
}

/**
 * GET listing item to fetch productType (and optional attributes/summaries).
 */
async function getListingItem(sellerId, sku, marketplaceId, baseUri, accessToken, credentials, awsRegion) {
  const encodedSku = encodeURIComponent(sku);
  const query = new URLSearchParams({
    marketplaceIds: marketplaceId,
    includedData: 'attributes,issues,summaries'
  });
  const path = `/listings/2021-08-01/items/${sellerId}/${encodedSku}?${query.toString()}`;
  const host = baseUri.startsWith('https://') ? baseUri.replace('https://', '') : baseUri;
  const signed = signRequest(host, path, 'GET', accessToken, credentials, awsRegion);
  const url = `https://${host}${path}`;
  const response = await axios.get(url, {
    headers: signed.headers
  });
  return response.data;
}

/**
 * PATCH listing item to update attributes.
 * Uses the same body string for signing and sending so SigV4 matches.
 */
async function patchListingItem(sellerId, sku, marketplaceId, baseUri, accessToken, credentials, awsRegion, productType, patches) {
  const encodedSku = encodeURIComponent(sku);
  const query = new URLSearchParams({ marketplaceIds: marketplaceId });
  const path = `/listings/2021-08-01/items/${sellerId}/${encodedSku}?${query.toString()}`;
  const host = baseUri.startsWith('https://') ? baseUri.replace('https://', '') : baseUri;
  const bodyObj = { productType, patches };
  const bodyString = JSON.stringify(bodyObj);
  const signed = signRequest(host, path, 'PATCH', accessToken, credentials, awsRegion, bodyString);
  const url = `https://${host}${path}`;
  const response = await axios.patch(url, bodyString, {
    headers: signed.headers
  });
  return response.data;
}

/**
 * Build patches array from dataToBeUpdated and valueToBeUpdated.
 * dataToBeUpdated: 'title' | 'description' | 'bulletpoints'
 * valueToBeUpdated: string (title/description) or string[] (bulletpoints)
 */
function buildPatches(dataToBeUpdated, valueToBeUpdated, marketplaceId) {
  const patches = [];
  const normalizedType = (dataToBeUpdated || '').toLowerCase();

  if (normalizedType === DATA_TYPES.title) {
    const value = typeof valueToBeUpdated === 'string' ? valueToBeUpdated : String(valueToBeUpdated ?? '');
    patches.push({
      op: 'replace',
      path: ATTRIBUTE_PATHS.title,
      value: [{ value, marketplace_id: marketplaceId }]
    });
  } else if (normalizedType === DATA_TYPES.description) {
    const value = typeof valueToBeUpdated === 'string' ? valueToBeUpdated : String(valueToBeUpdated ?? '');
    patches.push({
      op: 'replace',
      path: ATTRIBUTE_PATHS.description,
      value: [{ value, marketplace_id: marketplaceId }]
    });
  } else if (normalizedType === DATA_TYPES.bulletpoints) {
    const arr = Array.isArray(valueToBeUpdated)
      ? valueToBeUpdated
      : (valueToBeUpdated != null ? [valueToBeUpdated] : []);
    const value = arr.map(v => ({ value: String(v), marketplace_id: marketplaceId }));
    patches.push({
      op: 'replace',
      path: ATTRIBUTE_PATHS.bulletpoints,
      value
    });
  } else {
    throw new ApiError(400, `Invalid dataToBeUpdated: ${dataToBeUpdated}. Use title, description, or bulletpoints.`);
  }

  return patches;
}

/**
 * Update product content (name, bullet points, or description).
 *
 * @param {Object} params
 * @param {string} params.sku - Product SKU
 * @param {string} params.sellerId - Selling partner ID (used for API calls; refresh token is resolved by userId/country/region)
 * @param {string} params.userId - User ID (used to find Seller and refresh token)
 * @param {string} params.country - Country code (e.g. US, AU, UK)
 * @param {string} params.region - Region: NA | EU | FE
 * @param {string} params.dataToBeUpdated - 'title' | 'description' | 'bulletpoints'
 * @param {string | string[]} params.valueToBeUpdated - New value; array for bulletpoints
 * @returns {Promise<{ success: boolean, productType?: string, data?: object, error?: string }>}
 */
async function updateProductContent(params) {
  const { sku, sellerId, userId, country, region, dataToBeUpdated, valueToBeUpdated } = params;

  if (!sku || !userId || !country || !region || dataToBeUpdated == null || valueToBeUpdated === undefined) {
    throw new ApiError(400, 'Missing required parameters: sku, userId, country, region, dataToBeUpdated, valueToBeUpdated');
  }

  logger.info('UpdateProductContentService started', {
    sku,
    sellerId,
    userId,
    country,
    region,
    dataToBeUpdated
  });

  // Step 1: Get refresh token and generate access token
  const { refreshToken, sellerId: resolvedSellerId } = await getRefreshTokenForSeller(
    userId,
    country,
    region,
    sellerId
  );
  const accessToken = await generateAccessToken(userId, refreshToken);
  if (!accessToken) {
    throw new ApiError(500, 'Failed to generate SP-API access token');
  }

  const { baseUri, marketplaceId, awsRegion } = getRegionConfig(region, country);
  const credentials = await getTemporaryCredentials(awsRegion);
  if (!credentials || !credentials.AccessKey || !credentials.SecretKey || !credentials.SessionToken) {
    throw new ApiError(500, 'Failed to obtain temporary AWS credentials');
  }

  const effectiveSellerId = sellerId || resolvedSellerId;

  // Step 2: GET listing item to obtain productType
  let listingData;
  try {
    listingData = await getListingItem(
      effectiveSellerId,
      sku,
      marketplaceId,
      baseUri,
      accessToken,
      credentials,
      awsRegion
    );
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    logger.error('UpdateProductContentService: GET listing item failed', {
      sku,
      status,
      data: data || err.message
    });
    throw new ApiError(
      status || 500,
      data?.errors?.[0]?.message || data?.message || err.message || 'Failed to fetch listing item'
    );
  }

  const summaries = listingData?.summaries;
  const productType = summaries?.[0]?.productType;
  if (!productType) {
    throw new ApiError(404, 'Product type not found in listing item response');
  }

  // Resolve valueToBeUpdated for partial bullet update (update one bullet, keep rest)
  let resolvedValue = valueToBeUpdated;
  const normalizedType = String(dataToBeUpdated || '').toLowerCase();
  if (normalizedType === DATA_TYPES.bulletpoints && valueToBeUpdated && typeof valueToBeUpdated === 'object' && !Array.isArray(valueToBeUpdated)) {
    const idx = valueToBeUpdated.index;
    const newVal = valueToBeUpdated.value;
    if (typeof idx !== 'number' || idx < 0 || newVal === undefined) {
      throw new ApiError(400, 'For partial bullet update use valueToBeUpdated: { index: number, value: string } (index 0-based, e.g. 2 for 3rd bullet)');
    }
    const currentBullets = listingData?.attributes?.bullet_point || [];
    const currentValues = currentBullets.map(item => (item && item.value != null ? String(item.value) : ''));
    if (idx >= currentValues.length) {
      // Extend array with empty strings if needed, then set the new value at index
      while (currentValues.length < idx) currentValues.push('');
      currentValues.push(String(newVal));
    } else {
      currentValues[idx] = String(newVal);
    }
    resolvedValue = currentValues;
    logger.info('UpdateProductContentService: partial bullet update', { index: idx, totalBullets: currentValues.length });
  }

  // Step 3: Build patches and PATCH listing item
  const patches = buildPatches(dataToBeUpdated, resolvedValue, marketplaceId);

  try {
    const patchResult = await patchListingItem(
      effectiveSellerId,
      sku,
      marketplaceId,
      baseUri,
      accessToken,
      credentials,
      awsRegion,
      productType,
      patches
    );
    logger.info('UpdateProductContentService: PATCH success', { sku, productType });
    return { success: true, productType, data: patchResult };
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    logger.error('UpdateProductContentService: PATCH listing item failed', {
      sku,
      status,
      data: data || err.message
    });
    throw new ApiError(
      status || 500,
      data?.errors?.[0]?.message || data?.message || err.message || 'Failed to update listing item'
    );
  }
}

module.exports = {
  updateProductContent,
  getRegionConfig,
  buildPatches,
  DATA_TYPES,
  ATTRIBUTE_PATHS
};
