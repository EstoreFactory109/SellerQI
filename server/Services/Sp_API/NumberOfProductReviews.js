const puppeteer = require("puppeteer");
const promiseLimit = require("promise-limit");
const logger = require("../../utils/Logger.js");
const User = require("../../models/userModel.js");
const NumberOfProductReviews = require("../../models/NumberOfProductReviewsModel.js");

// 🛠 Helper to split array into groups
function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// 🛠 Delay helper
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 🛠 Retry helper
async function retry(fn, retries = 3, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`Retry ${i + 1}/${retries} failed: ${err.message}`);
      await delay(delayMs);
    }
  }
}

// ✅ Scrape function
const getNumberOfProductReviews = async (asin, country) => {
  const amazonDomainsByCountry = {
    US: "https://www.amazon.com",
    CA: "https://www.amazon.ca",
    MX: "https://www.amazon.com.mx",
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
    EG: "https://www.amazon.eg",
  };

  const url = `${amazonDomainsByCountry[country]}/dp/${asin}`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });

    // Wait for multiple selectors with retry
    await retry(async () => {
      await Promise.all([
        page.waitForSelector("#productTitle", { timeout: 30000 }),
        page.waitForSelector("#feature-bullets li span", { timeout: 30000 }),
        page.waitForSelector("#aplus", { timeout: 30000 }),
        page.waitForSelector("#imgTagWrapperId img", { timeout: 30000 }),
        page.waitForSelector(".a-icon-alt", { timeout: 30000 }),
        page.waitForSelector("#acrCustomerReviewText", { timeout: 30000 }),
        page.waitForSelector("#cm-cr-dp-review-list", { timeout: 30000 }),
      ]);
    }, 3, 5000);

    // Scroll to load lazy content
    await page.evaluate(() => window.scrollBy(0, 1500));
    await delay(2000);

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
      const starRating = starRatingContent ? Number(starRatingContent.split(" ")[0]) : null;
      const totalRatingsContent = document.querySelector("#acrCustomerReviewText")?.innerText.trim() || null;
      const totalRatings = totalRatingsContent ? Number(totalRatingsContent.replace(/,/g, "").match(/\d+/)[0]) : null;
      const reviewCountElement = document.querySelectorAll("#cm-cr-dp-review-list > li").length;
      const videoCount = document.querySelector("#videoCount")?.innerText.trim() || "";

      return {
        title,
        about,
        description,
        images,
        starRating,
        totalRatings,
        reviewCountElement,
        videoCount,
      };
    });

    return productData;
  } catch (err) {
    console.error("Scraping error:", err);
    return null;
  } finally {
    await browser.close();
  }
};

// ✅ Main batch function
const addReviewDataToDatabase = async (asinArray, country, userId, region) => {
  if (!asinArray || !country || !userId) {
    logger.warn("❗ Missing required parameters: asinArray, country, or userId");
    return false;
  }

  const groupSize = 5;
  const asinGroups = chunkArray(asinArray, groupSize);

  try {
    let allProducts = [];

    for (const [groupIndex, group] of asinGroups.entries()) {
      console.log(`🚀 Processing group ${groupIndex + 1}/${asinGroups.length}`);

      const tasks = group.map(async (asin) => {
        return retry(async () => {
          const data = await getNumberOfProductReviews(asin, country);
          console.log(`✅ Success: ASIN ${asin}`);
          return {
            asin: asin,
            product_title: data?.title || "",
            about_product: data?.about || "",
            product_description: data?.description || "",
            product_photos: data?.images || [],
            video_url: data?.videoCount || "",
            product_num_ratings: data?.reviewCountElement || "",
            product_star_ratings: data?.starRating || "",
          };
        }, 3, 2000);
      });

      const groupResults = await Promise.all(tasks);
      allProducts.push(...groupResults);

      console.log(`✅ Group ${groupIndex + 1} completed`);
    }

    const filteredProducts = allProducts.filter((product) => product !== null);

    if (filteredProducts.length === 0) {
      logger.warn("❗ No valid products found. Skipping database insert.");
      return false;
    }

    const addReview = await NumberOfProductReviews.create({
      User: userId,
      region: region,
      country: country,
      Products: filteredProducts,
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

    console.log("✅ All products saved to database successfully.");
    return true;
  } catch (err) {
    console.error("❌ Error in batch process:", err);
    return false;
  }
};

// ✅ EXPORT statement
module.exports = {
  getNumberOfProductReviews,
  addReviewDataToDatabase,
};
