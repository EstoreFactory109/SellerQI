/**
 * UpdateProductContentTestController.js
 *
 * Single endpoint for all listing update operations (test/prototype).
 * Supports: attribute update, analyze-only, fix-conflicts-only.
 *
 * POST /api/test/update-product-content (or /update)
 *
 * Request body:
 * {
 *   "userId": "mongoose ObjectId",        // Optional if req.userId / req.user.id set (e.g. by auth)
 *   "sku": "3in1Dermaroller",
 *   "country": "AU",
 *   "region": "FE",
 *   "sellerId": "optional",
 *   "dataToBeUpdated": "title",           // Required unless fixConflictsOnly
 *   "valueToBeUpdated": "New Title",       // Required for updates (not for analyzeOnly/fixConflictsOnly)
 *   "analyzeOnly": false,                  // Optional: just analyze, don't update
 *   "fixConflictsOnly": false,             // Optional: only fix 8541 catalog conflicts
 *   "autoFixConflicts": true              // Optional: fix conflicts + update (default: true)
 * }
 */

const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const {
  updateProductContent,
  autoFixCatalogConflicts
} = require('../../Services/Sp_API/UpdateProductContentService.js');

const ALLOWED_UPDATE_TYPES = ['title', 'description', 'bulletpoints'];

function normalizeDataToBeUpdated(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function validateBulletpointsValue(valueToBeUpdated) {
  const isArray = Array.isArray(valueToBeUpdated);
  const isPartial =
    valueToBeUpdated &&
    typeof valueToBeUpdated === 'object' &&
    !Array.isArray(valueToBeUpdated) &&
    typeof valueToBeUpdated.index === 'number' &&
    valueToBeUpdated.value !== undefined;
  return isArray || isPartial;
}

const testUpdateProductContent = asyncHandler(async (req, res) => {
  const {
    sku,
    country,
    region,
    sellerId,
    dataToBeUpdated,
    valueToBeUpdated,
    analyzeOnly = false,
    fixConflictsOnly = false,
    autoFixConflicts = true
  } = req.body;

  const userId = req.userId || req.user?.id || req.body.userId;

  if (!sku || !country || !region) {
    return res.status(400).json(
      new ApiResponse(400, null, 'Missing required parameters: sku, country, region')
    );
  }

  if (!userId) {
    return res.status(400).json(
      new ApiResponse(400, null, 'Missing userId (set via auth or request body)')
    );
  }

  let result;

  if (fixConflictsOnly) {
    result = await autoFixCatalogConflicts({
      sku,
      userId,
      country,
      region,
      sellerId: sellerId || undefined
    });
  } else {
    if (dataToBeUpdated == null || dataToBeUpdated === '') {
      return res.status(400).json(
        new ApiResponse(400, null, 'dataToBeUpdated is required when not using fixConflictsOnly')
      );
    }

    const normalizedType = normalizeDataToBeUpdated(dataToBeUpdated);
    if (!ALLOWED_UPDATE_TYPES.includes(normalizedType)) {
      return res.status(400).json(
        new ApiResponse(400, null, `dataToBeUpdated must be one of: ${ALLOWED_UPDATE_TYPES.join(', ')}`)
      );
    }

    if (!analyzeOnly && valueToBeUpdated === undefined) {
      return res.status(400).json(
        new ApiResponse(400, null, 'valueToBeUpdated is required for updates')
      );
    }

    if (normalizedType === 'bulletpoints' && !analyzeOnly && !validateBulletpointsValue(valueToBeUpdated)) {
      return res.status(400).json(
        new ApiResponse(
          400,
          null,
          'For bulletpoints use valueToBeUpdated: array of strings (full replace) or { index: number, value: string } (update one bullet)'
        )
      );
    }

    result = await updateProductContent({
      sku,
      userId,
      country,
      region,
      sellerId: sellerId || undefined,
      dataToBeUpdated: normalizedType,
      valueToBeUpdated,
      options: {
        analyzeOnly,
        autoFixConflicts
      }
    });
  }

  return res.status(200).json({
    statusCode: 200,
    data: result,
    message: result.message || 'Success'
  });
});

module.exports = {
  testUpdateProductContent
};
