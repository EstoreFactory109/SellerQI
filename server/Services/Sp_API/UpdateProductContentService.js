/**
 * AutoFixListingService
 * Automatically analyzes and fixes listing issues for the "Fix It" button feature.
 * Handles catalog conflicts, validation errors, and attribute updates intelligently.
 * 
 * KEY FEATURE: Single PATCH call can fix all catalog conflicts (8541/8542/8543) 
 * AND update target attribute simultaneously using autoFixConflicts option.
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
  // Additional attribute types for catalog conflict fixes
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
  unit_count: 'unit_count'
});

/** Attribute paths for PATCH operations */
const ATTRIBUTE_PATHS = Object.freeze({
  title: '/attributes/item_name',
  description: '/attributes/product_description',
  bulletpoints: '/attributes/bullet_point',
  // Additional attribute paths
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
  unit_count: '/attributes/unit_count'
});

/** Attribute names in listing data */
const ATTRIBUTE_NAMES = Object.freeze({
  title: 'item_name',
  description: 'product_description',
  bulletpoints: 'bullet_point',
  // Additional attribute names
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
  unit_count: 'unit_count'
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
  'pattern'
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
 * @param {string} marketplaceId - Amazon marketplace ID
 * @returns {string} Language tag (e.g., 'en_US', 'en_AU')
 */
function getLanguageTag(marketplaceId) {
  return MARKETPLACE_LANGUAGE_MAP[marketplaceId] || 'en_US';
}

/**
 * Check if an attribute requires language_tag
 * @param {string} attributeName - Attribute name
 * @returns {boolean}
 */
function requiresLanguageTag(attributeName) {
  return ATTRIBUTES_REQUIRING_LANGUAGE_TAG.includes(attributeName);
}

/**
 * Resolve base URI, marketplace ID, and AWS region from region/country
 * @param {string} region - Region code (NA/EU/FE)
 * @param {string} country - Country code (US/AU/UK/etc)
 * @returns {Object} { baseUri, marketplaceId, awsRegion }
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
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @param {string} [sellerId] - Optional seller ID
 * @returns {Promise<Object>} { refreshToken, sellerId }
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
  return { refreshToken: account.spiRefreshToken, sellerId: account.selling_partner_id };
}

/**
 * Sign request with AWS SigV4
 * @param {string} host - API host
 * @param {string} path - Request path
 * @param {string} method - HTTP method
 * @param {string} accessToken - SP-API access token
 * @param {Object} credentials - AWS credentials
 * @param {string} awsRegion - AWS region
 * @param {Object|string} [body] - Request body
 * @returns {Object} Signed request
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

/**
 * GET listing item with all available data
 * @param {string} sellerId - Seller ID
 * @param {string} sku - Product SKU
 * @param {string} marketplaceId - Marketplace ID
 * @param {string} baseUri - API base URI
 * @param {string} accessToken - Access token
 * @param {Object} credentials - AWS credentials
 * @param {string} awsRegion - AWS region
 * @returns {Promise<Object>} Listing data
 */
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

/**
 * PATCH listing item
 * @param {string} sellerId - Seller ID
 * @param {string} sku - Product SKU
 * @param {string} marketplaceId - Marketplace ID
 * @param {string} baseUri - API base URI
 * @param {string} accessToken - Access token
 * @param {Object} credentials - AWS credentials
 * @param {string} awsRegion - AWS region
 * @param {string} productType - Product type
 * @param {Array} patches - Array of patch operations
 * @returns {Promise<Object>} Patch result
 */
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

/**
 * GET catalog item to fetch Amazon's authoritative data
 * @param {string} asin - ASIN
 * @param {string} marketplaceId - Marketplace ID
 * @param {string} baseUri - API base URI
 * @param {string} accessToken - Access token
 * @param {Object} credentials - AWS credentials
 * @param {string} awsRegion - AWS region
 * @returns {Promise<Object>} Catalog data
 */
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

/**
 * Parse 8541/8542/8543 error to extract conflicting attribute and Amazon's expected value
 * @param {Object} issue - The issue object from SP-API response
 * @returns {Object|null} Parsed conflict info or null
 */
function parse8541Error(issue) {
  if (!issue || !CATALOG_CONFLICT_CODES.includes(issue.code)) {
    return null;
  }
  
  const message = issue.message || '';
  
  // Extract attribute name: 'size' or 'item_name' etc.
  // Pattern: "attribute value(s) conflict with Amazon catalogue value(s): 'size'"
  const attrMatch = message.match(/(?:attribute value\(s\) conflict|following listing attribute).*?'(\w+)'/i);
  const attributeName = attrMatch ? attrMatch[1] : null;
  
  // Extract Amazon's value: Amazon [en_AU: "1 Count (Pack of 1)"]
  const amazonValueMatch = message.match(/Amazon\s*\[[\w_]+:\s*"([^"]+)"\]/i);
  const amazonValue = amazonValueMatch ? amazonValueMatch[1] : null;
  
  // Extract Merchant's value: Merchant [en_AU: "0.5mm"]
  const merchantValueMatch = message.match(/Merchant\s*\[[\w_]+:\s*"([^"]+)"\]/i);
  const merchantValue = merchantValueMatch ? merchantValueMatch[1] : null;
  
  // Extract language tag from the message if present
  const languageTagMatch = message.match(/\[([\w_]+):\s*"/i);
  const languageTag = languageTagMatch ? languageTagMatch[1] : null;
  
  // Extract ASIN
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
    canAutoFix: !!amazonValue, // Can only auto-fix if we know Amazon's value
    rawMessage: message,
    fixAction: amazonValue 
      ? `Update '${attributeName}' from "${merchantValue || 'current value'}" to "${amazonValue}"`
      : `Cannot auto-fix: Amazon's expected value not found in error message`
  };
}

/**
 * Analyze all 8541/8542/8543 errors and return fixable conflicts
 * @param {Array} issues - Array of issues from listing data
 * @returns {Object} Analysis result with conflicts
 */
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
        // Could not parse, add as unfixable
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
 * Analyze listing issues and determine fix strategy
 * @param {Object} listingData - Listing data from GET call
 * @param {string} [targetAttribute] - Attribute user wants to update
 * @returns {Object} Analysis result
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
    // Add catalog conflict analysis
    catalogConflictAnalysis: analyzeCatalogConflicts(issues),
    // ── NEW: Amazon's value for the target attribute if a conflict exists on it
    amazonValueForTargetAttribute: null
  };

  for (const issue of issues) {
    const strategy = ISSUE_FIX_STRATEGIES[issue.code];
    
    // Parse which attribute is conflicting from the message
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
      
      // Check if the conflict is on the attribute user wants to update
      if (targetAttribute) {
        const targetAttrName = ATTRIBUTE_NAMES[targetAttribute] || targetAttribute;
        if (conflictingAttr === targetAttrName || 
            conflictingAttr === targetAttribute ||
            issue.message?.toLowerCase().includes(targetAttrName)) {
          analysis.targetAttributeBlocked = true;

          // ── NEW: Capture Amazon's expected value so autoFixConflicts can use it
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

  // Determine if we can auto-fix
  if (analysis.targetAttributeBlocked) {
    analysis.canAutoFix = false;
    analysis.requiredAction = 'TARGET_ATTRIBUTE_CONFLICT';
  } else if (analysis.catalogConflicts.length > 0 && !analysis.targetAttributeBlocked) {
    // Conflict exists but NOT on the target attribute - we can try to update
    analysis.canAutoFix = true;
    analysis.requiredAction = 'PROCEED_WITH_CAUTION';
  }

  return analysis;
}

// ============================================================================
// PATCH BUILDING
// ============================================================================

/**
 * Extract language tag from existing listing data
 * @param {Object} listingData - Listing data
 * @param {string} attributeName - Attribute name
 * @param {string} marketplaceId - Marketplace ID
 * @returns {string} Language tag
 */
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

/**
 * Build a patch for a specific attribute with its Amazon catalog value
 * Used to fix individual conflicting attributes
 * @param {string} attributeName - Attribute name (e.g., 'size', 'color')
 * @param {string} amazonValue - Amazon's catalog value
 * @param {string} marketplaceId - Marketplace ID
 * @param {string} languageTag - Language tag
 * @returns {Object} Patch operation
 */
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
 * Build patches for the update - supports both simple and complex attribute types
 * @param {string} dataType - Data type (title, description, bulletpoints, size, etc.)
 * @param {string|string[]} value - Value to set
 * @param {string} marketplaceId - Marketplace ID
 * @param {string} languageTag - Language tag
 * @returns {Array} Array of patch operations
 */
function buildPatches(dataType, value, marketplaceId, languageTag) {
  const normalizedType = (dataType || '').toLowerCase();
  const patches = [];
  
  // Get attribute name - check if it's a known type or use as-is (for dynamic attributes)
  const attributeName = ATTRIBUTE_NAMES[normalizedType] || normalizedType;
  const attributePath = ATTRIBUTE_PATHS[normalizedType] || `/attributes/${attributeName}`;

  // Handle bullet points specially (array of values)
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

  // Handle special attribute structures (weight, unit_count, etc.)
  const specialStructure = SPECIAL_ATTRIBUTE_STRUCTURES[attributeName];
  if (specialStructure) {
    // For special attributes, try to preserve existing structure or use value as-is
    if (typeof value === 'object' && value !== null) {
      patches.push({
        op: 'replace',
        path: attributePath,
        value: [{ ...value, marketplace_id: marketplaceId }]
      });
    } else {
      // Simple value - wrap appropriately
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

  // Standard text attributes
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

/**
 * Get Amazon's catalog value for an attribute (to match if needed)
 * @param {Object} catalogData - Catalog data from getCatalogItem
 * @param {string} attributeName - Attribute name
 * @param {string} marketplaceId - Marketplace ID
 * @returns {string|null} Catalog value or null
 */
function getAmazonCatalogValue(catalogData, attributeName, marketplaceId) {
  const attributes = catalogData?.attributes;
  if (!attributes) return null;

  // Try direct attribute name
  if (attributes[attributeName]) {
    const attr = attributes[attributeName];
    if (Array.isArray(attr) && attr.length > 0) {
      return attr[0].value;
    }
  }

  // Try summaries for common attributes
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

/**
 * Get current value of an attribute from listing data
 * @param {Object} listingData - Listing data
 * @param {string} dataType - Data type
 * @returns {string|string[]|null} Current value
 */
function getCurrentAttributeValue(listingData, dataType) {
  const attrName = ATTRIBUTE_NAMES[dataType.toLowerCase()] || dataType.toLowerCase();
  const attrs = listingData?.attributes?.[attrName];
  
  if (!attrs || !Array.isArray(attrs)) return null;
  
  if (dataType.toLowerCase() === DATA_TYPES.bulletpoints) {
    return attrs.map(a => a?.value).filter(Boolean);
  }
  
  return attrs[0]?.value || null;
}

/**
 * Get user-friendly message for blocked updates
 * @param {Object} analysis - Analysis result
 * @returns {string} User-friendly message
 */
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
 * 
 * FIX: When the conflict is on the target attribute itself and autoFixConflicts is true,
 * Amazon's catalog value (extracted directly from the 8541 error message) is now used
 * for that attribute instead of silently skipping it and sending the user's value —
 * which was the root cause of the title not updating.
 * 
 * @param {Object} params
 * @param {string} params.sku - Product SKU
 * @param {string} params.userId - User ID
 * @param {string} params.country - Country code
 * @param {string} params.region - Region (NA/EU/FE)
 * @param {string} [params.sellerId] - Seller ID (optional)
 * @param {string} params.dataToBeUpdated - 'title' | 'description' | 'bulletpoints' | 'size' | etc.
 * @param {string|string[]} params.valueToBeUpdated - New value
 * @param {Object} [params.options] - Additional options
 * @param {boolean} [params.options.autoMatchCatalog=false] - Auto-match Amazon catalog if conflict on target
 * @param {boolean} [params.options.forceUpdate=false] - Try update even with conflicts
 * @param {boolean} [params.options.analyzeOnly=false] - Only analyze, don't update
 * @param {boolean} [params.options.autoFixConflicts=false] - Auto-fix all catalog conflicts in same call
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
    autoFixConflicts = false
  } = options;

  // Validate required params
  if (!sku || !userId || !country || !region || !dataToBeUpdated) {
    throw new ApiError(400, 'Missing required parameters');
  }

  logger.info('AutoFixListingService: Starting', { sku, dataToBeUpdated, options });

  // Initialize API clients
  const { refreshToken, sellerId: resolvedSellerId } = await getRefreshTokenForSeller(userId, country, region, sellerId);
  const accessToken = await generateAccessToken(userId, refreshToken);
  if (!accessToken) throw new ApiError(500, 'Failed to generate access token');

  const { baseUri, marketplaceId, awsRegion } = getRegionConfig(region, country);
  const credentials = await getTemporaryCredentials(awsRegion);
  if (!credentials?.AccessKey) throw new ApiError(500, 'Failed to get AWS credentials');

  const effectiveSellerId = sellerId || resolvedSellerId;

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
    // ── NEW: log whether we have an Amazon value for the blocked target attribute
    amazonValueForTarget: analysis.amazonValueForTargetAttribute?.value ?? null
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
      message: analysis.canAutoFix 
        ? 'Attribute can be updated' 
        : getBlockedMessage(analysis)
    };
  }

  // Step 3: Handle blocked target attribute (without autoFixConflicts)
  if (analysis.targetAttributeBlocked && !forceUpdate && !autoFixConflicts) {
    // Option: Auto-match catalog value if enabled
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
            suggestedFix: {
              useAmazonValue: true,
              value: catalogValue
            },
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
        'Register your brand with Amazon Brand Registry to gain catalog update permissions',
        'Contact Seller Support to request a catalog update'
      ]
    };
  }

  // Step 4: Prepare for update
  if (valueToBeUpdated === undefined) {
    throw new ApiError(400, 'valueToBeUpdated is required for update operation');
  }

  // Get language tag for target attribute
  const attrName = ATTRIBUTE_NAMES[dataToBeUpdated] || dataToBeUpdated;
  const languageTag = extractLanguageTag(listingData, attrName, marketplaceId);

  // Handle partial bullet point update
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

  // Step 5: Build ALL patches (conflicts + target attribute) in ONE array
  const allPatches = [];
  const fixedConflicts = [];

  // ── NEW: Track whether a conflict on the target attribute was handled using
  //         Amazon's catalog value. When true, Step 5b must NOT add the user's
  //         value on top — that was the root cause of the title not updating.
  let targetAttributeHandledByConflictFix = false;
  let amazonValueUsedForTarget = null;

  // 5a: Add conflict fix patches if autoFixConflicts is enabled
  if (autoFixConflicts && analysis.catalogConflictAnalysis.fixableCount > 0) {
    for (const conflict of analysis.catalogConflictAnalysis.conflicts) {
      const { attributeName, amazonValue, merchantValue, languageTag: conflictLangTag } = conflict;
      
      if (!amazonValue) continue; // Skip if we don't know Amazon's value

      const targetAttrName = ATTRIBUTE_NAMES[dataToBeUpdated] || dataToBeUpdated;

      if (attributeName === targetAttrName) {
        // ── FIX: The conflict is on the SAME attribute the user wants to update.
        //
        //   OLD behaviour: `continue` — skipped building a conflict-fix patch,
        //   then Step 5b sent the user's value → Amazon rejected it (8541 loop).
        //
        //   NEW behaviour: build the conflict-fix patch using Amazon's catalog
        //   value from the error message, record it, and set a flag so Step 5b
        //   knows NOT to overwrite it with the user's value.
        const existingAttr = listingData?.attributes?.[attributeName];
        const resolvedLanguageTag =
          existingAttr?.[0]?.language_tag || conflictLangTag || getLanguageTag(marketplaceId);

        const conflictPatch = buildConflictFixPatch(
          attributeName,
          amazonValue,
          marketplaceId,
          resolvedLanguageTag
        );
        allPatches.push(conflictPatch);

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
      
      // Conflict is on a different attribute — fix it normally
      const existingAttr = listingData?.attributes?.[attributeName];
      const conflictLanguageTag =
        existingAttr?.[0]?.language_tag || conflictLangTag || getLanguageTag(marketplaceId);

      const conflictPatch = buildConflictFixPatch(attributeName, amazonValue, marketplaceId, conflictLanguageTag);
      allPatches.push(conflictPatch);

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

  // 5b: Add target attribute patch ONLY if it was not already handled by a
  //     conflict fix above. Previously this always ran, which overwrote the
  //     correct Amazon catalog value with the user's rejected value.
  if (!targetAttributeHandledByConflictFix) {
    const targetPatches = buildPatches(dataToBeUpdated, finalValue, marketplaceId, languageTag);
    allPatches.push(...targetPatches);
  }

  logger.info('AutoFixListingService: Total patches to apply', { 
    total: allPatches.length,
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

    // Check response for issues
    const responseIssues = patchResult?.issues || [];
    const hasResponseConflicts = responseIssues.some(i => 
      CATALOG_CONFLICT_CODES.includes(i.code)
    );

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
        message: 'Update submitted but may not take effect due to catalog restrictions.',
        warning: true
      };
    }

    logger.info('AutoFixListingService: Update successful', { 
      sku, 
      dataToBeUpdated,
      conflictsFixed: fixedConflicts.length,
      usedAmazonValueForTarget: targetAttributeHandledByConflictFix
    });

    // Build success message
    let successMessage = `Successfully updated ${dataToBeUpdated}`;
    if (targetAttributeHandledByConflictFix) {
      successMessage += ` using Amazon's catalog value (your value conflicted with the catalog)`;
    }
    if (fixedConflicts.length > 0) {
      const otherConflicts = fixedConflicts.filter(c => c.attribute !== attrName);
      if (otherConflicts.length > 0) {
        successMessage += ` and fixed ${otherConflicts.length} additional catalog conflict(s)`;
      }
    }

    // ── NEW: Distinguish when Amazon's value was used for the target attribute
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
      // Surface which value actually landed on Amazon
      newValue: targetAttributeHandledByConflictFix ? amazonValueUsedForTarget : finalValue,
      // ── NEW: Let the caller know the user's value was overridden
      ...(targetAttributeHandledByConflictFix && {
        userRequestedValue: finalValue,
        amazonValueApplied: amazonValueUsedForTarget,
        notice: `Your requested value for '${dataToBeUpdated}' conflicts with Amazon's catalog. Amazon's catalog value was applied instead. To use your own value, register your brand via Amazon Brand Registry or raise a Seller Support case.`
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

    // Check if it's a catalog conflict error
    const errIssues = errData?.issues || errData?.errors || [];
    const isCatalogConflict = errIssues.some(i => 
      CATALOG_CONFLICT_CODES.includes(i.code)
    );

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
 * Auto-fix all catalog conflicts only (without updating any other attribute)
 * Use this when you just want to clear the 8541 errors
 * 
 * @param {Object} params
 * @param {string} params.sku - Product SKU
 * @param {string} params.userId - User ID
 * @param {string} params.country - Country code
 * @param {string} params.region - Region (NA/EU/FE)
 * @param {string} [params.sellerId] - Seller ID (optional)
 * @param {boolean} [params.dryRun=false] - If true, only analyze without making changes
 * @returns {Promise<Object>} Fix result
 */
async function autoFixCatalogConflicts(params) {
  const { sku, userId, country, region, sellerId, dryRun = false } = params;

  logger.info('AutoFixCatalogConflicts: Starting', { sku, dryRun });

  // Get credentials
  const { refreshToken, sellerId: resolvedSellerId } = await getRefreshTokenForSeller(userId, country, region, sellerId);
  const accessToken = await generateAccessToken(userId, refreshToken);
  if (!accessToken) throw new ApiError(500, 'Failed to generate access token');

  const { baseUri, marketplaceId, awsRegion } = getRegionConfig(region, country);
  const credentials = await getTemporaryCredentials(awsRegion);
  if (!credentials?.AccessKey) throw new ApiError(500, 'Failed to get AWS credentials');

  const effectiveSellerId = sellerId || resolvedSellerId;

  // Get listing data
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

  // Analyze conflicts
  const issues = listingData?.issues || [];
  const conflictAnalysis = analyzeCatalogConflicts(issues);

  if (!conflictAnalysis.hasConflicts) {
    return {
      status: FIX_STATUS.NO_CONFLICTS,
      action: 'NO_ACTION_NEEDED',
      message: 'No catalog conflicts found for this listing',
      sku,
      asin,
      productType
    };
  }

  if (conflictAnalysis.fixableCount === 0) {
    return {
      status: FIX_STATUS.CANNOT_FIX,
      action: 'MANUAL_FIX_REQUIRED',
      message: 'Conflicts found but cannot be auto-fixed. Amazon\'s expected values could not be determined.',
      sku,
      asin,
      productType,
      conflicts: conflictAnalysis.unfixableConflicts,
      possibleSolutions: [
        'Review the error messages and manually update the conflicting attributes',
        'Contact Seller Support to clarify the expected values'
      ]
    };
  }

  // Build patches
  const patches = [];
  const fixedAttributes = [];

  for (const conflict of conflictAnalysis.conflicts) {
    const { attributeName, amazonValue, merchantValue, languageTag: conflictLangTag } = conflict;
    
    if (!amazonValue) continue;
    
    const existingAttr = listingData?.attributes?.[attributeName];
    const languageTag = existingAttr?.[0]?.language_tag || conflictLangTag || getLanguageTag(marketplaceId);

    const patch = buildConflictFixPatch(attributeName, amazonValue, marketplaceId, languageTag);
    patches.push(patch);

    fixedAttributes.push({
      attribute: attributeName,
      oldValue: merchantValue,
      newValue: amazonValue,
      languageTag
    });
  }

  // Dry run - return what would be fixed
  if (dryRun) {
    return {
      status: FIX_STATUS.SUCCESS,
      action: 'DRY_RUN_ANALYSIS',
      message: `Found ${fixedAttributes.length} conflict(s) that can be auto-fixed`,
      sku,
      asin,
      productType,
      wouldFix: fixedAttributes,
      unfixable: conflictAnalysis.unfixableConflicts
    };
  }

  if (patches.length === 0) {
    return {
      status: FIX_STATUS.CANNOT_FIX,
      action: 'NO_FIXABLE_CONFLICTS',
      message: 'No conflicts could be auto-fixed',
      sku,
      asin,
      productType
    };
  }

  // Execute patch
  try {
    const patchResult = await patchListingItem(
      effectiveSellerId, sku, marketplaceId, baseUri,
      accessToken, credentials, awsRegion, productType, patches
    );

    const responseIssues = patchResult?.issues || [];
    const hasNewIssues = responseIssues.length > 0;

    logger.info('AutoFixCatalogConflicts: Completed', { 
      sku, 
      fixedCount: fixedAttributes.length,
      hasNewIssues
    });

    return {
      status: hasNewIssues ? FIX_STATUS.PARTIAL_SUCCESS : FIX_STATUS.SUCCESS,
      action: 'CONFLICTS_FIXED',
      message: hasNewIssues 
        ? `Fixed ${fixedAttributes.length} conflict(s) but new issues were reported`
        : `Successfully fixed ${fixedAttributes.length} catalog conflict(s)`,
      sku,
      asin,
      productType,
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
 * @param {Object} params
 * @param {string} params.sku - Product SKU
 * @param {string} params.userId - User ID
 * @param {string} params.country - Country code
 * @param {string} params.region - Region (NA/EU/FE)
 * @param {string} [params.sellerId] - Seller ID
 * @param {string} params.attributeName - Attribute to fix
 * @param {string} params.newValue - New value
 * @returns {Promise<Object>} Fix result
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
      sku,
      asin,
      productType,
      fixedAttribute: {
        attribute: attributeName,
        newValue: newValue
      },
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
 * @param {Object} params
 * @param {string[]} params.skus - Array of SKUs
 * @param {string} params.userId - User ID
 * @param {string} params.country - Country code
 * @param {string} params.region - Region
 * @param {string} params.dataToBeUpdated - Target attribute
 * @returns {Promise<Object>} Batch analysis result
 */
async function batchAnalyze(params) {
  const { skus, userId, country, region, dataToBeUpdated } = params;
  
  const results = [];
  
  for (const sku of skus) {
    try {
      const result = await autoFixListing({
        sku,
        userId,
        country,
        region,
        dataToBeUpdated,
        options: { analyzeOnly: true }
      });
      results.push({ sku, ...result });
    } catch (err) {
      results.push({
        sku,
        status: FIX_STATUS.ERROR,
        error: err.message
      });
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
 * @param {Object} params
 * @param {string} params.sku - Product SKU
 * @param {string} params.userId - User ID
 * @param {string} params.country - Country code
 * @param {string} params.region - Region
 * @param {string} [params.sellerId] - Seller ID
 * @param {string} params.dataToBeUpdated - Target attribute
 * @param {string} params.catalogValue - Amazon's catalog value
 * @returns {Promise<Object>} Fix result
 */
async function applyAmazonCatalogValue(params) {
  const { sku, userId, country, region, sellerId, dataToBeUpdated, catalogValue } = params;
  
  return autoFixListing({
    sku,
    userId,
    country,
    region,
    sellerId,
    dataToBeUpdated,
    valueToBeUpdated: catalogValue,
    options: { forceUpdate: true }
  });
}

/**
 * Simple update product content with auto-fix conflicts enabled by default
 * This is the main function for simple updates via controller
 * 
 * @param {Object} params - Same as autoFixListing
 * @returns {Promise<Object>} Result from autoFixListing
 */
async function updateProductContent(params) {
  const { options = {}, ...rest } = params;
  
  return autoFixListing({
    ...rest,
    options: {
      autoFixConflicts: true,  // Enable by default for seamless updates
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
  extractLanguageTag,
  
  // Constants
  FIX_STATUS,
  DATA_TYPES,
  ATTRIBUTE_PATHS,
  ATTRIBUTE_NAMES,
  MARKETPLACE_LANGUAGE_MAP,
  ATTRIBUTES_REQUIRING_LANGUAGE_TAG,
  CATALOG_CONFLICT_CODES
};