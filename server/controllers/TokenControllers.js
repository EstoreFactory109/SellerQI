const User = require('../models/userModel.js');
const Seller=require('../models/sellerCentralModel.js')
const {generateRefreshToken,generateAdsRefreshToken}=require('../Services/Sp_API/GenerateTokens');
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


const generateSPAPITokens=asyncHandler(async(req,res)=>{
    const {authCode,sellingPartnerId}=req.body;
    const userId=req.userId;
    const region=req.region;
    const country=req.country;
    if(!region || !country){
        return res.status(400).json(new ApiResponse(400,"","Region and country are missing"));
    }
    if(!authCode || !sellingPartnerId){
        return res.status(400).json({message:"Authorization code, selling partner id and state are missing"});
    }
    
    const {refreshToken}=await generateRefreshToken(authCode);
    if(!refreshToken){
        return res.status(500).json(new ApiError(500,"Internal server error in generating refresh token"));
    }
    

    const sellerCentral=await Seller.findOne({User:userId});
    if(!sellerCentral){
        return res.status(404).json(new ApiError(404,"SellerCentral not found"));
    }

    sellerCentral.selling_partner_id=sellingPartnerId;

    // Find the seller account that matches the current region and country
    const sellerAccount = sellerCentral.sellerAccount.find(account => 
        account.country === country && account.region === region
    );
    
    if(!sellerAccount){
        return res.status(404).json(new ApiError(404,"Seller account not found for the specified region and country"));
    }

    // Store the refresh token in the seller account
    sellerAccount.spiRefreshToken = refreshToken;
    
    
    
    await sellerCentral.save();
    return res.status(200).json(new ApiResponse(200,sellerAccount,"Tokens generated successfully"));
})

const generateAmazonAdsTokens=asyncHandler(async(req,res)=>{
    const {authCode}=req.body;
    const userId=req.userId;
    const region=req.region;
    const country=req.country;
    if(!region || !country){
        return res.status(400).json(new ApiResponse(400,"","Region and country are missing"));
    }
    if(!authCode){
        return res.status(400).json({message:"Authorization code"});
    }
    
    const {refreshToken}=await generateAdsRefreshToken(authCode);
    if(!refreshToken){
        return res.status(500).json(new ApiError(500,"Internal server error in generating refresh token"));
    }
    

    const sellerCentral=await Seller.findOne({User:userId});
    if(!sellerCentral){
        return res.status(404).json(new ApiError(404,"SellerCentral not found"));
    }


    // Find the seller account that matches the current region and country
    const sellerAccount = sellerCentral.sellerAccount.find(account => 
        account.country === country && account.region === region
    );
    
    if(!sellerAccount){
        return res.status(404).json(new ApiError(404,"Seller account not found for the specified region and country"));
    }

    // Store the refresh token in the seller account
    sellerAccount.adsRefreshToken = refreshToken;
    
    
    
    await sellerCentral.save();
    return res.status(200).json(new ApiResponse(200,sellerAccount,"Tokens generated successfully"));
})


module.exports={generateSPAPITokens,SaveAllDetails,addNewSellerCentralAccount,saveDetailsOfOtherAccounts,generateAmazonAdsTokens}