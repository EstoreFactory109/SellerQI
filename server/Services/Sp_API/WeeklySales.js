const axios = require('axios');
const aws4 = require('aws4');
const TotalSalesModel = require('../../models/products/TotalSalesModel.js');
const logger = require('../../utils/Logger.js');
const apiError = require('../../utils/ApiError.js');

const TotalSales = async (dataToReceive,UserId,baseuri,country,region) => {
    const host = baseuri;

    const queryParams = `marketplaceIds=${dataToReceive.marketplaceId}&interval=${dataToReceive.after}--${dataToReceive.before}&granularity=Day`;

    const path = `/sales/v1/orderMetrics?${queryParams}`;

    // Construct request
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

    // AWS Signature V4 signing
    aws4.sign(request, {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        sessionToken: dataToReceive.SessionToken
    });

    // Make the request
    try {
        const response = await axios.get(`https://${request.host}${request.path}`, { headers: request.headers });
        if (!response || !response.data) {
            return false;
        }

        let totalSalesArr=[];

        response.data.payload.forEach((elm)=>{
            totalSalesArr.push({
                interval:elm.interval,
                TotalAmount:elm.totalSales.amount
            })
        })

        const createTotalSales=await TotalSalesModel.create({
            User:UserId,
            region:region,
            country:country,
            totalSales:totalSalesArr
        })

        if(!createTotalSales){
            logger.error(new apiError(400,"Failed to create total sales"))
            return false;
        }

        return createTotalSales;
    } catch (error) {
        logger.error(new apiError(500,"Internal server error in getting total sales"));
        return false;
    }
};

module.exports = TotalSales;
