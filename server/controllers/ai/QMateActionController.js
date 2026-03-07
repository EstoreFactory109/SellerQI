/**
 * QMateActionController.js
 * 
 * Handles QMate's "Fix It" capabilities:
 * 1. Generate content suggestions (title, bullet points, description, backend keywords)
 * 2. Apply fixes to Amazon listings
 * 
 * These endpoints are called by the frontend when QMate suggests content_actions.
 */

const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { generateRankingContentSuggestion } = require('../../Services/AI/RankingContentAIService.js');
const { updateProductContent } = require('../../Services/Sp_API/UpdateProductContentService.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');

const ALLOWED_ATTRIBUTES = ['title', 'bulletpoints', 'description', 'generic_keyword'];

/**
 * POST /api/qmate/generate-suggestion
 * 
 * Generate AI content suggestions for a product attribute.
 * This is the same as what the "Fix It" button's "Generate" feature does.
 * 
 * Request body:
 * {
 *   "asin": "B00EXAMPLE",
 *   "attribute": "title" | "bulletpoints" | "description" | "generic_keyword",
 *   "currentValue": "Current content (optional - will be fetched if not provided)"
 * }
 */
const generateSuggestion = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { asin, attribute, currentValue } = req.body;

    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required'));
    }

    if (!country || !region) {
        return res.status(400).json(new ApiError(400, 'Country and region are required'));
    }

    if (!asin) {
        return res.status(400).json(new ApiError(400, 'ASIN is required'));
    }

    if (!attribute || !ALLOWED_ATTRIBUTES.includes(attribute.toLowerCase())) {
        return res.status(400).json(
            new ApiError(400, `attribute must be one of: ${ALLOWED_ATTRIBUTES.join(', ')}`)
        );
    }

    const normalizedAttribute = attribute.toLowerCase();

    logger.info('[QMateAction] Generating suggestion', {
        userId,
        country,
        region,
        asin,
        attribute: normalizedAttribute,
        hasCurrentValue: !!currentValue
    });

    try {
        // Build params for the ranking content AI service
        const params = {
            userId,
            country,
            region,
            asin,
            attribute: normalizedAttribute
        };

        // Add current value if provided
        if (currentValue) {
            switch (normalizedAttribute) {
                case 'title':
                    params.title = currentValue;
                    break;
                case 'bulletpoints':
                    params.bulletpoints = Array.isArray(currentValue) ? currentValue : [currentValue];
                    break;
                case 'description':
                    params.description = currentValue;
                    break;
                case 'generic_keyword':
                    params.backendKeywords = currentValue;
                    break;
            }
        }

        const result = await generateRankingContentSuggestion(params);

        logger.info('[QMateAction] Suggestion generated successfully', {
            userId,
            asin,
            attribute: normalizedAttribute
        });

        return res.status(200).json(
            new ApiResponse(200, {
                asin,
                attribute: normalizedAttribute,
                suggestions: result
            }, 'Suggestion generated successfully')
        );

    } catch (error) {
        logger.error('[QMateAction] Error generating suggestion', {
            error: error.message,
            stack: error.stack,
            userId,
            asin,
            attribute: normalizedAttribute
        });

        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json(
            new ApiError(statusCode, error.message || 'Failed to generate suggestion')
        );
    }
});

/**
 * POST /api/qmate/apply-fix
 * 
 * Apply a content fix to an Amazon listing.
 * This is the same as what the "Fix It" button's "Apply" feature does.
 * 
 * Request body:
 * {
 *   "asin": "B00EXAMPLE",
 *   "sku": "SKU123",
 *   "attribute": "title" | "bulletpoints" | "description" | "generic_keyword",
 *   "value": "The new content to apply"
 * }
 */
const applyFix = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { asin, sku, attribute, value } = req.body;

    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required'));
    }

    if (!country || !region) {
        return res.status(400).json(new ApiError(400, 'Country and region are required'));
    }

    if (!sku) {
        return res.status(400).json(
            new ApiError(400, 'SKU is required to apply fixes. Please provide the product SKU.')
        );
    }

    if (!attribute || !ALLOWED_ATTRIBUTES.includes(attribute.toLowerCase())) {
        return res.status(400).json(
            new ApiError(400, `attribute must be one of: ${ALLOWED_ATTRIBUTES.join(', ')}`)
        );
    }

    if (value === undefined || value === null || value === '') {
        return res.status(400).json(new ApiError(400, 'value is required'));
    }

    const normalizedAttribute = attribute.toLowerCase();

    logger.info('[QMateAction] Applying fix', {
        userId,
        country,
        region,
        asin,
        sku,
        attribute: normalizedAttribute,
        valueLength: typeof value === 'string' ? value.length : (Array.isArray(value) ? value.length : 'N/A')
    });

    try {
        // Call the update product content service
        const result = await updateProductContent({
            sku,
            userId,
            country,
            region,
            dataToBeUpdated: normalizedAttribute,
            valueToBeUpdated: value,
            options: {
                autoFixConflicts: true
            }
        });

        logger.info('[QMateAction] Fix applied successfully', {
            userId,
            asin,
            sku,
            attribute: normalizedAttribute,
            result: result.success ? 'success' : 'failed'
        });

        if (result.success === false || result.error) {
            return res.status(400).json(
                new ApiResponse(400, result, result.message || result.error || 'Failed to apply fix')
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                asin,
                sku,
                attribute: normalizedAttribute,
                applied: true,
                result
            }, 'Fix applied successfully')
        );

    } catch (error) {
        logger.error('[QMateAction] Error applying fix', {
            error: error.message,
            stack: error.stack,
            userId,
            asin,
            sku,
            attribute: normalizedAttribute
        });

        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json(
            new ApiError(statusCode, error.message || 'Failed to apply fix')
        );
    }
});

/**
 * POST /api/qmate/batch-suggestions
 * 
 * Generate suggestions for multiple attributes at once.
 * 
 * Request body:
 * {
 *   "asin": "B00EXAMPLE",
 *   "attributes": ["title", "bulletpoints", "description", "generic_keyword"]
 * }
 */
const batchSuggestions = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { asin, attributes } = req.body;

    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required'));
    }

    if (!country || !region) {
        return res.status(400).json(new ApiError(400, 'Country and region are required'));
    }

    if (!asin) {
        return res.status(400).json(new ApiError(400, 'ASIN is required'));
    }

    if (!Array.isArray(attributes) || attributes.length === 0) {
        return res.status(400).json(new ApiError(400, 'attributes array is required'));
    }

    const validAttributes = attributes.filter(a => 
        typeof a === 'string' && ALLOWED_ATTRIBUTES.includes(a.toLowerCase())
    );

    if (validAttributes.length === 0) {
        return res.status(400).json(
            new ApiError(400, `No valid attributes provided. Must be one of: ${ALLOWED_ATTRIBUTES.join(', ')}`)
        );
    }

    logger.info('[QMateAction] Generating batch suggestions', {
        userId,
        country,
        region,
        asin,
        attributes: validAttributes
    });

    const results = {};
    const errors = {};

    // Generate suggestions in parallel
    await Promise.all(validAttributes.map(async (attr) => {
        const normalizedAttr = attr.toLowerCase();
        try {
            const result = await generateRankingContentSuggestion({
                userId,
                country,
                region,
                asin,
                attribute: normalizedAttr
            });
            results[normalizedAttr] = result;
        } catch (error) {
            errors[normalizedAttr] = error.message;
            logger.warn('[QMateAction] Failed to generate suggestion for attribute', {
                asin,
                attribute: normalizedAttr,
                error: error.message
            });
        }
    }));

    logger.info('[QMateAction] Batch suggestions completed', {
        userId,
        asin,
        successCount: Object.keys(results).length,
        errorCount: Object.keys(errors).length
    });

    return res.status(200).json(
        new ApiResponse(200, {
            asin,
            suggestions: results,
            errors: Object.keys(errors).length > 0 ? errors : undefined
        }, 'Batch suggestions generated')
    );
});

/**
 * GET /api/qmate/lookup-sku/:asin
 * 
 * Look up the SKU for a given ASIN.
 * This is used when QMate's content_actions has a null SKU
 * and the frontend needs to resolve it before applying a fix.
 */
const lookupSku = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { asin } = req.params;

    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required'));
    }

    if (!country || !region) {
        return res.status(400).json(new ApiError(400, 'Country and region are required'));
    }

    if (!asin) {
        return res.status(400).json(new ApiError(400, 'ASIN is required'));
    }

    logger.info('[QMateAction] Looking up SKU for ASIN', {
        userId,
        country,
        region,
        asin
    });

    try {
        const sellerData = await Seller.findOne(
            { User: userId },
            { 'sellerAccount': { $elemMatch: { region, country } } }
        ).lean();

        const products = sellerData?.sellerAccount?.[0]?.products || [];
        const product = products.find(p => p.asin === asin);

        if (!product) {
            logger.warn('[QMateAction] Product not found for ASIN', { userId, asin });
            return res.status(404).json(
                new ApiError(404, `Product with ASIN ${asin} not found in your catalog`)
            );
        }

        if (!product.sku) {
            logger.warn('[QMateAction] SKU not available for ASIN', { userId, asin });
            return res.status(404).json(
                new ApiError(404, `SKU not available for ASIN ${asin}`)
            );
        }

        logger.info('[QMateAction] SKU found for ASIN', {
            userId,
            asin,
            sku: product.sku
        });

        return res.status(200).json(
            new ApiResponse(200, {
                asin,
                sku: product.sku,
                itemName: product.itemName || null,
                status: product.status || null
            }, 'SKU found successfully')
        );

    } catch (error) {
        logger.error('[QMateAction] Error looking up SKU', {
            error: error.message,
            stack: error.stack,
            userId,
            asin
        });

        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json(
            new ApiError(statusCode, error.message || 'Failed to look up SKU')
        );
    }
});

module.exports = {
    generateSuggestion,
    applyFix,
    batchSuggestions,
    lookupSku
};
