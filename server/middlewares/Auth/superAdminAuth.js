const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { verifyAccessToken } = require('../../utils/Tokens.js');
const logger = require('../../utils/Logger.js');

const superAdminAuth = asyncHandler(async (req, res, next) => {
    const superAdminToken = req.cookies.SuperAdminToken;
    
    if(!superAdminToken){
        logger.error(new ApiError(401, "SuperAdmin token required"));
        return res.status(401).json(new ApiResponse(401, "", "SuperAdmin token required"));
    }

    const decoded = await verifyAccessToken(superAdminToken);
    if(!decoded || !decoded.isvalid){
        logger.error(new ApiError(401, "Invalid superAdmin token"));
        return res.status(401).json(new ApiResponse(401, "", "Invalid superAdmin token"));
    }
    
    req.SuperAdminId = decoded.tokenData;
    next();
});

module.exports = superAdminAuth; 