const UserModel = require('../../models/user-auth/userModel.js');
const SellerCentralModel = require('../../models/user-auth/sellerCentralModel.js');
const { ApiError } = require("../../utils/ApiError.js");
const { hashPassword } = require("../../utils/HashPassword.js");
const logger = require("../../utils/Logger.js");


const createUser = async (firstname, lastname, phone, whatsapp, email, password, otp, allTermsAndConditionsAgreed, packageType, isInTrialPeriod, subscriptionStatus, trialEndsDate) => {

    // Validate required fields
    // Note: trialEndsDate can be null for PRO users who need to pay (not in trial)
    if(!firstname || !lastname || !phone || !whatsapp || !email || !password || !otp || !packageType || (isInTrialPeriod == null) || !subscriptionStatus){
        logger.error(new ApiError(404,"Details and credentials are missing"));
        return false;
    }

    // If user is in trial period, trialEndsDate is required
    if (isInTrialPeriod === true && !trialEndsDate) {
        logger.error(new ApiError(400, "Trial end date is required for trial users"));
        return false;
    }

    if (typeof allTermsAndConditionsAgreed !== 'boolean' || allTermsAndConditionsAgreed !== true) {
        logger.error(new ApiError(400, "Terms and conditions agreement is required"));
        return false;
    }

    try {
        const hashedPassword = await hashPassword(password);
        const userData = {
            firstName: firstname,
            lastName: lastname,
            phone: phone,
            whatsapp: whatsapp,
            email: email,
            password: hashedPassword,
            OTP: otp,
            allTermsAndConditionsAgreed: allTermsAndConditionsAgreed,
            packageType: packageType,
            isInTrialPeriod: isInTrialPeriod,
            subscriptionStatus: subscriptionStatus
        };
        
        // Only set trialEndsDate if it's provided (for trial users)
        if (trialEndsDate) {
            userData.trialEndsDate = trialEndsDate;
        }
        
        const user = new UserModel(userData);
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
    const user=await UserModel.findOne({_id:id,isVerified:true}).select("firstName lastName phone whatsapp email profilePic packageType subscriptionStatus isInTrialPeriod trialEndsDate accessType");
    if(!user){
        logger.error(new ApiError(404,"User not found"));
        return false;
    }

    // Fetch seller central data for this user
    const sellerCentral = await SellerCentralModel.findOne({ User: id });

    const userData = {
        userId:user._id,
        firstName : user.firstName,
        lastName : user.lastName ,
        phone:user.phone ,
        whatsapp:user.whatsapp ,
        email:user.email ,
        profilePic:user.profilePic,
        packageType: user.packageType,
        subscriptionStatus: user.subscriptionStatus,
        isInTrialPeriod: user.isInTrialPeriod,
        trialEndsDate: user.trialEndsDate,
        accessType: user.accessType,
        // Include sellerCentral data for SP-API and Ads connection check
        sellerCentral: sellerCentral ? {
            sellerAccount: (sellerCentral.sellerAccount || []).map(account => ({
                country: account.country,
                region: account.region,
                selling_partner_id: account.selling_partner_id,
                spiRefreshToken: account.spiRefreshToken ? 'connected' : null, // Don't expose actual token, just indicate if connected
                adsRefreshToken: account.adsRefreshToken ? 'connected' : null // Don't expose actual token, just indicate if connected
            }))
        } : null
    };
    
    // Debug logging
    console.log('=== BACKEND getUserById DEBUG ===');
    console.log('Raw user from DB:', {
        packageType: user.packageType,
        subscriptionStatus: user.subscriptionStatus,
        isInTrialPeriod: user.isInTrialPeriod,
        trialEndsDate: user.trialEndsDate,
        email: user.email
    });
    console.log('sellerCentral found:', !!sellerCentral);
    if (sellerCentral) {
        console.log('sellerAccount count:', sellerCentral.sellerAccount?.length || 0);
        console.log('Has spiRefreshToken:', sellerCentral.sellerAccount?.some(acc => acc.spiRefreshToken && acc.spiRefreshToken.trim() !== ''));
    }
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
        const hashedPassword = await hashPassword(newPassword);
        
        // Update the password and clear the reset code
        user.password = hashedPassword;
        user.resetPasswordCode = null;
        
        await user.save();
        
        return true;
    } catch (error) {
        logger.error(`Error in updating password: ${error}`);
        return false;
    }
}

module.exports = { createUser,getUserByEmail,verify,getUserById ,updateInfo, updatePassword}

