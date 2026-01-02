const { getUserByEmail } = require('../../Services/User/userServices.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { createAccessToken, createRefreshToken, createLocationToken } = require('../../utils/Tokens.js');
const { verifyPassword } = require('../../utils/HashPassword.js');
const logger = require('../../utils/Logger.js');
const UserModel = require('../../models/user-auth/userModel.js');
const { getHttpsCookieOptions } = require('../../utils/cookieConfig.js');

/**
 * SuperAdmin Login Controller
 * Handles authentication for superAdmin users only
 */
const adminLogin = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    console.log(email,password);

    // Validate required fields
    if (!email || !password) {
        logger.error(new ApiError(400, "Email and password are required"));
        return res.status(400).json(new ApiResponse(400, "", "Email and password are required"));
    }

    // Check if user exists
    const user = await getUserByEmail(email);
    if (!user) {
        logger.error(new ApiError(404, "Admin user not found"));
        return res.status(404).json(new ApiResponse(404, "", "Admin user not found"));
    }

    // Verify user has superAdmin access
    if (user.accessType !== 'superAdmin') {
        logger.error(new ApiError(403, "SuperAdmin access required"));
        return res.status(403).json(new ApiResponse(403, "", "SuperAdmin access required"));
    }

    // Verify password
  //  const isPasswordValid = await verifyPassword(password, user.password);

    const isPasswordValid = user.password === password;
    if (!isPasswordValid) {
        logger.error(new ApiError(401, "Invalid credentials"));
        return res.status(401).json(new ApiResponse(401, "", "Invalid credentials"));
    }

    // Create admin access token
    const adminToken = await createAccessToken(user._id);
    if (!adminToken) {
        logger.error(new ApiError(500, "Failed to create admin token"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to create admin token"));
    }

    // Prepare response data
    const responseData = {
        adminId: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        accessType: user.accessType,
        packageType: user.packageType
    };

    // Set secure cookie options
    const cookieOptions = getHttpsCookieOptions();

    logger.info(`Admin ${user.accessType} ${user._id} logged in successfully`);

    // Set admin token cookie and return response
    res.status(200)
        .cookie("SuperAdminToken", adminToken, cookieOptions)
        .json(new ApiResponse(200, responseData, "Admin login successful"));
});

/**
 * SuperAdmin Logout Controller
 * Handles logout for superAdmin users by clearing cookies
 */
const adminLogout = asyncHandler(async (req, res) => {
    const adminId = req.SuperAdminId; // Should be set by admin auth middleware

    if (!adminId) {
        logger.error(new ApiError(401, "Admin not authenticated"));
        return res.status(401).json(new ApiResponse(401, "", "Admin not authenticated"));
    }

    // Verify admin exists
    const admin = await UserModel.findById(adminId);
    if (!admin) {
        logger.error(new ApiError(404, "Admin user not found"));
        return res.status(404).json(new ApiResponse(404, "", "Admin user not found"));
    }

    // Set secure cookie options for clearing
    const cookieOptions = getHttpsCookieOptions();

    logger.info(`Admin ${admin.accessType} ${adminId} logged out successfully`);

    // Clear superAdmin token cookie
    res.clearCookie("SuperAdminToken", cookieOptions);
    res.clearCookie("IBEXAccessToken", cookieOptions);
    res.clearCookie("IBEXRefreshToken", cookieOptions);
    res.clearCookie("IBEXLocationToken", cookieOptions);
    
    res.status(200).json(new ApiResponse(200, "", "Admin logout successful"));
});

/**
 * Get All Accounts Controller
 * Returns all user accounts for the manage accounts page
 * Protected route - requires superAdmin access
 */
const getAllAccounts = asyncHandler(async (req, res) => {
    const adminId = req.SuperAdminId; // Should be set by auth middleware

    if (!adminId) {
        logger.error(new ApiError(401, "Admin token required"));
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }

    // Verify admin exists and has superAdmin access
    const admin = await UserModel.findById(adminId);
    if (!admin) {
        logger.error(new ApiError(404, "Admin user not found"));
        return res.status(404).json(new ApiResponse(404, "", "Admin user not found"));
    }

    if (admin.accessType !== 'superAdmin') {
        logger.error(new ApiError(403, "SuperAdmin access required"));
        return res.status(403).json(new ApiResponse(403, "", "SuperAdmin access required"));
    }

    try {
        // PERFORMANCE OPTIMIZATION: Use aggregation pipeline to fetch only needed fields
        // This avoids loading large arrays (products, TotatProducts) from sellerCentral
        const accounts = await UserModel.aggregate([
            // Stage 1: Project only needed user fields
            {
                $project: {
                    firstName: 1,
                    lastName: 1,
                    email: 1,
                    phone: 1,
                    whatsapp: 1,
                    accessType: 1,
                    packageType: 1,
                    subscriptionStatus: 1,
                    isInTrialPeriod: 1,
                    trialEndsDate: 1,
                    isVerified: 1,
                    profilePic: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    adminId: 1,
                    sellerCentral: 1
                }
            },
            // Stage 2: Sort by newest first
            { $sort: { createdAt: -1 } },
            // Stage 3: Lookup sellerCentral with projection to exclude large arrays
            {
                $lookup: {
                    from: 'sellers', // MongoDB collection name (lowercase, pluralized)
                    let: { sellerCentralId: '$sellerCentral' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$_id', '$$sellerCentralId'] } } },
                        {
                            $project: {
                                brand: 1,
                                selling_partner_id: 1,
                                // Only project essential fields from sellerAccount, excluding products and TotatProducts
                                sellerAccount: {
                                    $map: {
                                        input: '$sellerAccount',
                                        as: 'acc',
                                        in: {
                                            spiRefreshToken: '$$acc.spiRefreshToken',
                                            adsRefreshToken: '$$acc.adsRefreshToken',
                                            country: '$$acc.country',
                                            region: '$$acc.region',
                                            ProfileId: '$$acc.ProfileId',
                                            selling_partner_id: '$$acc.selling_partner_id'
                                            // products and TotatProducts are NOT included
                                        }
                                    }
                                }
                            }
                        }
                    ],
                    as: 'sellerCentralData'
                }
            },
            // Stage 4: Unwind the lookup result (convert array to single object)
            {
                $addFields: {
                    sellerCentral: { $arrayElemAt: ['$sellerCentralData', 0] }
                }
            },
            // Stage 5: Remove the temporary array field
            {
                $project: {
                    sellerCentralData: 0
                }
            }
        ]);

        // Transform the data to include additional computed fields
        // Since we used aggregation, sellerCentral is already trimmed
        const accountsWithStats = accounts.map(account => ({
            ...account,
            fullName: `${account.firstName} ${account.lastName}`,
            joinedDate: account.createdAt,
            lastUpdated: account.updatedAt,
            isAdmin: account.accessType === 'superAdmin',
            hasValidSubscription: account.subscriptionStatus === 'active',
            // Check if trial is expired
            isTrialExpired: account.isInTrialPeriod && account.trialEndsDate && new Date() > new Date(account.trialEndsDate)
        }));

        // PERFORMANCE OPTIMIZATION: Calculate stats in a single pass instead of multiple filter operations
        const stats = {
            total: 0,
            verified: 0,
            unverified: 0,
            activeSubscriptions: 0,
            inactiveSubscriptions: 0,
            trialUsers: 0,
            packageStats: {
                LITE: 0,
                PRO: 0,
                AGENCY: 0
            },
            accessTypeStats: {
                user: 0,
                superAdmin: 0
            }
        };

        // Single pass through accounts to calculate all stats
        accounts.forEach(acc => {
            stats.total++;
            if (acc.isVerified) stats.verified++;
            else stats.unverified++;
            
            if (acc.subscriptionStatus === 'active') stats.activeSubscriptions++;
            else if (acc.subscriptionStatus === 'inactive') stats.inactiveSubscriptions++;
            
            if (acc.isInTrialPeriod) stats.trialUsers++;
            
            if (acc.packageType === 'LITE') stats.packageStats.LITE++;
            else if (acc.packageType === 'PRO') stats.packageStats.PRO++;
            else if (acc.packageType === 'AGENCY') stats.packageStats.AGENCY++;
            
            if (acc.accessType === 'user') stats.accessTypeStats.user++;
            else if (acc.accessType === 'superAdmin') stats.accessTypeStats.superAdmin++;
        });

        

        const responseData = {
            accounts: accountsWithStats,
            stats: stats,
            totalCount: accounts.length
        };

        logger.info(`SuperAdmin ${adminId} retrieved ${accounts.length} accounts`);

        res.status(200).json(new ApiResponse(200, responseData, "Accounts retrieved successfully"));

    } catch (error) {
        logger.error(new ApiError(500, `Error retrieving accounts: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", "Failed to retrieve accounts"));
    }
});

/**
 * Login Selected User Controller
 * Allows admin to login as a selected user by user ID
 * Creates IBEX tokens and sets them in cookies
 * Protected route - requires superAdmin access
 */
const loginSelectedUser = asyncHandler(async (req, res) => {
    const adminId = req.SuperAdminId; // Should be set by auth middleware
    const { userId } = req.body;

    // Validate required fields
    if (!adminId) {
        logger.error(new ApiError(401, "Admin token required"));
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }

    if (!userId) {
        logger.error(new ApiError(400, "User ID is required"));
        return res.status(400).json(new ApiResponse(400, "", "User ID is required"));
    }

    // Verify admin exists and has superAdmin access
    const admin = await UserModel.findById(adminId);
    if (!admin) {
        logger.error(new ApiError(404, "Admin user not found"));
        return res.status(404).json(new ApiResponse(404, "", "Admin user not found"));
    }

    if (admin.accessType !== 'superAdmin') {
        logger.error(new ApiError(403, "SuperAdmin access required"));
        return res.status(403).json(new ApiResponse(403, "", "SuperAdmin access required"));
    }

    try {
        // Fetch user details with seller central populated
        const user = await UserModel.findById(userId)
            .populate('sellerCentral')
            .select('-password'); // Exclude password field

        if (!user) {
            logger.error(new ApiError(404, "User not found"));
            return res.status(404).json(new ApiResponse(404, "", "User not found"));
        }

        // Create IBEX tokens
        const accessToken = await createAccessToken(user._id);
        const refreshToken = await createRefreshToken(user._id);

        const sellerCentral = user.sellerCentral;
        let locationToken = '';
        if(!sellerCentral){
            locationToken = await createLocationToken('US', 'us-east-1');
        }else{
            const sellerAccount = sellerCentral.sellerAccount[0];
            locationToken = await createLocationToken(sellerAccount.country, sellerAccount.region);
        }
        
        // Create location token (assuming default values, you can modify based on user's location)

        // Validate token creation
        if (!accessToken || !refreshToken || !locationToken) {
            logger.error(new ApiError(500, "Failed to create user tokens"));
            return res.status(500).json(new ApiResponse(500, "", "Failed to create user tokens"));
        }

        // Update user's refresh token in database
        await UserModel.findByIdAndUpdate(user._id, {
            appRefreshToken: refreshToken
        });

        // Prepare response data
        const responseData = {
            userId: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            accessType: user.accessType,
            packageType: user.packageType,
            subscriptionStatus: user.subscriptionStatus,
            isInTrialPeriod: user.isInTrialPeriod,
            isVerified: user.isVerified,
            sellerCentral: user.sellerCentral,
            profilePic: user.profilePic,
            phone: user.phone,
            whatsapp: user.whatsapp
        };

        // Set secure cookie options
        const cookieOptions = getHttpsCookieOptions();

        logger.info(`SuperAdmin ${adminId} logged in as user ${user._id} (${user.email})`);

        // Set IBEX tokens in cookies and return response
        res.status(200)
            .cookie("IBEXAccessToken", accessToken, cookieOptions)
            .cookie("IBEXRefreshToken", refreshToken, cookieOptions)
            .cookie("IBEXLocationToken", locationToken, cookieOptions)
            .json(new ApiResponse(200, responseData, "Successfully logged in as selected user"));

    } catch (error) {
        logger.error(new ApiError(500, `Error logging in as user: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", "Failed to login as selected user"));
    }
});

module.exports = {
    adminLogin,
    adminLogout,
    getAllAccounts,
    loginSelectedUser
};
