const { verifyAccessToken } = require('../../utils/Tokens');
const { ApiResponse } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/AsyncHandler');

const demoAuth = asyncHandler(async (req, res, next) => {
    const token = req.cookies.DemoAccessToken;

    if (!token) {
        return res.status(401).json(new ApiResponse(401, '', 'Demo session expired'));
    }

    const decoded = await verifyAccessToken(token);

    if (!decoded || !decoded.isvalid) {
        return res.status(401).json(new ApiResponse(401, '', 'Demo session expired'));
    }

    req.userId = decoded.tokenData;
    next();
});

module.exports = demoAuth;
