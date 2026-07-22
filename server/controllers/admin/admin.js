const { getUserByEmail } = require('../../Services/User/userServices.js');
const { deleteUserById } = require('../../Services/User/deleteUserService.js');
const { enqueueFullUserDataPurge } = require('../../Services/BackgroundJobs/deleteUserQueue.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { createAccessToken, createRefreshToken, createLocationToken } = require('../../utils/Tokens.js');
const { verifyPassword } = require('../../utils/HashPassword.js');
const logger = require('../../utils/Logger.js');
const UserModel = require('../../models/user-auth/userModel.js');
const PaymentLogs = require('../../models/system/PaymentLogsModel.js');
const Subscription = require('../../models/user-auth/SubscriptionModel.js');
const { getHttpsCookieOptions } = require('../../utils/cookieConfig.js');
const RazorpayService = require('../../Services/Razorpay/RazorpayService.js');
const StripeService = require('../../Services/Stripe/StripeService.js');

/**
 * Export all accounts as CSV
 * Uses the same aggregation as getAllAccounts to avoid loading heavy fields.
 * Protected route - requires superAdmin access.
 */
const exportAllAccountsCsv = asyncHandler(async (req, res) => {
    const adminId = req.SuperAdminId;

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
        const accounts = await UserModel.aggregate([
            {
                $project: {
                    firstName: 1,
                    lastName: 1,
                    email: 1,
                    phone: 1,
                    accessType: 1,
                    packageType: 1,
                    isAgencyClient: 1,
                    subscriptionStatus: 1,
                    createdAt: 1
                }
            },
            { $sort: { createdAt: -1 } }
        ]);

        const header = [
            'First Name',
            'Last Name',
            'Email',
            'Phone Number',
            'Access Type',
            'Package Type',
            'Subscription Status',
            'Created At'
        ];

        const escapeCsv = (value) => {
            if (value === null || value === undefined) return '';
            const str = String(value);
            if (str.includes('"') || str.includes(',') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        // Format date as DD/MM/YYYY
        const formatDateDDMMYYYY = (dateVal) => {
            if (!dateVal) return '';
            const d = new Date(dateVal);
            if (isNaN(d.getTime())) return '';
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}/${month}/${year}`;
        };

        const displayPackageType = (acc) =>
            acc.isAgencyClient ? 'Agency Client' : acc.packageType;

        const rows = accounts.map(acc => [
            escapeCsv(acc.firstName),
            escapeCsv(acc.lastName),
            escapeCsv(acc.email),
            escapeCsv(acc.phone),
            escapeCsv(acc.accessType),
            escapeCsv(displayPackageType(acc)),
            escapeCsv(acc.subscriptionStatus),
            escapeCsv(formatDateDDMMYYYY(acc.createdAt))
        ].join(','));

        const csvContent = [header.join(','), ...rows].join('\n');

        const filename = `accounts-export-${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.status(200).send(csvContent);
    } catch (error) {
        logger.error(new ApiError(500, `Error exporting accounts CSV: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", "Failed to export accounts CSV"));
    }
});

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
    const isPasswordValid = await verifyPassword(password, user.password);
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
 * Builds the shared sellerCentral + subscription lookup stages and the
 * pre/post-lookup $match stages for getAllAccounts, from optional query filters.
 * Kept separate so the pipeline stays readable - each stage below is pushed in
 * the exact order it needs to run in the aggregation.
 */
const buildAccountsPipeline = (filters) => {
    const { packageType, statusFilter, startDate, endDate, brand, search, spApiFilter, adsFilter } = filters;
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pipeline = [];

    // Stage 1: Project only needed user fields
    pipeline.push({
        $project: {
            firstName: 1,
            lastName: 1,
            email: 1,
            phone: 1,
            whatsapp: 1,
            accessType: 1,
            packageType: 1,
            isAgencyClient: 1,
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
    });

    // Stage 2: Pre-lookup filters that only touch fields already on the User doc
    const preMatch = {};
    if (packageType && packageType !== 'all') {
        preMatch.packageType = packageType;
    }
    if (statusFilter === 'active') preMatch.subscriptionStatus = 'active';
    else if (statusFilter === 'trial') preMatch.isInTrialPeriod = true;
    else if (statusFilter === 'cancelled') preMatch.subscriptionStatus = 'cancelled';

    if (startDate || endDate) {
        preMatch.createdAt = {};
        if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            preMatch.createdAt.$gte = start;
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            preMatch.createdAt.$lte = end;
        }
    }
    if (Object.keys(preMatch).length > 0) {
        pipeline.push({ $match: preMatch });
    }

    // Stage 3: Sort by newest first
    pipeline.push({ $sort: { createdAt: -1 } });

    // Stage 4: Lookup sellerCentral with projection to exclude large arrays
    pipeline.push({
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
    });
    pipeline.push({ $addFields: { sellerCentral: { $arrayElemAt: ['$sellerCentralData', 0] } } });
    pipeline.push({ $project: { sellerCentralData: 0 } });

    // Stage 5: Lookup subscription (paymentGateway/stripeCustomerId/renewal dates)
    pipeline.push({
        $lookup: {
            from: 'subscriptions',
            let: { uid: '$_id' },
            pipeline: [
                { $match: { $expr: { $eq: ['$userId', '$$uid'] } } },
                { $project: { paymentGateway: 1, stripeCustomerId: 1, nextBillingDate: 1, currentPeriodEnd: 1 } }
            ],
            as: 'subscriptionData'
        }
    });
    pipeline.push({ $addFields: { subscriptionInfo: { $arrayElemAt: ['$subscriptionData', 0] } } });
    pipeline.push({ $project: { subscriptionData: 0 } });

    // Stage 6: Post-lookup filters (need sellerCentral to exist first: brand, search, SP-API/Ads connection)
    const connectionExpr = (tokenField) => ({
        $gt: [
            {
                $size: {
                    $filter: {
                        input: { $ifNull: ['$sellerCentral.sellerAccount', []] },
                        as: 'acc',
                        cond: {
                            $and: [
                                { $ne: [`$$acc.${tokenField}`, null] },
                                { $ne: [`$$acc.${tokenField}`, ''] }
                            ]
                        }
                    }
                }
            },
            0
        ]
    });

    const postMatchAnd = [];
    if (brand) {
        postMatchAnd.push({ 'sellerCentral.brand': { $regex: escapeRegex(brand), $options: 'i' } });
    }
    if (search) {
        const re = new RegExp(escapeRegex(search), 'i');
        postMatchAnd.push({ $or: [{ firstName: re }, { lastName: re }, { email: re }, { 'sellerCentral.brand': re }] });
    }
    if (spApiFilter === 'connected') postMatchAnd.push({ $expr: connectionExpr('spiRefreshToken') });
    else if (spApiFilter === 'not-connected') postMatchAnd.push({ $expr: { $not: connectionExpr('spiRefreshToken') } });
    if (adsFilter === 'connected') postMatchAnd.push({ $expr: connectionExpr('adsRefreshToken') });
    else if (adsFilter === 'not-connected') postMatchAnd.push({ $expr: { $not: connectionExpr('adsRefreshToken') } });

    if (postMatchAnd.length > 0) {
        pipeline.push({ $match: { $and: postMatchAnd } });
    }

    return pipeline;
};

/**
 * Computes global account stats (unaffected by any list filters/pagination) via
 * a single cheap $group aggregation instead of looping over loaded documents.
 */
const getAccountsStats = async () => {
    const [result] = await UserModel.aggregate([
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                verified: { $sum: { $cond: ['$isVerified', 1, 0] } },
                unverified: { $sum: { $cond: ['$isVerified', 0, 1] } },
                activeSubscriptions: { $sum: { $cond: [{ $eq: ['$subscriptionStatus', 'active'] }, 1, 0] } },
                inactiveSubscriptions: { $sum: { $cond: [{ $eq: ['$subscriptionStatus', 'inactive'] }, 1, 0] } },
                cancelledSubscriptions: { $sum: { $cond: [{ $eq: ['$subscriptionStatus', 'cancelled'] }, 1, 0] } },
                trialUsers: { $sum: { $cond: ['$isInTrialPeriod', 1, 0] } },
                LITE: { $sum: { $cond: [{ $eq: ['$packageType', 'LITE'] }, 1, 0] } },
                PRO: { $sum: { $cond: [{ $eq: ['$packageType', 'PRO'] }, 1, 0] } },
                AGENCY: { $sum: { $cond: [{ $eq: ['$packageType', 'AGENCY'] }, 1, 0] } },
                accessUser: { $sum: { $cond: [{ $eq: ['$accessType', 'user'] }, 1, 0] } },
                accessSuperAdmin: { $sum: { $cond: [{ $eq: ['$accessType', 'superAdmin'] }, 1, 0] } }
            }
        }
    ]);

    return {
        total: result?.total || 0,
        verified: result?.verified || 0,
        unverified: result?.unverified || 0,
        activeSubscriptions: result?.activeSubscriptions || 0,
        inactiveSubscriptions: result?.inactiveSubscriptions || 0,
        cancelledSubscriptions: result?.cancelledSubscriptions || 0,
        trialUsers: result?.trialUsers || 0,
        packageStats: {
            LITE: result?.LITE || 0,
            PRO: result?.PRO || 0,
            AGENCY: result?.AGENCY || 0
        },
        accessTypeStats: {
            user: result?.accessUser || 0,
            superAdmin: result?.accessSuperAdmin || 0
        }
    };
};

/**
 * Get All Accounts Controller
 * Returns user accounts for the manage accounts page.
 * `page`/`limit`/filters are all optional query params - when `page` is omitted
 * (e.g. the AdminUserLogs page calling this same endpoint), the full unpaginated,
 * unfiltered list is returned exactly as before for backward compatibility.
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
        const { page, limit, search, brand, packageType, statusFilter, startDate, endDate, spApiFilter, adsFilter } = req.query;
        const isPaginated = page !== undefined || limit !== undefined;

        const pipeline = buildAccountsPipeline({ packageType, statusFilter, startDate, endDate, brand, search, spApiFilter, adsFilter });

        let pageNum, limitNum;
        if (isPaginated) {
            pageNum = Math.max(1, parseInt(page) || 1);
            limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
            const skip = (pageNum - 1) * limitNum;
            pipeline.push({
                $facet: {
                    data: [{ $skip: skip }, { $limit: limitNum }],
                    totalCount: [{ $count: 'count' }]
                }
            });
        }

        // PERFORMANCE OPTIMIZATION: fetch the accounts page and the global stats in parallel
        const [aggregateResult, stats] = await Promise.all([
            UserModel.aggregate(pipeline),
            getAccountsStats()
        ]);

        let accounts;
        let pagination = null;
        if (isPaginated) {
            accounts = aggregateResult[0]?.data || [];
            const totalCount = aggregateResult[0]?.totalCount?.[0]?.count || 0;
            pagination = {
                currentPage: pageNum,
                limit: limitNum,
                totalCount,
                totalPages: Math.max(1, Math.ceil(totalCount / limitNum))
            };
        } else {
            accounts = aggregateResult;
        }

        // Transform the data to include additional computed fields
        // Since we used aggregation, sellerCentral/subscriptionInfo are already trimmed
        const accountsWithStats = accounts.map(account => ({
            ...account,
            fullName: `${account.firstName} ${account.lastName}`,
            joinedDate: account.createdAt,
            lastUpdated: account.updatedAt,
            isAdmin: account.accessType === 'superAdmin',
            hasValidSubscription: account.subscriptionStatus === 'active',
            // Check if trial is expired
            isTrialExpired: account.isInTrialPeriod && account.trialEndsDate && new Date() > new Date(account.trialEndsDate),
            // Include brand from sellerCentral
            brand: account.sellerCentral?.brand || null,
            // Renewal date sourced from the Subscription doc, already synced from Stripe via webhooks
            renewalDate: account.subscriptionInfo?.nextBillingDate || account.subscriptionInfo?.currentPeriodEnd || null
        }));

        // Card-connected: bounded live Stripe lookup, only for the current page's rows
        // (never for the unpaginated legacy path, to avoid firing a Stripe call per user)
        if (isPaginated) {
            await Promise.all(accountsWithStats.map(async (account) => {
                const subInfo = account.subscriptionInfo;
                if (subInfo?.paymentGateway === 'stripe' && subInfo?.stripeCustomerId) {
                    try {
                        const cardStatus = await StripeService.getCardConnectionStatus(subInfo.stripeCustomerId);
                        account.cardConnected = cardStatus.connected;
                        account.cardBrand = cardStatus.brand;
                        account.cardLast4 = cardStatus.last4;
                    } catch (error) {
                        logger.error(`Failed to fetch card status for stripeCustomerId ${subInfo.stripeCustomerId}: ${error.message}`);
                        account.cardConnected = null; // unknown - Stripe call failed
                    }
                } else {
                    account.cardConnected = false;
                }
            }));
        } else {
            accountsWithStats.forEach(account => { account.cardConnected = false; });
        }

        const responseData = {
            accounts: accountsWithStats,
            stats,
            totalCount: isPaginated ? pagination.totalCount : accountsWithStats.length,
            ...(isPaginated ? { pagination } : {})
        };

        logger.info(`SuperAdmin ${adminId} retrieved ${accountsWithStats.length} accounts${isPaginated ? ` (page ${pageNum})` : ''}`);

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

/**
 * Delete User Controller
 * Deletes a user and all associated seller documents from the database
 * Protected route - requires superAdmin access
 */
const deleteUser = asyncHandler(async (req, res) => {
    const adminId = req.SuperAdminId; // Should be set by auth middleware
    const { userId } = req.params;

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
        // Prevent admin from deleting themselves
        if (adminId.toString() === userId.toString()) {
            logger.error(new ApiError(400, "Cannot delete your own account"));
            return res.status(400).json(new ApiResponse(400, "", "Cannot delete your own account"));
        }

        // Use the delete service to delete user and seller documents (hybrid: immediate)
        const result = await deleteUserById(userId);

        logger.info(`SuperAdmin ${adminId} deleted user ${userId}`);

        // Enqueue full data purge in background (independent queue; does not affect existing flows)
        try {
            await enqueueFullUserDataPurge(userId);
        } catch (enqueueErr) {
            logger.error(`[deleteUser] Failed to enqueue full user data purge for ${userId}:`, enqueueErr);
            // Do not fail the request; user and sellers are already deleted
        }

        return res.status(200).json(new ApiResponse(200, result.data, "User account and seller documents deleted. Remaining data will be removed in the background."));

    } catch (error) {
        // Handle ApiError instances
        if (error instanceof ApiError) {
            logger.error(error);
            return res.status(error.statusCode || 500).json(new ApiResponse(error.statusCode || 500, "", error.message));
        }

        // Handle other errors
        logger.error(new ApiError(500, `Error deleting user: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", "Failed to delete user"));
    }
});

/**
 * Get Payment Logs for a specific user
 * Returns payment history including successes, failures, webhooks for superAdmin viewing
 * Protected route - requires superAdmin access
 */
const getPaymentLogs = asyncHandler(async (req, res) => {
    const adminId = req.SuperAdminId; // Should be set by auth middleware
    const { userId } = req.params;
    const { 
        page = 1, 
        limit = 50, 
        eventType, 
        status, 
        startDate, 
        endDate 
    } = req.query;

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

    if (!userId) {
        logger.error(new ApiError(400, "User ID is required"));
        return res.status(400).json(new ApiResponse(400, "", "User ID is required"));
    }

    try {
        // Verify user exists
        const user = await UserModel.findById(userId).select('firstName lastName email packageType subscriptionStatus');
        if (!user) {
            logger.error(new ApiError(404, "User not found"));
            return res.status(404).json(new ApiResponse(404, "", "User not found"));
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Get payment logs with filters
        const logs = await PaymentLogs.getLogsByUser(userId, {
            limit: parseInt(limit),
            skip,
            eventType,
            status,
            startDate,
            endDate
        });

        // Get total count for pagination
        const totalCount = await PaymentLogs.countByUser(userId, {
            eventType,
            status,
            startDate,
            endDate
        });

        // Get payment statistics for the user
        const stats = await PaymentLogs.getUserPaymentStats(userId);

        const responseData = {
            user: {
                _id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                packageType: user.packageType,
                subscriptionStatus: user.subscriptionStatus
            },
            logs,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalCount,
                limit: parseInt(limit)
            },
            stats
        };

        logger.info(`SuperAdmin ${adminId} viewed payment logs for user ${userId}`);

        return res.status(200).json(new ApiResponse(200, responseData, "Payment logs retrieved successfully"));

    } catch (error) {
        logger.error(new ApiError(500, `Error fetching payment logs: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", "Failed to fetch payment logs"));
    }
});

/**
 * Get All Payment Logs (for all users)
 * Returns payment history for all users with filtering and pagination
 * Protected route - requires superAdmin access
 */
const getAllPaymentLogs = asyncHandler(async (req, res) => {
    const adminId = req.SuperAdminId; // Should be set by auth middleware
    const { 
        page = 1, 
        limit = 100, 
        userId,
        eventType, 
        status, 
        paymentGateway,
        startDate, 
        endDate 
    } = req.query;

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
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const limitNum = parseInt(limit);

        // Build same query for count
        const countQuery = {};
        if (userId) countQuery.userId = userId;
        if (eventType) countQuery.eventType = eventType.toUpperCase();
        if (status) countQuery.status = status.toUpperCase();
        if (paymentGateway) countQuery.paymentGateway = paymentGateway.toUpperCase();
        if (startDate || endDate) {
            countQuery.createdAt = {};
            if (startDate) countQuery.createdAt.$gte = new Date(startDate);
            if (endDate) countQuery.createdAt.$lte = new Date(endDate);
        }

        const [logs, totalCount, failedPaymentsSummary] = await Promise.all([
            PaymentLogs.getAllLogs({
                limit: limitNum,
                skip,
                userId,
                eventType,
                status,
                paymentGateway,
                startDate,
                endDate
            }),
            PaymentLogs.countDocuments(countQuery),
            PaymentLogs.getFailedPaymentsSummary(30)
        ]);

        const responseData = {
            logs,
            pagination: {
                currentPage: parseInt(page),
                limit: limitNum,
                totalCount,
                totalPages: Math.ceil(totalCount / limitNum),
                hasMore: logs.length === limitNum
            },
            failedPaymentsSummary
        };

        logger.info(`SuperAdmin ${adminId} viewed all payment logs`);

        return res.status(200).json(new ApiResponse(200, responseData, "Payment logs retrieved successfully"));

    } catch (error) {
        logger.error(new ApiError(500, `Error fetching payment logs: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", "Failed to fetch payment logs"));
    }
});

/**
 * Cancel User Subscription (Admin action)
 * Allows superAdmin to cancel any user's subscription (Stripe or Razorpay)
 * Works for both active subscriptions and trial subscriptions
 * Protected route - requires superAdmin access
 */
const cancelUserSubscription = asyncHandler(async (req, res) => {
    const adminId = req.SuperAdminId; // Should be set by auth middleware
    const { userId } = req.params;

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
        // Get user info
        const user = await UserModel.findById(userId).select('firstName lastName email packageType subscriptionStatus isInTrialPeriod');
        if (!user) {
            logger.error(new ApiError(404, "User not found"));
            return res.status(404).json(new ApiResponse(404, "", "User not found"));
        }

        // Find the user's subscription
        const subscription = await Subscription.findOne({ 
            userId,
            status: { $in: ['active', 'trialing', 'authenticated'] }
        });

        if (!subscription) {
            // Check if user is on LITE plan (no active subscription to cancel)
            if (user.packageType === 'LITE') {
                return res.status(400).json(new ApiResponse(400, "", "User is on LITE plan with no active subscription to cancel"));
            }
            
            // User might have subscription data but no active subscription - update status manually
            await UserModel.findByIdAndUpdate(userId, {
                packageType: 'LITE',
                subscriptionStatus: 'cancelled',
                isInTrialPeriod: false,
                trialEndsDate: null,
                reviewRequestAuthStatus: false,
            });

            logger.info(`SuperAdmin ${adminId} cancelled subscription for user ${userId} (no active subscription found, status updated)`);

            return res.status(200).json(new ApiResponse(200, {
                userId,
                previousPackageType: user.packageType,
                newPackageType: 'LITE',
                message: 'User status updated to cancelled (no active subscription found)'
            }, "User subscription status updated"));
        }

        const paymentGateway = subscription.paymentGateway;
        const previousPackageType = subscription.planType || user.packageType;
        const wasTrialing = subscription.status === 'trialing' || subscription.hasTrial || user.isInTrialPeriod;

        let result;

        // Cancel subscription based on payment gateway
        if (paymentGateway === 'razorpay') {
            // Check if Razorpay is configured
            if (!RazorpayService.isConfigured()) {
                // Manually update subscription in database if Razorpay is not configured
                await Subscription.findOneAndUpdate(
                    { userId },
                    {
                        status: 'cancelled',
                        cancelAtPeriodEnd: false,
                        hasTrial: false,
                        trialEndsAt: null
                    }
                );

                await UserModel.findByIdAndUpdate(userId, {
                    packageType: 'LITE',
                    subscriptionStatus: 'cancelled',
                    isInTrialPeriod: false,
                    trialEndsDate: null
                });

                result = {
                    success: true,
                    message: 'Subscription cancelled in database (Razorpay not configured)',
                    wasTrialing
                };
            } else {
                // Cancel via Razorpay service
                result = await RazorpayService.cancelSubscription(userId);
            }
        } else if (paymentGateway === 'stripe') {
            // Cancel via Stripe service (immediate cancellation for admin action)
            result = await StripeService.cancelSubscription(userId, false);
        } else {
            // Unknown payment gateway - update database manually
            await Subscription.findOneAndUpdate(
                { userId },
                {
                    status: 'cancelled',
                    cancelAtPeriodEnd: false,
                    hasTrial: false,
                    trialEndsAt: null
                }
            );

            await UserModel.findByIdAndUpdate(userId, {
                packageType: 'LITE',
                subscriptionStatus: 'cancelled',
                isInTrialPeriod: false,
                trialEndsDate: null
            });

            result = {
                success: true,
                message: 'Subscription cancelled in database',
                wasTrialing
            };
        }

        // Log the admin action
        await PaymentLogs.logEvent({
            userId,
            eventType: 'ADMIN_SUBSCRIPTION_CANCELLED',
            paymentGateway: paymentGateway?.toUpperCase() || 'UNKNOWN',
            status: 'SUCCESS',
            subscriptionId: subscription.stripeSubscriptionId || subscription.razorpaySubscriptionId,
            planType: 'LITE',
            previousPlanType: previousPackageType,
            previousStatus: subscription.status,
            newStatus: 'cancelled',
            message: `SuperAdmin cancelled subscription${wasTrialing ? ' (was in trial)' : ''}`,
            source: 'ADMIN',
            metadata: {
                adminId: adminId.toString(),
                adminEmail: admin.email,
                wasTrialing
            }
        });

        logger.info(`SuperAdmin ${adminId} cancelled subscription for user ${userId} (gateway: ${paymentGateway}, wasTrialing: ${wasTrialing})`);

        return res.status(200).json(new ApiResponse(200, {
            userId,
            userEmail: user.email,
            userName: `${user.firstName} ${user.lastName}`,
            previousPackageType,
            newPackageType: 'LITE',
            paymentGateway,
            wasTrialing,
            ...result
        }, wasTrialing ? "Trial subscription cancelled successfully" : "Subscription cancelled successfully"));

    } catch (error) {
        // Log the failure
        await PaymentLogs.logEvent({
            userId,
            eventType: 'ADMIN_SUBSCRIPTION_CANCELLED',
            paymentGateway: 'UNKNOWN',
            status: 'FAILED',
            errorMessage: error.message,
            message: 'SuperAdmin failed to cancel subscription',
            source: 'ADMIN',
            metadata: {
                adminId: adminId.toString()
            }
        });

        logger.error(new ApiError(500, `Error cancelling subscription: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", error.message || "Failed to cancel subscription"));
    }
});

/**
 * Refund the last payment for a user's Stripe subscription
 */
const refundUserPayment = asyncHandler(async (req, res) => {
    const adminId = req.SuperAdminId;
    const { userId } = req.params;

    if (!adminId) {
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }
    if (!userId) {
        return res.status(400).json(new ApiResponse(400, "", "User ID is required"));
    }

    const admin = await UserModel.findById(adminId);
    if (!admin || admin.accessType !== 'superAdmin') {
        return res.status(403).json(new ApiResponse(403, "", "SuperAdmin access required"));
    }

    try {
        const user = await UserModel.findById(userId).select('firstName lastName email');
        if (!user) {
            return res.status(404).json(new ApiResponse(404, "", "User not found"));
        }

        const result = await StripeService.refundLastPayment(userId);

        await PaymentLogs.logEvent({
            userId,
            eventType: 'ADMIN_REFUND_ISSUED',
            paymentGateway: 'STRIPE',
            status: 'SUCCESS',
            paymentId: result.refundId,
            amount: result.amount / 100,
            currency: result.currency?.toUpperCase() || 'USD',
            message: `SuperAdmin refunded payment: ${result.currency?.toUpperCase()} ${result.amount / 100}`,
            source: 'ADMIN',
            metadata: {
                adminId: adminId.toString(),
                adminEmail: admin.email,
                invoiceId: result.invoiceId,
                invoiceNumber: result.invoiceNumber,
            }
        });

        logger.info(`SuperAdmin ${adminId} refunded payment for user ${userId}: refundId=${result.refundId}`);

        return res.status(200).json(new ApiResponse(200, {
            userId,
            userEmail: user.email,
            userName: `${user.firstName} ${user.lastName}`,
            ...result,
        }, "Payment refunded successfully"));

    } catch (error) {
        await PaymentLogs.logEvent({
            userId,
            eventType: 'ADMIN_REFUND_ISSUED',
            paymentGateway: 'STRIPE',
            status: 'FAILED',
            errorMessage: error.message,
            message: 'SuperAdmin failed to refund payment',
            source: 'ADMIN',
            metadata: { adminId: adminId.toString() }
        });

        logger.error(`Error refunding payment for user ${userId}:`, error);
        return res.status(500).json(new ApiResponse(500, "", error.message || "Failed to refund payment"));
    }
});

/**
 * Update/extend the trial period for a user's Stripe subscription
 */
const updateUserTrialPeriod = asyncHandler(async (req, res) => {
    const adminId = req.SuperAdminId;
    const { userId } = req.params;
    const { trialDays } = req.body;

    if (!adminId) {
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }
    if (!userId) {
        return res.status(400).json(new ApiResponse(400, "", "User ID is required"));
    }

    const days = parseInt(trialDays);
    if (!days || isNaN(days) || days < 1 || days > 365) {
        return res.status(400).json(new ApiResponse(400, "", "Trial period must be between 1 and 365 days"));
    }

    const admin = await UserModel.findById(adminId);
    if (!admin || admin.accessType !== 'superAdmin') {
        return res.status(403).json(new ApiResponse(403, "", "SuperAdmin access required"));
    }

    try {
        const user = await UserModel.findById(userId).select('firstName lastName email packageType subscriptionStatus');
        if (!user) {
            return res.status(404).json(new ApiResponse(404, "", "User not found"));
        }

        const result = await StripeService.updateTrialPeriod(userId, days);

        await PaymentLogs.logEvent({
            userId,
            eventType: 'ADMIN_TRIAL_UPDATED',
            paymentGateway: 'STRIPE',
            status: 'SUCCESS',
            subscriptionId: result.subscriptionId,
            message: `SuperAdmin set trial to ${days} days (ends ${result.trialEnd.toISOString()})`,
            source: 'ADMIN',
            metadata: {
                adminId: adminId.toString(),
                adminEmail: admin.email,
                trialDays: days,
                trialEnd: result.trialEnd,
            }
        });

        logger.info(`SuperAdmin ${adminId} updated trial for user ${userId}: ${days} days, ends ${result.trialEnd.toISOString()}`);

        return res.status(200).json(new ApiResponse(200, {
            userId,
            userEmail: user.email,
            userName: `${user.firstName} ${user.lastName}`,
            trialDays: days,
            ...result,
        }, `Trial period set to ${days} days successfully`));

    } catch (error) {
        await PaymentLogs.logEvent({
            userId,
            eventType: 'ADMIN_TRIAL_UPDATED',
            paymentGateway: 'STRIPE',
            status: 'FAILED',
            errorMessage: error.message,
            message: 'SuperAdmin failed to update trial period',
            source: 'ADMIN',
            metadata: { adminId: adminId.toString() }
        });

        logger.error(`Error updating trial for user ${userId}:`, error);
        return res.status(500).json(new ApiResponse(500, "", error.message || "Failed to update trial period"));
    }
});

module.exports = {
    adminLogin,
    adminLogout,
    getAllAccounts,
    loginSelectedUser,
    deleteUser,
    getPaymentLogs,
    getAllPaymentLogs,
    cancelUserSubscription,
    exportAllAccountsCsv,
    refundUserPayment,
    updateUserTrialPeriod
};
