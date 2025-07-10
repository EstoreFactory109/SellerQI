const User = require('../models/userModel.js');
const Seller=require('../models/sellerCentralModel.js')
const {generateRefreshToken,generateAccessToken}=require('../Services/Sp_API/GenerateTokens');
const { ApiError } = require('../utils/ApiError');
const { ApiResponse } = require('../utils/ApiResponse');
const asyncHandler = require('../utils/AsyncHandler');
const {createLocationToken}=require('../utils/Tokens.js');
const logger = require('../utils/Logger.js');
const { UserSchedulingService } = require('../Services/BackgroundJobs/UserSchedulingService.js');


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
    const createSellerCentral=await Seller.create({User:userId,selling_partner_id:"",sellerAccount:sellerCentral});
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

const addNewAccount=asyncHandler(async(req,res)=>{
    const {region,country}=req.body;
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
    const {authCode,sellerId}=req.body;
    const userId=req.userId;
    if(!authCode || !sellerId){
        return res.status(400).json({message:"Code is missing"});
    }
    
    const Refreshtoken=await generateRefreshToken(userId,authCode);
    if(!Refreshtoken){
        return res.status(500).json(new ApiError(500,"Internal server error in generating refresh token"));
    }
    const AccessToken=await generateAccessToken(userId,Refreshtoken);
    if(!AccessToken){
        return res.status(500).json(new ApiError(500,"Internal server error in generating access token"));
    }

    const sellerCentral=await Seller.findOne({User:userId});
    if(!sellerCentral){
        return res.status(404).json(new ApiError(404,"SellerCentral not found"));
    }

    sellerCentral.selling_partner_id=sellerId;
    await sellerCentral.save()
    return res.status(200).json(new ApiResponse(200,"","Tokens generated successfully"));
})


module.exports={generateSPAPITokens,SaveAllDetails,addNewAccount,saveDetailsOfOtherAccounts}