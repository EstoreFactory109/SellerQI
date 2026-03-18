const { ApiResponse } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/AsyncHandler');
const { createDemoAccessToken } = require('../../utils/Tokens');
const { getHttpsCookieOptions } = require('../../utils/cookieConfig');
const { getUserById } = require('../../Services/User/userServices');
const UserModel = require('../../models/user-auth/userModel');

const DEMO_EMAIL = 'demo@sellerqi.com';
const DEMO_TOKEN_MAX_AGE = 15 * 60 * 1000; // 15 minutes

const demoLogin = asyncHandler(async (req, res) => {
    const demoUser = await UserModel.findOne({ email: DEMO_EMAIL });

    if (!demoUser) {
        return res.status(404).json(new ApiResponse(404, '', 'Demo account not configured. Run the seed script first.'));
    }

    const accessToken = await createDemoAccessToken(demoUser._id);

    if (!accessToken) {
        return res.status(500).json(new ApiResponse(500, '', 'Failed to create demo session'));
    }

    const cookieOpts = {
        ...getHttpsCookieOptions(),
        maxAge: DEMO_TOKEN_MAX_AGE
    };

    res.cookie('DemoAccessToken', accessToken, cookieOpts);

    return res.status(200).json(new ApiResponse(200, {
        userId: demoUser._id,
        firstName: demoUser.firstName,
        lastName: demoUser.lastName,
        email: demoUser.email,
        packageType: demoUser.packageType,
        accessType: demoUser.accessType,
        isVerified: demoUser.isVerified,
        FirstAnalysisDone: demoUser.FirstAnalysisDone
    }, 'Demo login successful'));
});

const demoProfile = asyncHandler(async (req, res) => {
    const userId = req.userId;

    if (!userId) {
        return res.status(400).json(new ApiResponse(400, '', 'User id is missing'));
    }

    const userProfile = await getUserById(userId);

    if (!userProfile) {
        return res.status(404).json(new ApiResponse(404, '', 'Demo user not found'));
    }

    return res.status(200).json(new ApiResponse(200, userProfile, 'Demo profile fetched'));
});

const demoLogout = asyncHandler(async (req, res) => {
    const cookieOpts = getHttpsCookieOptions();
    res.clearCookie('DemoAccessToken', cookieOpts);
    return res.status(200).json(new ApiResponse(200, '', 'Demo session ended'));
});

module.exports = { demoLogin, demoProfile, demoLogout };
