const generateReport = require('../Services/Finance/GetOrdersAndRevenue.js');
const TotalSales = require('../Services/Sp_API/WeeklySales.js');
const getTemporaryCredentials = require('../utils/GenerateTemporaryCredentials.js');
const getshipment = require('../Services/Sp_API/shipment.js');
const puppeteer = require("puppeteer");
const { generateAccessToken } = require('../Services/AmazonAds/GenerateToken.js');
const { getProfileById } = require('../Services/AmazonAds/GenerateProfileId.js');
const { getKeywordPerformanceReport } = require('../Services/AmazonAds/GetWastedSpendKeywords.js');
const {getCampaign} = require('../Services/AmazonAds/GetCampaigns.js');

const {getAdGroups} = require('../Services/AmazonAds/GetAutoCampaignDetails.js');
const {getNegativeKeywords} = require('../Services/AmazonAds/NegetiveKeywords.js');
const {getSearchKeywords} = require('../Services/AmazonAds/GetSearchKeywords.js');
const {listFinancialEventsMethod} = require('../Services/Test/TestFinance.js');
const {getBrand} = require('../Services/Sp_API/GetBrand.js');

const testReport = async (req, res) => {
    const { accessToken, marketplaceIds } = req.body;
    // console.log(accessToken, marketplaceIds)
    if (!accessToken || !marketplaceIds) {
        return res.status(400).json({ message: "Credentials are missing" })
    }

    const report = await generateReport(accessToken, marketplaceIds, "681b7e41525925e8abb7d3c6", "US","NA","sellingpartnerapi-na.amazon.com");
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
    const result = await getProfileById(accessToken, region);
    return res.status(200).json({
        data: result
    })
}

const testPPCSpendsSalesUnitsSold = async (req, res) => {
    const { accessToken } = req.body;
    const result = await getKeywordPerformanceReport(accessToken, "4009758203350767", "2025-04-02", "2025-04-30", "681b7e41525925e8abb7d3c6", "US", "NA");
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
    const result = await getAdGroups(accessToken,profileId,region,campaignIds);
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
    const { accessToken, region,profileId } = req.body;
   
    const result = await getSearchKeywords(accessToken,profileId,"684b2156d5c2340ff1b7bd2b","US",region);
    return res.status(200).json({
        data: result
    })
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

module.exports = { testReport, getTotalSales, 
  getReviewData, testAmazonAds, testPPCSpendsSalesUnitsSold,
   testGetCampaigns,testGetAdGroups,
   testGetKeywords,testGetPPCSpendsBySKU,testListFinancialEvents,testGetBrand
   }