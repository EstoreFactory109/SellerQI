const { createUser, getUserByEmail, verify, getUserById, updateInfo, updatePassword } = require('../../Services/User/userServices.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { createAccessToken, createRefreshToken, createLocationToken } = require('../../utils/Tokens.js');
const { verifyPassword, hashPassword } = require('../../utils/HashPassword.js');
const logger = require('../../utils/Logger.js');
const { generateOTP } = require('../../utils/OTPGenerator.js');
const { sendEmail } = require('../../Services/Email/SendOtp.js');
const UserModel = require('../../models/user-auth/userModel.js');
const SellerCentralModel = require('../../models/user-auth/sellerCentralModel.js');
const mongoose = require('mongoose');

const { uploadToCloudinary } = require('../../Services/Cloudinary/Cloudinary.js');
const { sendEmailResetLink } = require('../../Services/Email/SendResetLink.js');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { UserSchedulingService } = require('../../Services/BackgroundJobs/UserSchedulingService.js');
const IPTrackingModel = require('../../models/system/IPTrackingModel.js');
const { OAuth2Client } = require('google-auth-library');
const { getHttpsCookieOptions } = require('../../utils/cookieConfig.js');
const sendVerificationCode = require('../../Services/SMS/sendSMS.js');

const registerUser = asyncHandler(async (req, res) => {
    const { firstname, lastname, phone, email, password, allTermsAndConditionsAgreed, packageType, isInTrialPeriod, subscriptionStatus, trialEndsDate, intendedPackage } = req.body;
    // console.log(firstname)

    // Validate required fields - trialEndsDate is only required for trial users
    if (!firstname || !lastname || !phone || !email || !password || !packageType || (isInTrialPeriod == null) || !subscriptionStatus) {
        logger.error(new ApiError(400, "Details and credentials are missing"));
        return res.status(400).json(new ApiResponse(400, "", "Details and credentials are missing"));
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
    let data = await createUser(
        firstname, 
        lastname, 
        phone, 
        phone, 
        email, 
        password, 
        otp, 
        allTermsAndConditionsAgreed, 
        packageType,           // PRO for both PRO-Trial and PRO
        isInTrialPeriod,       // true for PRO-Trial, false for PRO
        subscriptionStatus,    // active for PRO-Trial, inactive for PRO (pending payment)
        trialEndsDate          // Date for PRO-Trial, null for PRO
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
    const { firstname, lastname, phone, email, password, allTermsAndConditionsAgreed } = req.body;
    const agencyOwnerId = req.userId; // Get the agency owner's ID from auth middleware

    if (!firstname || !lastname || !phone || !email || !password) {
        logger.error(new ApiError(400, "Details and credentials are missing"));
        return res.status(400).json(new ApiResponse(400, "", "Details and credentials are missing"));
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
        // Hash the password
        const hashedPassword = await hashPassword(password);

        // Create the client user with adminId set to agency owner
        const newClient = new UserModel({
            firstName: firstname,
            lastName: lastname,
            phone: phone,
            whatsapp: phone, // Use phone as whatsapp for simplicity
            email: email,
            password: hashedPassword,
            isVerified: true, // Auto-verify agency clients
            allTermsAndConditionsAgreed: allTermsAndConditionsAgreed || true,
            packageType: 'PRO', // Give clients PRO access by default
            adminId: agencyOwnerId, // Set the agency owner as admin
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
                adminAccessType: agencyOwner.accessType || 'enterpriseAdmin'
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

    const checkPassword = await verifyPassword(password, checkUserIfExists.password);

    if (!checkPassword) {
        logger.error(new ApiError(401, "Password not matched"))
        return res.status(401).json(new ApiResponse(401, "", "Password not matched"));
    }

    // Check trial status on login
    if (checkUserIfExists.isInTrialPeriod && checkUserIfExists.trialEndsDate) {
        const currentDate = new Date();
        const trialEndDate = new Date(checkUserIfExists.trialEndsDate);

        // If trial has expired, update user status
        if (currentDate > trialEndDate) {
            await UserModel.findByIdAndUpdate(checkUserIfExists._id, {
                isInTrialPeriod: false,
                packageType: 'LITE',
                subscriptionStatus: 'inactive'
            });

            // Update the local user object for the response
            checkUserIfExists.isInTrialPeriod = false;
            checkUserIfExists.packageType = 'LITE';
            checkUserIfExists.subscriptionStatus = 'inactive';

            logger.info(`User ${checkUserIfExists._id} trial expired. Downgraded to LITE plan.`);
        }
    }

    let getSellerCentral;
    let allSellerAccounts = null;
    let AccessToken, RefreshToken, LocationToken, adminToken = "";


    // Check if user is superAdmin
    if (checkUserIfExists.accessType === 'superAdmin') {
        // Get all seller central accounts from the database
        const allSellerCentrals = await SellerCentralModel.find({})

        if (!allSellerCentrals || allSellerCentrals.length === 0) {
            logger.error(new ApiError(404, "No seller central accounts found"));
            return res.status(404).json(new ApiResponse(404, "", "No seller central accounts found"));
        }

        // Use the first seller central account for tokens
        getSellerCentral = allSellerCentrals[0];

        adminToken = await createAccessToken(checkUserIfExists._id);
        AccessToken = await createAccessToken(getSellerCentral.User);
        RefreshToken = await createRefreshToken(getSellerCentral.User);
        LocationToken = await createLocationToken(getSellerCentral.sellerAccount[0].country, getSellerCentral.sellerAccount[0].region);
        // Prepare all accounts data to send in response

    } else if (checkUserIfExists.accessType === 'enterpriseAdmin') {
        adminToken = await createAccessToken(checkUserIfExists._id);

        const sellerCentral = await SellerCentralModel.findOne({ User: checkUserIfExists._id });
        if (!sellerCentral) {
            const getClient = await UserModel.findOne({ adminId: checkUserIfExists._id }).sort({ createdAt: -1 });
            if (!getClient) {
                AccessToken = await createAccessToken(checkUserIfExists._id);
                RefreshToken = await createRefreshToken(checkUserIfExists._id);
                LocationToken = await createLocationToken("US", "NA");
            } else {
                AccessToken = await createAccessToken(getClient._id);
                RefreshToken = await createRefreshToken(getClient._id);
                const getClientSellerCentral = await SellerCentralModel.findOne({ User: getClient._id });
                if (!getClientSellerCentral) {
                    LocationToken = await createLocationToken("US", "NA");
                } else {
                    LocationToken = await createLocationToken(getClientSellerCentral.sellerAccount[0].country, getClientSellerCentral.sellerAccount[0].region);
                }
            }
        } else {
            AccessToken = await createAccessToken(checkUserIfExists._id);
            RefreshToken = await createRefreshToken(checkUserIfExists._id);
            LocationToken = await createLocationToken(sellerCentral.sellerAccount[0].country, sellerCentral.sellerAccount[0].region);
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
        logger.error(new AccessToken(500, "Internal server error in creating tokens"));
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

            // If trial has expired, update user status
            if (currentDate > trialEndDate) {
                await UserModel.findByIdAndUpdate(checkUserIfExists._id, {
                    isInTrialPeriod: false,
                    packageType: 'LITE',
                    subscriptionStatus: 'inactive'
                });

                // Update the local user object for the response
                checkUserIfExists.isInTrialPeriod = false;
                checkUserIfExists.packageType = 'LITE';
                checkUserIfExists.subscriptionStatus = 'inactive';

                logger.info(`User ${checkUserIfExists._id} trial expired during Google login. Downgraded to LITE plan.`);
            }
        }

        let getSellerCentral;
        let allSellerAccounts = null;
        let AccessToken, RefreshToken, LocationToken, adminToken = "";

        // Check if user is superAdmin
        if (checkUserIfExists.accessType === 'superAdmin') {
            // Get all seller central accounts from the database
            const allSellerCentrals = await SellerCentralModel.find({});

            if (!allSellerCentrals || allSellerCentrals.length === 0) {
                logger.error(new ApiError(404, "No seller central accounts found"));
                return res.status(404).json(new ApiResponse(404, "", "No seller central accounts found"));
            }

            // Use the first seller central account for tokens
            getSellerCentral = allSellerCentrals[0];

            adminToken = await createAccessToken(checkUserIfExists._id);
            AccessToken = await createAccessToken(getSellerCentral.User);
            RefreshToken = await createRefreshToken(getSellerCentral.User);
            LocationToken = await createLocationToken(getSellerCentral.sellerAccount[0].country, getSellerCentral.sellerAccount[0].region);
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

        if (!AccessToken || !RefreshToken) {
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

        // Update user subscription plan
        user.subscriptionPlan = planType;
        user.subscriptionStatus = 'active';
        await user.save();

        logger.info(`User ${userId} subscription plan updated to ${planType}`);

        return res.status(200).json(
            new ApiResponse(200, {
                subscriptionPlan: user.subscriptionPlan,
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
        user.subscriptionStatus = 'active';
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

            // If trial has expired, update user status
            if (currentDate > trialEndDate) {
                await UserModel.findByIdAndUpdate(userId, {
                    isInTrialPeriod: false,
                    packageType: 'LITE',
                    subscriptionStatus: 'inactive'
                });

                logger.info(`User ${userId} trial expired. Downgraded to LITE plan.`);

                return res.status(200).json(new ApiResponse(200, {
                    isInTrialPeriod: false,
                    packageType: 'LITE',
                    subscriptionStatus: 'inactive',
                    trialEndsDate: user.trialEndsDate,
                    trialExpired: true
                }, "Trial status updated"));
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

// Admin endpoints
const getAdminProfile = asyncHandler(async (req, res) => {
    const adminId = req.adminId;

    if (!adminId) {
        logger.error(new ApiError(401, "Admin token required"));
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }

    try {
        const adminUser = await UserModel.findById(adminId).select('-password');
        console.log(adminUser);

        if (!adminUser) {
            logger.error(new ApiError(404, "Admin user not found"));
            return res.status(404).json(new ApiResponse(404, "", "Admin user not found"));
        }

        // Get client statistics
        const clientStats = await UserModel.aggregate([
            { $match: { adminId: mongoose.Types.ObjectId(adminId) } },
            {
                $group: {
                    _id: null,
                    totalClients: { $sum: 1 },
                    activeClients: {
                        $sum: {
                            $cond: [{ $eq: ["$subscriptionStatus", "active"] }, 1, 0]
                        }
                    }
                }
            }
        ]);

        // Get clients added this month
        const thisMonth = new Date();
        thisMonth.setDate(1);
        thisMonth.setHours(0, 0, 0, 0);

        const newClientsThisMonth = await UserModel.countDocuments({
            adminId: adminId,
            createdAt: { $gte: thisMonth }
        });

        const stats = clientStats[0] || { totalClients: 0, activeClients: 0 };
        stats.thisMonth = newClientsThisMonth;

        const responseData = {
            adminInfo: adminUser,
            clientStats: stats
        };

        return res.status(200).json(new ApiResponse(200, responseData, "Admin profile fetched successfully"));
    } catch (error) {
        logger.error(new ApiError(500, `Error fetching admin profile: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error"));
    }
});

const getAdminClients = asyncHandler(async (req, res) => {
    const adminId = req.adminId;

    if (!adminId) {
        logger.error(new ApiError(401, "Admin token required"));
        return res.status(401).json(new ApiResponse(401, "", "Admin token required"));
    }

    try {
        const clients = await UserModel.find({ adminId: adminId })
            .select('firstName lastName email phone createdAt subscriptionStatus packageType')
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
        // Verify the client belongs to this admin
        const client = await UserModel.findOne({ _id: clientId, adminId: adminId });

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

module.exports = {
    registerUser,
    registerAgencyClient,
    verifyUser,
    loginUser,
    profileUser,
    logoutUser,
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
    getAdminClients,
    removeAdminClient,
    getAdminBillingInfo,
    resendOtp,
    // Super Admin endpoints
    superAdminUpdateUserPassword
};
