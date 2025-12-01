const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { Integration } = require('../../Services/main/Integration.js');
const logger = require('../../utils/Logger.js');

// This function is now handled by Integration service
// Keeping it here for backward compatibility if needed
const addNewAccountHistory = async (userId, country, region) => {
    return Integration.addNewAccountHistory(userId, country, region);
};

const getSpApiData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Processing SP-API data request for user ${userId}, region ${Region}, country ${Country}`);

        // Delegate to the Integration service
        const result = await Integration.getSpApiData(userId, Region, Country);

        if (!result.success) {
            logger.error('Integration service returned error', {
                error: result.error,
                statusCode: result.statusCode,
                userId,
                Region,
                Country
            });

            return res.status(result.statusCode || 500).json(
                new ApiError(result.statusCode || 500, result.error || 'Failed to process SP-API data')
            );
        }

        // Return successful response
        return res.status(result.statusCode || 200).json(
            new ApiResponse(
                result.statusCode || 200,
                {
                    data: result.data,
                    summary: result.summary
                },
                result.statusCode === 200 
                    ? "SP-API data processing completed successfully"
                    : "Partial success - some services failed"
            )
        );

    } catch (unexpectedError) {
        logger.error("Unexpected error in getSpApiData controller", {
            error: unexpectedError.message,
            stack: unexpectedError.stack,
            userId,
            Region,
            Country
        });

        return res.status(500).json(
            new ApiError(500, `Unexpected error: ${unexpectedError.message}`)
        );
    }
});

module.exports = { getSpApiData, addNewAccountHistory };