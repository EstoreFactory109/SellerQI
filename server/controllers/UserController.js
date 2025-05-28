const { createUser, getUserByEmail, verify, getUserById, updateInfo } = require('../Services/User/userServices.js');
const { ApiError } = require('../utils/ApiError.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const asyncHandler = require('../utils/AsyncHandler.js');
const { createAccessToken, createRefreshToken, createLocationToken } = require('../utils/Tokens.js');
const { verifyPassword } = require('../utils/HashPassword.js');
const logger = require('../utils/Logger.js');
const { generateOTP } = require('../utils/OTPGenerator.js');
const { sendEmail } = require('../Services/Email/SendOtp.js');
const UserModel = require('../models/userModel.js');
const SellerCentralModel = require('../models/sellerCentralModel.js');
const { uploadToCloudinary } = require('../Services/Cloudinary/Cloudinary.js');


const registerUser = asyncHandler(async (req, res) => {
    const { firstname, lastname, phone, whatsapp, email, password } = req.body;
    console.log(firstname)

    if (!firstname || !lastname || !phone || !whatsapp || !email || !password) {
        logger.error(new ApiError(400, "Details and credentials are missing"));
        return res.status(400).json(new ApiResponse(400, "", "Details and credentials are missing"));
    }

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

    let data = await createUser(firstname, lastname, phone, whatsapp, email, password, otp);
    // console.log(data);

    if (!data) {
        logger.error(new ApiError(500, "Internal server error in registering user"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in registering user"));
    }



    res.status(201)
        .json(new ApiResponse(201, "", "User registered successfully. OTP has been sent to your email address"));

})


const verifyUser = asyncHandler(async (req, res) => {

    const { email, otp } = req.body;

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

    const options = {
        httpOnly: true,
        secure: true,
    }

    res.status(200)
        .cookie("IBEXAccessToken", AccessToken, options)
        .cookie("IBEXRefreshToken", RefreshToken, options)
        .json(new ApiResponse(200, "", "User verified successfully"))


})



const profileUser = asyncHandler(async (req, res) => {
    const userId = req.userId;

    if (!userId) {
        logger.error(new ApiError(400, "User id is missing"));
        return res.status(400).json(new ApiResponse(400, "", "User id is missing"));
    }

    const userProfile = await getUserById(userId);

    if (!userProfile) {
        logger.error(new ApiError(404, "User not found"));
        return res.status(404).json(new ApiResponse(404, "", "User not found"));
    }

    return res.status(200).json(new ApiResponse(200, userProfile, "User profile fetched successfully"));
})






const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;


    if (!email || !password) {
        logger.error(new ApiError(400, "Details and credentials are missing"));
        return res.status(400).json(new ApiResponse(400, "", "Details and credentials are missing"));
    }

    const checkUserIfExists = await getUserByEmail(email);



    if (!checkUserIfExists) {
        logger.error(new ApiError(404, "User not found"));
        return res.status(404).json(new ApiResponse(404, "", "User not found"));
    }

    const checkPassword = await verifyPassword(password, checkUserIfExists.password);


    if (!checkPassword) {
        logger.error(new ApiError(401, "Password not matched"))
        return res.status(401).json(new ApiResponse(401, "", "Password not matched"));
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

    } else {
        getSellerCentral = await SellerCentralModel.findOne({ User: checkUserIfExists._id });
        if (!getSellerCentral) {
            logger.error(new ApiError(404, "Seller central not found"));
            return res.status(404).json(new ApiResponse(404, "", "Seller central not found"));
        }
        // For regular users and enterpriseAdmin, get their own seller central
        AccessToken = await createAccessToken(checkUserIfExists._id);
        RefreshToken = await createRefreshToken(checkUserIfExists._id);
        LocationToken = await createLocationToken(getSellerCentral.sellerAccount[0].country, getSellerCentral.sellerAccount[0].region);
    }



    if (!AccessToken || !RefreshToken || !LocationToken) {
        logger.error(new AccessToken(500, "Internal server error in creating tokens"));
        return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating tokens"));
    }



    const option = {
        httpOnly: true,
        secure: true
    }

    // Prepare response data
    const responseData = {
        firstName: checkUserIfExists.firstName,
        lastName: checkUserIfExists.lastName,
        email: checkUserIfExists.email,
        phone: checkUserIfExists.phone,
        whatsapp: checkUserIfExists.whatsapp,
        accessType: checkUserIfExists.accessType
    };

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

    res.clearCookie("AdminToken");
    res.clearCookie("IBEXAccessToken");
    res.clearCookie("IBEXRefreshToken");
    res.clearCookie("IBEXLocationToken");
    res.status(200).json(new ApiResponse(200, "", "User logged out successfully"));
})

const updateProfilePic = asyncHandler(async (req, res) => {
    const userId = req.userId;
    console.log(userId)
    const avatar = req.file?.path;
    console.log(avatar)
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
    const adminId = req.adminId; // Getting admin id from auth middleware
    const { country, region } = req.body;

    // Check if admin id exists

    // Validate required fields
    if (!country || !region) {
        logger.error(new ApiError(400, "country, and region are required"));
        return res.status(400).json(new ApiResponse(400, "", "userId, country, and region are required"));
    }

    if (adminId !== null) {
        const { userId } = req.body;
        if (!userId) {
            logger.error(new ApiError(400, "userId is required"));
            return res.status(400).json(new ApiResponse(400, "", "userId is required"));
        }

        let AccessToken = await createAccessToken(userId);
        let RefreshToken = await createRefreshToken(userId);
        let LocationToken = await createLocationToken(country, region);

        if (!AccessToken || !RefreshToken || !LocationToken) {
            logger.error(new ApiError(500, "Internal server error in creating tokens"));
            return res.status(500).json(new ApiResponse(500, "", "Internal server error in creating tokens"));
        }

        const option = {
            httpOnly: true,
            secure: true
        }

        return res.status(200)
            .cookie("IBEXAccessToken", AccessToken, option)
            .cookie("IBEXRefreshToken", RefreshToken, option)
            .cookie("IBEXLocationToken", LocationToken, option)
            .json(new ApiResponse(200, "", "Account switched successfully"));
    }

    // Verify that the admin is actually a superAdmin
    let LocationToken = await createLocationToken(country, region);
    const option = {
        httpOnly: true,
        secure: true
    }

    return res.status(200)
        .cookie("IBEXLocationToken", LocationToken, option)
        .json(new ApiResponse(200, "", "Account switched successfully"));

    // Get seller details using the provided credentials

});


module.exports = { registerUser, verifyUser, loginUser, profileUser, logoutUser, updateProfilePic, updateDetails, switchAccount };
