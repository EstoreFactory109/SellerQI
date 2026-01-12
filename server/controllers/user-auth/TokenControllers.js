const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js')
const { generateRefreshToken, generateAdsRefreshToken } = require('../../Services/Sp_API/GenerateTokens');
const { ApiError } = require('../../utils/ApiError');
const { ApiResponse } = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/AsyncHandler');
const { createLocationToken } = require('../../utils/Tokens.js');
const logger = require('../../utils/Logger.js');
const { UserSchedulingService } = require('../../Services/BackgroundJobs/UserSchedulingService.js');
const { v4: uuidv4 } = require('uuid');
const { getHttpCookieOptions } = require('../../utils/cookieConfig.js');
const { sendRegisteredEmail } = require('../../Services/Email/SendEmailOnRegistered.js');

const SaveAllDetails = asyncHandler(async (req, res) => {
    const { region, country } = req.body;
    const userId = req.userId;
    
    if (!country || !region) {
        return res.status(400).json(new ApiResponse(400, "", "Credentials are missing"));
    }
    
    const getUser = await User.findById(userId);
    if (!getUser) {
        return res.status(404).json(new ApiResponse(404, "", "User not found"));
    }

    console.log(`SaveAllDetails: region=${region}, country=${country}, userId=${userId}`);
    
    // Check if SellerCentral already exists for this user
    let sellerCentralDoc = await Seller.findOne({ User: userId }).sort({ createdAt: -1 });
    
    if (!sellerCentralDoc) {
        // Create new SellerCentral if it doesn't exist
        console.log('SaveAllDetails: No existing SellerCentral found, creating new one');
        const sellerAccount = [{
            selling_partner_id: uuidv4(),
            country: country,
            region: region,
        }];
        
        sellerCentralDoc = await Seller.create({ 
            User: userId,
            selling_partner_id: uuidv4(), 
            sellerAccount: sellerAccount 
        });
        
        if (!sellerCentralDoc) {
            logger.error(new ApiError(500, "Error in creating sellercentral"));
            return res.status(500).json(new ApiResponse(500, "", "Error in creating sellercentral"));
        }
        
        getUser.sellerCentral = sellerCentralDoc._id;
        await getUser.save();
        console.log('SaveAllDetails: Created new SellerCentral:', sellerCentralDoc._id);
    } else {
        // SellerCentral exists - check if sellerAccount with same country/region exists
        const existingAccount = sellerCentralDoc.sellerAccount.find(
            acc => acc.country === country && acc.region === region
        );
        
        if (!existingAccount) {
            // Add new sellerAccount if it doesn't exist for this country/region
            console.log(`SaveAllDetails: Adding new sellerAccount for ${country}/${region}`);
            sellerCentralDoc.sellerAccount.push({
                selling_partner_id: uuidv4(),
                country: country,
                region: region,
            });
            await sellerCentralDoc.save();
        } else {
            // Account already exists for this country/region - use existing
            console.log(`SaveAllDetails: Seller account for ${country}/${region} already exists, using existing account`);
        }
        
        // Ensure user has reference to sellerCentral (in case it was missing)
        if (!getUser.sellerCentral || getUser.sellerCentral.toString() !== sellerCentralDoc._id.toString()) {
            getUser.sellerCentral = sellerCentralDoc._id;
            await getUser.save();
        }
    }

    // Update user's seller accounts in scheduling system
    try {
        await UserSchedulingService.updateUserSellerAccounts(userId);
        logger.info(`Updated seller accounts in scheduling system for user ${userId}`);
    } catch (error) {
        logger.error(`Failed to update scheduling for user ${userId}:`, error);
        // Don't fail the process if scheduling update fails
    }

    const locationToken = await createLocationToken(country, region);
    if (!locationToken) {
        logger.error(new ApiError(500, "Error in creating location token"));
        return res.status(500).json(new ApiError(500, "Error in creating location token"));
    }

    return res.status(201)
        .cookie("IBEXLocationToken", locationToken, getHttpCookieOptions())
        .json(new ApiResponse(201, "", "All the seller central information has been stored successfully"));
})


const saveDetailsOfOtherAccounts = asyncHandler(async (req, res) => {
    const { region, country } = req.body;
    const userId = req.userId;
    if (!country || !region) {
        return res.status(400).json(new ApiResponse(400, "", "Credentials are missing"));
    }
    const sellerCentral = await Seller.findOne({ User: userId });
    if (!sellerCentral) {
        const createSellerCentral = await Seller.create({ User: userId, selling_partner_id: uuidv4(), sellerAccount: { country: country, region: region } });
        if (!createSellerCentral) {
            logger.error(new ApiError(500, "Error in creating sellercentral"));
            return res.status(500).json(new ApiResponse(500, "", "Error in creating sellercentral"));
        }
        const locationToken = await createLocationToken(country, region);
        if (!locationToken) {
            logger.error(new ApiError(500, "Error in creating location token"));
            return res.status(500).json(new ApiError(500, "Error in creating location token"));
        }
        return res.status(201)
            .cookie("IBEXLocationToken", locationToken, getHttpCookieOptions())
            .json(new ApiResponse(201, "", "New account added successfully"));
    }
    
    // Check if sellerAccount with same country/region already exists
    const existingAccount = sellerCentral.sellerAccount.find(
        acc => acc.country === country && acc.region === region
    );
    
    if (!existingAccount) {
        // Only add if it doesn't exist
        sellerCentral.sellerAccount.push({ country: country, region: region });
        await sellerCentral.save();
        console.log(`saveDetailsOfOtherAccounts: Added new sellerAccount for ${country}/${region}`);
    } else {
        console.log(`saveDetailsOfOtherAccounts: Seller account for ${country}/${region} already exists, using existing`);
    }

    // Update user's seller accounts in scheduling system
    try {
        await UserSchedulingService.updateUserSellerAccounts(userId);
        logger.info(`Updated seller accounts in scheduling system for user ${userId}`);
    } catch (error) {
        logger.error(`Failed to update scheduling for user ${userId}:`, error);
        // Don't fail the process if scheduling update fails
    }

    const locationToken = await createLocationToken(country, region);
    if (!locationToken) {
        logger.error(new ApiError(500, "Error in creating location token"));
        return res.status(500).json(new ApiError(500, "Error in creating location token"));
    }
    return res.status(201)
        .cookie("IBEXLocationToken", locationToken, getHttpCookieOptions())
        .json(new ApiResponse(201, "", "New account added successfully"));
})

const addNewSellerCentralAccount = asyncHandler(async (req, res) => {
    const region = req.region;
    const country = req.country;
    const userId = req.userId;
    if (!country || !region) {
        return res.status(400).json(new ApiResponse(400, "", "Credentials are missing"));
    }
    const sellerCentral = await Seller.findOne({ User: userId });
    if (!sellerCentral) {
        return res.status(404).json(new ApiResponse(404, "", "Seller central not found"));
    }
    
    // Check if sellerAccount with same country/region already exists
    const existingAccount = sellerCentral.sellerAccount.find(
        acc => acc.country === country && acc.region === region
    );
    
    if (!existingAccount) {
        // Only add if it doesn't exist
        sellerCentral.sellerAccount.push({ region: region, country: country });
        await sellerCentral.save();
        console.log(`addNewSellerCentralAccount: Added new sellerAccount for ${country}/${region}`);
    } else {
        console.log(`addNewSellerCentralAccount: Seller account for ${country}/${region} already exists, using existing`);
    }

    // Update user's seller accounts in scheduling system
    try {
        await UserSchedulingService.updateUserSellerAccounts(userId);
        logger.info(`Updated seller accounts in scheduling system for user ${userId}`);
    } catch (error) {
        logger.error(`Failed to update scheduling for user ${userId}:`, error);
        // Don't fail the process if scheduling update fails
    }

    const locationToken = await createLocationToken(country, region);
    if (!locationToken) {
        logger.error(new ApiError(500, "Error in creating location token"));
        return res.status(500).json(new ApiError(500, "Error in creating location token"));
    }
    return res.status(201)
        .cookie("IBEXLocationToken", locationToken, getHttpCookieOptions())
        .json(new ApiResponse(201, "", "New account added successfully"));
})


const generateSPAPITokens = asyncHandler(async (req, res) => {
    const { authCode, sellingPartnerId } = req.body;
    const userId = req.userId;
    const region = req.region;
    const country = req.country;

    if (!region || !country) {
        return res.status(400).json(new ApiResponse(400, "", "Region and country are missing"));
    }
    if (!authCode || !sellingPartnerId) {
        return res.status(400).json(new ApiResponse(400, "", "Authorization code and selling partner id are missing"));
    }

    try {
        // Call generateRefreshToken with proper error handling
        const tokenData = await generateRefreshToken(authCode, region);

        if (!tokenData || !tokenData.refreshToken) {
            logger.error("No refresh token received from generateRefreshToken function");
            return res.status(500).json(new ApiResponse(500, "", "Failed to generate refresh token - no token data received"));
        }

        const refreshToken = tokenData.refreshToken;

        const sellerCentral = await Seller.findOne({ User: userId }).sort({ createdAt: -1 });
        if (!sellerCentral) {
            return res.status(404).json(new ApiResponse(404, "", "SellerCentral not found"));
        }

        
        // Find the seller account that matches the current region and country
        const sellerAccount = sellerCentral.sellerAccount.find(account =>
            account.country === country && account.region === region
        );

        if (!sellerAccount) {
            return res.status(404).json(new ApiResponse(404, "", "Seller account not found for the specified region and country"));
        }

        // Store the refresh token in the seller account
        sellerAccount.spiRefreshToken = refreshToken;
        sellerAccount.selling_partner_id = sellingPartnerId;

        await sellerCentral.save();

        const getUser = await User.findById(userId).select("firstName lastName phone email");

        if(!getUser){
            logger.error(new ApiError(404,"User not found"));
        }

        const sendEmail = await sendRegisteredEmail(userId,getUser.firstName,getUser.lastName,getUser.phone,getUser.email,sellingPartnerId);
        if(!sendEmail){
            logger.error(new ApiError(500, "Internal server error in sending email"));
           // return res.status(500).json(new ApiResponse(500, "", "Internal server error in sending email"));
        }
        return res.status(200).json(new ApiResponse(200, sellerCentral, "Tokens generated successfully"));

    } catch (error) {
        // Handle specific errors from generateRefreshToken
        logger.error(`Error in generateSPAPITokens: ${error.message}`);

        // If it's an ApiError, preserve the status code and message
        if (error.statusCode) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, "", error.message));
        }

        // For other errors, return a generic 500
        return res.status(500).json(new ApiResponse(500, "", `Failed to generate refresh token: ${error.message}`));
    }
})

const generateAmazonAdsTokens = asyncHandler(async (req, res) => {
    const { authCode } = req.body;
    const userId = req.userId;
    const region = req.region;
    const country = req.country;

    if (!region || !country) {
        return res.status(400).json(new ApiResponse(400, "", "Region and country are missing"));
    }
    if (!authCode) {
        return res.status(400).json(new ApiResponse(400, "", "Authorization code is missing"));
    }

    try {
        // Call generateAdsRefreshToken with proper error handling
        const tokenData = await generateAdsRefreshToken(authCode, region);

        if (!tokenData || !tokenData.refreshToken) {
            logger.error("No refresh token received from generateAdsRefreshToken function");
            return res.status(500).json(new ApiResponse(500, "", "Failed to generate ads refresh token - no token data received"));
        }

        const refreshToken = tokenData.refreshToken;

        const sellerCentral = await Seller.findOne({ User: userId }).sort({ createdAt: -1 });
        if (!sellerCentral) {
            return res.status(404).json(new ApiResponse(404, "", "SellerCentral not found"));
        }

        // Find the seller account that matches the current region and country
        const sellerAccount = sellerCentral.sellerAccount.find(account =>
            account.country === country && account.region === region
        );

        if (!sellerAccount) {
            return res.status(404).json(new ApiResponse(404, "", "Seller account not found for the specified region and country"));
        }

        // Store the refresh token in the seller account
        sellerAccount.adsRefreshToken = refreshToken;

        await sellerCentral.save();
        return res.status(200).json(new ApiResponse(200, sellerAccount, "Amazon Ads tokens generated successfully"));

    } catch (error) {
        // Handle specific errors from generateAdsRefreshToken
        logger.error(`Error in generateAmazonAdsTokens: ${error.message}`);

        // If it's an ApiError, preserve the status code and message
        if (error.statusCode) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, "", error.message));
        }

        // For other errors, return a generic 500
        return res.status(500).json(new ApiResponse(500, "", `Failed to generate ads refresh token: ${error.message}`));
    }
})


module.exports = { generateSPAPITokens, SaveAllDetails, addNewSellerCentralAccount, saveDetailsOfOtherAccounts, generateAmazonAdsTokens }