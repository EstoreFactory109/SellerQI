const axios = require("axios");
const aws4 = require("aws4");
const logger = require("../../utils/Logger.js");
const APlusContent = require("../../models/APlusContentModel.js");
const { ApiError } = require("../../utils/ApiError");

const getContentDocument = async (dataToReceive, userId, baseURI, country, region) => {
    const host = baseURI;  // Correct SP-API host

    const queryParams = new URLSearchParams({
        marketplaceId: dataToReceive.marketplaceId, // Correct param
    }).toString();
  
    const path = `/aplus/2020-11-01/contentDocuments?${queryParams}`;

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

    aws4.sign(request, {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        sessionToken: dataToReceive.SessionToken // Include only if using temporary credentials
    });

    try {
        const response = await axios.get(`https://${request.host}${request.path}`, { headers: request.headers });
        
        if(!response || !response.data || !response.data.contentMetadataRecords){
            logger.error(new ApiError("No A+ Content metadata records found", 404));
            return false;
        }
  
        const result = []
        response.data.contentMetadataRecords.forEach((data)=>{
            const keyData = {
                ReferenceKey: data.contentReferenceKey,
                Status: data.contentMetadata.status
            }
            result.push(keyData)
        });
        
        let asinList = [];
         
        const promises = result.map(async (key) => {
            try {
                const Response = await getContentDocumentAsins(dataToReceive, baseURI, key.ReferenceKey);
         
                if (!Response || !Response.asinMetadataSet) {
                    logger.warn(`No ASIN metadata found for contentReferenceKey: ${key.ReferenceKey}`);
                    return null; 
                }
         
                let asinArray = Response.asinMetadataSet.map((data) => data.asin);
         
                return {
                    ContentReferenceKey: key.ReferenceKey,
                    Asins: asinArray,
                    status: key.Status,
                };
            } catch (error) {
                logger.error(new ApiError(`Error fetching ASINs for ${key.ReferenceKey}: ${error.message}`, 500));
                return null; 
            }
        });
         
        const results = await Promise.allSettled(promises);
         
        results.forEach((res) => {
            // MODIFIED: Added check for res.value.status === 'APPROVED'
            if (res.status === "fulfilled" && res.value && res.value.status === 'APPROVED') {
                asinList.push(res.value);
            }
        });
            
        if(asinList.length === 0){
            logger.info("No APPROVED A+ Content documents with ASINs found after filtering.");
            // It's not necessarily an error if no APPROVED A+ content is found, so we might not want to return false here
            // or create an empty record. For now, let's proceed to create an empty record if that's the desired behavior.
        }

        // Ensure ApiContentDetails is an array, even if empty
        const apiContentDetailsToSave = asinList.map(item => ({
            ContentReferenceKey: item.ContentReferenceKey,
            Asins: item.Asins,
            status: item.status // This will always be 'APPROVED' due to the filter
        }));

        const createAPlus = await APlusContent.create({
            User: userId,
            region: region,
            country: country,
            ApiContentDetails: apiContentDetailsToSave
        });
        
        if(!createAPlus){
            logger.error(new ApiError("Failed to create APlusContent record in DB", 500));
            return false; // Or handle error appropriately
        }
        
        return apiContentDetailsToSave; // Return the saved/filtered data
         
    } catch (error) {
        console.error("❌ Error Fetching A+ Content Documents:", error.response?.data || error.message);
        logger.error(new ApiError(`A+ Content fetch error: ${error.message}`, error.response?.status || 500));
        return false;
    }
};

const getContentDocumentAsins = async (dataToReceive, baseURI, contentReferenceKey) => {
    const host = baseURI;

    const queryParams = new URLSearchParams({
        marketplaceId: dataToReceive.marketplaceId,
    }).toString();
  
    const path = `/aplus/2020-11-01/contentDocuments/${contentReferenceKey}/asins?${queryParams}`;

    let request = {
        host: host,
        path: path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",
            "content-type": "application/json",
            "x-amz-access-token": dataToReceive.AccessToken
        }
    };

    aws4.sign(request, {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        sessionToken: dataToReceive.SessionToken
    });

    try {
        const response = await axios.get(`https://${request.host}${request.path}`, { headers: request.headers });
        
        if(!response || !response.data){
            logger.warn(`No data returned for getContentDocumentAsins for ${contentReferenceKey}`);
            return null; // Return null instead of false for better error handling upstream
        }
        
        return response.data;
         
    } catch (error) {
        console.error(`❌ Error Fetching ASINs for Content Document ${contentReferenceKey}:`, error.response?.data || error.message);
        logger.error(new ApiError(`Error fetching ASINs for ${contentReferenceKey}: ${error.message}`, error.response?.status || 500));
        return null; // Return null for better error handling
    }
};

module.exports = { getContentDocument };