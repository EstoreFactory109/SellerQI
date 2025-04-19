const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const promiseLimit = require("promise-limit"); // ✅ Concurrency limiter
const logger = require("../../utils/Logger.js");
const User = require("../../models/userModel.js");
const NumberOfProductReviews = require("../../models/NumberOfProductReviewsModel.js");
const puppeteer = require("puppeteer");

// ✅ Setup axios-retry globally
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return (
      axiosRetry.isNetworkError(error) ||
      axiosRetry.isRetryableError(error) ||
      error.response?.status === 429 ||
      error.response?.status >= 500
    );
  }
});

// ✅ Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ Main fetch function
const getNumberOfProductReviews = async (asin, country) => {
  try {


    const amazonDomainsByCountry = {
      US: "https://www.amazon.com",
      CA: "https://www.amazon.ca",
      MX: "https://www.amazon.com.mx",
      BR: "https://www.amazon.com.br",
      GB: "https://www.amazon.co.uk", 
      DE: "https://www.amazon.de",
      FR: "https://www.amazon.fr",
      IT: "https://www.amazon.it",
      ES: "https://www.amazon.es",
      NL: "https://www.amazon.nl",
      SE: "https://www.amazon.se",
      PL: "https://www.amazon.pl",
      BE: "https://www.amazon.com.be",
      AU: "https://www.amazon.com.au",
      IN: "https://www.amazon.in",
      JP: "https://www.amazon.co.jp",
      SG: "https://www.amazon.sg",
      AE: "https://www.amazon.ae",
      SA: "https://www.amazon.sa",
      TR: "https://www.amazon.com.tr",
      EG: "https://www.amazon.eg"
    };

    const url = `${amazonDomainsByCountry[country]}/dp/${asin}`; // replace with your ASIN

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
      const starRating = Number(starRatingContent?.split(" ")[0]);
      const totalRatingsContent = document.querySelector("#acrCustomerReviewText")?.innerText.trim() || null;
      const totalRatings = Number(totalRatingsContent?.split(" ")[0].replace(/,/g, ""))

      const reviewCountElement =
        document.querySelectorAll("#cm-cr-dp-review-list > li").length

      const videoCount = document.querySelector("#videoCount")?.innerText.trim() || ""


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

    return productData;
  } catch (error) {
    console.error("Scraping error:", error);
    return res.status(500).json({ error: error.message });
  }
};

const addReviewDataTODatabase = async (asinArray, country, userId, region) => {
  console.log("Hello")
  console.log("asinArray: ", asinArray);

  if (!asinArray || !country || !userId) {
    logger.warn("❗ Missing required parameters: asin, country, or userId");
    return false;
  }

  const limit = promiseLimit(3); // ✅ Limit concurrency to 3

  try {
    const tasks = asinArray.map((asin, index) =>
      limit(async () => {
        await delay(index * 500); // ✅ Staggered delay (0ms, 200ms, 400ms...)

        const data = await getNumberOfProductReviews(asin, country);
        if (!data) return null;


        return {
          asin: asin,
          product_title: data.title || "",
          about_product: data.about || "",
          product_description: data.description || "",
          product_photos: data.images|| [],
          video_url: data.videoCount ||"",
          product_num_ratings: data.reviewCountElement || "",
          product_star_ratings: data.starRating || "",
        };
      })
    );

    const products = await Promise.all(tasks);
    const filteredProducts = products.filter(product => product !== null);

    if (filteredProducts.length === 0) {
      logger.warn("❗ No valid products found. Skipping database insert.");
      return false;
    }

    const addReview = await NumberOfProductReviews.create({
      User: userId,
      region: region,
      country: country,
      Products: filteredProducts
    });

    if (!addReview) {
      logger.warn("❗ Failed to save review data.");
      return false;
    }

    const getUser = await User.findById(userId);
    if (!getUser) {
      logger.warn("❗ No User found");
      return false;
    }

    getUser.numberOfProductReviews = addReview._id;
    await getUser.save();
    logger.info("✅ Data saved successfully");

    console.log("addReview: ", addReview);

    return addReview;
  } catch (error) {
    logger.error({
      message: "❌ Error saving product reviews to database",
      error: error.message
    });
    return false;
  }
};

module.exports = { addReviewDataTODatabase };
