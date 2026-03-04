/**
 * AutoFixListingService
 * Automatically analyzes and fixes listing issues for the "Fix It" button feature.
 * Handles catalog conflicts, validation errors, and attribute updates intelligently.
 * 
 * KEY FEATURE: Single PATCH call can fix all catalog conflicts (8541/8542/8543) 
 * AND update target attribute simultaneously using autoFixConflicts option.
 * 
 * BRAND FIX: Automatically detects missing brand attribute and patches it in the
 * same PATCH call using options.brandName — required for Brand Registry catalog
 * authority to take effect on title and other attributes.
 */

const axios = require('axios');
const aws4 = require('aws4');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAccessToken } = require('./GenerateTokens.js');
const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');
const { URIs, marketplaceConfig, spapiRegions } = require('../../controllers/config/config.js');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Allowed values for dataToBeUpdated */
const DATA_TYPES = Object.freeze({
  title: 'title',
  description: 'description',
  bulletpoints: 'bulletpoints',
  size: 'size',
  color: 'color',
  brand: 'brand',
  manufacturer: 'manufacturer',
  model: 'model',
  material: 'material',
  style: 'style',
  pattern: 'pattern',
  item_weight: 'item_weight',
  item_package_weight: 'item_package_weight',
  unit_count: 'unit_count',
  generic_keyword: 'generic_keyword'
});

/** Attribute paths for PATCH operations */
const ATTRIBUTE_PATHS = Object.freeze({
  title: '/attributes/item_name',
  description: '/attributes/product_description',
  bulletpoints: '/attributes/bullet_point',
  size: '/attributes/size',
  color: '/attributes/color',
  brand: '/attributes/brand',
  manufacturer: '/attributes/manufacturer',
  model: '/attributes/model_number',
  material: '/attributes/material',
  style: '/attributes/style',
  pattern: '/attributes/pattern',
  item_weight: '/attributes/item_weight',
  item_package_weight: '/attributes/item_package_weight',
  unit_count: '/attributes/unit_count',
  generic_keyword: '/attributes/generic_keyword'
});

/** Attribute names in listing data */
const ATTRIBUTE_NAMES = Object.freeze({
  title: 'item_name',
  description: 'product_description',
  bulletpoints: 'bullet_point',
  size: 'size',
  color: 'color',
  brand: 'brand',
  manufacturer: 'manufacturer',
  model: 'model_number',
  material: 'material',
  style: 'style',
  pattern: 'pattern',
  item_weight: 'item_weight',
  item_package_weight: 'item_package_weight',
  unit_count: 'unit_count',
  generic_keyword: 'generic_keyword'
});

/** 
 * Attributes that require language_tag 
 * Some attributes (like weight, unit_count) don't need language_tag
 */
const ATTRIBUTES_REQUIRING_LANGUAGE_TAG = Object.freeze([
  'item_name',
  'product_description',
  'bullet_point',
  'size',
  'color',
  'brand',
  'manufacturer',
  'material',
  'style',
  'pattern',
  'generic_keyword'
]);

/** 
 * Attributes that have special value structures (not just {value, language_tag, marketplace_id})
 */
const SPECIAL_ATTRIBUTE_STRUCTURES = Object.freeze({
  item_weight: { hasUnit: true, unitField: 'unit', valueField: 'value' },
  item_package_weight: { hasUnit: true, unitField: 'unit', valueField: 'value' },
  unit_count: { hasType: true, typeField: 'type', valueField: 'value' }
});

/** Map marketplace ID to default language tag */
const MARKETPLACE_LANGUAGE_MAP = Object.freeze({
  // North America
  'ATVPDKIKX0DER': 'en_US',   // US
  'A2EUQ1WTGCTBG2': 'en_CA',  // Canada
  'A1AM78C64UM0Y8': 'es_MX',  // Mexico
  'A2Q3Y263D00KWC': 'pt_BR',  // Brazil
  // Europe
  'A1F83G8C2ARO7P': 'en_GB',  // UK
  'A1PA6795UKMFR9': 'de_DE',  // Germany
  'A13V1IB3VIYBER': 'fr_FR',  // France
  'A1RKKUPIHCS9HS': 'es_ES',  // Spain
  'APJ6JRA9NG5V4': 'it_IT',   // Italy
  'A1805IZSGTT6HS': 'nl_NL',  // Netherlands
  'A2NODRKZP88ZB9': 'sv_SE',  // Sweden
  'A1C3SOZBER6TH2': 'pl_PL',  // Poland
  'A33AVAJ2PDY3EV': 'tr_TR',  // Turkey
  'A17E79C6D8DWNP': 'ar_SA',  // Saudi Arabia
  'A2VIGQ35RCS4UG': 'ar_AE',  // UAE
  'ARBP9OOSHTCHU': 'ar_EG',   // Egypt
  // Far East
  'A39IBJ37TRP1C6': 'en_AU',  // Australia
  'A1VC38T7YXB528': 'ja_JP',  // Japan
  'A21TJRUUN4KGV': 'en_IN',   // India
  'A19VAU5U5O7RUS': 'en_SG',  // Singapore
  'AAHKV2X7AFBER': 'zh_CN',   // China
});

/** Issue codes and their fix strategies */
const ISSUE_FIX_STRATEGIES = Object.freeze({
  '8541': 'CATALOG_CONFLICT',
  '8542': 'CATALOG_CONFLICT',
  '8543': 'CATALOG_CONFLICT',
  '99010': 'BRAND_CONFLICT',
  '90220': 'MISSING_ATTRIBUTE',
  '90117': 'INVALID_VALUE',
  '90118': 'INVALID_VALUE',
});

/** Catalog conflict error codes */
const CATALOG_CONFLICT_CODES = Object.freeze(['8541', '8542', '8543']);

/** Fix result statuses */
const FIX_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
  CONFLICT_RESOLVED: 'CONFLICT_RESOLVED',
  CANNOT_FIX: 'CANNOT_FIX',
  REQUIRES_MANUAL: 'REQUIRES_MANUAL',
  NO_CONFLICTS: 'NO_CONFLICTS',
  ERROR: 'ERROR'
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get language tag for a marketplace
 */
function getLanguageTag(marketplaceId) {
  return MARKETPLACE_LANGUAGE_MAP[marketplaceId] || 'en_US';
}

/**
 * Check if an attribute requires language_tag
 */
function requiresLanguageTag(attributeName) {
  return ATTRIBUTES_REQUIRING_LANGUAGE_TAG.includes(attributeName);
}

/**
 * Resolve base URI, marketplace ID, and AWS region from region/country
 */
function getRegionConfig(region, country) {
  if (!URIs || !marketplaceConfig || !spapiRegions) {
    throw new ApiError(500, 'Server configuration error');
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
 * Get SP-API refresh token for seller
 */
async function getRefreshTokenForSeller(userId, country, region, sellerId) {
  const seller = await Seller.findOne({ User: userId });
  if (!seller) {
    throw new ApiError(404, 'No seller account found for this user');
  }
  const accounts = Array.isArray(seller.sellerAccount) ? seller.sellerAccount : [];
  const account = accounts.find(acc => acc && acc.country === country && acc.region === region);
  if (!account) {
    throw new ApiError(404, `No seller account found for region ${region} and country ${country}`);
  }
  if (!account.spiRefreshToken) {
    throw new ApiError(400, 'SP-API refresh token not found. Connect Amazon Seller Central first.');
  }
  return {
    refreshToken: account.spiRefreshToken,
    sellerId: account.selling_partner_id,
    brand: seller.brand || null
  };
}

/**
 * Sign request with AWS SigV4
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
  if (body !== undefined && body !== null && ['PATCH', 'PUT', 'POST'].includes(method)) {
    request.body = typeof body === 'string' ? body : JSON.stringify(body);
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

// ============================================================================
// SP-API CALLS
// ============================================================================

async function getListingItem(sellerId, sku, marketplaceId, baseUri, accessToken, credentials, awsRegion) {
  const encodedSku = encodeURIComponent(sku);
  const query = new URLSearchParams({
    marketplaceIds: marketplaceId,
    includedData: 'attributes,issues,summaries,offers,fulfillmentAvailability'
  });
  const path = `/listings/2021-08-01/items/${sellerId}/${encodedSku}?${query.toString()}`;
  const host = baseUri.replace('https://', '');
  const signed = signRequest(host, path, 'GET', accessToken, credentials, awsRegion);
  const response = await axios.get(`https://${host}${path}`, { headers: signed.headers });
  return response.data;
}

async function patchListingItem(sellerId, sku, marketplaceId, baseUri, accessToken, credentials, awsRegion, productType, patches) {
  const encodedSku = encodeURIComponent(sku);
  const query = new URLSearchParams({ marketplaceIds: marketplaceId });
  const path = `/listings/2021-08-01/items/${sellerId}/${encodedSku}?${query.toString()}`;
  const host = baseUri.replace('https://', '');
  const bodyString = JSON.stringify({ productType, patches });
  const signed = signRequest(host, path, 'PATCH', accessToken, credentials, awsRegion, bodyString);
  const response = await axios.patch(`https://${host}${path}`, bodyString, { headers: signed.headers });
  return response.data;
}

async function getCatalogItem(asin, marketplaceId, baseUri, accessToken, credentials, awsRegion) {
  const query = new URLSearchParams({
    marketplaceIds: marketplaceId,
    includedData: 'attributes,summaries'
  });
  const path = `/catalog/2022-04-01/items/${asin}?${query.toString()}`;
  const host = baseUri.replace('https://', '');
  const signed = signRequest(host, path, 'GET', accessToken, credentials, awsRegion);
  const response = await axios.get(`https://${host}${path}`, { headers: signed.headers });
  return response.data;
}

// ============================================================================
// CONFLICT PARSING & ANALYSIS
// ============================================================================

function parse8541Error(issue) {
  if (!issue || !CATALOG_CONFLICT_CODES.includes(issue.code)) {
    return null;
  }
  
  const message = issue.message || '';
  
  const attrMatch = message.match(/(?:attribute value\(s\) conflict|following listing attribute).*?'(\w+)'/i);
  const attributeName = attrMatch ? attrMatch[1] : null;
  
  const amazonValueMatch = message.match(/Amazon\s*\[[\w_]+:\s*"([^"]+)"\]/i);
  const amazonValue = amazonValueMatch ? amazonValueMatch[1] : null;
  
  const merchantValueMatch = message.match(/Merchant\s*\[[\w_]+:\s*"([^"]+)"\]/i);
  const merchantValue = merchantValueMatch ? merchantValueMatch[1] : null;
  
  const languageTagMatch = message.match(/\[([\w_]+):\s*"/i);
  const languageTag = languageTagMatch ? languageTagMatch[1] : null;
  
  const asinMatch = message.match(/ASIN\s+([A-Z0-9]{10})/i);
  const asin = asinMatch ? asinMatch[1] : null;
  
  if (!attributeName) {
    logger.warn('parse8541Error: Could not extract attribute name from message', { message });
    return null;
  }
  
  return {
    code: issue.code,
    attributeName,
    amazonValue,
    merchantValue,
    languageTag,
    asin,
    canAutoFix: !!amazonValue,
    rawMessage: message,
    fixAction: amazonValue 
      ? `Update '${attributeName}' from "${merchantValue || 'current value'}" to "${amazonValue}"`
      : `Cannot auto-fix: Amazon's expected value not found in error message`
  };
}

function analyzeCatalogConflicts(issues) {
  const conflicts = [];
  const unfixableConflicts = [];
  
  for (const issue of (issues || [])) {
    if (CATALOG_CONFLICT_CODES.includes(issue.code)) {
      const parsed = parse8541Error(issue);
      if (parsed) {
        if (parsed.canAutoFix) {
          conflicts.push(parsed);
        } else {
          unfixableConflicts.push(parsed);
        }
      } else {
        unfixableConflicts.push({
          code: issue.code,
          rawMessage: issue.message,
          canAutoFix: false,
          reason: 'Could not parse error message'
        });
      }
    }
  }
  
  return {
    hasConflicts: conflicts.length > 0 || unfixableConflicts.length > 0,
    fixableCount: conflicts.length,
    unfixableCount: unfixableConflicts.length,
    conflicts,
    unfixableConflicts,
    canAutoFixAll: conflicts.length > 0 && unfixableConflicts.length === 0
  };
}

/**
 * Check if the brand attribute is missing or empty from listing data.
 *
 * WHY THIS MATTERS: When brand attribute is absent, Amazon cannot link the listing
 * to Brand Registry. This means catalog contribution rights don't apply and
 * title/display fields won't update in Seller Central even if the PATCH succeeds.
 *
 * @param {Object} listingData - Listing data from GET call
 * @returns {boolean} True if brand attribute is missing or empty
 */
function isBrandAttributeMissing(listingData) {
  const brand = listingData?.attributes?.brand;
  if (!brand || !Array.isArray(brand) || brand.length === 0) return true;
  return !brand[0]?.value || brand[0].value.trim() === '';
}

/**
 * Analyze listing issues and determine fix strategy
 */
function analyzeIssues(listingData, targetAttribute) {
  const issues = listingData?.issues || [];
  const analysis = {
    hasIssues: issues.length > 0,
    catalogConflicts: [],
    validationErrors: [],
    missingAttributes: [],
    canAutoFix: true,
    targetAttributeBlocked: false,
    conflictingAttributes: [],
    requiredAction: null,
    issues: issues,
    catalogConflictAnalysis: analyzeCatalogConflicts(issues),
    amazonValueForTargetAttribute: null,
    // ── NEW: flag whether brand attribute is missing from this listing.
    // When true and brandName is supplied in options, the brand patch will be
    // included automatically in the same PATCH call as the main update.
    missingBrand: isBrandAttributeMissing(listingData)
  };

  for (const issue of issues) {
    const strategy = ISSUE_FIX_STRATEGIES[issue.code];
    
    const conflictMatch = issue.message?.match(/'(\w+)'/g);
    const conflictingAttr = conflictMatch ? conflictMatch[0]?.replace(/'/g, '') : null;
    
    if (strategy === 'CATALOG_CONFLICT') {
      const parsed = parse8541Error(issue);

      analysis.catalogConflicts.push({
        code: issue.code,
        message: issue.message,
        attribute: conflictingAttr,
        severity: issue.severity,
        parsed
      });
      
      if (conflictingAttr) {
        analysis.conflictingAttributes.push(conflictingAttr);
      }
      
      if (targetAttribute) {
        const targetAttrName = ATTRIBUTE_NAMES[targetAttribute] || targetAttribute;
        if (conflictingAttr === targetAttrName || 
            conflictingAttr === targetAttribute ||
            issue.message?.toLowerCase().includes(targetAttrName)) {
          analysis.targetAttributeBlocked = true;

          if (parsed?.amazonValue) {
            analysis.amazonValueForTargetAttribute = {
              value: parsed.amazonValue,
              languageTag: parsed.languageTag,
              attributeName: parsed.attributeName
            };
          }
        }
      }
    } else if (strategy === 'MISSING_ATTRIBUTE') {
      analysis.missingAttributes.push({
        code: issue.code,
        message: issue.message,
        attribute: conflictingAttr
      });
    } else if (strategy === 'INVALID_VALUE') {
      analysis.validationErrors.push({
        code: issue.code,
        message: issue.message,
        attribute: conflictingAttr
      });
    } else if (strategy === 'BRAND_CONFLICT') {
      analysis.canAutoFix = false;
      analysis.requiredAction = 'BRAND_REGISTRY_REQUIRED';
    }
  }

  if (analysis.targetAttributeBlocked) {
    analysis.canAutoFix = false;
    analysis.requiredAction = 'TARGET_ATTRIBUTE_CONFLICT';
  } else if (analysis.catalogConflicts.length > 0 && !analysis.targetAttributeBlocked) {
    analysis.canAutoFix = true;
    analysis.requiredAction = 'PROCEED_WITH_CAUTION';
  }

  return analysis;
}

// ============================================================================
// PATCH BUILDING
// ============================================================================

function extractLanguageTag(listingData, attributeName, marketplaceId) {
  const attributes = listingData?.attributes;
  if (attributes && attributes[attributeName]) {
    const attr = attributes[attributeName];
    if (Array.isArray(attr) && attr.length > 0 && attr[0].language_tag) {
      return attr[0].language_tag;
    }
  }
  return getLanguageTag(marketplaceId);
}

function buildConflictFixPatch(attributeName, amazonValue, marketplaceId, languageTag) {
  const attributePath = `/attributes/${attributeName}`;
  const valueObj = { value: String(amazonValue), marketplace_id: marketplaceId };
  if (requiresLanguageTag(attributeName)) {
    valueObj.language_tag = languageTag;
  }
  return {
    op: 'replace',
    path: attributePath,
    value: [valueObj]
  };
}

/**
 * Build the brand attribute patch.
 * The brandName MUST exactly match Brand Registry enrollment — it is case-sensitive.
 * e.g. "DIRECT FROM FACTORY" not "Direct From Factory"
 *
 * @param {string} brandName - Brand name exactly as enrolled in Brand Registry
 * @param {string} marketplaceId - Marketplace ID
 * @param {string} languageTag - Language tag
 * @returns {Object} Patch operation
 */
function buildBrandPatch(brandName, marketplaceId, languageTag) {
  return {
    op: 'replace',
    path: '/attributes/brand',
    value: [
      {
        value: String(brandName),
        language_tag: languageTag,
        marketplace_id: marketplaceId
      }
    ]
  };
}

function buildPatches(dataType, value, marketplaceId, languageTag) {
  const normalizedType = (dataType || '').toLowerCase();
  const patches = [];
  
  const attributeName = ATTRIBUTE_NAMES[normalizedType] || normalizedType;
  const attributePath = ATTRIBUTE_PATHS[normalizedType] || `/attributes/${attributeName}`;

  if (normalizedType === DATA_TYPES.bulletpoints) {
    const arr = Array.isArray(value) ? value : [value];
    patches.push({
      op: 'replace',
      path: attributePath,
      value: arr.map(v => ({ 
        value: String(v), 
        language_tag: languageTag, 
        marketplace_id: marketplaceId 
      }))
    });
    return patches;
  }

  const specialStructure = SPECIAL_ATTRIBUTE_STRUCTURES[attributeName];
  if (specialStructure) {
    if (typeof value === 'object' && value !== null) {
      patches.push({
        op: 'replace',
        path: attributePath,
        value: [{ ...value, marketplace_id: marketplaceId }]
      });
    } else {
      const valueObj = { value: String(value), marketplace_id: marketplaceId };
      if (requiresLanguageTag(attributeName)) {
        valueObj.language_tag = languageTag;
      }
      patches.push({
        op: 'replace',
        path: attributePath,
        value: [valueObj]
      });
    }
    return patches;
  }

  const valueObj = { value: String(value), marketplace_id: marketplaceId };
  if (requiresLanguageTag(attributeName)) {
    valueObj.language_tag = languageTag;
  }
  
  patches.push({
    op: 'replace',
    path: attributePath,
    value: [valueObj]
  });

  return patches;
}

function getAmazonCatalogValue(catalogData, attributeName, marketplaceId) {
  const attributes = catalogData?.attributes;
  if (!attributes) return null;

  if (attributes[attributeName]) {
    const attr = attributes[attributeName];
    if (Array.isArray(attr) && attr.length > 0) {
      return attr[0].value;
    }
  }

  const summaries = catalogData?.summaries;
  if (summaries && Array.isArray(summaries)) {
    const summary = summaries.find(s => s.marketplaceId === marketplaceId) || summaries[0];
    if (summary) {
      if (attributeName === 'item_name' && summary.itemName) return summary.itemName;
      if (attributeName === 'brand' && summary.brand) return summary.brand;
    }
  }

  return null;
}

function getCurrentAttributeValue(listingData, dataType) {
  const attrName = ATTRIBUTE_NAMES[dataType.toLowerCase()] || dataType.toLowerCase();
  const attrs = listingData?.attributes?.[attrName];
  
  if (!attrs || !Array.isArray(attrs)) return null;
  
  if (dataType.toLowerCase() === DATA_TYPES.bulletpoints) {
    return attrs.map(a => a?.value).filter(Boolean);
  }
  
  return attrs[0]?.value || null;
}

function getBlockedMessage(analysis) {
  if (analysis.requiredAction === 'BRAND_REGISTRY_REQUIRED') {
    return 'This product requires Brand Registry permissions to update catalog data.';
  }
  if (analysis.requiredAction === 'TARGET_ATTRIBUTE_CONFLICT') {
    const conflicts = analysis.catalogConflicts.map(c => c.message).join(' ');
    return `Cannot update: The attribute you want to change conflicts with Amazon's catalog. ${conflicts}`;
  }
  return 'Unable to update this attribute due to catalog restrictions.';
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Main Auto-Fix Function for "Fix It" Button
 * 
 * This function can:
 * 1. Analyze listing issues (analyzeOnly: true)
 * 2. Update a single attribute
 * 3. Fix all catalog conflicts AND update target attribute in ONE call (autoFixConflicts: true)
 * 4. Automatically patch missing brand attribute in the same call (options.brandName)
 * 
 * @param {Object} params
 * @param {string} params.sku - Product SKU
 * @param {string} params.userId - User ID
 * @param {string} params.country - Country code
 * @param {string} params.region - Region (NA/EU/FE)
 * @param {string} [params.sellerId] - Seller ID (optional)
 * @param {string} params.dataToBeUpdated - 'title' | 'description' | 'bulletpoints' | 'size' | 'generic_keyword' | etc.
 * @param {string|string[]} params.valueToBeUpdated - New value
 * @param {Object} [params.options] - Additional options
 * @param {boolean} [params.options.autoMatchCatalog=false] - Auto-match Amazon catalog if conflict on target
 * @param {boolean} [params.options.forceUpdate=false] - Try update even with conflicts
 * @param {boolean} [params.options.analyzeOnly=false] - Only analyze, don't update
 * @param {boolean} [params.options.autoFixConflicts=false] - Auto-fix all catalog conflicts in same call
 * @param {string}  [params.options.brandName] - Brand name EXACTLY as enrolled in Brand Registry
 *                                               (case-sensitive, e.g. "DIRECT FROM FACTORY").
 *                                               When provided and brand is missing from the listing,
 *                                               it is patched in the same PATCH call automatically
 *                                               so Brand Registry catalog authority takes effect.
 * @returns {Promise<Object>} Fix result
 */
async function autoFixListing(params) {
  const { 
    sku, 
    userId, 
    country, 
    region, 
    sellerId, 
    dataToBeUpdated, 
    valueToBeUpdated,
    options = {}
  } = params;

  const {
    autoMatchCatalog = false,
    forceUpdate = false,
    analyzeOnly = false,
    autoFixConflicts = false,
    // ── NEW: brand name exactly as enrolled in Brand Registry (case-sensitive)
    brandName = null
  } = options;

  if (!sku || !userId || !country || !region || !dataToBeUpdated) {
    throw new ApiError(400, 'Missing required parameters');
  }

  logger.info('AutoFixListingService: Starting', { sku, dataToBeUpdated, options });

  const { refreshToken, sellerId: resolvedSellerId, brand: sellerBrand } =
    await getRefreshTokenForSeller(userId, country, region, sellerId);
  const accessToken = await generateAccessToken(userId, refreshToken);
  if (!accessToken) throw new ApiError(500, 'Failed to generate access token');

  const { baseUri, marketplaceId, awsRegion } = getRegionConfig(region, country);
  const credentials = await getTemporaryCredentials(awsRegion);
  if (!credentials?.AccessKey) throw new ApiError(500, 'Failed to get AWS credentials');

  const effectiveSellerId = sellerId || resolvedSellerId;

  // Prefer explicit brandName from options; fall back to seller.brand when available
  const effectiveBrandName = brandName || sellerBrand || null;

  // Step 1: Get current listing data
  let listingData;
  try {
    listingData = await getListingItem(effectiveSellerId, sku, marketplaceId, baseUri, accessToken, credentials, awsRegion);
  } catch (err) {
    const errData = err.response?.data;
    throw new ApiError(err.response?.status || 500, errData?.errors?.[0]?.message || 'Failed to fetch listing');
  }

  const productType = listingData?.summaries?.[0]?.productType;
  const asin = listingData?.summaries?.[0]?.asin;
  
  if (!productType) {
    throw new ApiError(404, 'Product type not found');
  }

  // Step 2: Analyze current issues
  const analysis = analyzeIssues(listingData, dataToBeUpdated);
  
  logger.info('AutoFixListingService: Analysis complete', {
    sku,
    hasIssues: analysis.hasIssues,
    canAutoFix: analysis.canAutoFix,
    targetAttributeBlocked: analysis.targetAttributeBlocked,
    conflictingAttributes: analysis.conflictingAttributes,
    fixableConflicts: analysis.catalogConflictAnalysis.fixableCount,
    amazonValueForTarget: analysis.amazonValueForTargetAttribute?.value ?? null,
    missingBrand: analysis.missingBrand,
    brandWillBePatched: analysis.missingBrand && !!effectiveBrandName
  });

  // If analyze only, return analysis
  if (analyzeOnly) {
    return {
      status: FIX_STATUS.SUCCESS,
      action: 'ANALYSIS_ONLY',
      sku,
      asin,
      productType,
      analysis,
      currentValue: getCurrentAttributeValue(listingData, dataToBeUpdated),
      canUpdate: analysis.canAutoFix,
      catalogConflicts: analysis.catalogConflictAnalysis,
      // ── NEW: surface brand warning so caller knows what to pass
      brandWarning: analysis.missingBrand
        ? 'Brand attribute is missing. Title and other attributes may not update in Seller Central display even if PATCH succeeds. If seller.brand is set we will use that; otherwise pass options.brandName (exactly as in Brand Registry) to fix automatically.'
        : null,
      message: analysis.canAutoFix 
        ? 'Attribute can be updated' 
        : getBlockedMessage(analysis)
    };
  }

  // Step 3: Handle blocked target attribute (without autoFixConflicts)
  if (analysis.targetAttributeBlocked && !forceUpdate && !autoFixConflicts) {
    if (autoMatchCatalog && asin) {
      try {
        const catalogData = await getCatalogItem(asin, marketplaceId, baseUri, accessToken, credentials, awsRegion);
        const attrName = ATTRIBUTE_NAMES[dataToBeUpdated] || dataToBeUpdated;
        const catalogValue = getAmazonCatalogValue(catalogData, attrName, marketplaceId);
        
        if (catalogValue) {
          return {
            status: FIX_STATUS.CONFLICT_RESOLVED,
            action: 'CATALOG_VALUE_AVAILABLE',
            sku,
            asin,
            productType,
            analysis,
            userRequestedValue: valueToBeUpdated,
            amazonCatalogValue: catalogValue,
            message: `Your requested value conflicts with Amazon catalog. Amazon's value: "${catalogValue}". Use this value or contact Brand Registry support.`,
            suggestedFix: { useAmazonValue: true, value: catalogValue },
            canProceedWithAmazonValue: true
          };
        }
      } catch (catalogErr) {
        logger.warn('AutoFixListingService: Could not fetch catalog data', { asin, error: catalogErr.message });
      }
    }

    return {
      status: FIX_STATUS.CANNOT_FIX,
      action: 'BLOCKED_BY_CATALOG',
      sku,
      asin,
      productType,
      analysis,
      catalogConflicts: analysis.catalogConflictAnalysis,
      message: getBlockedMessage(analysis),
      possibleSolutions: [
        'Enable autoFixConflicts option to fix all conflicts automatically',
        'Register your brand with Amazon Brand Registry to gain catalog update permissions (and set seller.brand in Seller model)',
        'Contact Seller Support to request a catalog update'
      ]
    };
  }

  // Step 4: Prepare for update
  if (valueToBeUpdated === undefined) {
    throw new ApiError(400, 'valueToBeUpdated is required for update operation');
  }

  const attrName = ATTRIBUTE_NAMES[dataToBeUpdated] || dataToBeUpdated;
  const languageTag = extractLanguageTag(listingData, attrName, marketplaceId);

  let finalValue = valueToBeUpdated;
  if (dataToBeUpdated.toLowerCase() === DATA_TYPES.bulletpoints && 
      valueToBeUpdated && 
      typeof valueToBeUpdated === 'object' && 
      !Array.isArray(valueToBeUpdated)) {
    const { index, value } = valueToBeUpdated;
    if (typeof index !== 'number' || index < 0 || value === undefined) {
      throw new ApiError(400, 'For partial bullet update, use { index: number, value: string }');
    }
    const currentBullets = listingData?.attributes?.bullet_point || [];
    const bulletValues = currentBullets.map(b => b?.value ?? '');
    while (bulletValues.length <= index) bulletValues.push('');
    bulletValues[index] = String(value);
    finalValue = bulletValues;
  }

  // Step 5: Build ALL patches in ONE array
  const allPatches = [];
  const fixedConflicts = [];
  let targetAttributeHandledByConflictFix = false;
  let amazonValueUsedForTarget = null;

  // ── NEW 5a: Patch brand attribute FIRST if it is missing AND brandName was provided.
  //    Done first so Amazon links the listing to Brand Registry before processing
  //    the rest of the patches in the same call.
  let brandWasPatched = false;
  if (analysis.missingBrand && effectiveBrandName) {
    const brandLanguageTag = getLanguageTag(marketplaceId);
    allPatches.push(buildBrandPatch(effectiveBrandName, marketplaceId, brandLanguageTag));
    brandWasPatched = true;
    logger.info('AutoFixListingService: Adding brand patch — brand attribute was missing', {
      brandName: effectiveBrandName,
      marketplaceId,
      languageTag: brandLanguageTag
    });
  } else if (analysis.missingBrand && !effectiveBrandName) {
    logger.warn(
      'AutoFixListingService: Brand attribute is missing and neither options.brandName nor seller.brand are set. ' +
      'Title/display changes may not reflect in Seller Central until brand is set. ' +
      'Pass options.brandName to fix automatically.',
      { sku }
    );
  }

  // 5b: Add conflict fix patches if autoFixConflicts is enabled
  if (autoFixConflicts && analysis.catalogConflictAnalysis.fixableCount > 0) {
    for (const conflict of analysis.catalogConflictAnalysis.conflicts) {
      const { attributeName, amazonValue, merchantValue, languageTag: conflictLangTag } = conflict;
      
      if (!amazonValue) continue;

      const targetAttrName = ATTRIBUTE_NAMES[dataToBeUpdated] || dataToBeUpdated;

      if (attributeName === targetAttrName) {
        // Conflict is on the SAME attribute the user wants to update.
        // Use Amazon's catalog value — sending user's value would cause an 8541 loop.
        const existingAttr = listingData?.attributes?.[attributeName];
        const resolvedLanguageTag =
          existingAttr?.[0]?.language_tag || conflictLangTag || getLanguageTag(marketplaceId);

        allPatches.push(buildConflictFixPatch(attributeName, amazonValue, marketplaceId, resolvedLanguageTag));

        targetAttributeHandledByConflictFix = true;
        amazonValueUsedForTarget = amazonValue;

        fixedConflicts.push({
          attribute: attributeName,
          oldValue: merchantValue,
          newValue: amazonValue,
          languageTag: resolvedLanguageTag,
          note: 'Conflict was on target attribute — Amazon catalog value applied instead of user-supplied value'
        });

        logger.info('AutoFixListingService: Conflict is on target attribute — using Amazon catalog value', {
          attributeName,
          userRequestedValue: finalValue,
          amazonValueApplied: amazonValue
        });

        continue;
      }
      
      const existingAttr = listingData?.attributes?.[attributeName];
      const conflictLanguageTag =
        existingAttr?.[0]?.language_tag || conflictLangTag || getLanguageTag(marketplaceId);

      allPatches.push(buildConflictFixPatch(attributeName, amazonValue, marketplaceId, conflictLanguageTag));
      fixedConflicts.push({
        attribute: attributeName,
        oldValue: merchantValue,
        newValue: amazonValue,
        languageTag: conflictLanguageTag
      });
    }
    
    logger.info('AutoFixListingService: Added conflict fix patches', { 
      count: fixedConflicts.length,
      conflicts: fixedConflicts.map(c => c.attribute),
      targetAttributeHandledByConflictFix
    });
  }

  // 5c: Add target attribute patch ONLY if not already handled by a conflict fix
  if (!targetAttributeHandledByConflictFix) {
    const targetPatches = buildPatches(dataToBeUpdated, finalValue, marketplaceId, languageTag);
    allPatches.push(...targetPatches);
  }

  logger.info('AutoFixListingService: Total patches to apply', { 
    total: allPatches.length,
    brandPatched: brandWasPatched,
    conflictFixes: fixedConflicts.length,
    targetAttribute: dataToBeUpdated,
    targetHandledViaConflictFix: targetAttributeHandledByConflictFix
  });

  // Step 6: Execute SINGLE PATCH with all operations
  try {
    const patchResult = await patchListingItem(
      effectiveSellerId, sku, marketplaceId, baseUri,
      accessToken, credentials, awsRegion, productType, allPatches
    );

    const responseIssues = patchResult?.issues || [];
    const hasResponseConflicts = responseIssues.some(i => CATALOG_CONFLICT_CODES.includes(i.code));

    if (hasResponseConflicts) {
      return {
        status: FIX_STATUS.PARTIAL_SUCCESS,
        action: 'UPDATE_SUBMITTED_WITH_WARNINGS',
        sku,
        asin,
        productType,
        data: patchResult,
        issues: responseIssues,
        updatedAttribute: dataToBeUpdated,
        newValue: targetAttributeHandledByConflictFix ? amazonValueUsedForTarget : finalValue,
        fixedConflicts: fixedConflicts.length > 0 ? fixedConflicts : undefined,
        brandPatched: brandWasPatched ? effectiveBrandName : undefined,
        message: 'Update submitted but may not take effect due to catalog restrictions.',
        warning: true
      };
    }

    logger.info('AutoFixListingService: Update successful', { 
      sku, 
      dataToBeUpdated,
      conflictsFixed: fixedConflicts.length,
      usedAmazonValueForTarget: targetAttributeHandledByConflictFix,
      brandPatched: brandWasPatched
    });

    let successMessage = `Successfully updated ${dataToBeUpdated}`;
    if (brandWasPatched) {
      successMessage += ` and set brand to "${effectiveBrandName}"`;
    }
    if (targetAttributeHandledByConflictFix) {
      successMessage += ` using Amazon's catalog value (your value conflicted with the catalog)`;
    }
    if (fixedConflicts.length > 0) {
      const otherConflicts = fixedConflicts.filter(c => c.attribute !== attrName);
      if (otherConflicts.length > 0) {
        successMessage += ` and fixed ${otherConflicts.length} additional catalog conflict(s)`;
      }
    }

    const action = targetAttributeHandledByConflictFix
      ? 'AMAZON_VALUE_USED'
      : fixedConflicts.length > 0
        ? 'UPDATED_AND_CONFLICTS_FIXED'
        : 'UPDATED';

    return {
      status: FIX_STATUS.SUCCESS,
      action,
      sku,
      asin,
      productType,
      data: patchResult,
      updatedAttribute: dataToBeUpdated,
      newValue: targetAttributeHandledByConflictFix ? amazonValueUsedForTarget : finalValue,
      ...(targetAttributeHandledByConflictFix && {
        userRequestedValue: finalValue,
        amazonValueApplied: amazonValueUsedForTarget,
        notice: `Your requested value for '${dataToBeUpdated}' conflicts with Amazon's catalog. Amazon's catalog value was applied instead. To use your own value, register your brand via Amazon Brand Registry or raise a Seller Support case.`
      }),
      // ── NEW: surface brand patch result to caller
      ...(brandWasPatched && {
        brandPatched: effectiveBrandName,
        brandNote: 'Brand attribute was missing and has been set. Amazon should now link this listing to your Brand Registry enrollment, allowing display attributes to update correctly.'
      }),
      fixedConflicts: fixedConflicts.length > 0 ? fixedConflicts : undefined,
      message: successMessage
    };

  } catch (err) {
    const errStatus = err.response?.status;
    const errData = err.response?.data;
    
    logger.error('AutoFixListingService: Update failed', {
      sku,
      status: errStatus,
      error: errData || err.message
    });

    const errIssues = errData?.issues || errData?.errors || [];
    const isCatalogConflict = errIssues.some(i => CATALOG_CONFLICT_CODES.includes(i.code));

    if (isCatalogConflict) {
      return {
        status: FIX_STATUS.CANNOT_FIX,
        action: 'CATALOG_CONFLICT_ERROR',
        sku,
        asin,
        productType,
        issues: errIssues,
        message: 'Cannot update: Catalog data conflict. You do not have permission to modify this attribute.',
        possibleSolutions: [
          'Register your brand with Amazon Brand Registry',
          'Contact Seller Support for catalog corrections',
          'Accept Amazon\'s existing catalog values'
        ]
      };
    }

    throw new ApiError(
      errStatus || 500,
      errData?.errors?.[0]?.message || errData?.message || err.message || 'Update failed'
    );
  }
}

/**
 * Ensure brand attribute is set on a listing.
 * Use this as a standalone call when you just want to set/fix the brand
 * without updating any other attribute.
 *
 * WHY THIS MATTERS: When brand attribute is missing, Amazon cannot link the
 * listing to Brand Registry. This means catalog contribution rights don't apply
 * and title/display fields won't update in Seller Central even though the PATCH
 * succeeds at the attributes level.
 *
 * @param {Object} params
 * @param {string} params.sku - Product SKU
 * @param {string} params.userId - User ID
 * @param {string} params.country - Country code
 * @param {string} params.region - Region (NA/EU/FE)
 * @param {string} [params.sellerId] - Seller ID
 * @param {string} params.brandName - Brand name EXACTLY as enrolled in Brand Registry (case-sensitive)
 * @param {boolean} [params.forceUpdate=false] - Overwrite brand even if one already exists
 * @returns {Promise<Object>} Fix result
 */
async function ensureBrandAttribute(params) {
  const { sku, userId, country, region, sellerId, brandName, forceUpdate = false } = params;

  if (!brandName) {
    throw new ApiError(400, 'brandName is required and must exactly match your Brand Registry enrollment');
  }

  logger.info('EnsureBrandAttribute: Starting', { sku, brandName, forceUpdate });

  const { refreshToken, sellerId: resolvedSellerId } = await getRefreshTokenForSeller(userId, country, region, sellerId);
  const accessToken = await generateAccessToken(userId, refreshToken);
  if (!accessToken) throw new ApiError(500, 'Failed to generate access token');

  const { baseUri, marketplaceId, awsRegion } = getRegionConfig(region, country);
  const credentials = await getTemporaryCredentials(awsRegion);
  if (!credentials?.AccessKey) throw new ApiError(500, 'Failed to get AWS credentials');

  const effectiveSellerId = sellerId || resolvedSellerId;

  let listingData;
  try {
    listingData = await getListingItem(effectiveSellerId, sku, marketplaceId, baseUri, accessToken, credentials, awsRegion);
  } catch (err) {
    const errData = err.response?.data;
    throw new ApiError(err.response?.status || 500, errData?.errors?.[0]?.message || 'Failed to fetch listing');
  }

  const productType = listingData?.summaries?.[0]?.productType;
  const asin = listingData?.summaries?.[0]?.asin;
  if (!productType) throw new ApiError(404, 'Product type not found');

  const missing = isBrandAttributeMissing(listingData);
  const currentBrand = listingData?.attributes?.brand?.[0]?.value || null;

  // Brand already set to the correct value — nothing to do
  if (!missing && !forceUpdate) {
    if (currentBrand === brandName) {
      return {
        status: FIX_STATUS.SUCCESS,
        action: 'BRAND_ALREADY_SET',
        message: `Brand is already set to "${brandName}". No update needed.`,
        sku,
        asin,
        productType,
        currentBrand
      };
    }
    // Brand exists but is different value — require explicit forceUpdate
    return {
      status: FIX_STATUS.REQUIRES_MANUAL,
      action: 'BRAND_MISMATCH',
      message: `Brand is currently "${currentBrand}" which differs from "${brandName}". Pass forceUpdate: true to overwrite.`,
      sku,
      asin,
      productType,
      currentBrand,
      requestedBrand: brandName
    };
  }

  const languageTag = getLanguageTag(marketplaceId);
  const patch = buildBrandPatch(brandName, marketplaceId, languageTag);

  try {
    const patchResult = await patchListingItem(
      effectiveSellerId, sku, marketplaceId, baseUri,
      accessToken, credentials, awsRegion, productType, [patch]
    );

    const responseIssues = patchResult?.issues || [];
    logger.info('EnsureBrandAttribute: Success', { sku, brandName });

    return {
      status: FIX_STATUS.SUCCESS,
      action: 'BRAND_SET',
      message: `Brand attribute successfully set to "${brandName}". Amazon should now link this listing to your Brand Registry enrollment.`,
      sku,
      asin,
      productType,
      previousBrand: currentBrand,
      newBrand: brandName,
      data: patchResult,
      issues: responseIssues.length > 0 ? responseIssues : undefined
    };
  } catch (err) {
    const errData = err.response?.data;
    logger.error('EnsureBrandAttribute: Failed', { sku, brandName, error: errData || err.message });
    throw new ApiError(
      err.response?.status || 500,
      errData?.errors?.[0]?.message || `Failed to set brand attribute`
    );
  }
}

/**
 * Auto-fix all catalog conflicts only
 */
async function autoFixCatalogConflicts(params) {
  const { sku, userId, country, region, sellerId, dryRun = false } = params;

  logger.info('AutoFixCatalogConflicts: Starting', { sku, dryRun });

  const { refreshToken, sellerId: resolvedSellerId } = await getRefreshTokenForSeller(userId, country, region, sellerId);
  const accessToken = await generateAccessToken(userId, refreshToken);
  if (!accessToken) throw new ApiError(500, 'Failed to generate access token');

  const { baseUri, marketplaceId, awsRegion } = getRegionConfig(region, country);
  const credentials = await getTemporaryCredentials(awsRegion);
  if (!credentials?.AccessKey) throw new ApiError(500, 'Failed to get AWS credentials');

  const effectiveSellerId = sellerId || resolvedSellerId;

  let listingData;
  try {
    listingData = await getListingItem(effectiveSellerId, sku, marketplaceId, baseUri, accessToken, credentials, awsRegion);
  } catch (err) {
    const errData = err.response?.data;
    throw new ApiError(err.response?.status || 500, errData?.errors?.[0]?.message || 'Failed to fetch listing');
  }

  const productType = listingData?.summaries?.[0]?.productType;
  const asin = listingData?.summaries?.[0]?.asin;
  if (!productType) throw new ApiError(404, 'Product type not found');

  const issues = listingData?.issues || [];
  const conflictAnalysis = analyzeCatalogConflicts(issues);

  if (!conflictAnalysis.hasConflicts) {
    return {
      status: FIX_STATUS.NO_CONFLICTS,
      action: 'NO_ACTION_NEEDED',
      message: 'No catalog conflicts found for this listing',
      sku, asin, productType
    };
  }

  if (conflictAnalysis.fixableCount === 0) {
    return {
      status: FIX_STATUS.CANNOT_FIX,
      action: 'MANUAL_FIX_REQUIRED',
      message: 'Conflicts found but cannot be auto-fixed. Amazon\'s expected values could not be determined.',
      sku, asin, productType,
      conflicts: conflictAnalysis.unfixableConflicts,
      possibleSolutions: [
        'Review the error messages and manually update the conflicting attributes',
        'Contact Seller Support to clarify the expected values'
      ]
    };
  }

  const patches = [];
  const fixedAttributes = [];

  for (const conflict of conflictAnalysis.conflicts) {
    const { attributeName, amazonValue, merchantValue, languageTag: conflictLangTag } = conflict;
    if (!amazonValue) continue;
    const existingAttr = listingData?.attributes?.[attributeName];
    const languageTag = existingAttr?.[0]?.language_tag || conflictLangTag || getLanguageTag(marketplaceId);
    patches.push(buildConflictFixPatch(attributeName, amazonValue, marketplaceId, languageTag));
    fixedAttributes.push({ attribute: attributeName, oldValue: merchantValue, newValue: amazonValue, languageTag });
  }

  if (dryRun) {
    return {
      status: FIX_STATUS.SUCCESS,
      action: 'DRY_RUN_ANALYSIS',
      message: `Found ${fixedAttributes.length} conflict(s) that can be auto-fixed`,
      sku, asin, productType,
      wouldFix: fixedAttributes,
      unfixable: conflictAnalysis.unfixableConflicts
    };
  }

  if (patches.length === 0) {
    return {
      status: FIX_STATUS.CANNOT_FIX,
      action: 'NO_FIXABLE_CONFLICTS',
      message: 'No conflicts could be auto-fixed',
      sku, asin, productType
    };
  }

  try {
    const patchResult = await patchListingItem(
      effectiveSellerId, sku, marketplaceId, baseUri,
      accessToken, credentials, awsRegion, productType, patches
    );

    const responseIssues = patchResult?.issues || [];
    const hasNewIssues = responseIssues.length > 0;

    logger.info('AutoFixCatalogConflicts: Completed', { sku, fixedCount: fixedAttributes.length, hasNewIssues });

    return {
      status: hasNewIssues ? FIX_STATUS.PARTIAL_SUCCESS : FIX_STATUS.SUCCESS,
      action: 'CONFLICTS_FIXED',
      message: hasNewIssues 
        ? `Fixed ${fixedAttributes.length} conflict(s) but new issues were reported`
        : `Successfully fixed ${fixedAttributes.length} catalog conflict(s)`,
      sku, asin, productType,
      fixedAttributes,
      data: patchResult,
      newIssues: hasNewIssues ? responseIssues : undefined
    };
  } catch (err) {
    const errData = err.response?.data;
    logger.error('AutoFixCatalogConflicts: Failed', { sku, error: errData || err.message });
    throw new ApiError(
      err.response?.status || 500,
      errData?.errors?.[0]?.message || 'Failed to fix catalog conflicts'
    );
  }
}

/**
 * Fix a single specific attribute
 */
async function fixSingleAttribute(params) {
  const { sku, userId, country, region, sellerId, attributeName, newValue } = params;

  if (!attributeName || newValue === undefined) {
    throw new ApiError(400, 'attributeName and newValue are required');
  }

  logger.info('FixSingleAttribute: Starting', { sku, attributeName });

  const { refreshToken, sellerId: resolvedSellerId } = await getRefreshTokenForSeller(userId, country, region, sellerId);
  const accessToken = await generateAccessToken(userId, refreshToken);
  if (!accessToken) throw new ApiError(500, 'Failed to generate access token');

  const { baseUri, marketplaceId, awsRegion } = getRegionConfig(region, country);
  const credentials = await getTemporaryCredentials(awsRegion);
  if (!credentials?.AccessKey) throw new ApiError(500, 'Failed to get AWS credentials');

  const effectiveSellerId = sellerId || resolvedSellerId;

  let listingData;
  try {
    listingData = await getListingItem(effectiveSellerId, sku, marketplaceId, baseUri, accessToken, credentials, awsRegion);
  } catch (err) {
    const errData = err.response?.data;
    throw new ApiError(err.response?.status || 500, errData?.errors?.[0]?.message || 'Failed to fetch listing');
  }

  const productType = listingData?.summaries?.[0]?.productType;
  const asin = listingData?.summaries?.[0]?.asin;
  if (!productType) throw new ApiError(404, 'Product type not found');

  const languageTag = extractLanguageTag(listingData, attributeName, marketplaceId);
  const patch = buildConflictFixPatch(attributeName, newValue, marketplaceId, languageTag);

  try {
    const patchResult = await patchListingItem(
      effectiveSellerId, sku, marketplaceId, baseUri,
      accessToken, credentials, awsRegion, productType, [patch]
    );

    logger.info('FixSingleAttribute: Success', { sku, attributeName });

    return {
      status: FIX_STATUS.SUCCESS,
      action: 'ATTRIBUTE_FIXED',
      message: `Successfully updated '${attributeName}'`,
      sku, asin, productType,
      fixedAttribute: { attribute: attributeName, newValue },
      data: patchResult
    };
  } catch (err) {
    const errData = err.response?.data;
    logger.error('FixSingleAttribute: Failed', { sku, attributeName, error: errData || err.message });
    throw new ApiError(
      err.response?.status || 500,
      errData?.errors?.[0]?.message || `Failed to update '${attributeName}'`
    );
  }
}

/**
 * Batch analyze multiple SKUs
 */
async function batchAnalyze(params) {
  const { skus, userId, country, region, dataToBeUpdated } = params;
  const results = [];
  
  for (const sku of skus) {
    try {
      const result = await autoFixListing({
        sku, userId, country, region, dataToBeUpdated,
        options: { analyzeOnly: true }
      });
      results.push({ sku, ...result });
    } catch (err) {
      results.push({ sku, status: FIX_STATUS.ERROR, error: err.message });
    }
  }
  
  return {
    total: skus.length,
    canFix: results.filter(r => r.canUpdate).length,
    cannotFix: results.filter(r => !r.canUpdate && r.status !== FIX_STATUS.ERROR).length,
    errors: results.filter(r => r.status === FIX_STATUS.ERROR).length,
    results
  };
}

/**
 * Apply fix using Amazon's catalog value
 */
async function applyAmazonCatalogValue(params) {
  const { sku, userId, country, region, sellerId, dataToBeUpdated, catalogValue } = params;
  return autoFixListing({
    sku, userId, country, region, sellerId,
    dataToBeUpdated,
    valueToBeUpdated: catalogValue,
    options: { forceUpdate: true }
  });
}

/**
 * Simple update product content with auto-fix conflicts enabled by default.
 * Pass options.brandName to also fix a missing brand attribute in the same call.
 */
async function updateProductContent(params) {
  const { options = {}, ...rest } = params;
  return autoFixListing({
    ...rest,
    options: {
      autoFixConflicts: true,
      ...options
    }
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Main functions
  updateProductContent,
  autoFixListing,
  autoFixCatalogConflicts,
  fixSingleAttribute,
  ensureBrandAttribute,         // ── NEW: standalone brand setter

  // Batch operations
  batchAnalyze,
  
  // Utility functions
  applyAmazonCatalogValue,
  analyzeIssues,
  analyzeCatalogConflicts,
  parse8541Error,
  getLanguageTag,
  getCurrentAttributeValue,
  buildPatches,
  buildConflictFixPatch,
  buildBrandPatch,              // ── NEW
  extractLanguageTag,
  isBrandAttributeMissing,      // ── NEW
  
  // Constants
  FIX_STATUS,
  DATA_TYPES,
  ATTRIBUTE_PATHS,
  ATTRIBUTE_NAMES,
  MARKETPLACE_LANGUAGE_MAP,
  ATTRIBUTES_REQUIRING_LANGUAGE_TAG,
  CATALOG_CONFLICT_CODES
};