const dotenv = require('dotenv');
dotenv.config();

const accountSid = process.env.ACCOUNT_SID;
const authToken = process.env.AUTH_TOKEN;

const client = require('twilio')(accountSid, authToken);

const sendVerificationCode = async(otp,phoneNumber)=>{
    console.log("otp: ",otp);
    console.log("phoneNumber: ",phoneNumber);
    const message = `Your One Time Password (OTP) for verification for SellerQI is ${otp}`
    let messageOptions = {
        from : process.env.OTP_VERIFICATION_PHONE_NUMBER,
        to: phoneNumber,
        body:message
    }
    try{
        let response = await client.messages.create(messageOptions);
        if(response){
            return true;
        }
    }catch(error){
        throw error;
    }
}

module.exports = sendVerificationCode