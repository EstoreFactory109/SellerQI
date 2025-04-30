const generateReport = require('../Services/Sp_API/GET_FBA_INVENTORY_PLANNING_DATA.js');
const TotalSales = require('../Services/Sp_API/WeeklySales.js');
const getTemporaryCredentials = require('../utils/GenerateTemporaryCredentials.js');
const getshipment = require('../Services/Sp_API/shipment.js');
const puppeteer = require("puppeteer");
const testReport = async (req, res) => {
    const { accessToken, marketplaceIds } = req.body;
    console.log(accessToken, marketplaceIds)
    if (!accessToken || !marketplaceIds) {
        return res.status(400).json({ message: "Credentials are missing" })
    }

    const report = await generateReport(accessToken, marketplaceIds, "67fab4e78a78bdc26ef2246c", "sellingpartnerapi-na.amazon.com","NA","US");
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










module.exports = { testReport, getTotalSales, getReviewData }