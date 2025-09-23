const UserModel = require("../../models/userModel.js");
const { ApiError } = require("../../utils/ApiError.js");
const { hashPassword } = require("../../utils/HashPassword.js");
const logger = require("../../utils/Logger.js");


const createUser = async (firstname, lastname, phone, whatsapp, email, password, otp, allTermsAndConditionsAgreed, packageType, isInTrialPeriod, subscriptionStatus, trialEndsDate) => {

    if(!firstname || !lastname || !phone || !whatsapp || !email || !password || !otp || !packageType || !isInTrialPeriod || !subscriptionStatus || !trialEndsDate){
        logger.error(new ApiError(404,"Details and credentials are missing"));
        return false;
    }

    if (typeof allTermsAndConditionsAgreed !== 'boolean' || allTermsAndConditionsAgreed !== true) {
        logger.error(new ApiError(400, "Terms and conditions agreement is required"));
        return false;
    }

    try {
       // const hashedPassword = await hashPassword(password);
        const user = new UserModel({
            firstName: firstname,
            lastName: lastname,
            phone: phone,
            whatsapp: whatsapp,
            email: email,
            password: password,
            OTP: otp,
            allTermsAndConditionsAgreed: allTermsAndConditionsAgreed,
            packageType: packageType,
            isInTrialPeriod: isInTrialPeriod,
            subscriptionStatus: subscriptionStatus,
            trialEndsDate: trialEndsDate
        });
        return await user.save();
    } catch (error) {
        logger.error(`Error in registering user: ${error}`);
        return false;
    }
}

const getUserByEmail =async(email)=>{
    
    if(!email){
        logger.error(new ApiError(404,"Email is missing"));
        return false;
    }
    return await UserModel.findOne({ email }).select('+password');

    
}

const getUserById =async(id)=>{
    if(!id){
        logger.error(new ApiError(404,"Id is missing"));
        return false;
    }
    const user=await UserModel.findOne({_id:id,isVerified:true}).select("firstName lastName phone whatsapp email profilePic packageType subscriptionStatus");
    if(!user){
        logger.error(new ApiError(404,"User not found"));
        return false;
    }

    const userData = {
        userId:user._id,
        firstName : user.firstName,
        lastName : user.lastName ,
        phone:user.phone ,
        whatsapp:user.whatsapp ,
        email:user.email ,
        profilePic:user.profilePic,
        packageType: user.packageType,
        subscriptionStatus: user.subscriptionStatus
    };
    
    // Debug logging
    console.log('=== BACKEND getUserById DEBUG ===');
    console.log('Raw user from DB:', {
        packageType: user.packageType,
        subscriptionStatus: user.subscriptionStatus,
        email: user.email
    });
    console.log('Returned userData:', userData);
    
    return userData;
}


const verify=async(email,otp)=>{
    if(!email || !otp){
        logger.error(new ApiError(404,"Email or OTP is missing"));
        return false;
    }
    try {
        const user=await UserModel.findOne({
            email:email,
        })
        if(!user){
            logger.error(new ApiError(404,"User not found"));
            return false;
        }

        if(user.OTP!==otp){
            logger.error(new ApiError(400,"Invalid OTP"));
            return false;
        }

        user.OTP=null;
        user.isVerified=true;
        return await user.save();
    } catch (error) {
        logger.error(`Error in verifying user: ${error}`);
        return false;
    }
    
}

const updateInfo=async(userId,firstName,lastName,phone,whatsapp,email)=>{
    if(!userId){
        logger.error(new ApiError(404,"User id is missing"));
        return false;
    }

    try {
        const getUser=await UserModel.findById(userId).select("firstname lastname phone whatsapp email");
        if(!getUser){
            logger.error(new ApiError(404,"User not found"));
            return false;
        }

        getUser.firstName=firstName;
        getUser.lastName=lastName;
        getUser.phone=phone;
        getUser.whatsapp=whatsapp;
        getUser.email=email;
        await getUser.save();

        return {
           firstName: getUser.firstName,
           lastName:getUser.lastName,
           phone:getUser.phone,
           whatsapp:getUser.whatsapp,
           email:getUser.email
        };
    } catch (error) {
        logger.error(`Error in updating user info: ${error}`);
        return false;
    }
}

const updatePassword = async (email, newPassword) => {
    if (!email || !newPassword) {
        logger.error(new ApiError(400, "Email or password is missing"));
        return false;
    }

    try {
        const user = await UserModel.findOne({ email: email });
        
        if (!user) {
            logger.error(new ApiError(404, "User not found"));
            return false;
        }

        // Hash the new password
       // const hashedPassword = await hashPassword(newPassword);
        
        // Update the password and clear the reset code
        user.password = newPassword;
        user.resetPasswordCode = null;
        
        await user.save();
        
        return true;
    } catch (error) {
        logger.error(`Error in updating password: ${error}`);
        return false;
    }
}

module.exports = { createUser,getUserByEmail,verify,getUserById ,updateInfo, updatePassword}

