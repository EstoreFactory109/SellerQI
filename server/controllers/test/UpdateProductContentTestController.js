/**
 * UpdateProductContentTestController.js
 *
 * Test controller for UpdateProductContentService (product name, bullet points, description).
 *
 * Endpoints:
 * - GET  /api/test/update-product-content/test - Route health / available endpoints
 * - POST /api/test/update-product-content/update - Call updateProductContent service
 */

const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { updateProductContent } = require('../../Services/Sp_API/UpdateProductContentService.js');

/**
 * POST /api/test/update-product-content/update
 *
 * Request body:
 * {
 *   "userId": "mongoose ObjectId",
 *   "sku": "SKU_CODE",
 *   "sellerId": "selling_partner_id (optional if only one account for region/country)",
 *   "country": "US",
 *   "region": "NA",
 *   "dataToBeUpdated": "title" | "description" | "bulletpoints",
 *   "valueToBeUpdated": "string" (title/description), ["string", ...] (bulletpoints full replace),
 *     or { "index": 2, "value": "New 3rd bullet" } (bulletpoints partial - update one, keep rest)
 * }
 */
const testUpdateProductContent = asyncHandler(async (req, res) => {
  const { userId, sku, sellerId, country, region, dataToBeUpdated, valueToBeUpdated } = req.body;

  if (!userId || !sku || !country || !region || dataToBeUpdated == null || valueToBeUpdated === undefined) {
    return res.status(400).json(
      new ApiResponse(400, null, 'Missing required fields: userId, sku, country, region, dataToBeUpdated, valueToBeUpdated')
    );
  }

  const allowedTypes = ['title', 'description', 'bulletpoints'];
  const normalizedType = String(dataToBeUpdated).toLowerCase();
  if (!allowedTypes.includes(normalizedType)) {
    return res.status(400).json(
      new ApiResponse(400, null, `dataToBeUpdated must be one of: ${allowedTypes.join(', ')}`)
    );
  }

  if (normalizedType === 'bulletpoints') {
    const isArray = Array.isArray(valueToBeUpdated);
    const isPartial = valueToBeUpdated && typeof valueToBeUpdated === 'object' && !Array.isArray(valueToBeUpdated) && typeof valueToBeUpdated.index === 'number' && valueToBeUpdated.value !== undefined;
    if (!isArray && !isPartial) {
      return res.status(400).json(
        new ApiResponse(400, null, 'For bulletpoints use valueToBeUpdated: array of strings (full replace) or { index: number, value: string } (update one bullet, e.g. index 2 for 3rd)')
      );
    }
  }

  try {
    logger.info('[UpdateProductContentTest] Calling updateProductContent', {
      userId,
      sku,
      country,
      region,
      dataToBeUpdated: normalizedType
    });

    const result = await updateProductContent({
      sku,
      sellerId: sellerId || undefined,
      userId,
      country,
      region,
      dataToBeUpdated: normalizedType,
      valueToBeUpdated
    });

    return res.status(200).json(
      new ApiResponse(200, result, 'Product content updated successfully')
    );
  } catch (err) {
    const status = err.statusCode || err.status || 500;
    const message = err.message || 'Update product content failed';
    logger.error('[UpdateProductContentTest] Error', { error: message, userId, sku });
    return res.status(status).json(
      new ApiResponse(status, null, message)
    );
  }
});

module.exports = {
  testUpdateProductContent
};
