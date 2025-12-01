const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const {getProfileById}=require('../../Services/AmazonAds/GenerateProfileId.js');
const {generateAdsAccessToken}=require('../../Services/AmazonAds/GenerateToken.js');
const sellercentral=require('../../models/user-auth/sellerCentralModel.js');

const getProfileId=asyncHandler(async(req,res)=>{
    const region = req.region;
    const country = req.country;
    const userId= req.userId;
  
    const sellerCentral=await sellercentral.findOne({User:userId}).sort({createdAt: -1});
    if(!sellerCentral){
        return res.status(404).json(new ApiResponse(404,"","SellerCentral not found"));
    }
   
    const sellerAccount=sellerCentral.sellerAccount.find(account=>account.country===country && account.region===region);
    if(!sellerAccount){
        return res.status(404).json(new ApiResponse(404,"","Seller account not found for the specified region and country"));
    }

    
    const refreshToken=sellerAccount.adsRefreshToken;
    
    const accessToken=await generateAdsAccessToken(refreshToken);
    console.log(accessToken);
    if(!accessToken){
        return res.status(500).json(new ApiResponse(500,"","Failed to generate access token"));
    }
    
    const profileId=await getProfileById(accessToken,region ,country,userId);
    return res.status(200).json(new ApiResponse(200,profileId,'Profile ID fetched successfully'));
});

const saveProfileId=asyncHandler(async(req,res)=>{
    const {profileId,currencyCode}=req.body;
    if(!profileId || !currencyCode){
        return res.status(400).json(new ApiResponse(400,"","Profile ID and currency code are required"));
    }
    const country = req.country;
    const region = req.region;
    const userId= req.userId;
    const sellerCentral=await sellercentral.findOne({User:userId}).sort({createdAt: -1});
    if(!sellerCentral){
        return res.status(404).json(new ApiResponse(404,"","SellerCentral not found"));
    }
    const sellerAccount=sellerCentral.sellerAccount.find(account=>account.country===country && account.region===region);
    if(!sellerAccount){
        return res.status(404).json(new ApiResponse(404,"","Seller account not found for the specified region and country"));
    }
    sellerAccount.ProfileId=profileId;
    sellerAccount.countryCode=currencyCode;
    await sellerCentral.save();
    return res.status(200).json(new ApiResponse(200,profileId,'Profile ID saved successfully'));
});

module.exports={getProfileId,saveProfileId};