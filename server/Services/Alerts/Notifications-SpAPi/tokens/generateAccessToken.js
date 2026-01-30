const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const logger=require('../../../../utils/Logger');
const axios=require('axios');
const { ApiError } = require('../../../../utils/ApiError');

const generateAccessToken = async()=>{
   

    const clientId=process.env.SPAPI_CLIENT_ID;
    const clientSecret=process.env.SPAPI_CLIENT_SECRET;
    
    if(!clientId || !clientSecret){
        const error = new ApiError(500,"Alerts client credentials are missing from environment variables");
        logger.error(error);
        throw error;
    }

    const scope=process.env.ALERT_ACCESS_TOKEN_SCOPE;
    const grantType="client_credentials";

    const body = new URLSearchParams({
        grant_type: grantType,
        scope: scope,
        client_id: clientId,
        client_secret: clientSecret
    });
  
    const response = await axios.post("https://api.amazon.com/auth/o2/token", body, {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        }
    });

    if(!response || !response.data){
        const error = new ApiError(500,"Internal server error in generating access token - no response received");
        logger.error(error);
        throw error;
    }


}

module.exports = generateAccessToken;