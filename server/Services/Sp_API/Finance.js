const axios = require('axios');
const aws4 = require('aws4');
const listFinancialEvents = require('../../models/listFinancialEventsModel.js');
const ProductWiseSales = require('../../models/ProductWiseSalesModel.js');
const UserModel = require('../../models/userModel.js');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError');

const listFinancialEventsMethod = async (dataToReceive, userId, baseuri, country, region) => {
    const host = baseuri;

    console.log("📥 Incoming data:", dataToReceive);

    const queryParams = new URLSearchParams({
        postedAfter: dataToReceive.after,
        postedBefore: dataToReceive.before,
        marketplaceId: dataToReceive.marketplaceId,
    }).toString();

    const path = `/finances/2024-06-19/transactions?${queryParams}`;

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
        sessionToken: dataToReceive.SessionToken // Only needed if temporary creds
    });

    try {
        const response = await axios.get(`https://${request.host}${request.path}`, {
            headers: request.headers
        });

        const responseData = response.data.payload;

        const dataObj = calculateAmazonFees(responseData.transactions);


        const addToDb = await listFinancialEvents.create({
            User: userId,
            region: region,
            country: country,
            Gross_Profit: dataObj.Gross_Profit,
            ProductAdsPayment: dataObj.ProductAdsPayment,
            FBA_Fees: dataObj.FBA_Fees,
            Amazon_Charges: dataObj.Amazon_Charges,
            Refunds: dataObj.Refunds,
            Storage: dataObj.Storage,
        });

        const addToSalesDb = await ProductWiseSales.create({
            User: userId,
            region: region,
            country: country,
            productWiseSales: dataObj.ProductWiseSales
        });

        if (!addToDb || !addToSalesDb) {
            logger.error(new ApiError(500, "Error in adding to DB"));
            return false;
        }

        const getUser = await UserModel.findById(userId);
        getUser.listFinancialEvents = addToDb._id;
        await getUser.save();

        return addToDb;

    } catch (error) {
        console.error("❌ Error Fetching Financial Events:", error.response?.data || error.message);
        return false;
    }
};

const calculateAmazonFees = (dataArray) => {
    let totalGrossProfit = 0;
    let totalFBAFees = 0;
    let totalRefunds = 0;
    let ProductAdsPayment = 0;
    let Shipment = 0;
    let adjustment = 0;
    let AmazonFees = 0;
    let DebtRecovery = 0;
    let storage = 0;
    let ProductWiseSales = [];

    dataArray.forEach(data => {
        const amount = data.totalAmount?.currencyAmount || 0;

        switch (data.transactionType) {
            case "ProductAdsPayment":
                ProductAdsPayment += amount;
                break;

            case "Shipment":
                Shipment += amount;
                const asin = data.items?.[0]?.contexts?.[0]?.asin;
                const quantity = data.items?.[0]?.contexts?.[0]?.quantityShipped;
                if (asin && quantity !== undefined) {
                    ProductWiseSales.push({
                        asin: asin,
                        quantity: quantity,
                        amount: amount
                    });
                }
                break;

            case "Refund":
                totalRefunds += amount;
                break;

            case "DebtRecovery":
                DebtRecovery += amount;
                break;

            case "Adjustment":
                adjustment += amount;
                break;

            case "ServiceFee":
                if (data.description === "Subscription") {
                    AmazonFees += amount;
                } else if (data.description === "FBAStorageBilling") {
                    storage += amount;
                } else {
                    totalFBAFees += amount;
                }
                break;

            default:
                break;
        }
    });

    totalGrossProfit = totalFBAFees + totalRefunds + ProductAdsPayment + Shipment + adjustment + AmazonFees + DebtRecovery + storage;

    return {
        Gross_Profit: totalGrossProfit.toFixed(2),
        ProductAdsPayment: Math.abs(ProductAdsPayment.toFixed(2)),
        FBA_Fees: Math.abs(totalFBAFees.toFixed(2)),
        Amazon_Charges: Math.abs(AmazonFees.toFixed(2)),
        Refunds: Math.abs(totalRefunds.toFixed(2)),
        Storage: Math.abs(storage.toFixed(2)),
        ProductWiseSales: ProductWiseSales
    };
};

module.exports = { listFinancialEventsMethod };
