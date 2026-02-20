const getReport = require('../../Services/Sp_API/GET_MERCHANT_LISTINGS_ALL_DATA.js');
const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');
const getshipment = require('../../Services/Sp_API/shipment.js');
const puppeteer = require("puppeteer");
const { generateAccessToken, generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
const { getKeywordPerformanceReport } = require('../../Services/AmazonAds/GetWastedSpendKeywords.js');
const {getCampaign} = require('../../Services/AmazonAds/GetCampaigns.js');
const { getPPCSpendsBySKU } = require('../../Services/AmazonAds/GetPPCProductWise.js');
const { getPPCSpendsDateWise } = require('../../Services/AmazonAds/GetDateWiseSpendKeywords.js');
const { getKeywords } = require('../../Services/AmazonAds/Keywords.js');
const { getPPCMetrics } = require('../../Services/AmazonAds/GetPPCMetrics.js');
const { getPPCUnitsSold } = require('../../Services/AmazonAds/GetPPCUnitsSold.js');
const {getNegativeKeywords} = require('../../Services/AmazonAds/NegetiveKeywords.js');
const tokenManager = require('../../utils/TokenManager.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { Integration } = require('../../Services/main/Integration.js');
const {getSearchKeywords} = require('../../Services/AmazonAds/GetSearchKeywords.js');
const GET_FBA_INVENTORY_PLANNING_DATA = require('../../Services/Sp_API/GET_FBA_INVENTORY_PLANNING_DATA.js');
const {getBrand} = require('../../Services/Sp_API/GetBrand.js');
const {getAdGroups} = require('../../Services/AmazonAds/AdGroups.js');
const {getKeywordRecommendations} = require('../../Services/AmazonAds/KeyWordsRecommendations.js');
const { sendRegisteredEmail } = require('../../Services/Email/SendEmailOnRegistered.js');
const getLedgerSummaryReport = require('../../Services/Sp_API/GET_LEDGER_SUMMARY_VIEW_DATA.js');
const getProductWiseFBAData = require('../../Services/Sp_API/GetProductWiseFBAData.js');
const adsKeywordsPerformanceModel = require('../../models/amazon-ads/adsKeywordsPerformanceModel.js');

const testReport = async (req, res) => {
    const {accessToken}=req.body

    const report = await getReport(accessToken, ["A1F83G8C2ARO7P"], "68b22cf2ca1778e39c966bc0", "UK","EU","sellingpartnerapi-eu.amazon.com");
    if (!report) {
        return res.status(408).json({ message: "Report did not complete within 5 minutes" })
    }
    return res.status(200).json({
        message: "Report Requested! Report ID: ",
        data: report
    })
}

const testNormalEndpoint = async (req, res) => {
    return res.status(200).json({ message: "Normal Endpoint" })
}

const getTotalSales = async (req, res) => {
    try {
        const temporaryCredentials = await getTemporaryCredentials("us-east-1");

        const dataToSend = {
            marketplaceId: "ATVPDKIKX0DER",
            after: "2025-03-01T00:00:00Z",
            before: "2025-03-07T23:59:59Z",
            SessionToken: temporaryCredentials.SessionToken,
            AccessToken: "Atza|IwEBIPpEipI_wTzmJB8Ueu6wcjVMRvGw2Qk_uynf8T26ELJRR6IkTZVFyA7ioyxBf6SOTZNReLxVU1iTBC406CGgbP860LiEEkehgkj6ufLYnY6ufEeGgUD3sxovj0rEdgQ0VYJsbFijwmNMjO6ZK0WHH_cugtN8LkXC9Z7_n74ioDuDsbTBnwiGnd_JRPXcy6IMDCxPDkL7M53nPPhoxhXysBsTCKs_A6xO-xVDKy8kBOzqLN_lypfzPrBfeVzjS-tpl9N4Kj8n_0GuEgUUV-IAPeGocLcknyJ2gL3_8w_URodBlcO3j2Y3jHjm1916cnAPjfZ0kO3YvWYk3Eb2GjkV7Rvl9MD-4aUn9KKgEmd5-H2jnQ"
        }
        const result = await getshipment(dataToSend, "67e2fa4a782037804651ddd3", "sellingpartnerapi-na.amazon.com", "US", "NA");
        //dataToSend,"67e2fa4a782037804651ddd3","sellingpartnerapi-na.amazon.com","US","NA"

        return res.status(200).json({
            data: result
        })

    } catch (error) {
        throw new Error(error)
    }
}






const getReviewData = async (req, res) => {
    try {
      const url = "https://www.amazon.com/dp/B008KJEYLO"; // replace with your ASIN
  
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
  
      const page = await browser.newPage();
  
      await page.setUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110 Safari/537.36"
      );
      await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
  
      await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });
  
      // Scroll to load lazy content
      await page.evaluate(() => window.scrollBy(0, 1500));
      await new Promise((resolve) => setTimeout(resolve, 2000));
  
    
  
      // ✅ Get basic product data
      const productData = await page.evaluate(() => {
        const title = document.querySelector("#productTitle")?.innerText.trim() || null;
  
        const about = Array.from(document.querySelectorAll("#feature-bullets li span"))
          .map((el) => el.innerText.trim())
          .filter(Boolean);
  
        const description =
          document.querySelector("#productDescription")?.innerText.trim() ||
          document.querySelector("#aplus")?.innerText.trim() ||
          null;
  
        const imageData = document.querySelector("#imgTagWrapperId img")?.getAttribute("data-a-dynamic-image");
        const images = imageData ? Object.keys(JSON.parse(imageData)) : [];
  
        const starRatingContent = document.querySelector(".a-icon-alt")?.innerText.trim() || null;
        const starRating=Number(starRatingContent.split(" ")[0]);
        const totalRatingsContent = document.querySelector("#acrCustomerReviewText")?.innerText.trim() || null;
        const totalRatings=Number(totalRatingsContent.split(" ")[0].replace(/,/g, ""))
        
        const reviewCountElement =
          document.querySelectorAll("#cm-cr-dp-review-list > li").length 

          const videoCount=document.querySelector("#videoCount")?.innerText.trim()||null;
         

        return {
          title,
          about,
          description,
          images,
          starRating,
          totalRatings,
          reviewCountElement,
          videoCount
        };
      });
  
      await browser.close();
  
      return res.status(200).json({
        productData
      });
    } catch (error) {
      console.error("Scraping error:", error);
      return res.status(500).json({ error: error.message });
    }
  };




const testAmazonAds = async (req, res) => {
    const { accessToken, region } = req.body;
    const result = await getProfileById(accessToken, region,"US","681b7e41525925e8abb7d3c6");
    return res.status(200).json({
        data: result
    })
}

  const testGetCampaigns = async (req, res) => {
    const { accessToken, profileId } = req.body;
    const result = await getCampaign(accessToken,profileId,"NA","681b7e41525925e8abb7d3c6","US");
    return res.status(200).json({
        data: result
    })
  }




  const testGetAdGroups = async (req, res) => {
    const { accessToken, region,profileId,campaignIds } = req.body;
    const result = await getAdGroups(accessToken,profileId,"NA","681b7e41525925e8abb7d3c6","US",["384401447418864","296211985111834","501765201108807"]);
    return res.status(200).json({
        data: result
    })
  }

  const testGetKeywords = async (req, res) => {
    const { accessToken, region,profileId } = req.body;
    const campaignId=["384401447418864","344856825901105","304447074514909"]
    const adGroupId=["430568511470558","507081767760505","366695316274140"]
    const result = await getNegativeKeywords(accessToken,"3813192246011322","684b2156d5c2340ff1b7bd2b","US",region,campaignId,adGroupId);
    return res.status(200).json({
        data: result
    })
  }

  const testGetPPCSpendsBySKU = async (req, res) => {
    try {
      const { accessToken, region, profileId, userId, country, fetchTokenFromDB } = req.body;
      
      // If fetchTokenFromDB is true, get token from database
      let adsAccessToken = accessToken;
      let adsProfileId = profileId;
      let testUserId = userId || "684b2156d5c2340ff1b7bd2b";
      let testCountry = country || "US";
      
      if (fetchTokenFromDB && userId) {
        const Seller = require('../../models/user-auth/sellerCentralModel.js');
        const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
        const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
        
        const sellerAccount = await Seller.findOne({ userId: userId });
        
        if (!sellerAccount) {
          return res.status(404).json({
            success: false,
            error: 'Seller account not found for the provided userId'
          });
        }
        
        if (!sellerAccount.adsRefreshToken) {
          return res.status(400).json({
            success: false,
            error: 'Ads refresh token not found for this user. Please connect Amazon Ads account first.'
          });
        }
        
        // Generate access token from refresh token
        adsAccessToken = await generateAdsAccessToken(sellerAccount.adsRefreshToken);
        
        if (!adsAccessToken) {
          return res.status(500).json({
            success: false,
            error: 'Failed to generate Ads access token. Please check refresh token validity.'
          });
        }
        
        // Get profile ID if not provided
        if (!adsProfileId && sellerAccount.adsProfileId) {
          adsProfileId = sellerAccount.adsProfileId;
        } else if (!adsProfileId) {
          // Try to get profile ID
          try {
            const profiles = await getProfileById(adsAccessToken, region || 'NA');
            if (profiles && profiles.length > 0) {
              adsProfileId = profiles[0].profileId;
            }
          } catch (profileError) {
            console.error('Error fetching profile ID:', profileError.message);
          }
        }
        
        testUserId = userId;
        testCountry = sellerAccount.country || country || "US";
      }
      
      // Validate required parameters
      if (!adsAccessToken) {
        return res.status(400).json({
          success: false,
          error: 'accessToken is required. Either provide it in the request body or set fetchTokenFromDB to true with a valid userId.'
        });
      }
      
      if (!adsProfileId) {
        return res.status(400).json({
          success: false,
          error: 'profileId is required. Either provide it in the request body or ensure the user has a profileId in the database.'
        });
      }
      
      if (!region) {
        return res.status(400).json({
          success: false,
          error: 'region is required. Valid values: NA, EU, FE'
        });
      }
      
      // Validate region
      const validRegions = ['NA', 'EU', 'FE'];
      if (!validRegions.includes(region)) {
        return res.status(400).json({
          success: false,
          error: `Invalid region: ${region}. Valid values are: ${validRegions.join(', ')}`
        });
      }
      
      console.log('🧪 Testing Search Keywords API:', {
        userId: testUserId,
        country: testCountry,
        region: region,
        profileId: adsProfileId,
        hasAccessToken: !!adsAccessToken
      });
      
      // Call the getSearchKeywords function
      const result = await getSearchKeywords(
        adsAccessToken,
        adsProfileId,
        testUserId,
        testCountry,
        region
      );
      
      return res.status(200).json({
        success: true,
        message: 'Search Keywords data retrieved successfully',
        data: result,
        metadata: {
          userId: testUserId,
          country: testCountry,
          region: region,
          profileId: adsProfileId,
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (error) {
      console.error('❌ Error in testGetPPCSpendsBySKU:', error);
      
      // Handle specific error types
      if (error.response) {
        const status = error.response.status || 500;
        const errorData = error.response.data || {};
        
        return res.status(status).json({
          success: false,
          error: 'Amazon Ads API Error',
          message: error.message,
          details: errorData,
          statusCode: status
        });
      }
      
      // Handle token-related errors
      if (error.message && (
        error.message.includes('token') || 
        error.message.includes('unauthorized') ||
        error.message.includes('401')
      )) {
        return res.status(401).json({
          success: false,
          error: 'Authentication Error',
          message: error.message,
          suggestion: 'Please check if your access token is valid or try setting fetchTokenFromDB to true to refresh the token.'
        });
      }
      
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: error.message || 'An unexpected error occurred while fetching search keywords'
      });
    }
  }

  const testGetWastedSpendKeywords = async (req, res) => {
    try {
      const { accessToken, profileId, userId, country, region, refreshToken, testMode: requestedTestMode } = req.body;
      
      // Default to 'full' if testMode is not provided
      const testMode = requestedTestMode || 'full';

      // Validate required parameters
      if (!accessToken) {
        return res.status(400).json({
          success: false,
          error: 'accessToken is required'
        });
      }

      if (!profileId) {
        return res.status(400).json({
          success: false,
          error: 'profileId is required'
        });
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required'
        });
      }

      if (!country) {
        return res.status(400).json({
          success: false,
          error: 'country is required'
        });
      }

      if (!region) {
        return res.status(400).json({
          success: false,
          error: 'region is required (NA, EU, or FE)'
        });
      }

      // Validate region
      const validRegions = ['NA', 'EU', 'FE'];
      if (!validRegions.includes(region)) {
        return res.status(400).json({
          success: false,
          error: `Invalid region: ${region}. Must be one of: ${validRegions.join(', ')}`
        });
      }

      console.log('Testing GetWastedSpendKeywords with params:', {
        profileId,
        userId,
        country,
        region,
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        testMode: testMode || 'full'
      });

      // Test Mode: 'api' - Only test API call
      // Test Mode: 'database' - Only test database retrieval
      // Test Mode: 'calculation' - Only test calculation logic
      // Test Mode: 'full' - Test everything (default)

      const testResults = {
        apiTest: null,
        databaseTest: null,
        calculationTest: null,
        wastedKeywords: []
      };

      // 1. Test API Call (if not database-only or calculation-only mode)
      if (testMode !== 'database' && testMode !== 'calculation') {
        try {
          console.log('📡 Step 1: Testing API call...');
          console.log('Calling getKeywordPerformanceReport with:', {
            profileId,
            userId,
            country,
            region,
            hasAccessToken: !!accessToken,
            hasRefreshToken: !!refreshToken,
            testMode
          });
          
          const apiResult = await getKeywordPerformanceReport(
            accessToken,
            profileId,
            userId,
            country,
            region,
            refreshToken
          );
          
          console.log('API call completed, result:', {
            success: apiResult.success,
            hasData: !!apiResult.data,
            dataLength: apiResult.data?.length || 0
          });

          testResults.apiTest = {
            success: apiResult.success,
            reportId: apiResult.reportId,
            keywordsCount: apiResult.data?.length || 0,
            message: apiResult.success 
              ? `Successfully fetched ${apiResult.data?.length || 0} keywords from API`
              : `API call failed: ${apiResult.error}`
          };

          console.log('✅ API Test Result:', testResults.apiTest);
        } catch (apiError) {
          testResults.apiTest = {
            success: false,
            error: apiError.message,
            stack: process.env.NODE_ENV === 'development' ? apiError.stack : undefined
          };
          console.error('❌ API Test Failed:', apiError.message);
        }
      } else {
        testResults.apiTest = {
          skipped: true,
          reason: `API test skipped because testMode is '${testMode}'. Use testMode: 'full' or 'api' to run API test.`
        };
        console.log(`⏭️  API test skipped (testMode: ${testMode})`);
      }

      // 2. Test Database Retrieval
      if (testMode !== 'api') {
        try {
          console.log('💾 Step 2: Testing database retrieval...');
          const dbData = await adsKeywordsPerformanceModel
            .findOne({ userId, country, region })
            .sort({ createdAt: -1 })
            .lean();

          if (dbData) {
            testResults.databaseTest = {
              success: true,
              keywordsCount: dbData.keywordsData?.length || 0,
              createdAt: dbData.createdAt,
              message: `Found ${dbData.keywordsData?.length || 0} keywords in database`
            };
            console.log('✅ Database Test Result:', testResults.databaseTest);

            // 3. Test Calculation Logic
            if (testMode !== 'api' && testMode !== 'database') {
              try {
                console.log('🧮 Step 3: Testing wasted spend calculation...');
                const keywordsData = dbData.keywordsData || [];

                // Calculate wasted spend keywords: cost > 0 && attributedSales30d === 0 (with tolerance for floating point)
                const wastedKeywords = keywordsData
                  .filter(keyword => {
                    const cost = parseFloat(keyword.cost) || 0;
                    const attributedSales30d = parseFloat(keyword.attributedSales30d) || 0;
                    // Use < 0.01 instead of === 0 to handle floating point precision issues
                    return cost > 0 && attributedSales30d < 0.01;
                  })
                  .map(keyword => {
                    const cost = parseFloat(keyword.cost) || 0;
                    const attributedSales30d = parseFloat(keyword.attributedSales30d) || 0;
                    
                    return {
                      keyword: keyword.keyword,
                      keywordId: keyword.keywordId,
                      campaignName: keyword.campaignName,
                      campaignId: keyword.campaignId,
                      adGroupName: keyword.adGroupName,
                      matchType: keyword.matchType,
                      spend: cost,
                      sales: attributedSales30d,
                      clicks: keyword.clicks,
                      impressions: keyword.impressions,
                      acos: attributedSales30d > 0 ? (cost / attributedSales30d) * 100 : null
                    };
                  })
                  .sort((a, b) => b.spend - a.spend);

                const totalWastedSpend = wastedKeywords.reduce((sum, kw) => sum + kw.spend, 0);
                const totalKeywords = keywordsData.length;
                const wastedPercentage = totalKeywords > 0 ? (wastedKeywords.length / totalKeywords) * 100 : 0;

                testResults.calculationTest = {
                  success: true,
                  totalKeywords: totalKeywords,
                  wastedKeywordsCount: wastedKeywords.length,
                  totalWastedSpend: totalWastedSpend,
                  wastedPercentage: wastedPercentage.toFixed(2),
                  message: `Found ${wastedKeywords.length} wasted keywords (${wastedPercentage.toFixed(2)}% of total)`
                };

                testResults.wastedKeywords = wastedKeywords.slice(0, 20); // Return top 20

                console.log('✅ Calculation Test Result:', testResults.calculationTest);
              } catch (calcError) {
                testResults.calculationTest = {
                  success: false,
                  error: calcError.message,
                  stack: process.env.NODE_ENV === 'development' ? calcError.stack : undefined
                };
                console.error('❌ Calculation Test Failed:', calcError.message);
              }
            }
          } else {
            testResults.databaseTest = {
              success: false,
              message: 'No keyword performance data found in database for this user/country/region'
            };
            console.log('⚠️ Database Test: No data found');
          }
        } catch (dbError) {
          testResults.databaseTest = {
            success: false,
            error: dbError.message,
            stack: process.env.NODE_ENV === 'development' ? dbError.stack : undefined
          };
          console.error('❌ Database Test Failed:', dbError.message);
        }
      }

      // Determine overall success
      const overallSuccess = Object.values(testResults)
        .filter(result => result && typeof result === 'object' && 'success' in result)
        .every(result => result.success !== false);

      return res.status(overallSuccess ? 200 : 207).json({
        success: overallSuccess,
        message: 'Wasted spend keywords test completed',
        testMode: testMode,
        results: testResults,
        summary: {
          apiTestPassed: testResults.apiTest?.success !== false && !testResults.apiTest?.skipped,
          apiTestSkipped: testResults.apiTest?.skipped || false,
          databaseTestPassed: testResults.databaseTest?.success !== false,
          calculationTestPassed: testResults.calculationTest?.success !== false,
          wastedKeywordsFound: testResults.wastedKeywords?.length || 0
        },
        note: testMode === 'calculation' || testMode === 'database' 
          ? `⚠️ API test was skipped because testMode is '${testMode}'. To test the API call, use testMode: 'full' or 'api', or omit testMode (defaults to 'full').`
          : null
      });

    } catch (error) {
      console.error('Error in testGetWastedSpendKeywords:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to test wasted spend keywords',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  /**
   * Fetch the last stored ads keywords performance document for a user.
   * Used to verify what keyword data (wasted spend source) is in the DB.
   * POST body: { userId (required), country (optional), region (optional) }
   * - If country and region are provided: returns last document for that user+country+region.
   * - Otherwise: returns the single most recent document for the user (any country/region).
   */
  const getLastAdsKeywordsPerformanceDocument = async (req, res) => {
    try {
      const { userId, country, region } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required'
        });
      }

      const mongoose = require('mongoose');
      const userIdObj = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null;
      if (!userIdObj) {
        return res.status(400).json({
          success: false,
          error: 'userId must be a valid MongoDB ObjectId'
        });
      }

      const query = { userId: userIdObj };
      if (country != null && country !== '') query.country = country;
      if (region != null && region !== '') query.region = region;

      const doc = await adsKeywordsPerformanceModel
        .findOne(query)
        .sort({ createdAt: -1 })
        .lean();

      if (!doc) {
        return res.status(404).json({
          success: false,
          error: 'No ads keywords performance document found for the given criteria',
          criteria: { userId: userId, ...(country != null && { country }), ...(region != null && { region }) }
        });
      }

      const keywordsCount = Array.isArray(doc.keywordsData) ? doc.keywordsData.length : 0;
      return res.status(200).json({
        success: true,
        message: 'Last ads keywords performance document retrieved',
        data: doc,
        summary: {
          documentId: doc._id,
          userId: doc.userId,
          country: doc.country,
          region: doc.region,
          keywordsDataCount: keywordsCount,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt
        }
      });
    } catch (error) {
      console.error('Error in getLastAdsKeywordsPerformanceDocument:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch last ads keywords performance document'
      });
    }
  };

  const testGetBrand = async (req, res) => {
    const { asin, marketplaceId, accessToken } = req.body;
    const temporaryCredentials = await getTemporaryCredentials("us-east-1");
    const SessionToken = temporaryCredentials.SessionToken;
    const result = await getBrand(asin, marketplaceId, SessionToken, "sellingpartnerapi-na.amazon.com", accessToken,"681b7e41525925e8abb7d3c6");
    return res.status(200).json({
        data: result
    })
  }


  const testSendEmailOnRegistered = async (req, res) => {
    const { userId, firstName, lastName, userPhone, userEmail,sellerId } = req.body;

    console.log(userId, firstName, lastName, userPhone, userEmail,sellerId);
    const result = await sendRegisteredEmail(userId, firstName, lastName, userPhone, userEmail,sellerId);
    return res.status(200).json({
        data: result
    })
  }

  /**
   * Test NumberOfProductReviews - Fetches product review data from RapidAPI
   * Accepts userId, country, and region - fetches ASINs automatically from Seller model
   * NOTE: This function was updated to fetch ASINs from the database instead of requiring them in the request
   */
  const testNumberOfProductReviews = async (req, res) => {
    try {
      const { userId, country, region } = req.body;
      
      // Import required modules
      const mongoose = require('mongoose');
      const Seller = require('../../models/user-auth/sellerCentralModel.js');
      const { addReviewDataTODatabase } = require('../../Services/Sp_API/NumberOfProductReviews.js');
      
      // Validate required parameters
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required'
        });
      }
      
      if (!country) {
        return res.status(400).json({
          success: false,
          error: 'country is required (e.g., US, UK, DE, CA)'
        });
      }
      
      if (!region) {
        return res.status(400).json({
          success: false,
          error: 'region is required (NA, EU, or FE)'
        });
      }
      
      // Validate region
      const validRegions = ['NA', 'EU', 'FE'];
      if (!validRegions.includes(region)) {
        return res.status(400).json({
          success: false,
          error: `Invalid region: ${region}. Valid values are: ${validRegions.join(', ')}`
        });
      }
      
      console.log('🔍 [testNumberOfProductReviews] Fetching seller account and ASINs from database...');
      
      // Convert userId to ObjectId if needed
      let userIdQuery = userId;
      if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
        userIdQuery = new mongoose.Types.ObjectId(userId);
      }
      
      // Find the Seller document
      const sellerCentral = await Seller.findOne({ User: userIdQuery });
      
      if (!sellerCentral) {
        return res.status(404).json({
          success: false,
          error: 'Seller account not found for the provided userId',
          suggestion: 'Please ensure the user has connected their Amazon Seller Central account.'
        });
      }
      
      // Find the specific seller account for this country/region
      const sellerAccount = sellerCentral.sellerAccount?.find(
        acc => acc.country === country && acc.region === region
      );
      
      if (!sellerAccount) {
        return res.status(404).json({
          success: false,
          error: `No seller account found for country: ${country}, region: ${region}`,
          availableAccounts: sellerCentral.sellerAccount?.map(acc => ({
            country: acc.country,
            region: acc.region
          })) || []
        });
      }
      
      // Extract ASINs from ACTIVE products only
      const products = sellerAccount.products || [];
      const activeProducts = products.filter(p => p.status === 'Active');
      const asins = activeProducts
        .map(p => p.asin)
        .filter(asin => asin && typeof asin === 'string' && asin.trim().length > 0);
      
      if (asins.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No active products with ASINs found in the seller account',
          suggestion: 'Please ensure the seller account has active products with ASINs',
          totalProducts: products.length,
          activeProducts: activeProducts.length
        });
      }
      
      console.log(`✅ [testNumberOfProductReviews] Found ${asins.length} ASINs from active products (${products.length} total, ${activeProducts.length} active)`);
      console.log('🧪 [testNumberOfProductReviews] Starting product reviews fetch:', {
        userId,
        country,
        region,
        asinCount: asins.length,
        sampleAsins: asins.slice(0, 5)
      });
      
      // Call the addReviewDataTODatabase service
      const result = await addReviewDataTODatabase(asins, country, userId, region);
      
      if (!result) {
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch and save product reviews data',
          message: 'The service returned false. Check logs for details.'
        });
      }
      
      // Return success response with summary
      return res.status(200).json({
        success: true,
        message: 'Product reviews data fetched and saved successfully',
        data: {
          recordId: result._id,
          userId: result.User,
          country: result.country,
          region: result.region,
          productsCount: result.Products?.length || 0,
          createdAt: result.createdAt
        },
        summary: {
          totalAsins: asins.length,
          productsProcessed: result.Products?.length || 0,
          sampleProducts: result.Products?.slice(0, 3).map(p => ({
            asin: p.asin,
            product_title: p.product_title,
            product_num_ratings: p.product_num_ratings,
            product_star_ratings: p.product_star_ratings,
            has_brandstory: p.has_brandstory
          })) || []
        },
        metadata: {
          userId,
          country,
          region,
          processedAt: new Date().toISOString()
        }
      });
      
    } catch (error) {
      console.error('❌ Error in testNumberOfProductReviews:', error);
      
      // Handle specific error cases
      if (error.response) {
        const status = error.response.status || 500;
        const errorData = error.response.data || {};
        
        return res.status(status).json({
          success: false,
          error: 'RapidAPI Error',
          status: status,
          message: error.message,
          details: errorData
        });
      }
      
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: error.message || 'An unexpected error occurred while fetching product reviews'
      });
    }
  }

const testLedgerSummaryReport = async (req, res) => {
    try {
        const { accessToken, marketplaceIds, baseuri, userId, country, region, dataStartTime, dataEndTime } = req.body;

        if (!accessToken) {
            return res.status(400).json({ 
                success: false,
                message: "accessToken is required" 
            });
        }

        if (!userId || !country || !region) {
            return res.status(400).json({ 
                success: false,
                message: "userId, country, and region are required" 
            });
        }

        // Default values if not provided
        const marketplaceIdsArray = marketplaceIds || ["ATVPDKIKX0DER"]; // Default US marketplace
        const baseURI = baseuri || "sellingpartnerapi-na.amazon.com";

        let report;
        try {
            report = await getLedgerSummaryReport(accessToken, marketplaceIdsArray, userId, baseURI, country, region);
        } catch (error) {
            // Handle authorization and other errors
            if (error.message.includes('Access denied') || error.message.includes('Unauthorized')) {
                return res.status(403).json({
                    success: false,
                    message: error.message,
                    data: null,
                    hint: "This report may require specific SP-API permissions. Check your Amazon Developer Console app permissions."
                });
            }
            return res.status(500).json({
                success: false,
                message: error.message || "Error generating report",
                data: null
            });
        }
        
        if (!report || !report.success) {
            return res.status(408).json({ 
                success: false,
                message: report?.message || "Report did not complete within the time limit",
                data: null
            });
        }

        return res.status(200).json({
            success: true,
            message: report.message || "Report fetched and saved successfully",
            data: report.data,
            recordId: report.recordId,
            totalRecords: report.totalRecords
        });
    } catch (error) {
        console.error("❌ Error in testLedgerSummaryReport:", error.message);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
            data: null
        });
    }
}

const testGetProductWiseFBAData = async (req, res) => {
    try {
        const { accessToken, marketplaceIds, baseuri, userId, country, region } = req.body;

        if (!accessToken) {
            return res.status(400).json({ 
                success: false,
                message: "accessToken is required" 
            });
        }

        if (!userId || !country || !region) {
            return res.status(400).json({ 
                success: false,
                message: "userId, country, and region are required" 
            });
        }

        // Default values if not provided
        const marketplaceIdsArray = marketplaceIds || ["ATVPDKIKX0DER"]; // Default US marketplace
        const baseURI = baseuri || "sellingpartnerapi-na.amazon.com";

        let result;
        try {
            result = await getProductWiseFBAData(accessToken, marketplaceIdsArray, userId, baseURI, country, region);
        } catch (error) {
            // Handle authorization and other errors
            if (error.message.includes('Access denied') || error.message.includes('Unauthorized')) {
                return res.status(403).json({
                    success: false,
                    message: error.message,
                    data: null,
                    hint: "This report may require specific SP-API permissions. Check your Amazon Developer Console app permissions."
                });
            }
            return res.status(500).json({
                success: false,
                message: error.message || "Error generating report",
                data: null
            });
        }
        
        if (!result || !result.success) {
            return res.status(408).json({ 
                success: false,
                message: result?.message || "Report did not complete within the time limit",
                data: null
            });
        }

        // Extract summary information from the data
        const fbaDataArray = result.data?.fbaData || [];
        const summary = {
            totalProducts: fbaDataArray.length,
            productsWithSalesPrice: fbaDataArray.filter(item => item["sales-price"] && parseFloat(item["sales-price"]) > 0).length,
            productsWithFees: fbaDataArray.filter(item => item["estimated-fee-total"] && parseFloat(item["estimated-fee-total"]) > 0).length,
            productsWithDimensions: fbaDataArray.filter(item => item["longest-side"] && item["median-side"] && item["shortest-side"]).length,
            productsWithBrand: fbaDataArray.filter(item => item.brand && item.brand.trim() !== "").length,
            productsWithProductName: fbaDataArray.filter(item => item["product-name"] && item["product-name"].trim() !== "").length,
            totalEstimatedFees: fbaDataArray.reduce((sum, item) => {
                const fee = parseFloat(item["estimated-fee-total"]) || 0;
                return sum + fee;
            }, 0).toFixed(2),
            fieldsAvailable: fbaDataArray.length > 0 ? Object.keys(fbaDataArray[0]) : []
        };

        return res.status(200).json({
            success: true,
            message: result.message || "Product wise FBA data fetched and saved successfully",
            data: result.data,
            summary: summary,
            sampleData: fbaDataArray.slice(0, 5), // Return first 5 items as sample
            metadata: {
                savedAt: result.data?.createdAt || new Date().toISOString(),
                userId: userId,
                country: country,
                region: region,
                marketplaceIds: marketplaceIdsArray
            }
        });
    } catch (error) {
        console.error("❌ Error in testGetProductWiseFBAData:", error.message);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
            data: null
        });
    }
}

// Dedicated test function for Search Keywords
const testSearchKeywords = async (req, res) => {
  try {
    const { accessToken, region, profileId, userId, country, fetchTokenFromDB } = req.body;
    
    // Import required modules
        const Seller = require('../../models/user-auth/sellerCentralModel.js');
        const tokenManager = require('../../utils/TokenManager.js');
    const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
    const { getSearchKeywords } = require('../../Services/AmazonAds/GetSearchKeywords.js');
    
    let adsAccessToken = accessToken;
    let adsProfileId = profileId;
    let testUserId = userId;
    let testCountry = country || "US";
    let spRefreshToken = null;
    let adsRefreshToken = null;
    
    // If fetchTokenFromDB is true, get tokens from database
    if (fetchTokenFromDB && userId) {
      // Convert userId to ObjectId if it's a string
      const mongoose = require('mongoose');
      let userIdQuery = userId;
      
      // Try to convert to ObjectId if it's a valid ObjectId string
      if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
        userIdQuery = new mongoose.Types.ObjectId(userId);
      }
      
      console.log('🔍 Searching for seller account:', {
        userId: userId,
        userIdType: typeof userId,
        userIdQuery: userIdQuery,
        userIdQueryType: typeof userIdQuery
      });
      
      // Find the Seller document by User field
      const sellerCentral = await Seller.findOne({ User: userIdQuery }).sort({ createdAt: -1 });
      
      if (!sellerCentral) {
        // Try alternative queries for debugging
        const allSellers = await Seller.find({}).limit(5).select('User sellerAccount.country sellerAccount.region');
        console.log('🔍 Debug: Sample sellers in database:', allSellers.map(s => ({
          userId: s.User,
          userIdType: typeof s.User,
          userIdString: s.User?.toString(),
          accounts: s.sellerAccount?.map(acc => ({ country: acc.country, region: acc.region }))
        })));
        
        return res.status(404).json({
                success: false,
          error: 'Seller account not found for the provided userId',
          debug: {
            searchedUserId: userId,
            searchedUserIdType: typeof userId,
            isObjectIdValid: mongoose.Types.ObjectId.isValid(userId),
            suggestion: 'Please ensure the user has connected their Amazon Seller Central account first.'
          }
        });
      }
      
      console.log('✅ Found seller central:', {
        sellerCentralId: sellerCentral._id,
        userField: sellerCentral.User,
        userFieldType: typeof sellerCentral.User,
        userFieldString: sellerCentral.User?.toString(),
        sellerAccountCount: sellerCentral.sellerAccount?.length || 0
      });
      
      // Find the specific sellerAccount by country and region
      const sellerAccount = sellerCentral.sellerAccount?.find(
        account => account.country === (country || "US") && account.region === region
      );
      
      if (!sellerAccount) {
        return res.status(404).json({
                success: false,
          error: `Seller account not found for country: ${country || "US"} and region: ${region}`,
          availableAccounts: sellerCentral.sellerAccount?.map(acc => ({
            country: acc.country,
            region: acc.region,
            hasAdsToken: !!acc.adsRefreshToken
          })) || [],
          suggestion: 'Please ensure the user has connected their Amazon Ads account for this country and region.'
        });
      }
      
      if (!sellerAccount.adsRefreshToken) {
            return res.status(400).json({
                success: false,
          error: 'Ads refresh token not found for this user. Please connect Amazon Ads account first.',
          country: sellerAccount.country,
          region: sellerAccount.region
        });
      }
      
      // Store refresh tokens for TokenManager
      adsRefreshToken = sellerAccount.adsRefreshToken;
      spRefreshToken = sellerCentral.sellerAccount?.find(acc => acc.spiRefreshToken)?.spiRefreshToken || null;
      
      // Get initial access token (TokenManager will refresh if needed)
      const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
      try {
        adsAccessToken = await generateAdsAccessToken(adsRefreshToken);
        if (!adsAccessToken) {
            return res.status(500).json({
                success: false,
            error: 'Failed to generate Ads access token. The refresh token may be invalid or expired. Please reconnect your Amazon Ads account.'
            });
        }
      } catch (tokenError) {
            return res.status(500).json({
                success: false,
          error: 'Failed to generate Ads access token',
          message: tokenError.message,
          suggestion: 'The refresh token may be invalid or expired. Please reconnect your Amazon Ads account.'
        });
      }
      
      // Get profile ID if not provided
      if (!adsProfileId && sellerAccount.ProfileId) {
        adsProfileId = sellerAccount.ProfileId;
        console.log('✅ Using profile ID from database:', adsProfileId);
      } else if (!adsProfileId) {
        // Try to get profile ID from Amazon Ads API
        console.log('🔄 Profile ID not found in database, fetching from Amazon Ads API...');
        try {
          const testCountryValue = sellerAccount.country || country || "US";
          const testRegionValue = sellerAccount.region || region;
          const profiles = await getProfileById(adsAccessToken, testRegionValue, testCountryValue, testUserId);
          if (profiles && Array.isArray(profiles) && profiles.length > 0) {
            adsProfileId = profiles[0].profileId;
            console.log('✅ Auto-selected profile ID:', adsProfileId);
          }
        } catch (profileError) {
          console.error('⚠️ Error fetching profile ID:', profileError.message);
        }
      }
      
      console.log('✅ Tokens fetched from database:', {
        hasAccessToken: !!adsAccessToken,
        hasProfileId: !!adsProfileId,
        userId: testUserId
      });
    }
    
    // Validate required parameters
    if (!adsAccessToken) {
            return res.status(400).json({
                success: false,
        error: 'accessToken is required. Either provide it in the request body or set fetchTokenFromDB to true.'
      });
    }
    
    if (!adsProfileId) {
      return res.status(400).json({
        success: false,
        error: 'profileId is required. Either provide it in the request body or set fetchTokenFromDB to true with a valid region.'
      });
    }
    
    if (!region) {
      return res.status(400).json({
        success: false,
        error: 'region is required. Valid values: NA, EU, FE'
      });
    }
    
    if (!testUserId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required. Either provide it in the request body or set fetchTokenFromDB to true.'
      });
    }
    
    // Validate region
    const validRegions = ['NA', 'EU', 'FE'];
    if (!validRegions.includes(region)) {
      return res.status(400).json({
        success: false,
        error: `Invalid region: ${region}. Valid values are: ${validRegions.join(', ')}`
      });
    }
    
    console.log('🧪 Testing Search Keywords API:', {
      userId: testUserId,
      country: testCountry,
      region: region,
      profileId: adsProfileId,
      hasAccessToken: !!adsAccessToken,
      hasRefreshToken: !!adsRefreshToken,
      tokenSource: fetchTokenFromDB ? 'database' : 'request body',
      usingTokenManager: !!adsRefreshToken
    });
    
    // Use TokenManager if we have refresh tokens, otherwise call directly
    let result;
    if (adsRefreshToken && testUserId) {
      // Use TokenManager for automatic token refresh and retry
      console.log('🔄 Using TokenManager for automatic token refresh...');
      result = await tokenManager.wrapAdsFunction(
        getSearchKeywords,
        testUserId,
        spRefreshToken,
        adsRefreshToken
      )(adsAccessToken, adsProfileId, testUserId, testCountry, region);
            } else {
      // Call directly without TokenManager (no automatic refresh)
      console.log('⚠️ Calling without TokenManager - no refresh token available');
      result = await getSearchKeywords(
        adsAccessToken,
        adsProfileId,
        testUserId,
        testCountry,
                region
            );
    }
    
    return res.status(200).json({
      success: true,
      message: 'Search Keywords data retrieved successfully',
      data: result,
      metadata: {
        userId: testUserId,
        country: testCountry,
        region: region,
        profileId: adsProfileId,
        timestamp: new Date().toISOString()
      }
    });
    
        } catch (error) {
    console.error('❌ Error in testSearchKeywords:', error);
    
    // Handle specific error types
    if (error.response) {
      const status = error.response.status || 500;
      const errorData = error.response.data || {};
      
      return res.status(status).json({
        success: false,
        error: 'Amazon Ads API Error',
        message: error.message,
        details: errorData,
        statusCode: status
      });
    }
    
    // Handle token-related errors
    if (error.message && (
      error.message.includes('token') || 
      error.message.includes('unauthorized') ||
      error.message.includes('401')
    )) {
      return res.status(401).json({
        success: false,
        error: 'Authentication Error',
        message: error.message,
        suggestion: 'Please check if your access token is valid or try setting fetchTokenFromDB to true to refresh the token.'
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message || 'An unexpected error occurred while fetching search keywords'
    });
  }
};

// Test function for FBA Inventory Planning Data
const testFbaInventoryPlanningData = async (req, res) => {
  try {
    const { accessToken, userId, country, region, marketplaceIds, fetchTokenFromDB } = req.body;
    
    // Import required modules
    const Seller = require('../../models/user-auth/sellerCentralModel.js');
    const tokenManager = require('../../utils/TokenManager.js');
    const { URIs, marketplaceConfig } = require('../../controllers/config/config.js');
    const { generateAccessToken } = require('../../Services/Sp_API/GenerateTokens.js');
    const GET_FBA_INVENTORY_PLANNING_DATA = require('../../Services/Sp_API/GET_FBA_INVENTORY_PLANNING_DATA.js');
    const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');
    const { spapiRegions } = require('../../controllers/config/config.js');
    
    let spApiToken = accessToken;
    let testUserId = userId;
    let testCountry = country || "US";
    let testRegion = region || "NA";
    let spRefreshToken = null;
    let adsRefreshToken = null;
    
    // Convert userId to ObjectId if needed
    const mongoose = require('mongoose');
    let userIdQuery = userId;
    if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
      userIdQuery = new mongoose.Types.ObjectId(userId);
    }
    
    // If fetchTokenFromDB is true, get tokens from database
    if (fetchTokenFromDB && userId) {
      const sellerCentral = await Seller.findOne({ User: userIdQuery }).sort({ createdAt: -1 });
      
      if (!sellerCentral) {
        return res.status(404).json({
          success: false,
          error: 'Seller account not found for the provided userId',
          suggestion: 'Please ensure the user has connected their Amazon Seller Central account first.'
        });
      }
      
      // Find the specific sellerAccount by country and region
      const sellerAccount = sellerCentral.sellerAccount?.find(
        account => account.country === (country || "US") && account.region === (region || "NA")
      );
      
      if (!sellerAccount) {
        return res.status(404).json({
            success: false,
          error: `Seller account not found for country: ${country || "US"} and region: ${region || "NA"}`,
          availableAccounts: sellerCentral.sellerAccount?.map(acc => ({
            country: acc.country,
            region: acc.region,
            hasSpApiToken: !!acc.spiRefreshToken
          })) || [],
          suggestion: 'Please ensure the user has connected their Amazon Seller Central account for this country and region.'
        });
      }
      
      if (!sellerAccount.spiRefreshToken) {
            return res.status(400).json({
                success: false,
          error: 'SP-API refresh token not found for this user. Please connect Amazon Seller Central account first.',
          country: sellerAccount.country,
          region: sellerAccount.region
        });
      }
      
      // Store refresh tokens for TokenManager
      spRefreshToken = sellerAccount.spiRefreshToken;
      adsRefreshToken = sellerAccount.adsRefreshToken || null;
      
      // Get initial access token (TokenManager will refresh if needed)
      try {
        spApiToken = await generateAccessToken(userId, spRefreshToken);
        if (!spApiToken) {
          return res.status(500).json({
            success: false,
            error: 'Failed to generate SP-API access token. The refresh token may be invalid or expired. Please reconnect your Amazon Seller Central account.'
          });
        }
      } catch (tokenError) {
        return res.status(500).json({
          success: false,
          error: 'Failed to generate SP-API access token',
          message: tokenError.message,
          suggestion: 'The refresh token may be invalid or expired. Please reconnect your Amazon Seller Central account.'
        });
      }
      
      testUserId = userId;
      testCountry = sellerAccount.country || country || "US";
      testRegion = sellerAccount.region || region || "NA";
    } else if (userId) {
      // Even if not fetching from DB, we need refresh tokens for TokenManager
      const sellerCentral = await Seller.findOne({ User: userIdQuery }).sort({ createdAt: -1 });
      if (sellerCentral) {
        const sellerAccount = sellerCentral.sellerAccount?.find(
          account => account.country === (country || "US") && account.region === (region || "NA")
        );
        if (sellerAccount) {
          spRefreshToken = sellerAccount.spiRefreshToken;
          adsRefreshToken = sellerAccount.adsRefreshToken || null;
        }
      }
    }
    
    // Validate required parameters
    if (!spApiToken) {
      return res.status(400).json({
        success: false,
        error: 'accessToken is required. Either provide it in the request body or set fetchTokenFromDB to true.'
      });
    }
    
    if (!testUserId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required. Either provide it in the request body or set fetchTokenFromDB to true.'
      });
    }
    
    if (!testCountry) {
      return res.status(400).json({
        success: false,
        error: 'country is required'
      });
    }
    
    if (!testRegion) {
      return res.status(400).json({
        success: false,
        error: 'region is required. Valid values: NA, EU, FE'
      });
    }
    
    // Validate region
    const validRegions = ['NA', 'EU', 'FE'];
    if (!validRegions.includes(testRegion)) {
      return res.status(400).json({
        success: false,
        error: `Invalid region: ${testRegion}. Valid values are: ${validRegions.join(', ')}`
      });
    }
    
    // Get marketplace IDs
    let marketplaceIdsArray = marketplaceIds;
    if (!marketplaceIdsArray || !Array.isArray(marketplaceIdsArray) || marketplaceIdsArray.length === 0) {
      // If not provided, try to get from config
      const marketplaceId = marketplaceConfig[testCountry] || marketplaceConfig[testCountry.toUpperCase()];
      if (marketplaceId) {
        marketplaceIdsArray = [marketplaceId];
        } else {
        return res.status(400).json({
          success: false,
          error: 'marketplaceIds is required and must be a non-empty array, or country must be valid'
        });
      }
    }
    
    // Get base URI
    let baseURI = URIs[testRegion];
    if (!baseURI) {
      const defaultURIs = {
        NA: 'sellingpartnerapi-na.amazon.com',
        EU: 'sellingpartnerapi-eu.amazon.com',
        FE: 'sellingpartnerapi-fe.amazon.com'
      };
      baseURI = defaultURIs[testRegion];
    }
    
    if (!baseURI) {
      return res.status(400).json({
        success: false,
        error: `Unsupported region: ${testRegion}`
      });
    }
    
    console.log('🧪 Testing FBA Inventory Planning Data API:', {
      userId: testUserId,
      country: testCountry,
      region: testRegion,
      marketplaceIds: marketplaceIdsArray,
      hasAccessToken: !!spApiToken,
      hasRefreshToken: !!spRefreshToken,
      tokenSource: fetchTokenFromDB ? 'database' : 'request body',
      usingTokenManager: !!spRefreshToken
    });
    
    // Use TokenManager if we have refresh tokens, otherwise call directly
    let result;
    if (spRefreshToken && testUserId) {
      // Use TokenManager for automatic token refresh and retry
      console.log('🔄 Using TokenManager for automatic token refresh...');
      result = await tokenManager.wrapSpApiFunction(
        GET_FBA_INVENTORY_PLANNING_DATA,
        testUserId,
        spRefreshToken,
        adsRefreshToken
      )(spApiToken, marketplaceIdsArray, baseURI, testUserId, testCountry, testRegion);
    } else {
      // Call directly without TokenManager (no automatic refresh)
      console.log('⚠️ Calling without TokenManager - no refresh token available');
      result = await GET_FBA_INVENTORY_PLANNING_DATA(
        spApiToken,
        marketplaceIdsArray,
        baseURI,
        testUserId,
        testCountry,
        testRegion
      );
        }

        return res.status(200).json({
            success: true,
      message: 'FBA Inventory Planning Data fetched successfully',
      data: result,
      metadata: {
        userId: testUserId,
        country: testCountry,
        region: testRegion,
        marketplaceIds: marketplaceIdsArray,
        usedTokenManager: !!spRefreshToken,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Error in testFbaInventoryPlanningData:', error);
    
    // Handle specific error types
    if (error.response) {
      const status = error.response.status || 500;
      const errorData = error.response.data || {};
      
      return res.status(status).json({
        success: false,
        error: 'Amazon SP-API Error',
        message: error.message,
        details: errorData,
        statusCode: status
      });
    }
    
    // Handle token-related errors
    if (error.message && (
      error.message.includes('token') || 
      error.message.includes('unauthorized') ||
      error.message.includes('401')
    )) {
      return res.status(401).json({
        success: false,
        error: 'Authentication Error',
        message: error.message,
        suggestion: 'Please check if your access token is valid. If using fetchTokenFromDB, the refresh token may be invalid. Please reconnect your Amazon Seller Central account.'
      });
    }
    
        return res.status(500).json({
            success: false,
      error: 'Internal Server Error',
      message: error.message || 'An unexpected error occurred while fetching FBA Inventory Planning Data'
        });
    }
};

// Test function for Keyword Recommendations
const testKeywordRecommendations = async (req, res) => {
  try {
    const { accessToken, profileId, userId, country, region, asins, fetchTokenFromDB } = req.body;
    
    // Import required modules
    const Seller = require('../../models/user-auth/sellerCentralModel.js');
    const tokenManager = require('../../utils/TokenManager.js');
    const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
    const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
    
    let adsAccessToken = accessToken;
    let adsProfileId = profileId;
    let testUserId = userId;
    let testCountry = country || "US";
    let testRegion = region;
    let testAsins = asins;
    let spRefreshToken = null;
    let adsRefreshToken = null;
    
    // If fetchTokenFromDB is true, get tokens from database
    if (fetchTokenFromDB && userId) {
      // Convert userId to ObjectId if it's a string
      const mongoose = require('mongoose');
      let userIdQuery = userId;
      
      // Try to convert to ObjectId if it's a valid ObjectId string
      if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
        userIdQuery = new mongoose.Types.ObjectId(userId);
      }
      
      console.log('🔍 Searching for seller account:', {
        userId: userId,
        userIdType: typeof userId,
        userIdQuery: userIdQuery
      });
      
      // Find the Seller document by User field
      const sellerCentral = await Seller.findOne({ User: userIdQuery }).sort({ createdAt: -1 });
      
      if (!sellerCentral) {
        return res.status(404).json({
          success: false,
          error: 'Seller account not found for the provided userId',
          suggestion: 'Please ensure the userId is correct and the seller account exists in the database.'
        });
      }
      
      if (!sellerCentral.adsRefreshToken) {
        return res.status(400).json({
          success: false,
          error: 'Ads refresh token not found for this user',
          suggestion: 'Please connect Amazon Ads account first.'
        });
      }
      
      // Get tokens from seller account
      adsRefreshToken = sellerCentral.adsRefreshToken;
      spRefreshToken = sellerCentral.refreshToken;
      testUserId = sellerCentral.User?.toString() || userId;
      
      // Generate access token from refresh token
      adsAccessToken = await generateAdsAccessToken(adsRefreshToken);
      
      if (!adsAccessToken) {
        return res.status(500).json({
          success: false,
          error: 'Failed to generate Ads access token',
          suggestion: 'Please check if the refresh token is valid. You may need to reconnect your Amazon Ads account.'
        });
      }
      
      // Get profile ID if not provided
      if (!adsProfileId && testRegion) {
        const profiles = await getProfileById(adsAccessToken, testRegion, testCountry, testUserId);
        if (profiles && Array.isArray(profiles) && profiles.length > 0) {
          adsProfileId = profiles[0].profileId;
          console.log('✅ Auto-selected profile ID:', adsProfileId);
        }
      }
      
      console.log('✅ Tokens fetched from database:', {
        hasAccessToken: !!adsAccessToken,
        hasProfileId: !!adsProfileId,
        userId: testUserId
      });
    }
    
    // Validate required parameters
    if (!adsAccessToken) {
      return res.status(400).json({
        success: false,
        error: 'accessToken is required. Either provide it in the request body or set fetchTokenFromDB to true.'
      });
    }
    
    if (!adsProfileId) {
      return res.status(400).json({
        success: false,
        error: 'profileId is required. Either provide it in the request body or set fetchTokenFromDB to true with a valid region.'
      });
    }
    
    if (!testRegion) {
      return res.status(400).json({
        success: false,
        error: 'region is required. Valid values: NA, EU, FE'
      });
    }
    
    if (!testUserId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required. Either provide it in the request body or set fetchTokenFromDB to true.'
      });
    }
    
    if (!testAsins || !Array.isArray(testAsins) || testAsins.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'asins is required and must be a non-empty array of ASIN strings',
        example: ['B0993VDPGD', 'B0DG59M2TM', 'B0D2S53GFV']
      });
    }
    
    // Validate region
    const validRegions = ['NA', 'EU', 'FE'];
    if (!validRegions.includes(testRegion)) {
      return res.status(400).json({
        success: false,
        error: `Invalid region: ${testRegion}. Valid values are: ${validRegions.join(', ')}`
      });
    }
    
    // Validate ASINs format (basic validation - ASINs are typically 10 characters)
    const invalidAsins = testAsins.filter(asin => !asin || typeof asin !== 'string' || asin.trim().length === 0);
    if (invalidAsins.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ASINs found. All ASINs must be non-empty strings.',
        invalidAsins: invalidAsins
      });
    }
    
    console.log('🧪 Testing Keyword Recommendations API:', {
      userId: testUserId,
      country: testCountry,
      region: testRegion,
      profileId: adsProfileId,
      asinCount: testAsins.length,
      hasAccessToken: !!adsAccessToken,
      hasRefreshToken: !!adsRefreshToken,
      tokenSource: fetchTokenFromDB ? 'database' : 'request body',
      usingTokenManager: !!adsRefreshToken
    });
    
    // Use TokenManager if we have refresh tokens, otherwise call directly
    let result;
    if (adsRefreshToken && testUserId) {
      // Use TokenManager for automatic token refresh and retry
      console.log('🔄 Using TokenManager for automatic token refresh...');
      result = await tokenManager.wrapAdsFunction(
        getKeywordRecommendations,
        testUserId,
        spRefreshToken,
        adsRefreshToken
      )(adsAccessToken, adsProfileId, testUserId, testCountry, testRegion, testAsins);
    } else {
      // Call directly without TokenManager (no automatic refresh)
      console.log('⚠️ Calling without TokenManager - no refresh token available');
      result = await getKeywordRecommendations(
        adsAccessToken,
        adsProfileId,
        testUserId,
        testCountry,
        testRegion,
        testAsins
      );
    }
    
    return res.status(200).json({
      success: true,
      message: 'Keyword recommendations fetched successfully',
      data: result,
      metadata: {
        userId: testUserId,
        country: testCountry,
        region: testRegion,
        asinCount: testAsins.length,
        keywordCount: result?.keywordRecommendationData?.keywordTargetList?.length || 0
      }
    });
    
  } catch (error) {
    console.error('❌ Error in testKeywordRecommendations:', error);
    
    // Handle specific error cases
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;
      
      if (status === 401 || status === 403) {
        return res.status(status).json({
          success: false,
          error: 'Authentication Error',
          message: error.message,
          details: errorData,
          suggestion: 'Please check if your access token is valid. If using fetchTokenFromDB, the refresh token may be invalid. Please reconnect your Amazon Ads account.'
        });
      }
      
      if (status === 429) {
        return res.status(status).json({
          success: false,
          error: 'Rate Limit Exceeded',
          message: 'Too many requests. Please wait before making another request.',
          suggestion: 'The API has rate limits. Please wait a moment and try again.'
        });
      }
      
      return res.status(status).json({
        success: false,
        error: 'Amazon Ads API Error',
        status: status,
        message: error.message,
        details: errorData
      });
    }
    
    // Handle validation errors
    if (error.message && (
      error.message.includes('required') || 
      error.message.includes('Invalid') ||
      error.message.includes('not found')
    )) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: error.message
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message || 'An unexpected error occurred while fetching keyword recommendations'
    });
  }
};

/**
 * NEW: Test Keyword Recommendations with ASINs fetched from Seller Model
 * Accepts userId, country, and region - fetches ASINs automatically from database
 * Uses the new ASIN-wise approach (one ASIN at a time, batches of 5)
 */
const testKeywordRecommendationsFromDB = async (req, res) => {
  try {
    const { userId, country, region } = req.body;
    
    // Import required modules
    const mongoose = require('mongoose');
    const Seller = require('../../models/user-auth/sellerCentralModel.js');
    const tokenManager = require('../../utils/TokenManager.js');
    const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
    const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
    const { getAllStoredKeywordsForUser } = require('../../Services/AmazonAds/KeyWordsRecommendations.js');
    
    // Validate required parameters
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }
    
    if (!country) {
      return res.status(400).json({
        success: false,
        error: 'country is required (e.g., US, UK, DE)'
      });
    }
    
    if (!region) {
      return res.status(400).json({
        success: false,
        error: 'region is required (NA, EU, or FE)'
      });
    }
    
    // Validate region
    const validRegions = ['NA', 'EU', 'FE'];
    if (!validRegions.includes(region)) {
      return res.status(400).json({
        success: false,
        error: `Invalid region: ${region}. Valid values are: ${validRegions.join(', ')}`
      });
    }
    
    console.log('🔍 Fetching seller account and ASINs from database...');
    
    // Convert userId to ObjectId if needed
    let userIdQuery = userId;
    if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
      userIdQuery = new mongoose.Types.ObjectId(userId);
    }
    
    // Find the Seller document
    const sellerCentral = await Seller.findOne({ User: userIdQuery });
    
    if (!sellerCentral) {
      return res.status(404).json({
        success: false,
        error: 'Seller account not found for the provided userId'
      });
    }
    
    // Find the specific seller account for this country/region
    const sellerAccount = sellerCentral.sellerAccount?.find(
      acc => acc.country === country && acc.region === region
    );
    
    if (!sellerAccount) {
      return res.status(404).json({
        success: false,
        error: `No seller account found for country: ${country}, region: ${region}`,
        availableAccounts: sellerCentral.sellerAccount?.map(acc => ({
          country: acc.country,
          region: acc.region
        })) || []
      });
    }
    
    // Check for required tokens
    if (!sellerAccount.adsRefreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Ads refresh token not found for this seller account',
        suggestion: 'Please connect Amazon Ads account first.'
      });
    }
    
    // Extract ASINs from the seller account products
    const products = sellerAccount.products || [];
    const asins = products
      .map(p => p.asin)
      .filter(asin => asin && typeof asin === 'string' && asin.trim().length > 0);
    
    if (asins.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No ASINs found in the seller account products',
        suggestion: 'Please ensure the seller account has products with ASINs'
      });
    }
    
    console.log(`✅ Found ${asins.length} ASINs for processing`);
    
    // Generate access token
    const adsAccessToken = await generateAdsAccessToken(sellerAccount.adsRefreshToken);
    
    if (!adsAccessToken) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate Ads access token',
        suggestion: 'Please check if the refresh token is valid.'
      });
    }
    
    // Get profile ID
    let profileId = sellerAccount.ProfileId;
    if (!profileId) {
      const profiles = await getProfileById(adsAccessToken, region, country, userId);
      if (profiles && Array.isArray(profiles) && profiles.length > 0) {
        profileId = profiles[0].profileId;
        console.log('✅ Auto-selected profile ID:', profileId);
      } else {
        return res.status(400).json({
          success: false,
          error: 'Could not find profile ID for this account'
        });
      }
    }
    
    console.log('🧪 Starting Keyword Recommendations API (ASIN-wise):', {
      userId,
      country,
      region,
      profileId,
      asinCount: asins.length,
      sampleAsins: asins.slice(0, 5)
    });
    
    // Call the keyword recommendations function using TokenManager
    const result = await tokenManager.wrapAdsFunction(
      getKeywordRecommendations,
      userId,
      sellerAccount.spiRefreshToken,
      sellerAccount.adsRefreshToken
    )(adsAccessToken, profileId, userId, country, region, asins);
    
    // Get all stored keywords for this user after processing
    const storedKeywords = await getAllStoredKeywordsForUser(userId, country, region);
    
    return res.status(200).json({
      success: true,
      message: 'Keyword recommendations processed successfully (ASIN-wise)',
      summary: {
        totalAsins: result.totalAsins,
        successfulAsins: result.successfulAsins,
        failedAsins: result.failedAsins,
        totalKeywordsFound: result.totalKeywordsFound
      },
      results: result.results,
      storedData: {
        totalRecords: storedKeywords.length,
        asins: storedKeywords.map(sk => ({
          asin: sk.asin,
          keywordCount: sk.totalKeywords,
          fetchedAt: sk.fetchedAt
        }))
      },
      metadata: {
        userId,
        country,
        region,
        processedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Error in testKeywordRecommendationsFromDB:', error);
    
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;
      
      if (status === 401 || status === 403) {
        return res.status(status).json({
          success: false,
          error: 'Authentication Error',
          message: error.message,
          details: errorData,
          suggestion: 'Please reconnect your Amazon Ads account.'
        });
      }
      
      return res.status(status).json({
        success: false,
        error: 'Amazon Ads API Error',
        status: status,
        message: error.message,
        details: errorData
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message || 'An unexpected error occurred'
    });
  }
};

/**
 * Get stored keyword recommendations for a user (from database)
 */
const getStoredKeywordRecommendations = async (req, res) => {
  try {
    const { userId, country, region, asin } = req.query;
    
    const { AsinKeywordRecommendations } = require('../../models/amazon-ads/KeywordRecommendationsModel.js');
    
    if (!userId || !country || !region) {
      return res.status(400).json({
        success: false,
        error: 'userId, country, and region are required query parameters'
      });
    }
    
    let result;
    
    if (asin) {
      // Get keywords for specific ASIN
      result = await AsinKeywordRecommendations.findByAsin(userId, country, region, asin);
      
      if (!result) {
        return res.status(404).json({
          success: false,
          error: `No keyword recommendations found for ASIN: ${asin}`
        });
      }
      
      return res.status(200).json({
        success: true,
        data: result,
        metadata: {
          asin: result.asin,
          keywordCount: result.totalKeywords,
          fetchedAt: result.fetchedAt
        }
      });
      
    } else {
      // Get all keywords for user
      result = await AsinKeywordRecommendations.findAllForUser(userId, country, region);
      
      return res.status(200).json({
        success: true,
        totalAsins: result.length,
        totalKeywords: result.reduce((sum, item) => sum + item.totalKeywords, 0),
        data: result.map(item => ({
          asin: item.asin,
          keywordCount: item.totalKeywords,
          keywords: item.keywordTargetList,
          fetchedAt: item.fetchedAt
        }))
      });
    }
    
  } catch (error) {
    console.error('❌ Error in getStoredKeywordRecommendations:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message
    });
  }
};

/**
 * Test PPC Metrics - Fetches aggregated PPC data including total sales, spend, ACOS, and date-wise metrics
 * Accepts userId, country, region - fetches tokens and profile from database
 * Aggregates data from Sponsored Products, Sponsored Brands, and Sponsored Display campaigns
 */
const testPPCMetrics = async (req, res) => {
  try {
    const { userId, country, region, startDate, endDate, fetchTokenFromDB = true } = req.body;
    
    // Import required modules
    const mongoose = require('mongoose');
    const Seller = require('../../models/user-auth/sellerCentralModel.js');
    const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
    const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
    const { getPPCMetrics } = require('../../Services/AmazonAds/GetPPCMetrics.js');
    
    // Validate required parameters
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }
    
    if (!country) {
      return res.status(400).json({
        success: false,
        error: 'country is required (e.g., US, UK, DE, CA)'
      });
    }
    
    if (!region) {
      return res.status(400).json({
        success: false,
        error: 'region is required (NA, EU, or FE)'
      });
    }
    
    // Validate region
    const validRegions = ['NA', 'EU', 'FE'];
    if (!validRegions.includes(region)) {
      return res.status(400).json({
        success: false,
        error: `Invalid region: ${region}. Valid values are: ${validRegions.join(', ')}`
      });
    }
    
    // Validate date format if provided
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (startDate && !dateRegex.test(startDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid startDate format. Use YYYY-MM-DD'
      });
    }
    if (endDate && !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid endDate format. Use YYYY-MM-DD'
      });
    }
    
    console.log('🔍 [testPPCMetrics] Fetching seller account from database...');
    
    // Convert userId to ObjectId if needed
    let userIdQuery = userId;
    if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
      userIdQuery = new mongoose.Types.ObjectId(userId);
    }
    
    // Find the Seller document
    const sellerCentral = await Seller.findOne({ User: userIdQuery });
    
    if (!sellerCentral) {
      return res.status(404).json({
        success: false,
        error: 'Seller account not found for the provided userId',
        suggestion: 'Please ensure the user has connected their Amazon Seller Central account.'
      });
    }
    
    // Find the specific seller account for this country/region
    const sellerAccount = sellerCentral.sellerAccount?.find(
      acc => acc.country === country && acc.region === region
    );
    
    if (!sellerAccount) {
      return res.status(404).json({
        success: false,
        error: `No seller account found for country: ${country}, region: ${region}`,
        availableAccounts: sellerCentral.sellerAccount?.map(acc => ({
          country: acc.country,
          region: acc.region,
          hasAdsToken: !!acc.adsRefreshToken,
          hasProfileId: !!acc.ProfileId
        })) || []
      });
    }
    
    // Check for required tokens
    if (!sellerAccount.adsRefreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Ads refresh token not found for this seller account',
        suggestion: 'Please connect Amazon Ads account first.'
      });
    }
    
    console.log(`✅ [testPPCMetrics] Found seller account for ${country}/${region}`);
    
    // Generate access token from refresh token
    let adsAccessToken;
    try {
      adsAccessToken = await generateAdsAccessToken(sellerAccount.adsRefreshToken);
      if (!adsAccessToken) {
        return res.status(500).json({
          success: false,
          error: 'Failed to generate Ads access token',
          suggestion: 'Please check if the refresh token is valid. You may need to reconnect your Amazon Ads account.'
        });
      }
    } catch (tokenError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate Ads access token',
        message: tokenError.message,
        suggestion: 'The refresh token may be invalid or expired. Please reconnect your Amazon Ads account.'
      });
    }
    
    // Get profile ID
    let profileId = sellerAccount.ProfileId;
    if (!profileId) {
      console.log('🔄 [testPPCMetrics] Profile ID not found in database, fetching from Amazon Ads API...');
      try {
        const profiles = await getProfileById(adsAccessToken, region, country, userId);
        if (profiles && Array.isArray(profiles) && profiles.length > 0) {
          // Find the matching profile for the country
          const countryCodeMap = {
            'US': 'US', 'CA': 'CA', 'MX': 'MX', 'BR': 'BR',
            'UK': 'UK', 'GB': 'UK', 'DE': 'DE', 'FR': 'FR', 'ES': 'ES', 'IT': 'IT', 'NL': 'NL', 'SE': 'SE', 'PL': 'PL', 'BE': 'BE',
            'JP': 'JP', 'AU': 'AU', 'SG': 'SG', 'IN': 'IN', 'AE': 'AE', 'SA': 'SA'
          };
          const targetCountryCode = countryCodeMap[country] || country;
          
          const matchingProfile = profiles.find(p => 
            p.countryCode === targetCountryCode || 
            p.countryCode?.toUpperCase() === country?.toUpperCase()
          ) || profiles[0];
          
          profileId = matchingProfile.profileId?.toString();
          console.log(`✅ [testPPCMetrics] Auto-selected profile ID: ${profileId} for country: ${matchingProfile.countryCode}`);
        } else {
          return res.status(400).json({
            success: false,
            error: 'Could not find any Amazon Ads profiles for this account',
            suggestion: 'Please ensure you have active Amazon Advertising campaigns.'
          });
        }
      } catch (profileError) {
        console.error('⚠️ [testPPCMetrics] Error fetching profile ID:', profileError.message);
        return res.status(400).json({
          success: false,
          error: 'Failed to fetch Amazon Ads profile ID',
          message: profileError.message
        });
      }
    }
    
    console.log('🚀 [testPPCMetrics] Starting PPC metrics fetch:', {
      userId,
      country,
      region,
      profileId,
      hasAccessToken: !!adsAccessToken,
      startDate: startDate || 'auto (30 days ago)',
      endDate: endDate || 'auto (yesterday)'
    });
    
    // Fetch PPC metrics
    const result = await getPPCMetrics(
      adsAccessToken,
      profileId,
      userId,
      country,
      region,
      sellerAccount.adsRefreshToken,
      startDate,
      endDate
    );
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch PPC metrics',
        message: result.message || result.error
      });
    }
    
    // Format the response
    return res.status(200).json({
      success: true,
      message: 'PPC metrics fetched successfully',
      dateRange: result.data.dateRange,
      summary: {
        totalSales: result.data.totalSales,
        totalSpend: result.data.totalSpend,
        overallAcos: result.data.overallAcos,
        overallRoas: result.data.overallRoas,
        totalImpressions: result.data.totalImpressions,
        totalClicks: result.data.totalClicks,
        ctr: result.data.ctr,
        cpc: result.data.cpc
      },
      campaignTypeBreakdown: result.data.campaignTypeBreakdown,
      dateWiseMetrics: result.data.dateWiseMetrics,
      processedCampaignTypes: result.data.processedCampaignTypes,
      metadata: {
        userId,
        country,
        region,
        profileId,
        processedAt: result.metadata.processedAt
      }
    });
    
  } catch (error) {
    console.error('❌ Error in testPPCMetrics:', error);
    
    // Handle specific error cases
    if (error.response) {
      const status = error.response.status || 500;
      const errorData = error.response.data || {};
      
      if (status === 401 || status === 403) {
        return res.status(status).json({
          success: false,
          error: 'Authentication Error',
          message: error.message,
          details: errorData,
          suggestion: 'Please reconnect your Amazon Ads account.'
        });
      }
      
      if (status === 429) {
        return res.status(status).json({
          success: false,
          error: 'Rate Limit Exceeded',
          message: 'Too many requests. Please wait before making another request.',
          suggestion: 'The API has rate limits. Please wait a moment and try again.'
        });
      }
      
      return res.status(status).json({
        success: false,
        error: 'Amazon Ads API Error',
        status: status,
        message: error.message,
        details: errorData
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message || 'An unexpected error occurred while fetching PPC metrics'
    });
  }
};

/**
 * Test endpoint that calls ALL Amazon Ads services in one request.
 * Same order as Integration: PPC Spends, Keyword Performance, PPC Date Wise, PPC Metrics, PPC Units Sold,
 * then Keywords (ads keywords), Campaign Data, Ad Groups, Negative Keywords, Search Keywords, Keyword Recommendations.
 * Body: { userId, country, region }
 */
const testAllAdsServices = async (req, res) => {
  try {
    const { userId, country, region } = req.body;
    if (!userId || !country || !region) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Request body must include userId, country, and region'
      });
    }

    const seller = await Seller.findOne({ User: userId });
    if (!seller) {
      return res.status(404).json({
        success: false,
        error: 'Seller account not found',
        message: `No seller found for userId: ${userId}`
      });
    }

    const sellerAccount = seller.sellerAccount.find(
      acc => acc.country === country && acc.region === region
    );
    if (!sellerAccount) {
      return res.status(404).json({
        success: false,
        error: 'Seller account not found for location',
        message: `No account for country=${country}, region=${region}`
      });
    }

    const AdsRefreshToken = sellerAccount.adsRefreshToken;
    if (!AdsRefreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Ads not connected',
        message: 'Please connect Amazon Ads account first for this location.'
      });
    }

    let adsAccessToken = await generateAdsAccessToken(AdsRefreshToken);
    if (!adsAccessToken) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate Ads access token',
        message: 'Refresh token may be invalid or expired. Please reconnect Amazon Ads account.'
      });
    }

    let profileId = sellerAccount.ProfileId;
    if (!profileId) {
      const profiles = await getProfileById(adsAccessToken, region, country, userId);
      if (profiles && Array.isArray(profiles) && profiles.length > 0) {
        const countryCodeMap = {
          'US': 'US', 'CA': 'CA', 'MX': 'MX', 'UK': 'UK', 'GB': 'UK', 'DE': 'DE', 'FR': 'FR', 'ES': 'ES', 'IT': 'IT', 'JP': 'JP', 'AU': 'AU'
        };
        const targetCode = countryCodeMap[country] || country;
        const match = profiles.find(p => (p.countryCode || '').toUpperCase() === (targetCode || '').toUpperCase()) || profiles[0];
        profileId = match.profileId?.toString();
      }
      if (!profileId) {
        return res.status(400).json({
          success: false,
          error: 'Could not resolve Amazon Ads profile ID',
          message: 'No profile found for this account/country. Ensure you have active Advertising campaigns.'
        });
      }
    }

    const asinArray = Array.isArray(sellerAccount.products)
      ? sellerAccount.products.map(p => p && p.asin).filter(Boolean)
      : [];
    const RefreshToken = sellerAccount.spiRefreshToken || null;

    const processResult = (result, serviceName) => {
      if (result.status === 'fulfilled') {
        const value = result.value;
        const isFailure = value === false || (value && typeof value === 'object' && value.success === false);
        if (isFailure) {
          return { success: false, error: value?.message || value?.error || 'Function returned failure', data: null };
        }
        return { success: true, data: value, error: null };
      }
      return { success: false, error: result.reason?.message || 'Unknown error', data: null };
    };

    const apiResults = {};

    // First batch: PPC Spends by SKU, Keyword Performance, PPC Spends Date Wise, PPC Metrics, PPC Units Sold
    const batch1 = await Promise.allSettled([
      tokenManager.wrapAdsFunction(getPPCSpendsBySKU, userId, RefreshToken, AdsRefreshToken)(adsAccessToken, profileId, userId, country, region, AdsRefreshToken),
      tokenManager.wrapAdsFunction(getKeywordPerformanceReport, userId, RefreshToken, AdsRefreshToken)(adsAccessToken, profileId, userId, country, region, AdsRefreshToken),
      tokenManager.wrapAdsFunction(getPPCSpendsDateWise, userId, RefreshToken, AdsRefreshToken)(adsAccessToken, profileId, userId, country, region, AdsRefreshToken),
      getPPCMetrics(adsAccessToken, profileId, userId, country, region, AdsRefreshToken, null, null, true),
      getPPCUnitsSold(adsAccessToken, profileId, userId, country, region, AdsRefreshToken, null, null, true)
    ]);
    apiResults.ppcSpendsBySKU = processResult(batch1[0], 'PPC Spends by SKU');
    apiResults.adsKeywordsPerformance = processResult(batch1[1], 'Ads Keywords Performance');
    apiResults.ppcSpendsDateWise = processResult(batch1[2], 'PPC Spends Date Wise');
    apiResults.ppcMetrics = processResult(batch1[3], 'PPC Metrics');
    apiResults.ppcUnitsSold = processResult(batch1[4], 'PPC Units Sold');

    // Second batch: getKeywords (Ads Keywords), getCampaign
    const batch2 = await Promise.allSettled([
      tokenManager.wrapAdsFunction(getKeywords, userId, RefreshToken, AdsRefreshToken)(adsAccessToken, profileId, userId, country, region),
      tokenManager.wrapAdsFunction(getCampaign, userId, RefreshToken, AdsRefreshToken)(adsAccessToken, profileId, region, userId, country)
    ]);
    apiResults.adsKeywords = processResult(batch2[0], 'Ads Keywords');
    apiResults.campaignData = processResult(batch2[1], 'Campaign Data');

    // Campaign and ad group IDs for negative keywords
    const { campaignIdArray, adGroupIdArray } = await Integration.getCampaignAndAdGroupIds(
      apiResults.ppcSpendsBySKU,
      userId,
      region,
      country
    );

    let campaignIds = [];
    if (apiResults.campaignData.success && apiResults.campaignData.data?.campaignData) {
      campaignIds = (apiResults.campaignData.data.campaignData || [])
        .filter(item => item && item.campaignId)
        .map(item => item.campaignId);
    }

    // Third batch: Ad Groups
    const batch3 = await Promise.allSettled([
      tokenManager.wrapAdsFunction(getAdGroups, userId, RefreshToken, AdsRefreshToken)(adsAccessToken, profileId, region, userId, country, campaignIds)
    ]);
    apiResults.adGroupsData = processResult(batch3[0], 'Ad Groups Data');

    // Fourth batch: Negative Keywords, Search Keywords, Keyword Recommendations
    const batch4Promises = [
      tokenManager.wrapAdsFunction(getNegativeKeywords, userId, RefreshToken, AdsRefreshToken)(adsAccessToken, profileId, userId, country, region, campaignIdArray || [], adGroupIdArray || []),
      tokenManager.wrapAdsFunction(getSearchKeywords, userId, RefreshToken, AdsRefreshToken)(adsAccessToken, profileId, userId, country, region, AdsRefreshToken)
    ];
    if (asinArray.length > 0) {
      batch4Promises.push(
        tokenManager.wrapAdsFunction(getKeywordRecommendations, userId, RefreshToken, AdsRefreshToken)(adsAccessToken, profileId, userId, country, region, asinArray)
      );
    }
    const batch4 = await Promise.allSettled(batch4Promises);
    apiResults.negativeKeywords = processResult(batch4[0], 'Negative Keywords');
    apiResults.searchKeywords = processResult(batch4[1], 'Search Keywords');
    apiResults.keywordRecommendations = asinArray.length > 0
      ? processResult(batch4[2], 'Keyword Recommendations')
      : { success: false, data: null, error: 'No ASINs available' };

    const summary = {};
    Object.keys(apiResults).forEach(key => {
      summary[key] = apiResults[key].success ? 'ok' : (apiResults[key].error || 'failed');
    });

    return res.status(200).json({
      success: true,
      message: 'All Ads services executed',
      summary,
      results: apiResults,
      metadata: { userId, country, region, profileId, asinCount: asinArray.length }
    });
  } catch (error) {
    console.error('❌ Error in testAllAdsServices:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message || 'An unexpected error occurred while calling all Ads services'
    });
  }
};

module.exports = { testReport, getTotalSales, 
   getReviewData, testAmazonAds,
   testGetCampaigns,testGetAdGroups,
   testGetKeywords,testGetPPCSpendsBySKU,testGetBrand,testSendEmailOnRegistered,testLedgerSummaryReport,testGetProductWiseFBAData,testGetWastedSpendKeywords,testSearchKeywords,testFbaInventoryPlanningData,testKeywordRecommendations,
   testKeywordRecommendationsFromDB,
   getStoredKeywordRecommendations,
   testPPCMetrics,
   testNumberOfProductReviews,
   getLastAdsKeywordsPerformanceDocument,
   testAllAdsServices,
   }