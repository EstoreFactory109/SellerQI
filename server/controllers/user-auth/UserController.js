const { createUser, getUserByEmail, verify, getUserById, updateInfo, updatePassword, getFirstAnalysisStatus } = require('../../Services/User/userServices.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { createAccessToken, createRefreshToken, createLocationToken, refreshAccess } = require('../../utils/Tokens.js');
const { verifyPassword, hashPassword } = require('../../utils/HashPassword.js');
const logger = require('../../utils/Logger.js');
const { generateOTP } = require('../../utils/OTPGenerator.js');
const { sendEmail } = require('../../Services/Email/SendOtp.js');
const UserModel = require('../../models/user-auth/userModel.js');
const SellerCentralModel = require('../../models/user-auth/sellerCentralModel.js');
const mongoose = require('mongoose');

const { uploadToCloudinary } = require('../../Services/Cloudinary/Cloudinary.js');
const AgencyAdminService = require('../../Services/User/AgencyAdminService.js');
const { sendEmailResetLink } = require('../../Services/Email/SendResetLink.js');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { UserSchedulingService } = require('../../Services/BackgroundJobs/UserSchedulingService.js');
const IPTrackingModel = require('../../models/system/IPTrackingModel.js');
const { OAuth2Client } = require('google-auth-library');
const { getHttpsCookieOptions } = require('../../utils/cookieConfig.js');
const sendVerificationCode = require('../../Services/SMS/sendSMS.js');
const subscriptionVerificationService = require('../../Services/User/SubscriptionVerificationService.js');

const registerUser = asyncHandler(async (req, res) => {
    const { firstname, lastname, phone, email, password, allTermsAndConditionsAgreed, packageType, isInTrialPeriod, subscriptionStatus, trialEndsDate, intendedPackage, agencyName } = req.body;
    // console.log(firstname)

    // Validate required fields - trialEndsDate is only required for trial users
    if (!firstname || !lastname || !phone || !email || !password || !packageType || (isInTrialPeriod == null) || !subscriptionStatus) {
        logger.error(new ApiError(400, "Details and credentials are missing"));
        return res.status(400).json(new ApiResponse(400, "", "Details and credentials are missing"));
    }

    // Agency name is required for AGENCY package type
    if (packageType === 'AGENCY' && !agencyName) {
        logger.error(new ApiError(400, "Agency name is required for AGENCY package"));
        return res.status(400).json(new ApiResponse(400, "", "Agency name is required for agency registration"));
    }

    // If user is in trial period, trialEndsDate is required
    if (isInTrialPeriod === true && !trialEndsDate) {
        logger.error(new ApiError(400, "Trial end date is required for trial users"));
        return res.status(400).json(new ApiResponse(400, "", "Trial end date is required for trial users"));
    }

    if (typeof allTermsAndConditionsAgreed !== 'boolean' || allTermsAndConditionsAgreed !== true) {
        logger.error(new ApiError(400, "Terms and conditions agreement is required"));
        return res.status(400).json(new ApiResponse(400, "", "You must agree to the Terms of Use and Privacy Policy"));
    }

    // Check if user already exists
    const checkUserIfExists = await getUserByEmail(email);
     if (checkUserIfExists) {
         logger.error(new ApiError(409, "User already exists"));
         return res.status(409).json(new ApiResponse(409, "", "User already exists"));
    }

    let otp = generateOTP();

    if (!otp) {
        logger.error(new ApiError(500, "Internal server error in generating OTP"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in generating OTP"));
    }

     let emailSent = await sendEmail(email, firstname, otp);
  
      if (!emailSent) {
          logger.error(new ApiError(500, "Internal server error in sending email"));
          return res.status(500).json(new ApiResponse(500, "", "Internal server error in sending email"));
      }

   /* let smsSent = await sendVerificationCode(otp, phone);

    if (!smsSent) {
        logger.error(new ApiError(500, "Internal server error in sending SMS"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in sending SMS"));
    }   */

    // Create user with proper package settings
    // PRO-Trial: isInTrialPeriod=true, subscriptionStatus=active, trialEndsDate set
    // PRO: isInTrialPeriod=false, subscriptionStatus=inactive (needs payment)
    // AGENCY: includes agencyName
    let data = await createUser(
        firstname, 
        lastname, 
        phone, 
        phone, 
        email, 
        password, 
        otp, 
        allTermsAndConditionsAgreed, 
        packageType,           // PRO for both PRO-Trial and PRO, AGENCY for agencies
        isInTrialPeriod,       // true for PRO-Trial, false for PRO
        subscriptionStatus,    // active for PRO-Trial, inactive for PRO (pending payment)
        trialEndsDate,         // Date for PRO-Trial, null for PRO
        agencyName             // Required for AGENCY, null for others
    );

    if (!data) {
        logger.error(new ApiError(500, "Internal server error in registering user"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in registering user"));
    }

    logger.info(`User registered: ${email}, package: ${packageType}, isInTrialPeriod: ${isInTrialPeriod}, intendedPackage: ${intendedPackage || 'not specified'}`);

    res.status(201)
        .json(new ApiResponse(201, { 
            email: email,
            packageType: packageType,
            isInTrialPeriod: isInTrialPeriod,
            subscriptionStatus: subscriptionStatus
        }, "User registered successfully. OTP has been sent to your email address"));

})

const registerAgencyClient = asyncHandler(async (req, res) => {
    const { firstname, lastname, phone, email, allTermsAndConditionsAgreed } = req.body;
    // Use adminId (from AdminToken) for agency owner - this is set by auth middleware
    // Fallback to userId for backward compatibility
    const agencyOwnerId = req.adminId || req.userId;

    // Password is no longer required for agency clients
    if (!firstname || !lastname || !phone || !email) {
        logger.error(new ApiError(400, "Details are missing"));
        return res.status(400).json(new ApiResponse(400, "", "Details are missing (firstname, lastname, phone, email)"));
    }

    if (!agencyOwnerId) {
        logger.error(new ApiError(401, "Unauthorized: Agency owner not found"));
        return res.status(401).json(new ApiResponse(401, "", "Unauthorized: Agency owner not found"));
    }

    // Check if agency owner has AGENCY package
    const agencyOwner = await UserModel.findById(agencyOwnerId);
    if (!agencyOwner || agencyOwner.packageType !== 'AGENCY') {
        logger.error(new ApiError(403, "Only AGENCY package users can register clients"));
        return res.status(403).json(new ApiResponse(403, "", "Only AGENCY package users can register clients"));
    }

    // Check if client email already exists
    const checkUserIfExists = await getUserByEmail(email);
    if (checkUserIfExists) {
        logger.error(new ApiError(409, "User already exists"));
        return res.status(409).json(new ApiResponse(409, "", "User already exists"));
    }

    try {
        // Agency clients do not have passwords - they can only be accessed via agency owner
        // Create the client user with agencyId set to agency owner
        const newClient = new UserModel({
            firstName: firstname,
            lastName: lastname,
            phone: phone,
            whatsapp: phone, // Use phone as whatsapp for simplicity
            email: email,
            // No password stored for agency clients
            isVerified: true, // Auto-verify agency clients
            allTermsAndConditionsAgreed: allTermsAndConditionsAgreed || true,
            packageType: 'PRO', // Give clients PRO access by default
            agencyId: agencyOwnerId, // Store the agency owner's ID
            isAgencyClient: true, // Mark as agency client
            adminId: agencyOwnerId, // Keep for backward compatibility
            OTP: null
        });

        const savedClient = await newClient.save();

        if (!savedClient) {
            logger.error(new ApiError(500, "Internal server error in creating client"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating client"));
        }

        // Create tokens for the new client (switch to client context)
        const AccessToken = await createAccessToken(savedClient._id);
        const RefreshToken = await createRefreshToken(savedClient._id);

        if (!AccessToken || !RefreshToken) {
            logger.error(new ApiError(500, "Internal server error in creating tokens"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating tokens"));
        }

        // Update client with refresh token
        await UserModel.findOneAndUpdate(
            { _id: savedClient._id },
            { $set: { appRefreshToken: RefreshToken } },
            { new: true }
        );

        // Initialize background job scheduling for the new client
        try {
            await UserSchedulingService.initializeUserSchedule(savedClient._id);
            logger.info(`Background job scheduling initialized for client ${savedClient._id}`);
        } catch (error) {
            logger.error(`Failed to initialize scheduling for client ${savedClient._id}:`, error);
            // Don't fail the registration process if scheduling fails
        }

        // Create admin token for the agency owner (to be stored in localStorage)
        const AdminAccessToken = await createAccessToken(agencyOwnerId);

        const options = getHttpsCookieOptions();

        // Set cookies for the client (the user will operate as the client)
        // Also return admin token in response for localStorage storage
        res.status(201)
            .cookie("IBEXAccessToken", AccessToken, options)
            .cookie("IBEXRefreshToken", RefreshToken, options)
            .json(new ApiResponse(201, {
                clientId: savedClient._id,
                firstName: savedClient.firstName,
                lastName: savedClient.lastName,
                email: savedClient.email,
                // Admin token for the agency owner
                adminToken: AdminAccessToken,
                adminId: agencyOwnerId,
                adminAccessType: agencyOwner.accessType || 'enterpriseAdmin',
                agencyName: agencyOwner.agencyName || ''
            }, "Client registered successfully"));

    } catch (error) {
        logger.error(new ApiError(500, `Error creating client: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating client"));
    }
});

const verifyUser = asyncHandler(async (req, res) => {

    const { email, otp } = req.body;

    console.log("email: ", email);
    console.log("otp: ", otp);

    if (!email || !otp) {
        logger.error(new ApiError(400, "Email or OTP is missing"));
        return res.status(400).json(new ApiError(400, "Email or OTP is missing"));
    }

    const verifyUser = await verify(email, otp);

    if (!verifyUser) {
        logger.error(new ApiError(400, "Invalid OTP"));
        return res.status(400).json(new ApiError(400, "Invalid OTP"));
    }

    const AccessToken = await createAccessToken(verifyUser.id);
    const RefreshToken = await createRefreshToken(verifyUser.id);


    if (!AccessToken || !RefreshToken) {
        logger.error(new ApiError(500, "Internal server error in creating access token or refresh Token"));
        return res.status(500).json(new ApiError(500, "Internal server error in creating access token"));
    }

    const UpdateRefreshToken = await UserModel.findOneAndUpdate(
        { _id: verifyUser.id, isVerified: true },
        { $set: { appRefreshToken: RefreshToken } },
        { new: true }
    )

    if (!UpdateRefreshToken) {
        logger.error(new ApiError(500, "Internal server error in updating refresh token"));
        return res.status(500).json(new ApiError(500, "Internal server error in updating refresh token"));
    }

    // Initialize background job scheduling for the new user
    try {
        await UserSchedulingService.initializeUserSchedule(verifyUser.id);
        logger.info(`Background job scheduling initialized for user ${verifyUser.id}`);
    } catch (error) {
        logger.error(`Failed to initialize scheduling for user ${verifyUser.id}:`, error);
        // Don't fail the verification process if scheduling fails
    }

    const options = getHttpsCookieOptions();

    // Return user package info for frontend to determine redirect
    const responseData = {
        userId: verifyUser.id,
        packageType: verifyUser.packageType,
        isInTrialPeriod: verifyUser.isInTrialPeriod,
        subscriptionStatus: verifyUser.subscriptionStatus,
        trialEndsDate: verifyUser.trialEndsDate
    };

    res.status(200)
        .cookie("IBEXAccessToken", AccessToken, options)
        .cookie("IBEXRefreshToken", RefreshToken, options)
        .json(new ApiResponse(200, responseData, "User verified successfully"))


})





const profileUser = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const isSuperAdminSession = req.isSuperAdminSession || false;
    
    console.log('=== PROFILE ENDPOINT CALLED ===');
    console.log('userId:', userId);
    console.log('isSuperAdminSession:', isSuperAdminSession);

    if (!userId) {
        logger.error(new ApiError(400, "User id is missing"));
        return res.status(400).json(new ApiResponse(400, "", "User id is missing"));
    }

    const userProfile = await getUserById(userId);
    console.log('userProfile from getUserById:', JSON.stringify(userProfile, null, 2));

    if (!userProfile) {
        logger.error(new ApiError(404, "User not found"));
        return res.status(404).json(new ApiResponse(404, "", "User not found"));
    }

    // Add super admin session flag to the response
    // This tells the frontend that a super admin is viewing this account
    const responseData = {
        ...userProfile,
        isSuperAdminSession: isSuperAdminSession
    };

    return res.status(200).json(new ApiResponse(200, responseData, "User profile fetched successfully"));
})






const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;


    if (!email || !password) {
        logger.error(new ApiError(400, "Details and credentials are missing"));
        return res.status(400).json(new ApiResponse(400, "", "Details and credentials are missing"));
    }

    const checkUserIfExists = await getUserByEmail(email);

    console.log("checkUserIfExists: ", checkUserIfExists);




    if (!checkUserIfExists) {
        logger.error(new ApiError(404, "User not found"));
        return res.status(404).json(new ApiResponse(404, "", "User not found"));
    }

    // Block agency clients from direct login - they can only be accessed via agency owner
    if (checkUserIfExists.isAgencyClient === true || checkUserIfExists.agencyId) {
        logger.warn(`Agency client ${checkUserIfExists.email} attempted direct login`);
        return res.status(403).json(new ApiResponse(403, "", "Agency clients cannot login directly. Please contact your agency administrator."));
    }

    if (checkUserIfExists.isVerified === false) {

        let otp = generateOTP();

        if (!otp) {
            logger.error(new ApiError(500, "Internal server error in generating OTP"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in generating OTP"));
        }

        let emailSent = await sendEmail(checkUserIfExists.email, checkUserIfExists.firstName, otp);
  
        if (!emailSent) {
            logger.error(new ApiError(500, "Internal server error in sending email"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in sending email"));
        }

        checkUserIfExists.OTP = otp;
        await checkUserIfExists.save();

        logger.info(`OTP sent to unverified user: ${checkUserIfExists.email}`);
        return res.status(401).json(new ApiResponse(401, { email: checkUserIfExists.email }, "User not verified"));
    }

    // Agency clients have no password, but this check happens above
    // For regular users, verify password
    const checkPassword = await verifyPassword(password, checkUserIfExists.password);

    if (!checkPassword) {
        logger.error(new ApiError(401, "Password not matched"))
        return res.status(401).json(new ApiResponse(401, "", "Password not matched"));
    }

    // Check trial status on login
    if (checkUserIfExists.isInTrialPeriod && checkUserIfExists.trialEndsDate) {
        const currentDate = new Date();
        const trialEndDate = new Date(checkUserIfExists.trialEndsDate);

        // If trial has expired according to our database, verify with payment gateway before downgrading
        if (currentDate > trialEndDate) {
            // IMPORTANT: Verify with Stripe/Razorpay before downgrading
            // This prevents incorrect downgrades when webhooks fail or are delayed
            const verificationResult = await subscriptionVerificationService.verifySubscriptionBeforeDowngrade(checkUserIfExists._id);
            
            logger.info(`User ${checkUserIfExists._id} trial expired. Verification result:`, {
                hasActiveSubscription: verificationResult.hasActiveSubscription,
                gateway: verificationResult.gateway,
                gatewayStatus: verificationResult.gatewayStatus,
                shouldDowngrade: verificationResult.shouldDowngrade,
                message: verificationResult.message
            });

            if (verificationResult.shouldDowngrade) {
                // Safe to downgrade - no active subscription with payment gateway
                await UserModel.findByIdAndUpdate(checkUserIfExists._id, {
                    isInTrialPeriod: false,
                    packageType: 'LITE',
                    subscriptionStatus: 'inactive'
                });

                // Update the local user object for the response
                checkUserIfExists.isInTrialPeriod = false;
                checkUserIfExists.packageType = 'LITE';
                checkUserIfExists.subscriptionStatus = 'inactive';

                logger.info(`User ${checkUserIfExists._id} trial expired and no active subscription found. Downgraded to LITE plan.`);
            } else if (verificationResult.hasActiveSubscription) {
                // DON'T downgrade - user has an active subscription with the payment gateway
                // Sync the subscription status from the gateway
                const syncResult = await subscriptionVerificationService.syncSubscriptionFromGateway(
                    checkUserIfExists._id, 
                    verificationResult, 
                    UserModel
                );
                
                logger.info(`User ${checkUserIfExists._id} has active ${verificationResult.gateway} subscription (${verificationResult.gatewayStatus}). NOT downgrading. Sync result:`, syncResult);

                // Update the local user object for the response based on sync
                if (syncResult.synced) {
                    checkUserIfExists.isInTrialPeriod = verificationResult.gatewayStatus === 'trialing' || verificationResult.gatewayStatus === 'authenticated';
                    checkUserIfExists.subscriptionStatus = syncResult.newStatus === 'trialing' ? 'trialing' : 'active';
                    // Keep their paid package type (don't change to LITE)
                }
            } else {
                // Verification failed with an error - don't downgrade to be safe
                logger.warn(`User ${checkUserIfExists._id} trial expired but verification failed. NOT downgrading to be safe. Reason: ${verificationResult.message}`);
            }
        }
    }

    let getSellerCentral;
    let allSellerAccounts = null;
    let AccessToken, RefreshToken, LocationToken, adminToken = "";


    // Check if user is superAdmin
    if (checkUserIfExists.accessType === 'superAdmin') {
        // Get all seller central accounts from the database
        const allSellerCentrals = await SellerCentralModel.find({}).populate('User', 'firstName lastName email');

        if (!allSellerCentrals || allSellerCentrals.length === 0) {
            logger.error(new ApiError(404, "No seller central accounts found"));
            return res.status(404).json(new ApiResponse(404, "", "No seller central accounts found"));
        }

        // Use the first seller central account for tokens
        getSellerCentral = allSellerCentrals[0];

        adminToken = await createAccessToken(checkUserIfExists._id);
        AccessToken = await createAccessToken(getSellerCentral.User._id || getSellerCentral.User);
        RefreshToken = await createRefreshToken(getSellerCentral.User._id || getSellerCentral.User);
        LocationToken = await createLocationToken(getSellerCentral.sellerAccount[0].country, getSellerCentral.sellerAccount[0].region);
        
        // Prepare all accounts data to send in response for super admin
        allSellerAccounts = allSellerCentrals.map(sc => ({
            sellerCentralId: sc._id,
            userId: sc.User._id || sc.User,
            userName: sc.User.firstName ? `${sc.User.firstName} ${sc.User.lastName}` : 'Unknown',
            userEmail: sc.User.email || 'Unknown',
            sellerAccounts: sc.sellerAccount.map(acc => ({
                country: acc.country,
                region: acc.region,
                selling_partner_id: acc.selling_partner_id,
                hasSpApi: !!acc.spiRefreshToken,
                hasAdsApi: !!acc.adsRefreshToken
            }))
        }));

    } else if (checkUserIfExists.accessType === 'enterpriseAdmin') {
        // AdminToken = agency owner's token (for admin operations like adding clients)
        adminToken = await createAccessToken(checkUserIfExists._id);

        // IBEXAccessToken/IBEXRefreshToken = client's token (like superAdmin pattern)
        // Query by agencyId (new) OR adminId (legacy) for backward compatibility
        const latestClient = await UserModel.findOne({
            $or: [
                { agencyId: checkUserIfExists._id },
                { adminId: checkUserIfExists._id }
            ]
        }).sort({ createdAt: -1 });

        if (latestClient) {
            // Client exists - use client's token for IBEXAccessToken
            AccessToken = await createAccessToken(latestClient._id);
            RefreshToken = await createRefreshToken(latestClient._id);
            const clientSellerCentral = await SellerCentralModel.findOne({ User: latestClient._id });
            if (clientSellerCentral && clientSellerCentral.sellerAccount?.length > 0) {
                LocationToken = await createLocationToken(clientSellerCentral.sellerAccount[0].country, clientSellerCentral.sellerAccount[0].region);
            } else {
                LocationToken = await createLocationToken("US", "NA");
            }
        } else {
            // No clients yet - use agency owner's token as fallback
            AccessToken = await createAccessToken(checkUserIfExists._id);
            RefreshToken = await createRefreshToken(checkUserIfExists._id);
            LocationToken = await createLocationToken("US", "NA");
        }

    }
    else {
        getSellerCentral = await SellerCentralModel.findOne({ User: checkUserIfExists._id });
        if (!getSellerCentral) {
            AccessToken = await createAccessToken(checkUserIfExists._id);
            RefreshToken = await createRefreshToken(checkUserIfExists._id);
            LocationToken = await createLocationToken("US", "NA");
            logger.error(new ApiError(404, "Seller central not found"));
        } else {
            AccessToken = await createAccessToken(checkUserIfExists._id);
            RefreshToken = await createRefreshToken(checkUserIfExists._id);
            LocationToken = await createLocationToken(getSellerCentral.sellerAccount[0].country, getSellerCentral.sellerAccount[0].region);
        }
        // For regular users and enterpriseAdmin, get their own seller central

    }



    if (!AccessToken || !RefreshToken || !LocationToken) {
        logger.error(new ApiError(500, "Internal server error in creating tokens"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating tokens"));
    }



    const option = getHttpsCookieOptions();




    // Prepare response data
    const responseData = {
        firstName: checkUserIfExists.firstName,
        lastName: checkUserIfExists.lastName,
        email: checkUserIfExists.email,
        phone: checkUserIfExists.phone,
        whatsapp: checkUserIfExists.whatsapp,
        accessType: checkUserIfExists.accessType,
        packageType: checkUserIfExists.packageType,
        subscriptionStatus: checkUserIfExists.subscriptionStatus,
        isInTrialPeriod: checkUserIfExists.isInTrialPeriod || false,
        trialEndsDate: checkUserIfExists.trialEndsDate || null
    };

    // Add sellerCentral data if available (needed for SP-API and Ads connection check on frontend)
    if (getSellerCentral) {
        responseData.sellerCentral = {
            sellerAccount: getSellerCentral.sellerAccount.map(account => ({
                country: account.country,
                region: account.region,
                selling_partner_id: account.selling_partner_id,
                spiRefreshToken: account.spiRefreshToken ? 'connected' : null, // Don't expose actual token, just indicate if connected
                adsRefreshToken: account.adsRefreshToken ? 'connected' : null // Don't expose actual token, just indicate if connected
            }))
        };
    }

    // Add all seller accounts data if user is superAdmin
    if (checkUserIfExists.accessType === 'superAdmin' && allSellerAccounts) {
        responseData.allSellerAccounts = allSellerAccounts;
        responseData.activeAccount = {
            sellingPartnerId: getSellerCentral.selling_partner_id,
            country: getSellerCentral.sellerAccount[0].country,
            region: getSellerCentral.sellerAccount[0].region
        };
    }

    console.log(adminToken);
    res.status(200)
        .cookie("AdminToken", adminToken, option)
        .cookie("IBEXAccessToken", AccessToken, option)
        .cookie("IBEXRefreshToken", RefreshToken, option)
        .cookie("IBEXLocationToken", LocationToken, option)
        .json(new ApiResponse(200, responseData, "User Loggedin successfully"))
})

const logoutUser = asyncHandler(async (req, res) => {

    const userId = req.userId;

    if (!userId) {
        logger.error(new ApiError(400, "User id is missing"));
        return res.status(400).json(new ApiResponse(400, "", "User id is missing"));
    }

    const UpdateRefreshToken = await UserModel.findOneAndUpdate(
        { _id: userId, isVerified: true },
        { $set: { appRefreshToken: "" } },
        { new: true }
    )

    if (!UpdateRefreshToken) {
        logger.error(new ApiError(500, "Internal server error in updating refresh token"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in updating refresh token"));
    }

    // Define the SAME options used when setting cookies
    const option = getHttpsCookieOptions();

    // Clear cookies with the same options
    res.clearCookie("AdminToken", option);
    res.clearCookie("IBEXAccessToken", option);
    res.clearCookie("IBEXRefreshToken", option);
    res.clearCookie("IBEXLocationToken", option);

    res.status(200).json(new ApiResponse(200, "", "User logged out successfully"));
})

// Refresh access token using refresh token from cookie
const refreshAccessToken = asyncHandler(async (req, res) => {
    const refreshToken = req.cookies.IBEXRefreshToken;

    if (!refreshToken) {
        logger.error(new ApiError(401, "Refresh token is missing"));
        return res.status(401).json(new ApiResponse(401, "", "Refresh token is missing"));
    }

    const newAccessToken = await refreshAccess(refreshToken);

    if (!newAccessToken) {
        logger.error(new ApiError(401, "Invalid or expired refresh token"));
        return res.status(401).json(new ApiResponse(401, "", "Invalid or expired refresh token. Please login again."));
    }

    const option = getHttpsCookieOptions();

    return res.status(200)
        .cookie("IBEXAccessToken", newAccessToken, option)
        .json(new ApiResponse(200, "", "Access token refreshed successfully"));
})

const updateProfilePic = asyncHandler(async (req, res) => {
    const userId = req.userId;
    // console.log(userId)
    const avatar = req.file?.path;
    // console.log(avatar)
    if (!userId || !avatar) {
        logger.error(new ApiError(400, "User id or avater is missing"));
        return res.status(400).json(new ApiResponse(400, "", "User id is missing"));
    }
    const profilePicUrl = await uploadToCloudinary(avatar);

    if (!profilePicUrl) {
        logger.error(new ApiError(500, "Internal server error in uploading profile pic"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in uploading profile pic"));
    }

    const getUser = await UserModel.findById(userId);
    if (!getUser) {
        logger.error(new ApiError(404, "User not found"));
        return res.status(404).json(new ApiResponse(404, "", "User not found"));
    }

    getUser.profilePic = profilePicUrl;
    await getUser.save();

    res.status(200).json(new ApiResponse(200, { profilePicUrl: profilePicUrl }, "Profile pic updated successfully"));
})

const updateDetails = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { firstName, lastName, phone, whatsapp, email } = req.body;

    if (!userId || !firstName || !lastName || !phone || !whatsapp || !email) {
        logger.error(new ApiError(400, "User id or details are missing"));
        return res.status(400).json(new ApiResponse(400, "", "User id is missing"));
    }

    const UpdateInfo = await updateInfo(userId, firstName, lastName, phone, whatsapp, email);

    if (!UpdateInfo) {
        logger.error(new ApiError(500, "Internal server error in updating details"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in updating details"));
    }
    res.status(200).json(new ApiResponse(200, { UpdateInfo }, "Details updated successfully"));
})

const switchAccount = asyncHandler(async (req, res) => {
    const userId = req.userId; // Getting admin id from auth middleware

    const { country, region } = req.body;

    console.log("from switchAccount: ", userId, country, region);

    // Check if admin id exists

    // Validate required fields
    if (!country || !region) {
        logger.error(new ApiError(400, "country, and region are required"));
        return res.status(400).json(new ApiResponse(400, "", "userId, country, and region are required"));
    }


    let AccessToken = await createAccessToken(userId);
    let RefreshToken = await createRefreshToken(userId);
    let LocationToken = await createLocationToken(country, region);

    if (!AccessToken || !RefreshToken || !LocationToken) {
        logger.error(new ApiError(500, "Internal server error in creating tokens"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating tokens"));
    }

    const option = getHttpsCookieOptions();

    return res.status(200)
        .cookie("IBEXAccessToken", AccessToken, option)
        .cookie("IBEXRefreshToken", RefreshToken, option)
        .cookie("IBEXLocationToken", LocationToken, option)
        .json(new ApiResponse(200, "", "Account switched successfully"));

});

const verifyEmailForPasswordReset = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        logger.error(new ApiError(400, "Email is missing"));
        return res.status(400).json(new ApiResponse(400, "", "Email is missing"));
    }

    const user = await getUserByEmail(email);

    if (!user) {
        logger.error(new ApiError(404, "User not found"));
        return res.status(404).json(new ApiResponse(404, "", "User not found"));
    }

    const code = jwt.sign({ email: email, code: uuidv4() }, process.env.JWT_SECRET, { expiresIn: '30m' });
    user.resetPasswordCode = code;
    await user.save();

    const link = `${process.env.RESET_LINK_BASE_URI}/${code}`

    // console.log(link, email, user.firstName);

    const emailSent = await sendEmailResetLink(email, user.firstName, link);

    if (!emailSent) {
        logger.error(new ApiError(500, "Internal server error in sending email"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in sending email"));
    }

    return res.status(200).json(new ApiResponse(200, "", "Reset link sent successfully"));
})

const verifyResetPasswordCode = asyncHandler(async (req, res) => {
    const { code } = req.body;

    if (!code) {
        logger.error(new ApiError(400, "Code is missing"));
        return res.status(400).json(new ApiResponse(400, "", "Code is missing"));
    }

    try {
        const decoded = jwt.verify(code, process.env.JWT_SECRET);

        if (!decoded) {
            logger.error(new ApiError(400, "Invalid code"));
            return res.status(400).json(new ApiResponse(400, "", "Invalid code"));
        }

        const user = await getUserByEmail(decoded.email);

        if (!user) {
            logger.error(new ApiError(404, "User not found"));
            return res.status(404).json(new ApiResponse(404, "", "User not found"));
        }

        if (user.resetPasswordCode !== code) {
            logger.error(new ApiError(400, "Invalid code"));
            return res.status(400).json(new ApiResponse(400, "", "Invalid code"));
        }


        // If we reach here, the token is valid and not expired
        return res.status(200).json(new ApiResponse(200, "", "Code verified successfully"));

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            logger.error(new ApiError(401, "Reset link has expired"));
            return res.status(401).json(new ApiResponse(401, "", "Reset link has expired. Please request a new one."));
        } else if (error.name === 'JsonWebTokenError') {
            logger.error(new ApiError(400, "Invalid reset code"));
            return res.status(400).json(new ApiResponse(400, "", "Invalid reset code"));
        } else {
            logger.error(new ApiError(500, "Error verifying reset code"));
            return res.status(500).json(new ApiResponse(500, "", "Error verifying reset code"));
        }
    }
})

const resetPassword = asyncHandler(async (req, res) => {
    const { code, newPassword } = req.body;
    // console.log(code, newPassword);

    if (!code || !newPassword) {
        logger.error(new ApiError(400, "Code or new password is missing"));
        return res.status(400).json(new ApiResponse(400, "", "Code or new password is missing"));
    }

    try {
        // Verify the code first
        const decoded = jwt.verify(code, process.env.JWT_SECRET);

        if (!decoded) {
            logger.error(new ApiError(400, "Invalid code"));
            return res.status(400).json(new ApiResponse(400, "", "Invalid code"));
        }

        // Check if user exists
        const user = await getUserByEmail(decoded.email);

        if (!user) {
            logger.error(new ApiError(404, "User not found"));
            return res.status(404).json(new ApiResponse(404, "", "User not found"));
        }

        // Verify the reset code matches
        if (user.resetPasswordCode !== code) {
            logger.error(new ApiError(400, "Invalid reset code"));
            return res.status(400).json(new ApiResponse(400, "", "Invalid reset code"));
        }

        // Update the password
        const passwordUpdated = await updatePassword(decoded.email, newPassword);

        if (!passwordUpdated) {
            logger.error(new ApiError(500, "Internal server error in updating password"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in updating password"));
        }

        return res.status(200).json(new ApiResponse(200, "", "Password reset successfully"));

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            logger.error(new ApiError(401, "Reset link has expired"));
            return res.status(401).json(new ApiResponse(401, "", "Reset link has expired. Please request a new one."));
        } else if (error.name === 'JsonWebTokenError') {
            logger.error(new ApiError(400, "Invalid reset code"));
            return res.status(400).json(new ApiResponse(400, "", "Invalid reset code"));
        } else {
            logger.error(new ApiError(500, "Error resetting password"));
            return res.status(500).json(new ApiResponse(500, "", "Error resetting password"));
        }
    }
})

const getIPTracking = asyncHandler(async (req, res) => {

    const ip = req.ip;
    // console.log(ip);
    if (!ip) {
        logger.error(new ApiError(400, "IP is missing"));
        return res.status(400).json(new ApiResponse(400, "", "IP is missing"));
    }
    const checkIp = await IPTrackingModel.findOne({ ip });
    if (!checkIp) {
        const newIp = await IPTrackingModel.create({ ip });
        return res.status(200).json(new ApiResponse(200, { searchesLeft: newIp.searchesLeft }, "IP tracking created successfully"));
    } else {
        return res.status(200).json(new ApiResponse(200, { searchesLeft: checkIp.searchesLeft }, "IP tracking fetched successfully"));
    }
})

const TrackIP = asyncHandler(async (req, res) => {
    const ip = req.ip;
    if (!ip) {
        logger.error(new ApiError(400, "IP is missing"));
        return res.status(400).json(new ApiResponse(400, "", "IP is missing"));
    }

    try {
        const checkIp = await IPTrackingModel.findOne({ ip });

        if (!checkIp) {
            const newIp = await IPTrackingModel.create({ ip });
            return res.status(200).json(new ApiResponse(200, { searchesLeft: newIp.searchesLeft }, "IP tracking created successfully"));
        } else {
            if (checkIp.searchesLeft === 0) {
                if (checkIp.renewalDate < new Date()) {
                    checkIp.searchesLeft = 3;
                    checkIp.renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                    await checkIp.save();
                    return res.status(200).json(new ApiResponse(200, { searchesLeft: checkIp.searchesLeft }, "Number of searches renewed successfully"));
                } else {
                    return res.status(200).json(new ApiResponse(200, { searchesLeft: checkIp.searchesLeft }, "Number of searches expired"));
                }
            } else {
                checkIp.searchesLeft--;
                // console.log("searchesLeft",checkIp.searchesLeft);
                await checkIp.save();
                return res.status(200).json(new ApiResponse(200, { searchesLeft: checkIp.searchesLeft }, "Number of searches updated successfully"));
            }
        }


    } catch (error) {
        logger.error(new ApiError(500, "Internal server error in getting IP tracking"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in getting IP tracking"));
    }


})


const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Google OAuth Login Handler
const googleLoginUser = asyncHandler(async (req, res) => {
    const { idToken } = req.body;

    if (!idToken) {
        logger.error(new ApiError(400, "Google ID token is missing"));
        return res.status(400).json(new ApiResponse(400, "", "Google ID token is missing"));
    }

    try {
        // Verify the Google ID token using environment variable
        console.log('🔍 Verifying Google ID token...');
        console.log('🔑 Expected audience (Client ID):', process.env.GOOGLE_CLIENT_ID);

        const ticket = await googleClient.verifyIdToken({
            idToken: idToken,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        console.log('✅ Token verified successfully');
        console.log('🎯 Token audience:', payload.aud);
        console.log('📧 User email:', payload.email);

        const { email, name, given_name, family_name, picture } = payload;

        if (!email) {
            logger.error(new ApiError(400, "Email not provided by Google"));
            return res.status(400).json(new ApiResponse(400, "", "Email not provided by Google"));
        }

        // Check if user exists
        const checkUserIfExists = await getUserByEmail(email);

        if (!checkUserIfExists) {
            logger.error(new ApiError(404, "User not found. Please sign up first."));
            return res.status(404).json(new ApiResponse(404, "", "User not found. Please sign up first."));
        }

        // Check trial status on Google login
        if (checkUserIfExists.isInTrialPeriod && checkUserIfExists.trialEndsDate) {
            const currentDate = new Date();
            const trialEndDate = new Date(checkUserIfExists.trialEndsDate);

            // If trial has expired according to our database, verify with payment gateway before downgrading
            if (currentDate > trialEndDate) {
                // IMPORTANT: Verify with Stripe/Razorpay before downgrading
                // This prevents incorrect downgrades when webhooks fail or are delayed
                const verificationResult = await subscriptionVerificationService.verifySubscriptionBeforeDowngrade(checkUserIfExists._id);
                
                logger.info(`User ${checkUserIfExists._id} trial expired (Google login). Verification result:`, {
                    hasActiveSubscription: verificationResult.hasActiveSubscription,
                    gateway: verificationResult.gateway,
                    gatewayStatus: verificationResult.gatewayStatus,
                    shouldDowngrade: verificationResult.shouldDowngrade,
                    message: verificationResult.message
                });

                if (verificationResult.shouldDowngrade) {
                    // Safe to downgrade - no active subscription with payment gateway
                    await UserModel.findByIdAndUpdate(checkUserIfExists._id, {
                        isInTrialPeriod: false,
                        packageType: 'LITE',
                        subscriptionStatus: 'inactive'
                    });

                    // Update the local user object for the response
                    checkUserIfExists.isInTrialPeriod = false;
                    checkUserIfExists.packageType = 'LITE';
                    checkUserIfExists.subscriptionStatus = 'inactive';

                    logger.info(`User ${checkUserIfExists._id} trial expired and no active subscription found (Google login). Downgraded to LITE plan.`);
                } else if (verificationResult.hasActiveSubscription) {
                    // DON'T downgrade - user has an active subscription with the payment gateway
                    // Sync the subscription status from the gateway
                    const syncResult = await subscriptionVerificationService.syncSubscriptionFromGateway(
                        checkUserIfExists._id, 
                        verificationResult, 
                        UserModel
                    );
                    
                    logger.info(`User ${checkUserIfExists._id} has active ${verificationResult.gateway} subscription (${verificationResult.gatewayStatus}) during Google login. NOT downgrading. Sync result:`, syncResult);

                    // Update the local user object for the response based on sync
                    if (syncResult.synced) {
                        checkUserIfExists.isInTrialPeriod = verificationResult.gatewayStatus === 'trialing' || verificationResult.gatewayStatus === 'authenticated';
                        checkUserIfExists.subscriptionStatus = syncResult.newStatus === 'trialing' ? 'trialing' : 'active';
                        // Keep their paid package type (don't change to LITE)
                    }
                } else {
                    // Verification failed with an error - don't downgrade to be safe
                    logger.warn(`User ${checkUserIfExists._id} trial expired but verification failed (Google login). NOT downgrading to be safe. Reason: ${verificationResult.message}`);
                }
            }
        }

        let getSellerCentral;
        let allSellerAccounts = null;
        let AccessToken, RefreshToken, LocationToken, adminToken = "";

        // Check if user is superAdmin
        if (checkUserIfExists.accessType === 'superAdmin') {
            // Get all seller central accounts from the database
            const allSellerCentrals = await SellerCentralModel.find({}).populate('User', 'firstName lastName email');

            if (!allSellerCentrals || allSellerCentrals.length === 0) {
                logger.error(new ApiError(404, "No seller central accounts found"));
                return res.status(404).json(new ApiResponse(404, "", "No seller central accounts found"));
            }

            // Use the first seller central account for tokens
            getSellerCentral = allSellerCentrals[0];

            adminToken = await createAccessToken(checkUserIfExists._id);
            AccessToken = await createAccessToken(getSellerCentral.User._id || getSellerCentral.User);
            RefreshToken = await createRefreshToken(getSellerCentral.User._id || getSellerCentral.User);
            LocationToken = await createLocationToken(getSellerCentral.sellerAccount[0].country, getSellerCentral.sellerAccount[0].region);
            
            // Prepare all accounts data to send in response for super admin
            allSellerAccounts = allSellerCentrals.map(sc => ({
                sellerCentralId: sc._id,
                userId: sc.User._id || sc.User,
                userName: sc.User.firstName ? `${sc.User.firstName} ${sc.User.lastName}` : 'Unknown',
                userEmail: sc.User.email || 'Unknown',
                sellerAccounts: sc.sellerAccount.map(acc => ({
                    country: acc.country,
                    region: acc.region,
                    selling_partner_id: acc.selling_partner_id,
                    hasSpApi: !!acc.spiRefreshToken,
                    hasAdsApi: !!acc.adsRefreshToken
                }))
            }));
        } else {
            getSellerCentral = await SellerCentralModel.findOne({ User: checkUserIfExists._id });
            if (!getSellerCentral) {
                // User exists but doesn't have SellerCentral yet - allow login with default location
                // This can happen if user signed up but hasn't connected Amazon account yet
                AccessToken = await createAccessToken(checkUserIfExists._id);
                RefreshToken = await createRefreshToken(checkUserIfExists._id);
                LocationToken = await createLocationToken("US", "NA");
            } else {
                // For regular users and enterpriseAdmin, get their own seller central
                AccessToken = await createAccessToken(checkUserIfExists._id);
                RefreshToken = await createRefreshToken(checkUserIfExists._id);
                LocationToken = await createLocationToken(getSellerCentral.sellerAccount[0].country, getSellerCentral.sellerAccount[0].region);
            }
        }

        if (!AccessToken || !RefreshToken || !LocationToken) {
            logger.error(new ApiError(500, "Internal server error in creating tokens"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating tokens"));
        }

        const option = getHttpsCookieOptions();

        // Prepare response data
        const responseData = {
            firstName: checkUserIfExists.firstName,
            lastName: checkUserIfExists.lastName,
            email: checkUserIfExists.email,
            phone: checkUserIfExists.phone,
            whatsapp: checkUserIfExists.whatsapp,
            accessType: checkUserIfExists.accessType,
            packageType: checkUserIfExists.packageType,
            subscriptionStatus: checkUserIfExists.subscriptionStatus,
            isInTrialPeriod: checkUserIfExists.isInTrialPeriod || false,
            trialEndsDate: checkUserIfExists.trialEndsDate || null
        };

        // Add sellerCentral data if available (needed for SP-API and Ads connection check on frontend)
        if (getSellerCentral) {
            responseData.sellerCentral = {
                sellerAccount: getSellerCentral.sellerAccount.map(account => ({
                    country: account.country,
                    region: account.region,
                    selling_partner_id: account.selling_partner_id,
                    spiRefreshToken: account.spiRefreshToken ? 'connected' : null, // Don't expose actual token, just indicate if connected
                    adsRefreshToken: account.adsRefreshToken ? 'connected' : null // Don't expose actual token, just indicate if connected
                }))
            };
        }

        // Add all seller accounts data if user is superAdmin
        if (checkUserIfExists.accessType === 'superAdmin' && allSellerAccounts) {
            responseData.allSellerAccounts = allSellerAccounts;
            responseData.activeAccount = {
                sellingPartnerId: getSellerCentral.selling_partner_id,
                country: getSellerCentral.sellerAccount[0].country,
                region: getSellerCentral.sellerAccount[0].region
            };
        }

        res.status(200)
            .cookie("AdminToken", adminToken, option)
            .cookie("IBEXAccessToken", AccessToken, option)
            .cookie("IBEXRefreshToken", RefreshToken, option)
            .cookie("IBEXLocationToken", LocationToken, option)
            .json(new ApiResponse(200, responseData, "Google login successful"));

    } catch (error) {
        // Check if it's a JWT verification error
        if (error.message && error.message.includes('audience')) {
            logger.error(`🚫 JWT Audience Error: ${error.message}`);
            logger.error(`🔍 This usually means the Google Client ID mismatch`);
            logger.error(`🔑 Expected audience: ${process.env.GOOGLE_CLIENT_ID}`);
            logger.error(`💡 Check your Google Cloud Console OAuth configuration`);
            return res.status(400).json(new ApiResponse(400, "", "Google authentication failed: Invalid audience"));
        }

        logger.error(`Google login error: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, "", "Google authentication failed"));
    }
});

// Google OAuth Register Handler
const googleRegisterUser = asyncHandler(async (req, res) => {
    const { idToken, packageType, isInTrialPeriod, subscriptionStatus, trialEndsDate } = req.body;



    if (!idToken) {
        logger.error(new ApiError(400, "Google ID token is missing"));
        return res.status(400).json(new ApiResponse(400, "", "Google ID token is missing"));
    }

    // Validate required fields - trialEndsDate is only required for trial users
    if (!packageType || (isInTrialPeriod == null) || !subscriptionStatus) {
        logger.error(new ApiError(400, "Package type, isInTrialPeriod, and subscriptionStatus are missing"));
        return res.status(400).json(new ApiResponse(400, "", "Package type, isInTrialPeriod, and subscriptionStatus are missing"));
    }
    
    // If user is in trial period, trialEndsDate is required
    if (isInTrialPeriod === true && !trialEndsDate) {
        logger.error(new ApiError(400, "Trial end date is required for trial users"));
        return res.status(400).json(new ApiResponse(400, "", "Trial end date is required for trial users"));
    }

    try {
        // Verify the Google ID token using environment variable
        console.log('🔍 Verifying Google ID token for registration...');
        console.log('🔑 Expected audience (Client ID):', process.env.GOOGLE_CLIENT_ID);

        const ticket = await googleClient.verifyIdToken({
            idToken: idToken,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        console.log('✅ Token verified successfully for registration');
        console.log('🎯 Token audience:', payload.aud);
        console.log('📧 User email:', payload.email);

        const { email, name, given_name, family_name, picture } = payload;

        if (!email) {
            logger.error(new ApiError(400, "Email not provided by Google"));
            return res.status(400).json(new ApiResponse(400, "", "Email not provided by Google"));
        }

        // Check if user already exists
        const checkUserIfExists = await getUserByEmail(email);

        if (checkUserIfExists) {
            // User already exists - return 409 Conflict
            logger.error(new ApiError(409, "User already exists. Please login instead."));
            return res.status(409).json(new ApiResponse(409, { email: email }, "User already exists. Please login instead."));
        }

        // Create new user
        const firstName = given_name || name?.split(' ')[0] || 'User';
        const lastName = family_name || name?.split(' ').slice(1).join(' ') || '';

        // For Google OAuth users, we'll use unique placeholder values for required fields
        // Generate unique placeholder phone numbers to avoid unique constraint conflicts
        const timestamp = Date.now().toString().slice(-10); // Last 10 digits of timestamp
        const placeholderPhone = timestamp; // Use timestamp as unique phone placeholder
        const placeholderWhatsapp = (parseInt(timestamp) + 1).toString(); // Slightly different for whatsapp
        const googleTempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8); // Random password

        // Hash the password before saving
        const hashedPassword = await hashPassword(googleTempPassword);

        // Create user data based on package settings from request
        const userData = {
            firstName: firstName,
            lastName: lastName,
            phone: placeholderPhone,
            whatsapp: placeholderWhatsapp,
            email: email,
            password: hashedPassword, // Use hashed password
            profilePic: picture || "",
            isVerified: true, // Google accounts are pre-verified
            allTermsAndConditionsAgreed: true, // Assuming Google signup implies agreement
            OTP: null,
            packageType: packageType,
            isInTrialPeriod: isInTrialPeriod,
            subscriptionStatus: subscriptionStatus
        };
        
        // Only set trialEndsDate if it's provided (for trial users)
        if (trialEndsDate) {
            userData.trialEndsDate = trialEndsDate;
        }
        
        const newUser = new UserModel(userData);

        const savedUser = await newUser.save();

        if (!savedUser) {
            logger.error(new ApiError(500, "Internal server error in creating user"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating user"));
        }

        // Create tokens for the new user
        const AccessToken = await createAccessToken(savedUser._id);
        const RefreshToken = await createRefreshToken(savedUser._id);
        // Set default location token (US/NA) for new users - will be updated when they connect Amazon
        const LocationToken = await createLocationToken("US", "NA");

        if (!AccessToken || !RefreshToken || !LocationToken) {
            logger.error(new ApiError(500, "Internal server error in creating tokens"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating tokens"));
        }

        // Update user with refresh token
        await UserModel.findOneAndUpdate(
            { _id: savedUser._id },
            { $set: { appRefreshToken: RefreshToken } },
            { new: true }
        );

        // Initialize background job scheduling for the new user
        try {
            await UserSchedulingService.initializeUserSchedule(savedUser._id);
            logger.info(`Background job scheduling initialized for user ${savedUser._id}`);
        } catch (error) {
            logger.error(`Failed to initialize scheduling for user ${savedUser._id}:`, error);
            // Don't fail the registration process if scheduling fails
        }

        const options = getHttpsCookieOptions();

        // Prepare response data
        const responseData = {
            firstName: savedUser.firstName,
            lastName: savedUser.lastName,
            email: savedUser.email,
            phone: savedUser.phone,
            whatsapp: savedUser.whatsapp,
            accessType: savedUser.accessType,
            needsPhoneUpdate: true // Flag to indicate user needs to update phone numbers
        };

        res.status(201)
            .cookie("IBEXAccessToken", AccessToken, options)
            .cookie("IBEXRefreshToken", RefreshToken, options)
            .cookie("IBEXLocationToken", LocationToken, options)
            .json(new ApiResponse(201, responseData, "Google registration successful"));

    } catch (error) {
        // Check if it's a JWT verification error
        if (error.message && error.message.includes('audience')) {
            logger.error(`🚫 JWT Audience Error: ${error.message}`);
            logger.error(`🔍 This usually means the Google Client ID mismatch`);
            logger.error(`🔑 Expected audience: ${process.env.GOOGLE_CLIENT_ID}`);
            logger.error(`💡 Check your Google Cloud Console OAuth configuration`);
            return res.status(400).json(new ApiResponse(400, "", "Google registration failed: Invalid audience"));
        }

        logger.error(`Google registration error: ${error.message}`);
        return res.status(500).json(new ApiResponse(500, "", "Google registration failed"));
    }
});

// Update user subscription plan to LITE
const updateSubscriptionPlan = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;
        const { planType } = req.body;

        // Validate plan type
        if (!planType || !['LITE', 'PRO', 'AGENCY'].includes(planType)) {
            return res.status(400).json(
                new ApiResponse(400, null, 'Invalid plan type')
            );
        }

        // Find and update user
        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json(
                new ApiResponse(404, null, 'User not found')
            );
        }

        // Update user subscription plan (using packageType which is the actual field in the model)
        user.packageType = planType;
        user.subscriptionStatus = 'active';
        await user.save();

        logger.info(`User ${userId} subscription plan updated to ${planType}`);

        return res.status(200).json(
            new ApiResponse(200, {
                packageType: user.packageType,
                subscriptionStatus: user.subscriptionStatus
            }, `Subscription plan updated to ${planType}`)
        );

    } catch (error) {
        logger.error('Error updating subscription plan:', error);
        return res.status(500).json(
            new ApiResponse(500, null, 'Failed to update subscription plan')
        );
    }
});

// Activate 7-day free trial
const activateFreeTrial = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;

        // Find user
        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json(
                new ApiResponse(404, null, 'User not found')
            );
        }

        // Check if user is already in trial period
        if (user.isInTrialPeriod) {
            return res.status(400).json(
                new ApiResponse(400, null, 'User is already in a trial period')
            );
        }

        // Check if user already has a PRO or AGENCY package
        if (user.packageType === 'PRO' || user.packageType === 'AGENCY') {
            return res.status(400).json(
                new ApiResponse(400, null, 'User already has a paid subscription')
            );
        }

        // Calculate trial end date (7 days from now)
        const trialEndsDate = new Date();
        trialEndsDate.setDate(trialEndsDate.getDate() + 7);

        // Update user with trial information
        user.isInTrialPeriod = true;
        user.trialEndsDate = trialEndsDate;
        user.packageType = 'PRO';
        user.subscriptionStatus = 'trialing'; // Mark as trialing, not active (active is for paid Pro)
        user.servedTrial = true; // Mark that user has been served a trial
        user.reviewRequestAuthStatus = true;
        await user.save();

        logger.info(`User ${userId} activated 7-day free trial. Trial ends on ${trialEndsDate}`);

        return res.status(200).json(
            new ApiResponse(200, {
                isInTrialPeriod: user.isInTrialPeriod,
                trialEndsDate: user.trialEndsDate,
                packageType: user.packageType,
                subscriptionStatus: user.subscriptionStatus
            }, 'Free trial activated successfully')
        );

    } catch (error) {
        logger.error('Error activating free trial:', error);
        return res.status(500).json(
            new ApiResponse(500, null, 'Failed to activate free trial')
        );
    }
});

// Check and update trial status endpoint
const checkTrialStatus = asyncHandler(async (req, res) => {
    const userId = req.userId;

    if (!userId) {
        logger.error(new ApiError(401, "User ID not found"));
        return res.status(401).json(new ApiResponse(401, "", "User ID not found"));
    }

    try {
        const user = await UserModel.findById(userId);

        if (!user) {
            logger.error(new ApiError(404, "User not found"));
            return res.status(404).json(new ApiResponse(404, "", "User not found"));
        }

        // Check trial status
        if (user.isInTrialPeriod && user.trialEndsDate) {
            const currentDate = new Date();
            const trialEndDate = new Date(user.trialEndsDate);

            // If trial has expired according to our database, verify with payment gateway before downgrading
            if (currentDate > trialEndDate) {
                // IMPORTANT: Verify with Stripe/Razorpay before downgrading
                // This prevents incorrect downgrades when webhooks fail or are delayed
                const verificationResult = await subscriptionVerificationService.verifySubscriptionBeforeDowngrade(userId);
                
                logger.info(`User ${userId} trial expired (checkTrialStatus). Verification result:`, {
                    hasActiveSubscription: verificationResult.hasActiveSubscription,
                    gateway: verificationResult.gateway,
                    gatewayStatus: verificationResult.gatewayStatus,
                    shouldDowngrade: verificationResult.shouldDowngrade,
                    message: verificationResult.message
                });

                if (verificationResult.shouldDowngrade) {
                    // Safe to downgrade - no active subscription with payment gateway
                    await UserModel.findByIdAndUpdate(userId, {
                        isInTrialPeriod: false,
                        packageType: 'LITE',
                        subscriptionStatus: 'inactive'
                    });

                    logger.info(`User ${userId} trial expired and no active subscription found. Downgraded to LITE plan.`);

                    return res.status(200).json(new ApiResponse(200, {
                        isInTrialPeriod: false,
                        packageType: 'LITE',
                        subscriptionStatus: 'inactive',
                        trialEndsDate: user.trialEndsDate,
                        trialExpired: true,
                        verificationDetails: {
                            gateway: verificationResult.gateway,
                            gatewayStatus: verificationResult.gatewayStatus
                        }
                    }, "Trial expired - downgraded to LITE"));
                } else if (verificationResult.hasActiveSubscription) {
                    // DON'T downgrade - user has an active subscription with the payment gateway
                    // Sync the subscription status from the gateway
                    const syncResult = await subscriptionVerificationService.syncSubscriptionFromGateway(
                        userId, 
                        verificationResult, 
                        UserModel
                    );
                    
                    logger.info(`User ${userId} has active ${verificationResult.gateway} subscription (${verificationResult.gatewayStatus}). NOT downgrading. Sync result:`, syncResult);

                    // Determine the updated status after sync
                    const isTrialing = verificationResult.gatewayStatus === 'trialing' || verificationResult.gatewayStatus === 'authenticated';
                    const newSubscriptionStatus = isTrialing ? 'trialing' : 'active';

                    return res.status(200).json(new ApiResponse(200, {
                        isInTrialPeriod: isTrialing,
                        packageType: user.packageType, // Keep their paid package type
                        subscriptionStatus: newSubscriptionStatus,
                        trialEndsDate: user.trialEndsDate,
                        trialExpired: false,
                        subscriptionActive: true,
                        verificationDetails: {
                            gateway: verificationResult.gateway,
                            gatewayStatus: verificationResult.gatewayStatus,
                            syncResult: syncResult
                        }
                    }, `Active ${verificationResult.gateway} subscription detected - NOT downgraded`));
                } else {
                    // Verification failed with an error - don't downgrade to be safe
                    logger.warn(`User ${userId} trial expired but verification failed. NOT downgrading to be safe. Reason: ${verificationResult.message}`);

                    return res.status(200).json(new ApiResponse(200, {
                        isInTrialPeriod: user.isInTrialPeriod,
                        packageType: user.packageType,
                        subscriptionStatus: user.subscriptionStatus,
                        trialEndsDate: user.trialEndsDate,
                        trialExpired: true,
                        verificationPending: true,
                        verificationDetails: {
                            message: verificationResult.message,
                            error: verificationResult.error
                        }
                    }, "Trial expired but verification failed - not downgrading to be safe"));
                }
            }
        }

        // Return current trial status
        return res.status(200).json(new ApiResponse(200, {
            isInTrialPeriod: user.isInTrialPeriod,
            packageType: user.packageType,
            subscriptionStatus: user.subscriptionStatus,
            trialEndsDate: user.trialEndsDate,
            trialExpired: false
        }, "Trial status checked"));

    } catch (error) {
        logger.error('Error checking trial status:', error);
        return res.status(500).json(new ApiResponse(500, "", "Error checking trial status"));
    }
});

// Admin endpoints (agency admin profile – get/update details except email; logo upload via Cloudinary)
const getAdminProfile = asyncHandler(async (req, res) => {
    const adminId = req.adminId;

    if (!adminId) {
        logger.error(new ApiError(401, "Admin token required"));
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }

    const result = await AgencyAdminService.getAdminProfile(adminId);
    if (!result) {
        logger.error(new ApiError(404, "Admin user not found"));
        return res.status(404).json(new ApiResponse(404, "", "Admin user not found"));
    }

    return res.status(200).json(new ApiResponse(200, result, "Admin profile fetched successfully"));
});

/**
 * Update agency admin profile (firstName, lastName, phone, whatsapp, agencyName). Email is not updatable.
 */
const updateAdminProfile = asyncHandler(async (req, res) => {
    const adminId = req.adminId;
    const { firstName, lastName, phone, whatsapp, agencyName } = req.body;

    if (!adminId) {
        logger.error(new ApiError(401, "Admin token required"));
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }

    const adminUser = await UserModel.findById(adminId).select('accessType');
    if (!adminUser) {
        logger.error(new ApiError(404, "Admin user not found"));
        return res.status(404).json(new ApiResponse(404, "", "Admin user not found"));
    }
    if (adminUser.accessType !== 'enterpriseAdmin') {
        logger.error(new ApiError(403, "Only agency admins can update this profile"));
        return res.status(403).json(new ApiResponse(403, "", "Unauthorized"));
    }

    const payload = { firstName, lastName, phone, whatsapp, agencyName };
    const updated = await AgencyAdminService.updateAdminProfile(adminId, payload);
    if (!updated) {
        logger.error(new ApiError(500, "Failed to update admin profile"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error"));
    }

    return res.status(200).json(new ApiResponse(200, { adminInfo: updated }, "Profile updated successfully"));
});

/**
 * Upload agency logo. Same flow as user profile pic: multer stores file, then upload to Cloudinary and save URL to profilePic.
 */
const updateAdminProfilePic = asyncHandler(async (req, res) => {
    const adminId = req.adminId;
    const localFilePath = req.file?.path;

    if (!adminId) {
        logger.error(new ApiError(401, "Admin token required"));
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }
    if (!localFilePath) {
        logger.error(new ApiError(400, "Logo file is missing"));
        return res.status(400).json(new ApiResponse(400, "", "Logo file is missing"));
    }

    const adminUser = await UserModel.findById(adminId).select('accessType');
    if (!adminUser) {
        logger.error(new ApiError(404, "Admin user not found"));
        return res.status(404).json(new ApiResponse(404, "", "Admin user not found"));
    }
    if (adminUser.accessType !== 'enterpriseAdmin') {
        logger.error(new ApiError(403, "Only agency admins can upload logo"));
        return res.status(403).json(new ApiResponse(403, "", "Unauthorized"));
    }

    const result = await AgencyAdminService.uploadAgencyLogo(adminId, localFilePath);
    if (!result) {
        logger.error(new ApiError(500, "Internal server error in uploading logo"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in uploading logo"));
    }

    return res.status(200).json(new ApiResponse(200, { profilePicUrl: result.profilePicUrl }, "Logo updated successfully"));
});

/**
 * Update agency admin password. Requires currentPassword and newPassword; uses req.adminId.
 */
const updateAdminPassword = asyncHandler(async (req, res) => {
    const adminId = req.adminId;
    const { currentPassword, newPassword } = req.body;

    if (!adminId) {
        logger.error(new ApiError(401, "Admin token required"));
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }
    if (!currentPassword || !newPassword) {
        logger.error(new ApiError(400, "Current password and new password are required"));
        return res.status(400).json(new ApiResponse(400, "", "Current password and new password are required"));
    }
    if (newPassword.length < 8) {
        logger.error(new ApiError(400, "New password must be at least 8 characters"));
        return res.status(400).json(new ApiResponse(400, "", "New password must be at least 8 characters"));
    }

    const adminUser = await UserModel.findById(adminId).select('+password');
    if (!adminUser) {
        logger.error(new ApiError(404, "Admin user not found"));
        return res.status(404).json(new ApiResponse(404, "", "Admin user not found"));
    }
    if (adminUser.accessType !== 'enterpriseAdmin') {
        logger.error(new ApiError(403, "Only agency admins can update password here"));
        return res.status(403).json(new ApiResponse(403, "", "Unauthorized"));
    }
    if (!adminUser.password) {
        logger.error(new ApiError(400, "No password set for this account"));
        return res.status(400).json(new ApiResponse(400, "", "No password set for this account"));
    }

    const isValid = await verifyPassword(currentPassword, adminUser.password);
    if (!isValid) {
        logger.error(new ApiError(401, "Current password is incorrect"));
        return res.status(401).json(new ApiResponse(401, "", "Current password is incorrect"));
    }

    const hashed = await hashPassword(newPassword);
    adminUser.password = hashed;
    await adminUser.save();

    logger.info(`Agency admin ${adminId} updated their password`);
    return res.status(200).json(new ApiResponse(200, "", "Password updated successfully"));
});

const getAdminClients = asyncHandler(async (req, res) => {
    const adminId = req.adminId;

    if (!adminId) {
        logger.error(new ApiError(401, "Admin token required"));
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }

    try {
        // Query by agencyId (new field) OR adminId (legacy field) for backward compatibility
        const clients = await UserModel.find({
            $or: [
                { agencyId: adminId },
                { adminId: adminId }
            ]
        })
            .select('firstName lastName email phone createdAt subscriptionStatus packageType agencyId isAgencyClient')
            .sort({ createdAt: -1 });

        // Check Amazon connection status for each client
        const clientsWithConnectionStatus = await Promise.all(
            clients.map(async (client) => {
                const clientObj = client.toObject();

                // Find seller central document for this client
                const sellerDocument = await SellerCentralModel.findOne({ User: client._id });

                if (!sellerDocument || !sellerDocument.sellerAccount || sellerDocument.sellerAccount.length === 0) {
                    // No seller document or no seller account
                    return {
                        ...clientObj,
                        amazonStatus: 'Not Connected',
                        amazonConnected: false,
                        hasSpApi: false,
                        hasAdsApi: false,
                        brandName: null,
                        marketplace: null,
                        connectedDate: null
                    };
                }

                const sellerAccount = sellerDocument.sellerAccount[0];
                const hasSpiToken = sellerAccount.spiRefreshToken && sellerAccount.spiRefreshToken.trim() !== '';
                const hasAdsToken = sellerAccount.adsRefreshToken && sellerAccount.adsRefreshToken.trim() !== '';

                let amazonStatus = 'Not Connected';
                let amazonConnected = false;

                if (hasSpiToken && hasAdsToken) {
                    amazonStatus = 'Connected';
                    amazonConnected = true;
                } else if (hasSpiToken && !hasAdsToken) {
                    amazonStatus = 'Seller Central';
                    amazonConnected = true;
                } else if (!hasSpiToken && hasAdsToken) {
                    amazonStatus = 'Amazon Ads';
                    amazonConnected = true;
                } else {
                    amazonStatus = 'Not Connected';
                    amazonConnected = false;
                }

                return {
                    ...clientObj,
                    amazonStatus,
                    amazonConnected,
                    hasSpApi: hasSpiToken,
                    hasAdsApi: hasAdsToken,
                    brandName: sellerDocument.brand || null,
                    marketplace: amazonConnected ? (sellerAccount.country || null) : null,
                    region: amazonConnected ? (sellerAccount.region || null) : null,
                    connectedDate: amazonConnected ? sellerDocument.createdAt : null
                };
            })
        );

        return res.status(200).json(new ApiResponse(200, clientsWithConnectionStatus, "Admin clients fetched successfully"));
    } catch (error) {
        logger.error(new ApiError(500, `Error fetching admin clients: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error"));
    }
});

const removeAdminClient = asyncHandler(async (req, res) => {
    const adminId = req.adminId;
    const { clientId } = req.params;

    if (!adminId) {
        logger.error(new ApiError(401, "Admin token required"));
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }

    try {
        // Verify the client belongs to this admin (check both agencyId and legacy adminId)
        const client = await UserModel.findOne({
            _id: clientId,
            $or: [
                { agencyId: adminId },
                { adminId: adminId }
            ]
        });

        if (!client) {
            logger.error(new ApiError(404, "Client not found or doesn't belong to this admin"));
            return res.status(404).json(new ApiResponse(404, "", "Client not found"));
        }

        // Remove the client
        await UserModel.findByIdAndDelete(clientId);

        return res.status(200).json(new ApiResponse(200, "", "Client removed successfully"));
    } catch (error) {
        logger.error(new ApiError(500, `Error removing client: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error"));
    }
});

/**
 * Agency: Switch to client context (login as client).
 * Creates IBEX tokens for the client and sets them in cookies.
 * Only agency owners can switch to their own clients (client.adminId === req.userId).
 */
const switchToClient = asyncHandler(async (req, res) => {
    // Use adminId (from AdminToken) for agency owner - same pattern as superAdmin
    const agencyOwnerId = req.adminId || req.userId;
    const { clientId } = req.body;

    if (!agencyOwnerId) {
        logger.error(new ApiError(401, "Unauthorized"));
        return res.status(401).json(new ApiResponse(401, "", "Unauthorized"));
    }

    if (!clientId) {
        logger.error(new ApiError(400, "Client ID is required"));
        return res.status(400).json(new ApiResponse(400, "", "Client ID is required"));
    }

    const agencyOwner = await UserModel.findById(agencyOwnerId);
    if (!agencyOwner || agencyOwner.packageType !== 'AGENCY') {
        logger.error(new ApiError(403, "Only agency accounts can switch to client"));
        return res.status(403).json(new ApiResponse(403, "", "Only agency accounts can switch to client"));
    }

    // Check both agencyId (new) and adminId (legacy) for backward compatibility
    const client = await UserModel.findOne({
        _id: clientId,
        $or: [
            { agencyId: agencyOwnerId },
            { adminId: agencyOwnerId }
        ]
    });
    if (!client) {
        logger.error(new ApiError(404, "Client not found or does not belong to your agency"));
        return res.status(404).json(new ApiResponse(404, "", "Client not found"));
    }

    const accessToken = await createAccessToken(client._id);
    const refreshToken = await createRefreshToken(client._id);
    if (!accessToken || !refreshToken) {
        logger.error(new ApiError(500, "Failed to create tokens"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to create tokens"));
    }

    await UserModel.findByIdAndUpdate(client._id, { appRefreshToken: refreshToken });

    const sellerCentral = await SellerCentralModel.findOne({ User: client._id });
    let locationToken;
    if (!sellerCentral || !sellerCentral.sellerAccount?.length) {
        locationToken = await createLocationToken("US", "NA");
    } else {
        const acc = sellerCentral.sellerAccount[0];
        locationToken = await createLocationToken(acc.country || "US", acc.region || "NA");
    }

    const options = getHttpsCookieOptions();
    const responseData = {
        userId: client._id,
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        packageType: client.packageType,
    };

    logger.info(`Agency ${agencyOwnerId} switched to client ${client._id} (${client.email})`);

    res.status(200)
        .cookie("IBEXAccessToken", accessToken, options)
        .cookie("IBEXRefreshToken", refreshToken, options)
        .cookie("IBEXLocationToken", locationToken, options)
        .json(new ApiResponse(200, responseData, "Successfully switched to client"));
});

/**
 * Complete agency signup without Stripe (separate flow from PRO).
 * Called after email verification when intendedPackage is AGENCY.
 * Activates the agency account and sets AdminToken so they can use manage-agency-users.
 */
const completeAgencySignup = asyncHandler(async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        logger.error(new ApiError(401, "Unauthorized"));
        return res.status(401).json(new ApiResponse(401, "", "Unauthorized"));
    }

    const user = await UserModel.findById(userId);
    if (!user) {
        logger.error(new ApiError(404, "User not found"));
        return res.status(404).json(new ApiResponse(404, "", "User not found"));
    }

    if (user.packageType !== 'AGENCY') {
        logger.error(new ApiError(400, "Only agency signups can use this endpoint"));
        return res.status(400).json(new ApiResponse(400, "", "Only agency signups can use this endpoint"));
    }

    if (user.subscriptionStatus === 'active') {
        // Already activated (e.g. refresh), set all tokens and return redirect
        const adminToken = await createAccessToken(userId);
        
        // Check for existing clients - use client token if exists, otherwise agency owner
        const latestClient = await UserModel.findOne({
            $or: [{ agencyId: userId }, { adminId: userId }]
        }).sort({ createdAt: -1 });
        
        let accessToken, refreshToken;
        if (latestClient) {
            accessToken = await createAccessToken(latestClient._id);
            refreshToken = await createRefreshToken(latestClient._id);
        } else {
            accessToken = await createAccessToken(userId);
            refreshToken = await createRefreshToken(userId);
        }
        
        const options = getHttpsCookieOptions();
        return res.status(200)
            .cookie("AdminToken", adminToken, options)
            .cookie("IBEXAccessToken", accessToken, options)
            .cookie("IBEXRefreshToken", refreshToken, options)
            .json(new ApiResponse(200, { redirectTo: '/manage-agency-users' }, "Agency account ready"));
    }

    if (user.subscriptionStatus !== 'inactive') {
        logger.error(new ApiError(400, "Invalid agency signup state"));
        return res.status(400).json(new ApiResponse(400, "", "Invalid agency signup state"));
    }

    // Activate agency account (no Stripe; billing can be handled separately / contact sales)
    await UserModel.findByIdAndUpdate(userId, {
        subscriptionStatus: 'active',
        accessType: 'enterpriseAdmin',
    });

    const adminToken = await createAccessToken(userId);
    const accessToken = await createAccessToken(userId);
    const refreshToken = await createRefreshToken(userId);
    if (!adminToken || !accessToken || !refreshToken) {
        logger.error(new ApiError(500, "Failed to create tokens"));
        return res.status(500).json(new ApiResponse(500, "", "Failed to create tokens"));
    }

    // Update user with refresh token
    await UserModel.findByIdAndUpdate(userId, { appRefreshToken: refreshToken });

    const options = getHttpsCookieOptions();
    logger.info(`Agency signup completed for user ${userId} (${user.email}) without Stripe`);

    res.status(200)
        .cookie("AdminToken", adminToken, options)
        .cookie("IBEXAccessToken", accessToken, options)
        .cookie("IBEXRefreshToken", refreshToken, options)
        .json(new ApiResponse(200, { redirectTo: '/manage-agency-users' }, "Agency account activated successfully"));
});

const getAdminBillingInfo = asyncHandler(async (req, res) => {
    const adminId = req.adminId;

    if (!adminId) {
        logger.error(new ApiError(401, "Admin token required"));
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }

    try {
        const adminUser = await UserModel.findById(adminId).select('packageType subscriptionStatus createdAt');

        if (!adminUser) {
            logger.error(new ApiError(404, "Admin user not found"));
            return res.status(404).json(new ApiResponse(404, "", "Admin user not found"));
        }

        // Mock billing data - replace with real Stripe data later
        const billingInfo = {
            planType: adminUser.packageType,
            monthlyPrice: adminUser.packageType === 'AGENCY' ? 49 : 99,
            status: adminUser.subscriptionStatus,
            nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            paymentMethod: '**** **** **** 4242'
        };

        // Mock payment history
        const paymentHistory = [
            {
                id: '1',
                date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                amount: billingInfo.monthlyPrice,
                status: 'paid',
                invoiceNumber: 'INV-001'
            },
            {
                id: '2',
                date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
                amount: billingInfo.monthlyPrice,
                status: 'paid',
                invoiceNumber: 'INV-002'
            }
        ];

        const responseData = {
            billingInfo,
            paymentHistory
        };

        return res.status(200).json(new ApiResponse(200, responseData, "Admin billing info fetched successfully"));
    } catch (error) {
        logger.error(new ApiError(500, `Error fetching admin billing info: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error"));
    }
});

// Super Admin - Update any user's password
const superAdminUpdateUserPassword = asyncHandler(async (req, res) => {
    // Use superAdminId if available (when super admin is logged in as another user), otherwise use userId
    const adminId = req.superAdminId || req.userId;
    const isSuperAdminSession = req.isSuperAdminSession || false;
    const { userId, newPassword } = req.body;

    // Validate required fields
    if (!userId || !newPassword) {
        logger.error(new ApiError(400, "User ID and new password are required"));
        return res.status(400).json(new ApiResponse(400, "", "User ID and new password are required"));
    }

    // Check if the requester is a super admin
    const admin = await UserModel.findById(adminId);
    if (!admin) {
        logger.error(new ApiError(404, "Admin not found"));
        return res.status(404).json(new ApiResponse(404, "", "Admin not found"));
    }

    if (admin.accessType !== 'superAdmin' && !isSuperAdminSession) {
        logger.error(new ApiError(403, "Unauthorized: Only super admin can update user passwords"));
        return res.status(403).json(new ApiResponse(403, "", "Unauthorized: Only super admin can update user passwords"));
    }

    // Find the target user
    const targetUser = await UserModel.findById(userId);
    if (!targetUser) {
        logger.error(new ApiError(404, "Target user not found"));
        return res.status(404).json(new ApiResponse(404, "", "Target user not found"));
    }

    // Validate password strength (minimum 8 characters)
    if (newPassword.length < 8) {
        logger.error(new ApiError(400, "Password must be at least 8 characters long"));
        return res.status(400).json(new ApiResponse(400, "", "Password must be at least 8 characters long"));
    }

    // Hash the new password
    const hashedPassword = await hashPassword(newPassword);

    // Update the user's password
    targetUser.password = hashedPassword;
    await targetUser.save();

    logger.info(`Super admin ${adminId} updated password for user ${userId} (${targetUser.email})`);

    return res.status(200).json(new ApiResponse(200, {
        userId: targetUser._id,
        email: targetUser.email,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName
    }, "User password updated successfully"));
});

const resendOtp = asyncHandler(async (req, res) => {
    const { email, phone } = req.body;

    const user = await UserModel.findOne({ email });
    if (!user) {
        return res.status(404).json(new ApiResponse(404, "", "User not found"));
    }
    const otp = generateOTP();

    user.OTP = otp;
    await user.save();
   /* const smsSent = await sendVerificationCode(otp, phone);
    if (!smsSent) {
        return res.status(500).json(new ApiResponse(500, "", "Internal server error"));
    }*/

    let emailSent = await sendEmail(email, user.firstName, otp);
    if (!emailSent) {
        return res.status(500).json(new ApiResponse(500, "", "Internal server error"));
    }

    return res.status(200).json(new ApiResponse(200, { otp }, "OTP sent successfully"));
});

/**
 * Check if the first analysis is done for the authenticated user
 * This endpoint is polled by the AnalysingAccount page to check when analysis completes
 */
const checkFirstAnalysisStatus = asyncHandler(async (req, res) => {
    const userId = req.userId;

    if (!userId) {
        logger.error(new ApiError(401, "User ID not found"));
        return res.status(401).json(new ApiResponse(401, "", "User ID not found"));
    }

    try {
        const status = await getFirstAnalysisStatus(userId);

        if (status === null) {
            logger.error(new ApiError(404, "User not found"));
            return res.status(404).json(new ApiResponse(404, "", "User not found"));
        }

        return res.status(200).json(new ApiResponse(200, {
            firstAnalysisDone: status
        }, status ? "Analysis complete" : "Analysis in progress"));

    } catch (error) {
        logger.error('Error checking first analysis status:', error);
        return res.status(500).json(new ApiResponse(500, "", "Error checking analysis status"));
    }
});

module.exports = {
    registerUser,
    registerAgencyClient,
    verifyUser,
    loginUser,
    profileUser,
    logoutUser,
    refreshAccessToken,
    updateProfilePic,
    updateDetails,
    switchAccount,
    verifyEmailForPasswordReset,
    verifyResetPasswordCode,
    resetPassword,
    TrackIP,
    getIPTracking,
    googleLoginUser,
    googleRegisterUser,
    updateSubscriptionPlan,
    activateFreeTrial,
    checkTrialStatus,
    // Admin endpoints
    getAdminProfile,
    updateAdminProfile,
    updateAdminProfilePic,
    updateAdminPassword,
    getAdminClients,
    removeAdminClient,
    switchToClient,
    completeAgencySignup,
    getAdminBillingInfo,
    resendOtp,
    // Super Admin endpoints
    superAdminUpdateUserPassword,
    // Analysis status
    checkFirstAnalysisStatus
};
