const { Analyse } = require('../../controllers/AnalysingController.js');
const logger = require('../../utils/Logger.js');
const Seller = require('../../models/sellerCentralModel.js');
const axios = require('axios');
const { sendWeeklyEmailToUser } = require('../Email/SendWeeklyEmail.js');


const analyzeUserData = async (userId, country, region) => {
    try {
        logger.info(`Starting analysis for user: ${userId}, country: ${country}, region: ${region}`);
        
        // Validate required parameters
        if (!userId) {
            logger.error('User ID is missing for analysis');
            return {
                status: 400,
                message: 'User ID is missing'
            };
        }
        
        if (!country || !region) {
            logger.error('Country or region is missing for analysis');
            return {
                status: 400,
                message: 'Country or region is missing'
            };
        }
        
        // Call the Analyse function from AnalysingController
        const analysisResult = await Analyse(userId, country, region);
        
        if (analysisResult.status === 200) {
            logger.info(`Analysis completed successfully for user: ${userId}`);
            return analysisResult.message;
        } else {
            logger.error(`Analysis failed for user: ${userId}, status: ${analysisResult.status}, message: ${analysisResult.message}`);
            return analysisResult;
        }
        
    } catch (error) {
        logger.error(`Error in analyzeUserData for user ${userId}:`, error);
        return {
            status: 500,
            message: `Internal server error: ${error.message}`
        };
    }
};

const sendMail = async()=>{
    try {

        const getSellers = await Seller.find({}).populate('User','firstName email');
        //const getSellers = await Seller.findOne({User:"689b9d9cfc29576b59e7f46c"}).populate('User','firstName email');

        if(!getSellers){
            logger.error('No users found');
            return;
        }

        // Divide sellers into 3 batches
        const totalSellers = getSellers.length;
        const batchSize = Math.ceil(totalSellers / 3);
        
        const batch1 = getSellers.slice(0, batchSize);
        const batch2 = getSellers.slice(batchSize, batchSize * 2);
        const batch3 = getSellers.slice(batchSize * 2);
        
        logger.info(`Divided ${totalSellers} sellers into 3 batches: Batch1(${batch1.length}), Batch2(${batch2.length}), Batch3(${batch3.length})`);
        
        // Process all batches in parallel
        const processBatch = async (batch, batchNumber) => {
            logger.info(`Starting parallel processing for batch ${batchNumber} with ${batch.length} sellers`);
            
            // Process all sellers in this batch in parallel
            const promises = batch.map(async (seller) => {
                try {
                    // Process each seller (replace with your actual logic)
                    const result = await getAnalysisData(seller);
                    logger.info(`Processed seller: ${seller.User?.firstName} (${seller.User?.email}) in batch ${batchNumber}`);
                    return result;
                } catch (error) {
                    logger.error(`Error processing seller ${seller.User?.email} in batch ${batchNumber}:`, error);
                    return null;
                }
            });
            
            return Promise.all(promises);
        };
        
        // Process all 3 batches in parallel
        const [batch1Results, batch2Results, batch3Results] = await Promise.all([
            processBatch(batch1, 1),
            processBatch(batch2, 2),
            processBatch(batch3, 3)
        ]);
        
        logger.info(`All batches processed. Batch1: ${batch1Results.length} results, Batch2: ${batch2Results.length} results, Batch3: ${batch3Results.length} results`);

       
        
    } catch (error) {
        logger.error('Error in sendMail:', error);
    }
}

const getAnalysisData = async(seller)=>{
    try{
        
        if (!seller.User || !seller.User._id || !seller.User.firstName || !seller.User.email) {
            logger.error('Invalid seller data - missing required user information');
            return null;
        }
        
        const userId = seller.User._id;
        const firstName = seller.User.firstName;
        const Email = seller.User.email;
        const brandName = seller.brand || '';
        
        if (!seller.sellerAccount || !Array.isArray(seller.sellerAccount) || seller.sellerAccount.length === 0) {
            logger.error('No seller accounts found for seller:', seller.User.email);
            return null;
        }
        
        for (const element of seller.sellerAccount) {
            
            if(!element.spiRefreshToken && !element.adsRefreshToken){
                logger.error('No refresh token found for seller: ',seller.User.email);
                continue;
            }

            

            const analyseResult = await analyzeUserData(userId,element.country,element.region);
            console.log("analyseResult: ",analyseResult);
            
            if(!analyseResult || analyseResult.status !== 200){
                logger.error('Error in analyseResult:', analyseResult);
                continue;
            }
            
            const healthScore = analyseResult.AccountData?.getAccountHealthPercentge?.Percentage || 0;

            const getCalculationData = await axios.post(`${process.env.CALCULATION_API_URI}/calculation-api/calculate`,
                analyseResult
            );
            
            if(!getCalculationData || !getCalculationData.data || !getCalculationData.data.data || !getCalculationData.data.data.dashboardData){
                logger.error('Error in getCalculationData:', getCalculationData);
                continue;
            }

            console.log("getCalculationData: ",getCalculationData.data.data.dashboardData.TotalRankingerrors);
            
            const rankingErrors = getCalculationData.data.data.dashboardData.TotalRankingerrors || 0;
            const conversionErrors = getCalculationData.data.data.dashboardData.totalErrorInConversion || 0;
            const accountErrors = getCalculationData.data.data.dashboardData.totalErrorInAccount || 0;
            const profitabilityErrors = getCalculationData.data.data.dashboardData.totalProfitabilityErrors || 0;
            const sponsoredAdsErrors = getCalculationData.data.data.dashboardData.totalSponsoredAdsErrors || 0;
            const inventoryErrors = getCalculationData.data.data.dashboardData.totalInventoryErrors || 0;
            const marketPlace = getCalculationData.data.data.dashboardData.Country || '';
            const totalIssues = rankingErrors + conversionErrors + accountErrors + profitabilityErrors + sponsoredAdsErrors + inventoryErrors;
           // const totalActiveProducts = getCalculationData.data.data.ActiveProducts.length();
            const sendEmail = await sendWeeklyEmailToUser(firstName,Email,marketPlace,brandName,healthScore,rankingErrors,conversionErrors,accountErrors,profitabilityErrors,sponsoredAdsErrors,inventoryErrors,totalIssues,"59");

            if(!sendEmail){
                logger.error('Error in sendEmail:', sendEmail);
                continue;
            }
            return getCalculationData.data.data.dashboardData;
        }
    }catch(error){
        logger.error('Error in getAnalysisData:', error);
        return null;
    }
}

module.exports = {
    analyzeUserData,
    getAnalysisData,
    sendMail
};
