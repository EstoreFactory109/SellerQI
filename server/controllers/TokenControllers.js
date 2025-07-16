const User = require('../models/userModel.js');
const Seller=require('../models/sellerCentralModel.js')
const {generateRefreshToken,generateAccessToken}=require('../Services/Sp_API/GenerateTokens');
const { ApiError } = require('../utils/ApiError');
const { ApiResponse } = require('../utils/ApiResponse');
const asyncHandler = require('../utils/AsyncHandler');
const {createLocationToken}=require('../utils/Tokens.js');
const logger = require('../utils/Logger.js');
const { UserSchedulingService } = require('../Services/BackgroundJobs/UserSchedulingService.js');
const {v4:uuidv4}=require('uuid');

const SaveAllDetails=asyncHandler(async(req,res)=>{
    const {region,country}=req.body;
    const userId=req.userId;
            // console.log(req.userId);
    if(!country || !region){
        return res.status(400).json(new ApiResponse(400,"","Credentials are missing"));
    }
            // console.log(region,country);
    const getUser=await User.findById(userId);
    if(!getUser){
        return res.status(404).json(new ApiResponse(404,"","User not found"));
    }


    const sellerCentral={
        country:country,
        region:region,
        
    }
    const createSellerCentral=await Seller.create({User:userId,selling_partner_id:uuidv4(),sellerAccount:sellerCentral});
    if(!createSellerCentral){
        logger.error(new ApiError(500,"Error in creating sellercentral"));
        return res.status(500).json(new ApiResponse(500,"","Error in creating sellercentral"));
    }

    getUser.sellerCentral=createSellerCentral._id;
    await getUser.save();

    // Update user's seller accounts in scheduling system
    try {
        await UserSchedulingService.updateUserSellerAccounts(userId);
        logger.info(`Updated seller accounts in scheduling system for user ${userId}`);
    } catch (error) {
        logger.error(`Failed to update scheduling for user ${userId}:`, error);
        // Don't fail the process if scheduling update fails
    }

    const locationToken=await createLocationToken(country,region);
    if(!locationToken){
        logger.error(new ApiError(500,"Error in creating location token")); 
        return res.status(500).json(new ApiError(500,"Error in creating location token"));
    }
    
    return res.status(201)
    .cookie("IBEXLocationToken",locationToken,{httpOnly:true,secure:true})
    .json(new ApiResponse(201,"","All the seller central information has been stored successfully"));
})


const saveDetailsOfOtherAccounts=asyncHandler(async(req,res)=>{
    const {region,country}=req.body;
    const userId=req.userId;
    if(!country || !region){
        return res.status(400).json(new ApiResponse(400,"","Credentials are missing"));
    }
    const sellerCentral=await Seller.findOne({User:userId});
    if(!sellerCentral){
        return res.status(404).json(new ApiResponse(404,"","Seller central not found"));
    }
    sellerCentral.sellerAccount.push({country:country,region:region});
    await sellerCentral.save();

    // Update user's seller accounts in scheduling system
    try {
        await UserSchedulingService.updateUserSellerAccounts(userId);
        logger.info(`Updated seller accounts in scheduling system for user ${userId}`);
    } catch (error) {
        logger.error(`Failed to update scheduling for user ${userId}:`, error);
        // Don't fail the process if scheduling update fails
    }

    const locationToken=await createLocationToken(country,region);
    if(!locationToken){
        logger.error(new ApiError(500,"Error in creating location token")); 
        return res.status(500).json(new ApiError(500,"Error in creating location token"));
    }
    return res.status(201)
    .cookie("IBEXLocationToken",locationToken,{httpOnly:true,secure:true})
    .json(new ApiResponse(201,"","New account added successfully"));
})

const addNewSellerCentralAccount=asyncHandler(async(req,res)=>{
    const region=req.region;
    const country=req.country;
    const userId=req.userId;
    if(!country || !region){
        return res.status(400).json(new ApiResponse(400,"","Credentials are missing"));
    }
    const sellerCentral=await Seller.findOne({User:userId});
    if(!sellerCentral){
        return res.status(404).json(new ApiResponse(404,"","Seller central not found"));
    }
    sellerCentral.sellerAccount.push({region:region,country:country});
    await sellerCentral.save();

    // Update user's seller accounts in scheduling system
    try {
        await UserSchedulingService.updateUserSellerAccounts(userId);
        logger.info(`Updated seller accounts in scheduling system for user ${userId}`);
    } catch (error) {
        logger.error(`Failed to update scheduling for user ${userId}:`, error);
        // Don't fail the process if scheduling update fails
    }

    const locationToken=await createLocationToken(country,region);
    if(!locationToken){
        logger.error(new ApiError(500,"Error in creating location token")); 
        return res.status(500).json(new ApiError(500,"Error in creating location token"));
    }
    return res.status(201)
    .cookie("IBEXLocationToken",locationToken,{httpOnly:true,secure:true})
    .json(new ApiResponse(201,"","New account added successfully"));
})


const generateSPAPITokens = asyncHandler(async(req, res) => {
    const { authCode, redirectUri } = req.body;
    const userId = req.userId;
    const region = req.region;
    const country = req.country;
    
    // Validation
    if (!region || !country) {
        return res.status(400).json(
            new ApiResponse(400, null, "Region and country are required")
        );
    }
    
    if (!authCode) {
        return res.status(400).json(
            new ApiResponse(400, null, "Authorization code is required")
        );
    }
    
    if (!redirectUri) {
        return res.status(400).json(
            new ApiResponse(400, null, "Redirect URI is required")
        );
    }
    
    try {
        // Generate tokens with both required parameters
        const tokenData = await generateRefreshToken(authCode, redirectUri);
        
        if (!tokenData || !tokenData.refreshToken) {
            return res.status(500).json(
                new ApiResponse(500, null, "Failed to generate refresh token")
            );
        }
        
        // Find seller
        const sellerCentral = await Seller.findOne({ User: userId });
        
        if (!sellerCentral) {
            return res.status(404).json(
                new ApiResponse(404, null, "Seller account not found")
            );
        }
        
        // Find the seller account for the region/country
        const sellerAccountIndex = sellerCentral.sellerAccount.findIndex(
            account => account.country === country && account.region === region
        );
        
        if (sellerAccountIndex === -1) {
            return res.status(404).json(
                new ApiResponse(404, null, "Seller account not found for the specified region and country")
            );
        }
        
        // Update the seller account with tokens
        sellerCentral.sellerAccount[sellerAccountIndex].spiRefreshToken = tokenData.refreshToken;
        
        // Optionally store access token and expiry
        sellerCentral.sellerAccount[sellerAccountIndex].spiAccessToken = tokenData.accessToken;
        sellerCentral.sellerAccount[sellerAccountIndex].tokenExpiresAt = new Date(
            Date.now() + (tokenData.expiresIn * 1000)
        );
        
        // Update sellerId at the account level (not global level)
        if (tokenData.sellerId) {
            sellerCentral.sellerAccount[sellerAccountIndex].sellerId = tokenData.sellerId;
        }
        
        // Save changes
        await sellerCentral.save();
        
        return res.status(200).json(
            new ApiResponse(200, {
                message: "Tokens generated and stored successfully",
                sellerId: tokenData.sellerId,
                region: region,
                country: country
            })
        );
        
    } catch (error) {
        logger.error(`Error in generateSPAPITokens: ${error.message}`);
        
        // Pass through ApiError if it's already formatted
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(error);
        }
        
        return res.status(500).json(
            new ApiResponse(500, null, "Failed to generate and store tokens")
        );
    }
});


module.exports={generateSPAPITokens,SaveAllDetails,addNewSellerCentralAccount,saveDetailsOfOtherAccounts}