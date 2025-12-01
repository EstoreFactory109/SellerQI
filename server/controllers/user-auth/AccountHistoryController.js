const {ApiError} = require("../../utils/ApiError");
const { ApiResponse } = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/AsyncHandler");
const logger = require("../../utils/Logger");
const AccountHistory =require('../../models/user-auth/AccountHistory.js')

const AddAccountHistory = asyncHandler(async (req, res) => {
    const  userId=req.userId;
    const country=req.country;
    const region  = req.region;
 const {Date,HealthScore,TotalProducts,ProductsWithIssues,TotalNumberOfIssues,expireDate}=req.body;

 if(!userId || !country || !region || !Date || !HealthScore || !TotalProducts || !ProductsWithIssues || !TotalNumberOfIssues || !expireDate){
    logger.error(new ApiError(400,"User id, country and region is missing"));
    return res.status(400).json(new ApiResponse(400,"","User id, country and region is missing"));
 }


const getAccountHistory=await AccountHistory.findOne({User:userId,country:country,region:region});

if(!getAccountHistory){
    const createAccountHistory=await AccountHistory.create({User:userId,country:country,region:region,accountHistory:[{
        Date:Date,
        HealthScore:HealthScore,
        TotalProducts:TotalProducts,
        ProductsWithIssues:ProductsWithIssues,
        TotalNumberOfIssues:TotalNumberOfIssues,
        expireDate:expireDate
    }]})

    if(!createAccountHistory){
        logger.error(new ApiError(500,"Error in creating account history"));
        return res.status(500).json(new ApiResponse(500,"","Error in creating account history"));
    }

    return res.status(201).json(new ApiResponse(200,createAccountHistory.accountHistory,"Account history added successfully"));
}

getAccountHistory.accountHistory.push({
    Date:Date,
    HealthScore:HealthScore,
    TotalProducts:TotalProducts,
    ProductsWithIssues:ProductsWithIssues,
    TotalNumberOfIssues:TotalNumberOfIssues,
    expireDate:expireDate
})

await getAccountHistory.save();


return res.status(201).json(new ApiResponse(200,getAccountHistory.accountHistory,"Account history Updated successfully"));

});

const getAccountHistory=asyncHandler(async(req,res)=>{
    const  userId=req.userId;
    const country=req.country;
    const region  = req.region;
            // console.log(userId,country,region)
    if(!userId || !country || !region){
        logger.error(new ApiError(400,"User id, country and region is missing"));
        return res.status(400).json(new ApiResponse(400,"","User id, country and region is missing"));
     }
    const GetAccountHistory=await AccountHistory.findOne({User:userId,country:country,region:region});
    if(!GetAccountHistory){
        return res.status(200).json(new ApiResponse(200,[],"No account history found"));
    }
    return res.status(200).json(new ApiResponse(200,GetAccountHistory.accountHistory,"Account history fetched successfully"));
})

module.exports = { AddAccountHistory,getAccountHistory };