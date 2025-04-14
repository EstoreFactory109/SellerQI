const {createUser,getUserByEmail,verify,getUserById } = require('../Services/User/userServices.js');
const { ApiError } = require('../utils/ApiError.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const asyncHandler = require('../utils/AsyncHandler.js');
const {createAccessToken,createRefreshToken,createLocationToken} = require('../utils/Tokens.js');
const {verifyPassword}=require('../utils/HashPassword.js');
const logger = require('../utils/Logger.js');
const {generateOTP}=require('../utils/OTPGenerator.js');
const {sendEmail}=require('../Services/Email/SendOtp.js');
const UserModel = require('../models/userModel.js');
const SellerCentralModel=require('../models/sellerCentralModel.js');


const registerUser=asyncHandler(async(req,res)=>{
    const { firstname, lastname, phone, whatsapp, email, password } = req.body;
    console.log(firstname)

    if(!firstname || !lastname || !phone || !whatsapp || !email || !password){
        logger.error(new ApiError(400,"Details and credentials are missing"));
        return res.status(400).json(new ApiResponse(400,"","Details and credentials are missing"));
    }

    const checkUserIfExists=await getUserByEmail(email);
    

    if(checkUserIfExists){
        logger.error(new ApiError(409,"User already exists"));
        return res.status(409).json(new ApiResponse(409,"","User already exists"));
    }
    let otp=generateOTP();

    if(!otp){
        logger.error(new ApiError(500,"Internal server error in generating OTP"));
        return res.status(500).json(new ApiResponse(500,"","Internal server error in generating OTP"));
    }

    let emailSent=await sendEmail(email,firstname,otp);

    if(!emailSent){
        logger.error(new ApiError(500,"Internal server error in sending email"));
        return res.status(500).json(new ApiResponse(500,"","Internal server error in sending email"));
    }

    let data = await createUser(firstname, lastname, phone, whatsapp, email, password,otp);
   // console.log(data);

    if (!data) { 
        logger.error(new ApiError(500, "Internal server error in registering user"));
        return res.status(500).json(new ApiResponse(500,"","Internal server error in registering user"));
    }

    

    res.status(201)
        .json( new ApiResponse(201, "","User registered successfully. OTP has been sent to your email address"));

})


const verifyUser=asyncHandler(async(req,res)=>{

    const {email,otp}=req.body;

    if(!email || !otp){
        logger.error(new ApiError(400,"Email or OTP is missing"));
        return res.status(400).json(new ApiError(400,"Email or OTP is missing"));
    }

    const verifyUser=await verify(email,otp);

    if(!verifyUser){
        logger.error(new ApiError(400,"Invalid OTP"));
        return res.status(400).json(new ApiError(400,"Invalid OTP"));
    }

    const AccessToken= await createAccessToken(verifyUser.id);
    const RefreshToken= await createRefreshToken(verifyUser.id);


    if(!AccessToken || !RefreshToken){
        logger.error(new ApiError(500,"Internal server error in creating access token or refresh Token"));
        return res.status(500).json(new ApiError(500,"Internal server error in creating access token"));
    }

    const UpdateRefreshToken=await UserModel.findOneAndUpdate(
        {_id:verifyUser.id,isVerified:true},
        {$set:{appRefreshToken:RefreshToken}},
        {new:true}
    )

    if(!UpdateRefreshToken){
        logger.error(new ApiError(500,"Internal server error in updating refresh token"));
        return res.status(500).json(new ApiError(500,"Internal server error in updating refresh token"));
    }

    const options={
        httpOnly:true,
        secure:true,
    }

    res.status(200)
        .cookie("IBEXAccessToken",AccessToken,options)
        .cookie("IBEXRefreshToken",RefreshToken,options)
        .json(new ApiResponse(200,"","User verified successfully"))
    

})



const profileUser=asyncHandler(async(req,res)=>{
    const  userId=req.userId;

    if(!userId){
        logger.error(new ApiError(400,"User id is missing"));
        return res.status(400).json(new ApiResponse(400,"","User id is missing"));
    }

    const userProfile=await getUserById(userId);

    if(!userProfile){
        logger.error(new ApiError(404,"User not found"));
        return res.status(404).json(new ApiResponse(404,"","User not found"));
    }

    return res.status(200).json(new ApiResponse(200,userProfile,"User profile fetched successfully"));
})






const loginUser=asyncHandler(async(req,res)=>{
    const {email,password}=req.body;


    if(!email || !password){
        logger.error(new ApiError(400,"Details and credentials are missing"));
        return res.status(400).json(new ApiResponse(400,"","Details and credentials are missing"));
    }

    const checkUserIfExists=await getUserByEmail(email);

   

    if(!checkUserIfExists){
        logger.error( new ApiError(404,"User not found"));
        return res.status(404).json(new ApiResponse(404,"","User not found"));
    }

    const checkPassword= await verifyPassword(password,checkUserIfExists.password);


    if(!checkPassword){
        logger.error(new ApiError(401,"Password not matched"))
        return res.status(401).json(new ApiResponse(401,"","Password not matched"));
    }

    const getSellerCentral=await SellerCentralModel.findOne({User:checkUserIfExists._id});

    if(!getSellerCentral){
        logger.error(new ApiError(404,"Seller central not found"));
        return res.status(404).json(new ApiResponse(404,"","Seller central not found"));
    }

    const AccessToken= await createAccessToken(checkUserIfExists._id);
    const RefreshToken= await createRefreshToken(checkUserIfExists._id);
    const LocationToken= await createLocationToken(getSellerCentral.sellerAccount[0].country,getSellerCentral.sellerAccount[0].region);

    if(!AccessToken || !RefreshToken || !LocationToken){
        logger.error( new AccessToken(500,"Internal server error in creating tokens"));
        return res.status(500).json(new ApiResponse(500,"","Internal server error in creating tokens"));
    }

    const UpdateRefreshToken=await UserModel.findOneAndUpdate(
        {_id:checkUserIfExists._id,isVerified:true},
        {$set:{appRefreshToken:RefreshToken}},
        {new:true}
    )

    if(!UpdateRefreshToken){
        logger.error(new ApiError(500,"Internal server error in updating refresh token"));
        return res.status(500).json(new ApiResponse(500,"","Internal server error in updating refresh token"));
    }


    const option={
        httpOnly:true,
        secure:true
    }

    res.status(200)
        .cookie("IBEXAccessToken",AccessToken,option)
        .cookie("IBEXRefreshToken",RefreshToken,option)
        .cookie("IBEXLocationToken",LocationToken,option)
        .json(new ApiResponse(200,{
            firstName:checkUserIfExists.firstName,
            lastName:checkUserIfExists.lastName,
            email:checkUserIfExists.email,
            phone:checkUserIfExists.phone,
            whatsapp:checkUserIfExists.whatsapp
        },"User Loggedin successfully"))
})

const logoutUser=asyncHandler(async(req,res)=>{

    const  userId=req.userId;

    if(!userId){
        logger.error(new ApiError(400,"User id is missing"));
        return res.status(400).json(new ApiResponse(400,"","User id is missing"));
    }

    const UpdateRefreshToken=await UserModel.findOneAndUpdate(
        {_id:userId,isVerified:true},
        {$set:{appRefreshToken:""}},
        {new:true}
    )

    if(!UpdateRefreshToken){
        logger.error(new ApiError(500,"Internal server error in updating refresh token"));
        return res.status(500).json(new ApiResponse(500,"","Internal server error in updating refresh token"));
    }


    res.clearCookie("IBEXAccessToken");
    res.clearCookie("IBEXRefreshToken");
    res.clearCookie("IBEXLocationToken");
    res.status(200).json(new ApiResponse(200,"","User logged out successfully"));
})

module.exports = { registerUser,verifyUser,loginUser,profileUser,logoutUser };
