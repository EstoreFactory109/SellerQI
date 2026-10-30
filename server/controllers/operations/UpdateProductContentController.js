/**
 * UpdateProductContentController.js
 *
 * Production controller for listing content updates.
 * Wraps AutoFixListingService (UpdateProductContentService).
 *
 * POST /api/listings/update-product-content
 *
 * Request body:
 * {
 *   "userId": "mongoose ObjectId",        // Optional if req.userId / req.user.id set (e.g. by auth)
 *   "sku": "3in1Dermaroller",
 *   "country": "AU",
 *   "region": "FE",
 *   "sellerId": "optional",
 *   "dataToBeUpdated": "title | description | bulletpoints | generic_keyword",
 *   "valueToBeUpdated": "New Title or keyword string", // Required for updates (not for analyzeOnly/fixConflictsOnly)
 *   "analyzeOnly": false,                  // Optional: just analyze, don't update
 *   "fixConflictsOnly": false,             // Optional: only fix 8541 catalog conflicts
 *   "autoFixConflicts": true,              // Optional: fix conflicts + update (default: true)
 *   "brandName": "Your Brand"              // Optional: if brand attribute is missing, set it (exactly as in Brand Registry)
 * }
 */

const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const {
  updateProductContent,
  FIX_STATUS
} = require('../../Services/Sp_API/UpdateProductContentService.js');

const ALLOWED_UPDATE_TYPES = ['title', 'description', 'bulletpoints', 'generic_keyword'];

/**
 * Makes a listing change through the change-request log and answers with Amazon's
 * result, as this endpoint always has (a refused change is still a 200 with the
 * result's status; the page reads it).
 */
async function runLoggedChange(req, actionType, input) {
  const ChangeRequestService = require('../../Services/Actions/ChangeRequestService.js');
  const { approverOf } = require('../actions/AmazonActionsController.js');
  let done;
  try {
    done = await ChangeRequestService.runApproved({
      userId: req.userId, country: req.country, region: req.region,
      feature: 'listings', actionType, input, source: 'screen', approvedBy: approverOf(req)
    });
  } catch (error) {
    // Refused before sending (switched off, no SKU, ...): nothing changed on Amazon.
    return { status: 'ERROR', message: error.message };
  }
  const ChangeRequest = require('../../models/MCP/AmazonChangeRequestModel.js');
  const doc = await ChangeRequest.findById(done.id).select('response error status').lean();
  if (doc?.response && typeof doc.response === 'object') return doc.response;
  return { status: doc?.status === 'succeeded' ? FIX_STATUS.SUCCESS : 'ERROR', message: doc?.error || done.message };
}

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

const updateProductContentController = asyncHandler(async (req, res) => {
  const {
    sku,
    sellerId,
    dataToBeUpdated,
    valueToBeUpdated,
    analyzeOnly = false,
    fixConflictsOnly = false,
    autoFixConflicts = true,
    brandName
  } = req.body;

  // The account and marketplace come from the session only (auth + getLocation),
  // never from the body.
  const userId = req.userId;
  const country = req.country;
  const region = req.region;

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
    // The seller's Fix button is the approval; the change is still logged.
    result = await runLoggedChange(req, 'listings.fix_catalog_conflicts', { sku });
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

    if (analyzeOnly) {
      // A read: nothing changes on Amazon.
      result = await updateProductContent({
        sku, userId, country, region,
        sellerId: sellerId || undefined,
        dataToBeUpdated: normalizedType,
        valueToBeUpdated,
        options: { analyzeOnly: true, autoFixConflicts }
      });
    } else {
      // The seller's Apply button is the approval; the change is still logged
      // (AmazonChangeRequest) and recorded as ours (ListingFixStatus, in the handler).
      result = await runLoggedChange(req, 'listings.update_content', {
        sku, field: normalizedType, value: valueToBeUpdated, autoFixConflicts,
        ...(brandName != null && brandName !== '' ? { brandName: String(brandName).trim() } : {})
      });
    }
  }

  return res.status(200).json({
    statusCode: 200,
    data: result,
    message: result.message || 'Success'
  });
});

module.exports = {
  updateProductContentController
};

