const axios = require('axios');
const aws4 = require('aws4');
const logger=require('../../utils/Logger.js');
const APlusContent= require('../../models/APlusContentModel.js');
const { ApiError } = require('../../utils/ApiError');

const getContentDocument= async (dataToReceive,userId,baseURI,country,region) => {
    const host = baseURI;  // Correct SP-API host

    // ✅ Fixed API Path & Required Params

   
    const queryParams = new URLSearchParams({
        marketplaceId: dataToReceive.marketplaceId, // Correct param
    }).toString();
  

    const path = `/aplus/2020-11-01/contentDocuments?${queryParams}`;

 
    // ✅ Construct Request
    let request = {
        host: host,
        path: path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",  // Recommended
            "content-type": "application/json",
            "x-amz-access-token": dataToReceive.AccessToken
        }
    };

    // ✅ Proper AWS Signing
    aws4.sign(request, {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        sessionToken: dataToReceive.SessionToken // Include only if using temporary credentials
    });

    // ✅ Make Request with Correct Headers
    try {
        const response = await axios.get(`https://${request.host}${request.path}`, { headers: request.headers });
        
        if(!response){
            logger.error(new ApiError("No Data Found", 404));
            return false;
        }

        
  
        const result=[]
         response.data.contentMetadataRecords.forEach((data)=>{

            const keyData={
                ReferenceKey:data.contentReferenceKey,
                Status:data.contentMetadata.status
            }
            result.push(keyData)
         });

         

        
         let asinList = [];
         
         const promises = result.map(async (key) => {
            
             try {
                 const Response = await getContentDocumentAsins(dataToReceive, baseURI,key.ReferenceKey);

                 
         
                 if (!Response) {
                     logger.error(new ApiError("No Data Found", 404));
                     return null; // Instead of returning false, return null to handle rejections properly
                 }
         
                 let asinArray = Response.asinMetadataSet.map((data) => data.asin);
         
                 return {
                     ContentReferenceKey: key.ReferenceKey,
                     Asins: asinArray,
                     status: key.Status,
                 };
             } catch (error) {
                 logger.error(new ApiError(error.message, 500));
                 return null; // Ensure errors do not stop execution
             }
         });
         
         // Wait for all promises to settle
         const results = await Promise.allSettled(promises);
         
         // Filter out failed responses and push only successful ones to asinList
         results.forEach((res) => {
             if (res.status === "fulfilled" && res.value) {
                 asinList.push(res.value);
             }
         });
         
         
            

        if(asinList.length===0){
            logger.error(new ApiError("No Data Found", 404));
            return false;
        }

        const createAPlus=await APlusContent.create({User:userId,region:region,country:country,ApiContentDetails:asinList});
        
        if(!createAPlus){
            logger.error(new ApiError("No Data Found", 404));
            return false;
        }
        
       

        return asinList;
         
    } catch (error) {
        console.error("❌ Error Fetching Catalog:", error.response?.data || error.message);
        return false;
    }
};

const getContentDocumentAsins= async (dataToReceive,baseURI,contentReferenceKey) => {
    const host = baseURI;  // Correct SP-API host

    // ✅ Fixed API Path & Required Params

   
console.log(dataToReceive)
console.log(contentReferenceKey)

const queryParams = new URLSearchParams({
    marketplaceId: dataToReceive.marketplaceId, // Correct param
}).toString();
  

    const path = `/aplus/2020-11-01/contentDocuments/${contentReferenceKey}/asins/?${queryParams}`;

 
    // ✅ Construct Request
    let request = {
        host: host,
        path: path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",  // Recommended
            "content-type": "application/json",
            "x-amz-access-token": dataToReceive.AccessToken
        }
    };

    // ✅ Proper AWS Signing
    aws4.sign(request, {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        sessionToken: dataToReceive.SessionToken // Include only if using temporary credentials
    });

    // ✅ Make Request with Correct Headers
    try {
        console.log(`https://${request.host}${request.path}`)
        const response = await axios.get(`https://${request.host}${request.path}`, { headers: request.headers });

        
        
        if(!response){
            logger.error(new ApiError("No Data Found", 404));
            return false;
        }

        
        return response.data
         
    } catch (error) {
        console.error("❌ Error Fetching Catalog:", error.response?.data || error.message);
        return false;
    }
};





module.exports={getContentDocument}