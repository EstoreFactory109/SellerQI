const getReport = require('../Services/Sp_API/GET_MERCHANT_LISTINGS_ALL_DATA.js');
const TotalSales = require('../Services/Sp_API/WeeklySales.js');
const getTemporaryCredentials = require('../utils/GenerateTemporaryCredentials.js');
const getshipment = require('../Services/Sp_API/shipment.js');
const puppeteer = require("puppeteer");
const { generateAccessToken } = require('../Services/AmazonAds/GenerateToken.js');
const { getProfileById } = require('../Services/AmazonAds/GenerateProfileId.js');
const { getKeywordPerformanceReport } = require('../Services/AmazonAds/GetWastedSpendKeywords.js');
const {getCampaign} = require('../Services/AmazonAds/GetCampaigns.js');

//const {getPPCSpendsDateWise} = require('../Services/AmazonAds/GetDateWiseSpendKeywords.js');
const {getNegativeKeywords} = require('../Services/AmazonAds/NegetiveKeywords.js');
const {getSearchKeywords} = require('../Services/AmazonAds/GetSearchKeywords.js');
const GET_FBA_INVENTORY_PLANNING_DATA = require('../Services/Sp_API/GET_FBA_INVENTORY_PLANNING_DATA.js');
const {listFinancialEventsMethod} = require('../Services/Test/TestFinance.js');
const {getBrand} = require('../Services/Sp_API/GetBrand.js');
const {getAdGroups} = require('../Services/AmazonAds/AdGroups.js');
const { sendRegisteredEmail } = require('../Services/Email/SendEmailOnRegistered.js');
const getKeywordData = require('../Services/SellerApp/integrate.js');
const getLedgerSummaryReport = require('../Services/Sp_API/GET_LEDGER_SUMMARY_VIEW_DATA.js');
const getProductWiseFBAData = require('../Services/Sp_API/GetProductWiseFBAData.js');
const { calculateBackendLostInventory, getBackendLostInventory } = require('../Services/Calculations/BackendLostInventory.js');

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

const testPPCSpendsSalesUnitsSold = async (req, res) => {
    const { accessToken } = req.body;
    const result = await getPPCSpendsDateWise(accessToken, "676804983458868", "68ae594913b351b03f8ae923", "US", "NA");
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
        const Seller = require('../models/sellerCentralModel.js');
        const { generateAdsAccessToken } = require('../Services/AmazonAds/GenerateToken.js');
        const { getProfileById } = require('../Services/AmazonAds/GenerateProfileId.js');
        
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
      const { accessToken, profileId, userId, country, region } = req.body;

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
        hasAccessToken: !!accessToken
      });

      const result = await getKeywordPerformanceReport(
        accessToken,
        profileId,
        userId,
        country,
        region
      );

      return res.status(200).json({
        success: true,
        message: 'Keyword performance report generated successfully',
        data: result
      });

    } catch (error) {
      console.error('Error in testGetWastedSpendKeywords:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate keyword performance report',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  const testListFinancialEvents = async (req, res) => {
   
    const result = await listFinancialEventsMethod();
    return res.status(200).json({
        data: result
    })
  }

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

  const testKeywordDataIntegration = async (req, res) => {
    try {
      const { asinArray, country, region } = req.body;

      // Validate required parameters
      if (!asinArray || !Array.isArray(asinArray) || asinArray.length === 0) {
        return res.status(400).json({
          error: "asinArray is required and must be a non-empty array"
        });
      }

      if (!country) {
        return res.status(400).json({
          error: "country is required"
        });
      }

      if (!region) {
        return res.status(400).json({
          error: "region is required"
        });
      }

      // Check if SellerApp credentials are configured
      if (!process.env.SELLERAPPCLIENTID || !process.env.SELLERAPPTOKEN) {
        return res.status(500).json({
          error: "SellerApp API credentials not configured",
          message: "Please set SELLERAPPCLIENTID and SELLERAPPTOKEN environment variables",
          details: {
            SELLERAPPCLIENTID: process.env.SELLERAPPCLIENTID ? "Set" : "Missing",
            SELLERAPPTOKEN: process.env.SELLERAPPTOKEN ? "Set" : "Missing"
          }
        });
      }

      console.log(`Testing keyword data integration for ASINs: ${asinArray.join(', ')}, Country: ${country}, Region: ${region}`);
      
      const result = await getKeywordData(asinArray, country, region);
      
      return res.status(200).json({
        message: "Keyword data integration test completed successfully",
        data: result,
        summary: {
          totalKeywords: result.length,
          uniqueAsins: [...new Set(result.map(item => item.asin))].length,
          countries: [...new Set(result.map(item => item.country))],
          regions: [...new Set(result.map(item => item.region))]
        }
      });
    } catch (error) {
      console.error("Keyword data integration test error:", error);
      
      // Handle specific API authentication errors
      if (error.response && error.response.status === 401) {
        return res.status(401).json({
          error: "SellerApp API Authentication Failed",
          message: "Invalid or expired SellerApp API credentials",
          details: error.response.data || "Please check your SELLERAPPCLIENTID and SELLERAPPTOKEN",
          solution: "Verify your SellerApp API credentials are correct and active"
        });
      }
      
      // Handle other API errors
      if (error.response) {
        return res.status(error.response.status).json({
          error: "SellerApp API Error",
          message: error.response.data?.error || error.message,
          status: error.response.status,
          statusText: error.response.statusText
        });
      }
      
      return res.status(500).json({
        error: "Internal server error",
        message: error.message
      });
    }
  }

  const testNumberOfProductReviews = async (req, res) => {
    const { asin, country, accessToken } = req.body;
    const result = await getNumberOfProductReviews(asin, country, accessToken);
    return res.status(200).json({
        data: result
    })
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
            report = await getLedgerSummaryReport(accessToken, marketplaceIdsArray, baseURI, userId, country, region, dataStartTime, dataEndTime);
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
            productsWithReimbursementPerUnit: fbaDataArray.filter(item => item.reimbursementPerUnit && item.reimbursementPerUnit > 0).length,
            totalReimbursementPerUnit: fbaDataArray.reduce((sum, item) => sum + (parseFloat(item.reimbursementPerUnit) || 0), 0),
            productsWithSalesPrice: fbaDataArray.filter(item => item.salesPrice && parseFloat(item.salesPrice) > 0).length,
            productsWithFees: fbaDataArray.filter(item => item.totalAmzFee && parseFloat(item.totalAmzFee) > 0).length
        };

        return res.status(200).json({
            success: true,
            message: result.message || "Product wise FBA data fetched and saved successfully",
            data: result.data,
            summary: summary,
            sampleData: fbaDataArray.slice(0, 5) // Return first 5 items as sample
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

const testCalculateBackendLostInventory = async (req, res) => {
    try {
        const { userId, country, region } = req.body;

        if (!userId || !country || !region) {
            return res.status(400).json({ 
                success: false,
                message: "userId, country, and region are required" 
            });
        }

        let result;
        try {
            result = await calculateBackendLostInventory(userId, country, region);
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message || "Error calculating Backend Lost Inventory",
                data: null
            });
        }
        
        if (!result || !result.success) {
            return res.status(400).json({ 
                success: false,
                message: result?.message || "Calculation failed",
                data: null
            });
        }

        return res.status(200).json({
            success: true,
            message: result.message || "Backend Lost Inventory calculated successfully",
            data: result.data,
            summary: result.summary,
            sampleItems: result.data?.items?.slice(0, 10) || [] // Return first 10 items as sample
        });
    } catch (error) {
        console.error("❌ Error in testCalculateBackendLostInventory:", error.message);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
            data: null
        });
    }
}

const testGetBackendLostInventory = async (req, res) => {
    try {
        const { userId, country, region } = req.body;

        if (!userId || !country || !region) {
            return res.status(400).json({ 
                success: false,
                message: "userId, country, and region are required" 
            });
        }

        let result;
        try {
            result = await getBackendLostInventory(userId, country, region);
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message || "Error getting Backend Lost Inventory",
                data: null
            });
        }
        
        if (!result || !result.success) {
            return res.status(404).json({ 
                success: false,
                message: result?.message || "No data found",
                data: null
            });
        }

        return res.status(200).json({
            success: true,
            message: result.message || "Backend Lost Inventory data retrieved successfully",
            data: result.data,
            summary: result.summary,
            sampleItems: result.data?.items?.slice(0, 10) || []
        });
    } catch (error) {
        console.error("❌ Error in testGetBackendLostInventory:", error.message);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
            data: null
        });
    }
}

/**
 * @desc Test all reimbursement APIs together and store data in database
 * @route POST /app/test/testAllReimbursementAPIs
 * @access Public (for testing)
 * 
 * This endpoint executes all reimbursement-related APIs from Refunzo documentation:
 * 1. All Shipments API - /fba/inbound/v0/shipments
 * 2. Shipment Items API - /fba/inbound/v0/shipments/{ship}/items (called within shipment.js)
 * 3. Listing Items API - /listings/2021-08-01/items/{sellerId}/{sku}
 * 4. GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA - Fee Protector Data
 * 5. Units Sold API - /sales/v1/orderMetrics
 * 6. GET_LEDGER_SUMMARY_VIEW_DATA - Backend Lost Inventory
 * 7. GET_FBA_REIMBURSEMENTS_DATA - Reimbursement Data
 * 8. Backend Lost Inventory Calculation
 * 9. All reimbursement retrieval endpoints
 */
const testAllReimbursementAPIs = async (req, res) => {
    try {
        const { userId, country, region } = req.body;

        if (!userId || !country || !region) {
            return res.status(400).json({
                success: false,
                message: 'userId, country, and region are required'
            });
        }

        // Import required services and models
        const Seller = require('../models/sellerCentralModel.js');
        const getTemporaryCredentials = require('../utils/GenerateTemporaryCredentials.js');
        const { generateAccessToken } = require('../Services/Sp_API/GenerateTokens.js');
        const tokenManager = require('../utils/TokenManager.js');
        const { URIs, marketplaceConfig, spapiRegions } = require('./config/config.js');
        const getshipment = require('../Services/Sp_API/shipment.js');
        const getProductWiseFBAData = require('../Services/Sp_API/GetProductWiseFBAData.js');
        const TotalSales = require('../Services/Sp_API/WeeklySales.js');
        const getLedgerSummaryReport = require('../Services/Sp_API/GET_LEDGER_SUMMARY_VIEW_DATA.js');
        const GET_FBA_REIMBURSEMENT_DATA = require('../Services/Sp_API/GET_FBA_REIMBURSEMENT_DATA.js');
        const { calculateBackendLostInventory } = require('../Services/Calculations/BackendLostInventory.js');
        const GetListingItem = require('../Services/Sp_API/GetListingItemsIssues.js');
        const {
            fetchReimbursementData,
            getReimbursementSummaryController,
            getAllReimbursements,
            getPotentialClaims,
            getUrgentClaims,
            getReimbursementStatsByType,
            getReimbursementTimeline
        } = require('./ReimbursementController.js');

        const results = {
            timestamp: new Date().toISOString(),
            userId,
            country,
            region,
            tests: {},
            summary: {
                totalTests: 0,
                passed: 0,
                failed: 0,
                errors: []
            }
        };

        // ===== GET SELLER DATA AND CREDENTIALS =====
        const getSellerData = await Seller.findOne({ User: userId });
        if (!getSellerData) {
            return res.status(404).json({
                success: false,
                message: 'No seller account found for this user'
            });
        }

        const sellerAccounts = Array.isArray(getSellerData.sellerAccount) 
            ? getSellerData.sellerAccount 
            : [];
        const getSellerAccount = sellerAccounts.find(
            item => item && item.country === country && item.region === region
        );

        if (!getSellerAccount) {
            return res.status(400).json({
                success: false,
                message: `No seller account found for region ${region} and country ${country}`
            });
        }

        const RefreshToken = getSellerAccount.spiRefreshToken;
        if (!RefreshToken) {
            return res.status(400).json({
                success: false,
                message: 'SP-API refresh token not found'
            });
        }

        // Get AWS credentials
        let Base_URI = URIs[region];
        if (!Base_URI) {
            const defaultURIs = {
                NA: 'sellingpartnerapi-na.amazon.com',
                EU: 'sellingpartnerapi-eu.amazon.com',
                FE: 'sellingpartnerapi-fe.amazon.com'
            };
            Base_URI = defaultURIs[region];
        }
        if (!Base_URI) {
            return res.status(400).json({
                success: false,
                message: `Unsupported region: ${region}`
            });
        }

        const regionConfig = spapiRegions[region];
        if (!regionConfig) {
            return res.status(400).json({
                success: false,
                message: `No credential configuration for region: ${region}`
            });
        }

        const credentials = await getTemporaryCredentials(regionConfig);
        if (!credentials || !credentials.AccessKey || !credentials.SecretKey) {
            return res.status(500).json({
                success: false,
                message: 'Failed to generate AWS credentials'
            });
        }

        // Generate access token
        const AccessToken = await generateAccessToken(userId, RefreshToken);
        if (!AccessToken) {
            return res.status(500).json({
                success: false,
                message: 'Failed to generate SP-API access token'
            });
        }

        // Initialize token manager
        tokenManager.setTokens(userId, AccessToken, null, RefreshToken, null);

        // Get marketplace ID
        let Marketplace_Id = marketplaceConfig[country] || marketplaceConfig[country.toUpperCase()];
        if (!Marketplace_Id && country) {
            const foundKey = Object.keys(marketplaceConfig).find(
                key => key.toLowerCase() === country.toLowerCase()
            );
            if (foundKey) {
                Marketplace_Id = marketplaceConfig[foundKey];
            }
        }
        if (!Marketplace_Id) {
            return res.status(400).json({
                success: false,
                message: `Unsupported country: ${country}`
            });
        }

        const dataToSend = {
            marketplaceId: Marketplace_Id,
            AccessToken: AccessToken,
            AccessKey: credentials.AccessKey,
            SecretKey: credentials.SecretKey,
            SessionToken: credentials.SessionToken,
            SellerId: getSellerAccount.selling_partner_id
        };

        // Mock request/response objects for controller functions
        const createMockReq = (params = {}, query = {}, body = {}) => ({
            userId,
            country: query.country || body.country || country,
            region: query.region || body.region || region,
            query: { ...query, country: query.country || country, region: query.region || region },
            body: { ...body, country: body.country || country, region: body.region || region },
            params
        });

        const createMockRes = () => {
            let responseData = null;
            let statusCode = 200;
            return {
                status: (code) => {
                    statusCode = code;
                    return {
                        json: (data) => {
                            responseData = { statusCode, data };
                            return responseData;
                        }
                    };
                },
                json: (data) => {
                    responseData = { statusCode, data };
                    return responseData;
                },
                getResponse: () => responseData
            };
        };

        // Create mock next function for asyncHandler
        const createMockNext = (errorHandler) => {
            return (error) => {
                if (error) {
                    errorHandler(error);
                }
            };
        };

        // Test 1: All Shipments API - /fba/inbound/v0/shipments
        results.summary.totalTests++;
        try {
            const shipmentResult = await tokenManager.wrapDataToSendFunction(
                getshipment,
                userId,
                RefreshToken,
                null
            )(dataToSend, userId, Base_URI, country, region);
            
            results.tests.allShipments = {
                status: shipmentResult ? 'success' : 'failed',
                hasData: !!shipmentResult,
                shipmentCount: shipmentResult?.shipmentData?.length || 0,
                note: 'Fetches all shipments with status CLOSED. Shipment items are automatically fetched for each shipment.'
            };
            
            if (shipmentResult) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push('All Shipments: No data returned');
            }
        } catch (error) {
            results.tests.allShipments = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`All Shipments: ${error.message}`);
        }

        // Test 2: GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA - Fee Protector Data
        results.summary.totalTests++;
        try {
            const fbaFeesResult = await getProductWiseFBAData(
                AccessToken,
                [Marketplace_Id],
                userId,
                Base_URI,
                country,
                region
            );
            
            results.tests.fbaEstimatedFees = {
                status: fbaFeesResult?.success ? 'success' : 'failed',
                hasData: !!fbaFeesResult?.success,
                productCount: fbaFeesResult?.data?.fbaData?.length || 0,
                message: fbaFeesResult?.message || 'Fee Protector data fetched',
                note: 'Stores SKU, FNSKU, ASIN, dimensions, weight, sales price, fees, and calculates Reimbursement Per Unit = (Sales Price – Fees)'
            };
            
            if (fbaFeesResult?.success) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push(`FBA Estimated Fees: ${fbaFeesResult?.message || 'Failed'}`);
            }
        } catch (error) {
            results.tests.fbaEstimatedFees = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`FBA Estimated Fees: ${error.message}`);
        }

        // Test 3: Units Sold API - /sales/v1/orderMetrics
        results.summary.totalTests++;
        try {
            // Calculate date range for last 30 days
            const now = new Date();
            const before = now.toISOString();
            const after = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
            
            const salesData = {
                ...dataToSend,
                after,
                before
            };
            
            const unitsSoldResult = await tokenManager.wrapDataToSendFunction(
                TotalSales,
                userId,
                RefreshToken,
                null
            )(salesData, userId, Base_URI, country, region);
            
            results.tests.unitsSold = {
                status: unitsSoldResult ? 'success' : 'failed',
                hasData: !!unitsSoldResult,
                note: 'Fetches units sold data for Fee Protector calculations'
            };
            
            if (unitsSoldResult) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push('Units Sold: No data returned');
            }
        } catch (error) {
            results.tests.unitsSold = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`Units Sold: ${error.message}`);
        }

        // Test 4: GET_LEDGER_SUMMARY_VIEW_DATA - Backend Lost Inventory
        results.summary.totalTests++;
        try {
            const ledgerResult = await getLedgerSummaryReport(
                AccessToken,
                [Marketplace_Id],
                Base_URI,
                userId,
                country,
                region
            );
            
            results.tests.ledgerSummary = {
                status: ledgerResult?.success ? 'success' : 'failed',
                hasData: !!ledgerResult?.success,
                recordId: ledgerResult?.recordId || null,
                totalRecords: ledgerResult?.totalRecords || 0,
                message: ledgerResult?.message || 'Ledger summary data fetched',
                note: 'Gets found and lost quantity for Backend Lost Inventory calculations'
            };
            
            if (ledgerResult?.success) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push(`Ledger Summary: ${ledgerResult?.message || 'Failed'}`);
            }
        } catch (error) {
            results.tests.ledgerSummary = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`Ledger Summary: ${error.message}`);
        }

        // Test 5: GET_FBA_REIMBURSEMENTS_DATA - Reimbursement Data
        results.summary.totalTests++;
        try {
            const reimbursementResult = await tokenManager.wrapDataToSendFunction(
                GET_FBA_REIMBURSEMENT_DATA,
                userId,
                RefreshToken,
                null
            )(dataToSend, userId, Base_URI, country, region);
            
            results.tests.fbaReimbursements = {
                status: reimbursementResult ? 'success' : 'failed',
                hasData: !!reimbursementResult,
                reimbursementCount: reimbursementResult?.reimbursements?.length || 0,
                note: 'Gets reimbursed units where reason is "Lost_warehouse" for Backend Lost Inventory calculations'
            };
            
            if (reimbursementResult) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push('FBA Reimbursements: No data returned');
            }
        } catch (error) {
            results.tests.fbaReimbursements = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`FBA Reimbursements: ${error.message}`);
        }

        // Test 6: Backend Lost Inventory Calculation
        results.summary.totalTests++;
        try {
            const backendLostResult = await calculateBackendLostInventory(userId, country, region);
            
            results.tests.backendLostInventory = {
                status: backendLostResult?.success ? 'success' : 'failed',
                hasData: !!backendLostResult?.success,
                itemCount: backendLostResult?.data?.items?.length || 0,
                message: backendLostResult?.message || 'Backend Lost Inventory calculated',
                note: 'Calculates: Discrepancy Units = Lost Units – Found Units – Reimbursed Units. Also identifies Underpaid items.'
            };
            
            if (backendLostResult?.success) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push(`Backend Lost Inventory: ${backendLostResult?.message || 'Failed'}`);
            }
        } catch (error) {
            results.tests.backendLostInventory = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`Backend Lost Inventory: ${error.message}`);
        }

        // Test 7: Fetch and merge reimbursement data (includes shipment discrepancies)
        results.summary.totalTests++;
        try {
            const mockReq7 = createMockReq({}, {}, { country, region });
            const mockRes7 = createMockRes();
            let testError = null;
            const mockNext7 = createMockNext((error) => {
                testError = error;
            });
            
            await fetchReimbursementData(mockReq7, mockRes7, mockNext7);
            
            if (testError) {
                throw testError;
            }
            
            const response7 = mockRes7.getResponse();
            
            results.tests.fetchReimbursementData = {
                status: response7.statusCode === 200 ? 'success' : 'failed',
                statusCode: response7.statusCode,
                apiDataCount: response7.data?.data?.apiDataCount || 0,
                potentialClaimsCount: response7.data?.data?.potentialClaimsCount || 0,
                totalReimbursements: response7.data?.data?.totalReimbursements || 0,
                message: response7.data?.message || 'Reimbursement data fetched and merged',
                note: 'Fetches reimbursement data from SP-API, calculates potential claims from shipment discrepancies, and merges everything to database'
            };
            
            if (response7.statusCode === 200) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push(`Fetch Reimbursement Data: ${response7.data?.message || 'Failed'}`);
            }
        } catch (error) {
            results.tests.fetchReimbursementData = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`Fetch Reimbursement Data: ${error.message}`);
        }

        // Test 8: Get reimbursement summary
        results.summary.totalTests++;
        try {
            const mockReq8 = createMockReq({}, { country, region });
            const mockRes8 = createMockRes();
            let testError8 = null;
            const mockNext8 = createMockNext((error) => {
                testError8 = error;
            });
            
            await getReimbursementSummaryController(mockReq8, mockRes8, mockNext8);
            
            if (testError8) {
                throw testError8;
            }
            
            const response8 = mockRes8.getResponse();
            
            results.tests.getSummary = {
                status: response8.statusCode === 200 ? 'success' : 'failed',
                statusCode: response8.statusCode,
                totalReceived: response8.data?.data?.totalReceived || 0,
                totalPending: response8.data?.data?.totalPending || 0,
                totalPotential: response8.data?.data?.totalPotential || 0
            };
            
            if (response8.statusCode === 200) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push(`Get Summary: ${response8.data?.message || 'Failed'}`);
            }
        } catch (error) {
            results.tests.getSummary = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`Get Summary: ${error.message}`);
        }

        // Test 9: Get all reimbursements
        results.summary.totalTests++;
        try {
            const mockReq9 = createMockReq({}, { country, region });
            const mockRes9 = createMockRes();
            let testError9 = null;
            const mockNext9 = createMockNext((error) => {
                testError9 = error;
            });
            
            await getAllReimbursements(mockReq9, mockRes9, mockNext9);
            
            if (testError9) {
                throw testError9;
            }
            
            const response9 = mockRes9.getResponse();
            
            results.tests.getAllReimbursements = {
                status: response9.statusCode === 200 ? 'success' : 'failed',
                statusCode: response9.statusCode,
                count: Array.isArray(response9.data?.data) ? response9.data.data.length : 0,
                hasMore: Array.isArray(response9.data?.data) && response9.data.data.length > 5
            };
            
            if (response9.statusCode === 200) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push(`Get All: ${response9.data?.message || 'Failed'}`);
            }
        } catch (error) {
            results.tests.getAllReimbursements = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`Get All: ${error.message}`);
        }

        // Test 10: Get potential claims
        results.summary.totalTests++;
        try {
            const mockReq10 = createMockReq({}, { country, region });
            const mockRes10 = createMockRes();
            let testError10 = null;
            const mockNext10 = createMockNext((error) => {
                testError10 = error;
            });
            
            await getPotentialClaims(mockReq10, mockRes10, mockNext10);
            
            if (testError10) {
                throw testError10;
            }
            
            const response10 = mockRes10.getResponse();
            
            results.tests.getPotentialClaims = {
                status: response10.statusCode === 200 ? 'success' : 'failed',
                statusCode: response10.statusCode,
                count: Array.isArray(response10.data?.data) ? response10.data.data.length : 0
            };
            
            if (response10.statusCode === 200) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push(`Get Potential: ${response10.data?.message || 'Failed'}`);
            }
        } catch (error) {
            results.tests.getPotentialClaims = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`Get Potential: ${error.message}`);
        }

        // Test 11: Get urgent claims
        results.summary.totalTests++;
        try {
            const mockReq11 = createMockReq({}, { country, region, days: 7 });
            const mockRes11 = createMockRes();
            let testError11 = null;
            const mockNext11 = createMockNext((error) => {
                testError11 = error;
            });
            
            await getUrgentClaims(mockReq11, mockRes11, mockNext11);
            
            if (testError11) {
                throw testError11;
            }
            
            const response11 = mockRes11.getResponse();
            
            results.tests.getUrgentClaims = {
                status: response11.statusCode === 200 ? 'success' : 'failed',
                statusCode: response11.statusCode,
                count: Array.isArray(response11.data?.data) ? response11.data.data.length : 0
            };
            
            if (response11.statusCode === 200) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push(`Get Urgent: ${response11.data?.message || 'Failed'}`);
            }
        } catch (error) {
            results.tests.getUrgentClaims = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`Get Urgent: ${error.message}`);
        }

        // Test 12: Get stats by type
        results.summary.totalTests++;
        try {
            const mockReq12 = createMockReq({}, { country, region });
            const mockRes12 = createMockRes();
            let testError12 = null;
            const mockNext12 = createMockNext((error) => {
                testError12 = error;
            });
            
            await getReimbursementStatsByType(mockReq12, mockRes12, mockNext12);
            
            if (testError12) {
                throw testError12;
            }
            
            const response12 = mockRes12.getResponse();
            
            results.tests.getStatsByType = {
                status: response12.statusCode === 200 ? 'success' : 'failed',
                statusCode: response12.statusCode,
                byType: response12.data?.data?.byType || {},
                countByType: response12.data?.data?.countByType || {}
            };
            
            if (response12.statusCode === 200) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push(`Get Stats: ${response12.data?.message || 'Failed'}`);
            }
        } catch (error) {
            results.tests.getStatsByType = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`Get Stats: ${error.message}`);
        }

        // Test 13: Get timeline
        results.summary.totalTests++;
        try {
            const mockReq13 = createMockReq({}, { country, region, days: 30 });
            const mockRes13 = createMockRes();
            let testError13 = null;
            const mockNext13 = createMockNext((error) => {
                testError13 = error;
            });
            
            await getReimbursementTimeline(mockReq13, mockRes13, mockNext13);
            
            if (testError13) {
                throw testError13;
            }
            
            const response13 = mockRes13.getResponse();
            
            results.tests.getTimeline = {
                status: response13.statusCode === 200 ? 'success' : 'failed',
                statusCode: response13.statusCode,
                count: Array.isArray(response13.data?.data) ? response13.data.data.length : 0
            };
            
            if (response13.statusCode === 200) {
                results.summary.passed++;
            } else {
                results.summary.failed++;
                results.summary.errors.push(`Get Timeline: ${response13.data?.message || 'Failed'}`);
            }
        } catch (error) {
            results.tests.getTimeline = {
                status: 'error',
                error: error.message
            };
            results.summary.failed++;
            results.summary.errors.push(`Get Timeline: ${error.message}`);
        }

        return res.status(200).json({
            success: true,
            message: 'All reimbursement APIs executed successfully. Data has been fetched and stored in database.',
            data: results,
            executionTime: new Date().toISOString()
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Error executing reimbursement APIs',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * @desc Get all reimbursement data from database for frontend
 * @route GET /app/test/getAllReimbursementData
 * @access Public (for testing)
 * 
 * Returns all models mentioned in Refunzo Final Documentation 6.md:
 * 1. AllShipments (ShipmentModel) - with ShipmentItems nested
 * 2. Listing Items (ListingItems)
 * 3. Fee Protector Data (ProductWiseFBAData)
 * 4. Units Sold (TotalSalesModel)
 * 5. Ledger Summary View (LedgerSummaryViewModel)
 * 6. Reimbursement Data (ReimbursementModel)
 * 7. Backend Lost Inventory (BackendLostInventoryModel)
 */
const getAllReimbursementData = async (req, res) => {
    try {
        const { userId, country, region } = req.query;

        if (!userId || !country || !region) {
            return res.status(400).json({
                success: false,
                message: 'userId, country, and region are required as query parameters'
            });
        }

        // Import all models
        const ReimbursementModel = require('../models/ReimbursementModel.js');
        const ShipmentModel = require('../models/ShipmentModel.js');
        const ListingItems = require('../models/GetListingItemsModel.js');
        const ProductWiseFBAData = require('../models/ProductWiseFBADataModel.js');
        const TotalSalesModel = require('../models/TotalSalesModel.js');
        const LedgerSummaryViewModel = require('../models/LedgerSummaryViewModel.js');
        const BackendLostInventoryModel = require('../models/BackendLostInventoryModel.js');
        const {
            getReimbursementSummary,
            getDetailedReimbursements
        } = require('../Services/Calculations/EnhancedReimbursement.js');

        // 1. Get AllShipments (includes ShipmentItems nested in itemDetails)
        const shipmentRecord = await ShipmentModel.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        const shipments = shipmentRecord ? {
            shipmentCount: shipmentRecord.shipmentData?.length || 0,
            totalItems: shipmentRecord.shipmentData?.reduce((sum, shipment) => 
                sum + (shipment.itemDetails?.length || 0), 0) || 0,
            data: shipmentRecord.shipmentData || [],
            note: 'Includes ShipmentItems nested in itemDetails array'
        } : {
            shipmentCount: 0,
            totalItems: 0,
            data: [],
            note: 'No shipment data found'
        };

        // 2. Get Listing Items
        const listingItemsRecord = await ListingItems.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        const listingItems = listingItemsRecord ? {
            keywordCount: listingItemsRecord.GenericKeyword?.length || 0,
            data: listingItemsRecord.GenericKeyword || []
        } : {
            keywordCount: 0,
            data: []
        };

        // 3. Get Fee Protector Data (ProductWiseFBAData)
        const fbaDataRecord = await ProductWiseFBAData.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        const feeProtectorData = fbaDataRecord ? {
            productCount: fbaDataRecord.fbaData?.length || 0,
            data: fbaDataRecord.fbaData || [],
            note: 'Includes SKU, FNSKU, ASIN, dimensions, weight, sales price, fees, and calculated Reimbursement Per Unit = (Sales Price – Fees)'
        } : {
            productCount: 0,
            data: [],
            note: 'No fee protector data found'
        };

        // 4. Get Units Sold (TotalSalesModel)
        const unitsSoldRecord = await TotalSalesModel.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        const unitsSold = unitsSoldRecord ? {
            intervalCount: unitsSoldRecord.totalSales?.length || 0,
            data: unitsSoldRecord.totalSales || []
        } : {
            intervalCount: 0,
            data: []
        };

        // 5. Get Ledger Summary View Data
        const ledgerSummaryRecord = await LedgerSummaryViewModel.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        const ledgerSummary = ledgerSummaryRecord ? {
            recordCount: ledgerSummaryRecord.data?.length || 0,
            data: ledgerSummaryRecord.data || [],
            note: 'Contains found and lost quantity for Backend Lost Inventory calculations'
        } : {
            recordCount: 0,
            data: [],
            note: 'No ledger summary data found'
        };

        // 6. Get Reimbursement Data
        const summary = await getReimbursementSummary(userId, country, region);
        const allReimbursements = await getDetailedReimbursements(userId, country, region, {});
        const potentialClaims = await getDetailedReimbursements(userId, country, region, { status: 'POTENTIAL' });
        
        // Get urgent claims (expiring in 7 days)
        const urgentClaims = potentialClaims.filter(claim => {
            return claim.daysToDeadline !== undefined && 
                   claim.daysToDeadline >= 0 && 
                   claim.daysToDeadline <= 7;
        });

        // Get stats by type
        const reimbursementRecord = await ReimbursementModel.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        const statsByType = reimbursementRecord ? {
            byType: reimbursementRecord.summary?.amountByType || {},
            countByType: reimbursementRecord.summary?.countByType || {},
            total: reimbursementRecord.summary?.totalReceived || 0
        } : { byType: {}, countByType: {}, total: 0 };

        // Get timeline data (last 30 days)
        const days = 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const timelineData = {};
        if (reimbursementRecord && reimbursementRecord.reimbursements) {
            reimbursementRecord.reimbursements
                .filter(r => {
                    const date = r.reimbursementDate || r.discoveryDate;
                    return date && date >= startDate;
                })
                .forEach(r => {
                    const date = r.reimbursementDate || r.discoveryDate;
                    const dateKey = date.toISOString().split('T')[0];

                    if (!timelineData[dateKey]) {
                        timelineData[dateKey] = {
                            date: dateKey,
                            totalAmount: 0,
                            count: 0,
                            byType: {}
                        };
                    }

                    timelineData[dateKey].totalAmount += r.amount || 0;
                    timelineData[dateKey].count++;

                    const type = r.reimbursementType || 'OTHER';
                    if (!timelineData[dateKey].byType[type]) {
                        timelineData[dateKey].byType[type] = 0;
                    }
                    timelineData[dateKey].byType[type] += r.amount || 0;
                });
        }

        const timeline = Object.values(timelineData).sort((a, b) => 
            new Date(a.date) - new Date(b.date)
        );

        // 7. Get Backend Lost Inventory
        const backendLostInventoryRecord = await BackendLostInventoryModel.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // ===== CALCULATE FEE PROTECTOR BACKEND SHIPMENT ITEMS AND SHIPMENTS =====
        // Create FBA data map for quick lookup
        const fbaDataMap = new Map();
        if (fbaDataRecord && fbaDataRecord.fbaData) {
            fbaDataRecord.fbaData.forEach(item => {
                if (item && item.asin) {
                    fbaDataMap.set(item.asin, item);
                }
            });
        }

        // Calculate BackendShipmentItems from shipments with discrepancies
        const backendShipmentItems = [];
        const backendShipments = [];
        
        if (shipmentRecord && shipmentRecord.shipmentData) {
            shipmentRecord.shipmentData.forEach(shipment => {
                if (!shipment || !shipment.itemDetails) return;
                
                let shipmentHasDiscrepancy = false;
                const shipmentItems = [];
                
                shipment.itemDetails.forEach(item => {
                    if (!item || !item.SellerSKU) return;
                    
                    const quantityShipped = parseInt(item.QuantityShipped) || 0;
                    const quantityReceived = parseInt(item.QuantityReceived) || 0;
                    const discrepancy = quantityShipped - quantityReceived;
                    
                    if (discrepancy > 0) {
                        shipmentHasDiscrepancy = true;
                        
                        // Find FBA data by SKU or FNSKU
                        let fbaItem = null;
                        for (const [asin, fbaData] of fbaDataMap.entries()) {
                            if (fbaData.sku === item.SellerSKU || fbaData.fnsku === item.FulfillmentNetworkSKU) {
                                fbaItem = fbaData;
                                break;
                            }
                        }
                        
                        const salesPrice = fbaItem ? (parseFloat(fbaItem.salesPrice) || 0) : 0;
                        const fees = fbaItem ? (parseFloat(fbaItem.totalAmzFee) || 0) : 0;
                        const reimbursementPerUnit = fbaItem ? (parseFloat(fbaItem.reimbursementPerUnit) || (salesPrice - fees)) : 0;
                        const expectedAmount = discrepancy * reimbursementPerUnit;
                        
                        backendShipmentItems.push({
                            sku: item.SellerSKU || '',
                            fnsku: item.FulfillmentNetworkSKU || '',
                            asin: fbaItem?.asin || '',
                            quantityShipped: quantityShipped,
                            quantityReceived: quantityReceived,
                            discrepancyUnits: discrepancy,
                            salesPrice: salesPrice,
                            fees: fees,
                            reimbursementPerUnit: reimbursementPerUnit,
                            expectedAmount: expectedAmount,
                            currency: fbaItem?.currency || 'USD'
                        });
                        
                        shipmentItems.push({
                            sku: item.SellerSKU,
                            discrepancy: discrepancy,
                            expectedAmount: expectedAmount
                        });
                    }
                });
                
                if (shipmentHasDiscrepancy) {
                    const totalDiscrepancy = shipmentItems.reduce((sum, item) => sum + item.discrepancy, 0);
                    const totalExpectedAmount = shipmentItems.reduce((sum, item) => sum + item.expectedAmount, 0);
                    
                    backendShipments.push({
                        shipmentId: shipment.shipmentId || '',
                        shipmentName: shipment.shipmentName || '',
                        totalDiscrepancyUnits: totalDiscrepancy,
                        totalExpectedAmount: totalExpectedAmount,
                        itemCount: shipmentItems.length
                    });
                }
            });
        }

        // ===== CALCULATE BACKEND LOST INVENTORY (if not already calculated) =====
        let backendLostInventory = {
            itemCount: 0,
            summary: {},
            data: [],
            note: 'No backend lost inventory data found. Run calculateBackendLostInventory first.'
        };

        if (backendLostInventoryRecord) {
            backendLostInventory = {
                itemCount: backendLostInventoryRecord.items?.length || 0,
                summary: backendLostInventoryRecord.summary || {},
                data: backendLostInventoryRecord.items || [],
                note: 'Calculated from Ledger Summary View and Reimbursement Data. Discrepancy Units = Lost Units – Found Units – Reimbursed Units'
            };
        } else {
            // Calculate on the fly if data exists
            if (ledgerSummaryRecord && reimbursementRecord && fbaDataRecord) {
                const calculatedItems = [];
                const ledgerData = ledgerSummaryRecord.data || [];
                const reimbursements = reimbursementRecord.reimbursements || [];
                
                // Create maps for quick lookup
                const ledgerMap = new Map();
                ledgerData.forEach(item => {
                    if (item && item.asin) {
                        const asin = item.asin;
                        if (!ledgerMap.has(asin)) {
                            ledgerMap.set(asin, {
                                lostUnits: 0,
                                foundUnits: 0
                            });
                        }
                        const lost = parseFloat(item.lost) || 0;
                        const found = parseFloat(item.found) || 0;
                        ledgerMap.get(asin).lostUnits += lost;
                        ledgerMap.get(asin).foundUnits += found;
                    }
                });
                
                // Map reimbursed units (where reason is "Lost_warehouse")
                const reimbursedMap = new Map();
                reimbursements.forEach(r => {
                    if (r && r.asin && r.reasonCode && 
                        (r.reasonCode.includes('Lost') || r.reasonCode.includes('LOST') || 
                         r.reasonCode.includes('Lost_warehouse') || r.reasonCode.includes('LOST_WAREHOUSE'))) {
                        const asin = r.asin;
                        const quantity = parseInt(r.quantity) || 0;
                        reimbursedMap.set(asin, (reimbursedMap.get(asin) || 0) + quantity);
                    }
                });
                
                // Calculate for each ASIN
                ledgerMap.forEach((ledgerData, asin) => {
                    const lostUnits = ledgerData.lostUnits || 0;
                    const foundUnits = ledgerData.foundUnits || 0;
                    const reimbursedUnits = reimbursedMap.get(asin) || 0;
                    
                    // Discrepancy Units = Lost Units – Found Units – Reimbursed Units
                    const discrepancyUnits = lostUnits - foundUnits - reimbursedUnits;
                    
                    if (discrepancyUnits > 0) {
                        // Get FBA data for this ASIN
                        const fbaItem = fbaDataMap.get(asin);
                        const salesPrice = fbaItem ? (parseFloat(fbaItem.salesPrice) || 0) : 0;
                        const fees = fbaItem ? (parseFloat(fbaItem.totalAmzFee) || 0) : 0;
                        const reimbursementPerUnit = fbaItem ? (parseFloat(fbaItem.reimbursementPerUnit) || (salesPrice - fees)) : 0;
                        
                        // Expected Amount = Discrepancy Units × (Sales Price – Fees)
                        const expectedAmount = discrepancyUnits * reimbursementPerUnit;
                        
                        // Get amount per unit from reimbursement (if available)
                        const reimbursementForAsin = reimbursements.find(r => r.asin === asin && r.reasonCode && 
                            (r.reasonCode.includes('Lost') || r.reasonCode.includes('LOST')));
                        const amountPerUnit = reimbursementForAsin ? ((reimbursementForAsin.amount || 0) / (reimbursementForAsin.quantity || 1)) : 0;
                        
                        // Check if underpaid: If Amount per Unit < ((Sales Price – Fees) × 0.4)
                        const isUnderpaid = amountPerUnit > 0 && amountPerUnit < (reimbursementPerUnit * 0.4);
                        const underpaidExpectedAmount = isUnderpaid ? 
                            ((reimbursementPerUnit - amountPerUnit) * discrepancyUnits) : 0;
                        
                        calculatedItems.push({
                            asin: asin,
                            sku: fbaItem?.sku || '',
                            fnsku: fbaItem?.fnsku || '',
                            lostUnits: lostUnits,
                            foundUnits: foundUnits,
                            reimbursedUnits: reimbursedUnits,
                            discrepancyUnits: discrepancyUnits,
                            salesPrice: salesPrice,
                            fees: fees,
                            reimbursementPerUnit: reimbursementPerUnit,
                            expectedAmount: expectedAmount,
                            currency: fbaItem?.currency || 'USD',
                            isUnderpaid: isUnderpaid,
                            amountPerUnit: amountPerUnit,
                            underpaidExpectedAmount: underpaidExpectedAmount
                        });
                    }
                });
                
                // Calculate summary
                const summary = {
                    totalDiscrepancyUnits: calculatedItems.reduce((sum, item) => sum + (item.discrepancyUnits || 0), 0),
                    totalExpectedAmount: calculatedItems.reduce((sum, item) => sum + (item.expectedAmount || 0), 0),
                    totalUnderpaidItems: calculatedItems.filter(item => item.isUnderpaid).length,
                    totalUnderpaidExpectedAmount: calculatedItems.reduce((sum, item) => sum + (item.underpaidExpectedAmount || 0), 0),
                    totalLostUnits: calculatedItems.reduce((sum, item) => sum + (item.lostUnits || 0), 0),
                    totalFoundUnits: calculatedItems.reduce((sum, item) => sum + (item.foundUnits || 0), 0),
                    totalReimbursedUnits: calculatedItems.reduce((sum, item) => sum + (item.reimbursedUnits || 0), 0)
                };
                
                backendLostInventory = {
                    itemCount: calculatedItems.length,
                    summary: summary,
                    data: calculatedItems,
                    note: 'Calculated on-the-fly from Ledger Summary View and Reimbursement Data. Discrepancy Units = Lost Units – Found Units – Reimbursed Units'
                };
            }
        }

        return res.status(200).json({
            success: true,
            message: 'All calculated reimbursement data retrieved successfully',
            data: {
                // Calculated Data as per Refunzo Documentation
                feeProtector: {
                    backendShipmentItems: {
                        count: backendShipmentItems.length,
                        data: backendShipmentItems,
                        note: 'Calculated from shipments with discrepancies. Reimbursement Per Unit = (Sales Price – Fees). Missing data treated as zero.'
                    },
                    backendShipments: {
                        count: backendShipments.length,
                        data: backendShipments,
                        note: 'Calculated from shipments where there is a discrepancy. Total expected amount = sum of all item discrepancies.'
                    }
                },
                
                backendLostInventory: {
                    itemCount: backendLostInventory.itemCount,
                    summary: backendLostInventory.summary,
                    data: backendLostInventory.data,
                    calculations: {
                        formula: 'Discrepancy Units = Lost Units – Found Units – Reimbursed Units',
                        expectedAmountFormula: 'Expected Amount = Discrepancy Units × (Sales Price – Fees)',
                        underpaidFormula: 'If Amount per Unit < ((Sales Price – Fees) × 0.4), then Underpaid Expected Amount = ((Sales Price – Fees) - Amount per Unit) × quantity',
                        note: 'All missing data treated as zero. Calculated from Ledger Summary View, Reimbursement Data, and ProductWiseFBAData.'
                    }
                },
                
                // Calculated Reimbursement Summary
                summary: {
                    totalReceived: summary?.totalReceived || 0,
                    totalPending: summary?.totalPending || 0,
                    totalPotential: summary?.totalPotential || 0,
                    totalDenied: summary?.totalDenied || 0
                },
                
                // Calculated Claims
                potentialClaims: {
                    count: potentialClaims.length,
                    data: potentialClaims
                },
                urgentClaims: {
                    count: urgentClaims.length,
                    data: urgentClaims
                },
                
                // Calculated Statistics
                statsByType: {
                    byType: statsByType.byType,
                    countByType: statsByType.countByType,
                    total: statsByType.total
                },
                
                // Calculated Timeline
                timeline: {
                    data: timeline,
                    days: days,
                    count: timeline.length
                },
                
                metadata: {
                    userId,
                    country,
                    region,
                    fetchedAt: new Date().toISOString(),
                    calculations: {
                        backendShipmentItemsCalculated: backendShipmentItems.length > 0,
                        backendShipmentsCalculated: backendShipments.length > 0,
                        backendLostInventoryCalculated: backendLostInventory.itemCount > 0,
                        potentialClaimsCalculated: potentialClaims.length > 0,
                        urgentClaimsCalculated: urgentClaims.length > 0
                    }
                }
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Error fetching reimbursement data',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// Dedicated test function for Search Keywords
const testSearchKeywords = async (req, res) => {
  try {
    const { accessToken, region, profileId, userId, country, fetchTokenFromDB } = req.body;
    
    // Import required modules
    const Seller = require('../models/sellerCentralModel.js');
    const tokenManager = require('../utils/TokenManager.js');
    const { getProfileById } = require('../Services/AmazonAds/GenerateProfileId.js');
    
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
      spRefreshToken = sellerCentral.sellerAccount?.find(acc => acc.spiRefreshToken)?.spiRefreshToken || null; // SP-API refresh token (may be null)
      
      // Get initial access token (TokenManager will refresh if needed)
      const { generateAdsAccessToken } = require('../Services/AmazonAds/GenerateToken.js');
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
          const profiles = await getProfileById(adsAccessToken, region || 'NA', testCountryValue, userId);
          
          if (profiles && Array.isArray(profiles) && profiles.length > 0) {
            // Use the first profile, or you could let user choose
            adsProfileId = profiles[0].profileId;
            console.log(`✅ Found ${profiles.length} profile(s), using first one:`, adsProfileId);
            
            // Optionally save it to database for future use
            if (profiles.length === 1) {
              try {
                // Update the specific sellerAccount in the sellerAccount array
                await Seller.findOneAndUpdate(
                  { 
                    User: userId,
                    'sellerAccount.country': sellerAccount.country,
                    'sellerAccount.region': sellerAccount.region
                  },
                  { 
                    $set: { 'sellerAccount.$.ProfileId': adsProfileId }
                  },
                  { new: true }
                );
                console.log('✅ Profile ID saved to database for future use');
              } catch (saveError) {
                console.warn('⚠️ Could not save profile ID to database:', saveError.message);
              }
            } else {
              console.log(`ℹ️ Multiple profiles found (${profiles.length}). Using first one. Available profiles:`, 
                profiles.map(p => ({ profileId: p.profileId, accountInfo: p.accountInfo }))
              );
            }
          } else if (profiles && !Array.isArray(profiles)) {
            // Handle case where API returns single profile object
            adsProfileId = profiles.profileId || profiles.id;
            console.log('✅ Found single profile:', adsProfileId);
          } else {
            console.warn('⚠️ No profiles found from Amazon Ads API');
          }
        } catch (profileError) {
          console.error('❌ Error fetching profile ID:', profileError.message);
          // Don't fail here, let it fail later with a clearer error message
        }
      }
      
      testUserId = userId;
      testCountry = sellerAccount.country || country || "US";
    } else if (userId) {
      // Even if not fetching from DB, we need refresh tokens for TokenManager
      const sellerCentral = await Seller.findOne({ User: userId }).sort({ createdAt: -1 });
      if (sellerCentral) {
        const sellerAccount = sellerCentral.sellerAccount?.find(
          account => account.country === (country || "US") && account.region === region
        );
        if (sellerAccount) {
          adsRefreshToken = sellerAccount.adsRefreshToken;
          spRefreshToken = sellerCentral.sellerAccount?.find(acc => acc.spiRefreshToken)?.spiRefreshToken || null;
        }
      }
    }
    
    // Validate required parameters
    if (!adsAccessToken) {
      return res.status(400).json({
        success: false,
        error: 'accessToken is required. Either provide it in the request body or set fetchTokenFromDB to true with a valid userId.'
      });
    }
    
    // Try to fetch profile ID one more time if still missing (even if not using fetchTokenFromDB)
    if (!adsProfileId && adsAccessToken && region && testUserId) {
      console.log('🔄 Profile ID still missing, attempting to fetch from API...');
      try {
        const profiles = await getProfileById(adsAccessToken, region, testCountry || country || "US", testUserId);
        
        if (profiles && Array.isArray(profiles) && profiles.length > 0) {
          adsProfileId = profiles[0].profileId;
          console.log(`✅ Successfully fetched profile ID: ${adsProfileId}`);
        } else if (profiles && !Array.isArray(profiles)) {
          // Handle single profile object response
          if (profiles.profileId) {
            adsProfileId = profiles.profileId;
          } else if (Array.isArray(profiles.profiles) && profiles.profiles.length > 0) {
            adsProfileId = profiles.profiles[0].profileId;
          }
          if (adsProfileId) {
            console.log(`✅ Successfully fetched profile ID: ${adsProfileId}`);
          }
        }
      } catch (profileError) {
        console.error('❌ Failed to fetch profile ID:', profileError.message);
      }
    }
    
    if (!adsProfileId) {
      return res.status(400).json({
        success: false,
        error: 'profileId is required',
        details: 'Profile ID could not be found. Please provide it in the request body, ensure it exists in the database, or ensure your Amazon Ads account has an active profile.',
        suggestion: 'You can either: 1) Provide profileId in the request body, 2) Ensure the user has adsProfileId saved in the database, or 3) The system will attempt to fetch it automatically if you have a valid access token.'
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
      )(adsAccessToken, adsProfileId, testUserId, testCountry, region, adsRefreshToken);
    } else {
      // Call directly without TokenManager (no automatic refresh)
      console.log('⚠️ Calling without TokenManager - no refresh token available');
      result = await getSearchKeywords(
        adsAccessToken,
        adsProfileId,
        testUserId,
        testCountry,
        region,
        adsRefreshToken
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
        usedTokenManager: !!adsRefreshToken,
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
        statusCode: status,
        suggestion: status === 401 ? 
          'Token may be expired or invalid. If you set fetchTokenFromDB to true, the refresh token itself may be invalid. Please reconnect your Amazon Ads account.' : 
          undefined
      });
    }
    
    // Handle token generation errors
    if (error.message && (
      error.message.includes('token refresh failed') ||
      error.message.includes('refresh token') ||
      error.message.includes('invalid_client') ||
      error.message.includes('Invalid token')
    )) {
      return res.status(401).json({
        success: false,
        error: 'Token Refresh Error',
        message: error.message,
        suggestion: 'The refresh token may be invalid or expired. Please reconnect your Amazon Ads account through the application.'
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
        suggestion: 'Please check if your access token is valid. If using fetchTokenFromDB, the refresh token may be invalid. Please reconnect your Amazon Ads account.'
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
    const Seller = require('../models/sellerCentralModel.js');
    const tokenManager = require('../utils/TokenManager.js');
    const { URIs, marketplaceConfig } = require('./config/config.js');
    const { generateAccessToken } = require('../Services/Sp_API/GenerateTokens.js');
    
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
        error: 'accessToken is required. Either provide it in the request body or set fetchTokenFromDB to true with a valid userId.'
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
        error: 'country is required. Valid values: US, UK, CA, DE, FR, etc.'
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
    
    // Get Base URI from config
    const Base_URI = URIs[testRegion];
    if (!Base_URI) {
      return res.status(400).json({
        success: false,
        error: `Base URI not configured for region: ${testRegion}`,
        suggestion: 'Please check environment variables: AMAZON_BASE_URI_NA, AMAZON_BASE_URI_EU, or AMAZON_BASE_URI_FE'
      });
    }
    
    // Get marketplace ID from config
    let marketplaceId = marketplaceIds?.[0] || marketplaceConfig[testCountry];
    if (!marketplaceId) {
      // Try uppercase country
      const upperCountry = testCountry.toUpperCase();
      marketplaceId = marketplaceConfig[upperCountry];
      
      if (!marketplaceId) {
        return res.status(400).json({
          success: false,
          error: `Marketplace ID not found for country: ${testCountry}`,
          availableCountries: Object.keys(marketplaceConfig),
          suggestion: 'Please provide a valid country code or marketplaceIds array in the request body.'
        });
      }
    }
    
    // Ensure marketplaceIds is an array
    const marketplaceIdsArray = Array.isArray(marketplaceIds) ? marketplaceIds : [marketplaceId];
    
    console.log('🧪 Testing FBA Inventory Planning Data API:', {
      userId: testUserId,
      country: testCountry,
      region: testRegion,
      marketplaceIds: marketplaceIdsArray,
      baseUri: Base_URI,
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
      )(spApiToken, marketplaceIdsArray, testUserId, Base_URI, testCountry, testRegion);
    } else {
      // Call directly without TokenManager (no automatic refresh)
      console.log('⚠️ Calling without TokenManager - no refresh token available');
      result = await GET_FBA_INVENTORY_PLANNING_DATA(
        spApiToken,
        marketplaceIdsArray,
        testUserId,
        Base_URI,
        testCountry,
        testRegion
      );
    }
    
    return res.status(200).json({
      success: true,
      message: 'FBA Inventory Planning Data retrieved successfully',
      data: result,
      metadata: {
        userId: testUserId,
        country: testCountry,
        region: testRegion,
        marketplaceIds: marketplaceIdsArray,
        baseUri: Base_URI,
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
        statusCode: status,
        suggestion: status === 401 ? 
          'Token may be expired or invalid. If you set fetchTokenFromDB to true, the refresh token itself may be invalid. Please reconnect your Amazon Seller Central account.' : 
          undefined
      });
    }
    
    // Handle token generation errors
    if (error.message && (
      error.message.includes('token refresh failed') ||
      error.message.includes('refresh token') ||
      error.message.includes('invalid_client') ||
      error.message.includes('Invalid token')
    )) {
      return res.status(401).json({
        success: false,
        error: 'Token Refresh Error',
        message: error.message,
        suggestion: 'The refresh token may be invalid or expired. Please reconnect your Amazon Seller Central account through the application.'
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

module.exports = { testReport, getTotalSales, 
   getReviewData, testAmazonAds, testPPCSpendsSalesUnitsSold,
   testGetCampaigns,testGetAdGroups,
   testGetKeywords,testGetPPCSpendsBySKU,testListFinancialEvents,testGetBrand,testSendEmailOnRegistered,testKeywordDataIntegration,testLedgerSummaryReport,testGetProductWiseFBAData,testCalculateBackendLostInventory,testGetBackendLostInventory,testAllReimbursementAPIs,getAllReimbursementData,testGetWastedSpendKeywords,testSearchKeywords,testFbaInventoryPlanningData
   }