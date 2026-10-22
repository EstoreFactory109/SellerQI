const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const promiseLimit = require("promise-limit"); // ✅ Concurrency limiter
const logger = require("../../utils/Logger.js");
const User = require('../../models/user-auth/userModel.js');
const NumberOfProductReviews = require('../../models/seller-performance/NumberOfProductReviewsModel.js');
const APlusContentModel = require('../../models/seller-performance/APlusContentModel.js');

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

// Concurrency: use API limit (e.g. 20 req/s). Stay slightly under to avoid 429s.
const REVIEWS_CONCURRENCY = parseInt(process.env.NUMBER_OF_REVIEWS_CONCURRENCY || '20', 10);

// Request timeout to prevent hanging requests (60 seconds)
const REQUEST_TIMEOUT_MS = 60000;

// Chunk size for processing ASINs to reduce memory usage
const ASIN_CHUNK_SIZE = parseInt(process.env.REVIEWS_CHUNK_SIZE || '100', 10);

// ✅ Main fetch function
const getNumberOfProductReviews = async (asin, country) => {
  try {
    if (!asin || !country) {
      return false;
    }

    if(country === "UK"){
      country = "GB";
    }
    const options = {
      method: "GET",
      url: process.env.NUMBER_OF_REVIEWS_URI,
      params: { asin, country },
      headers: {
        // From the environment only: the key used to be hard-coded here, and a
        // literal fallback would put it back in the repository.
        "x-rapidapi-key": rapidApiKey(),
        "x-rapidapi-host": process.env["X-RAPIDAPI-HOST"] || "real-time-amazon-data.p.rapidapi.com"
      },
      timeout: REQUEST_TIMEOUT_MS
    };

    const response = await axios.request(options);

    if (!response.data) {
      return false;
    }

    return response.data;
  } catch (error) {
    // Handle 404 as "no data available" rather than an error (common for new/delisted ASINs)
    if (error.response?.status === 404) {
      logger.debug(`No review data found for ASIN ${asin} (404 - product may be new or delisted)`);
      return null;
    }
    
    // Only log as error for unexpected failures (not network retries which are handled by axios-retry)
    if (error.response?.status !== 429 && error.response?.status < 500) {
      logger.warn(`Failed to fetch reviews for ASIN ${asin}:`, {
        status: error.response?.status,
        message: error.message
      });
    }
    return null;
  }
};

/**
 * Split array into chunks of specified size
 */
/** The RapidAPI key: X-RAPIDAPI-KEY (the name in .env), or RAPIDAPI_KEY. */
const rapidApiKey = () => process.env["X-RAPIDAPI-KEY"] || process.env.RAPIDAPI_KEY;

function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

const addReviewDataTODatabase = async (asinArray, country, userId, region) => {
  const totalAsins = asinArray?.length || 0;
  const totalChunks = Math.ceil(totalAsins / ASIN_CHUNK_SIZE);
  
  logger.info("NumberOfProductReviews starting", {
    asinCount: totalAsins,
    chunkSize: ASIN_CHUNK_SIZE,
    totalChunks,
    concurrency: REVIEWS_CONCURRENCY,
    userId,
    country,
    region
  });

  if (!asinArray || !Array.isArray(asinArray) || asinArray.length === 0) {
    logger.warn("NumberOfProductReviews: No ASINs provided", { userId, country, region });
    return { success: true, data: null, message: "No ASINs provided", productsProcessed: 0 };
  }

  if (!country || !userId) {
    logger.error("NumberOfProductReviews: Missing required parameters", { userId, country, region });
    return { success: false, error: "Missing required parameters" };
  }

  // Fail before any request: without a key every call is rejected, and a run of
  // empty results would be saved as a snapshot in which no listing has content.
  if (!rapidApiKey()) {
    logger.error("NumberOfProductReviews: X-RAPIDAPI-KEY is not set - listing content (reviews, bullets, images, video, Brand Story) cannot be fetched. Set X-RAPIDAPI-KEY in the server environment.", { userId, country, region });
    return { success: false, error: "X-RAPIDAPI-KEY is not set" };
  }

  const limit = promiseLimit(REVIEWS_CONCURRENCY);

  const fetchOne = async (asin) => {
    const data = await getNumberOfProductReviews(asin, country);
    if (!data || !data.data) return null;
    return {
      asin: asin,
      product_title: data.data.product_title || "",
      about_product: data.data.about_product || [],
      product_description: Array.isArray(data.data.product_description)
        ? data.data.product_description
        : (data.data.product_description ? [data.data.product_description] : []),
      product_photos: data.data.product_photos || [],
      // Entries without a URL are not videos; [undefined] used to count as one.
      video_url: Array.isArray(data.data.product_videos)
        ? data.data.product_videos.map(video => video?.video_url).filter(Boolean)
        : [],
      product_num_ratings: String(data.data.product_num_ratings || 0),
      // No rating (a product with no reviews) is stored as null, not "0": "0" read as
      // a real rating below 4.3 everywhere downstream. checkStarRating treats both as
      // no data, so rows already stored as "0" need no backfill.
      product_star_ratings: data.data.product_star_rating ? String(data.data.product_star_rating) : null,
      aplus: data.data.has_aplus || false,
      has_brandstory: data.data.has_brandstory || false
    };
  };

  try {
    const asinChunks = chunkArray(asinArray, ASIN_CHUNK_SIZE);
    let reviewDocId = null;
    let totalProductsSaved = 0;
    const allAplusProducts = [];

    for (let chunkIndex = 0; chunkIndex < asinChunks.length; chunkIndex++) {
      const chunk = asinChunks[chunkIndex];
      const chunkNumber = chunkIndex + 1;
      
      logger.info(`📦 Processing chunk ${chunkNumber}/${totalChunks}: ${chunk.length} ASINs`);

      const tasks = chunk.map((asin) => limit(() => fetchOne(asin)));
      const chunkProducts = (await Promise.all(tasks)).filter(Boolean);
      
      const validProducts = chunkProducts.filter(product => 
        product !== null && 
        product.asin && 
        product.product_title && 
        product.product_title.trim() !== ''
      );

      if (validProducts.length === 0) {
        logger.info(`Chunk ${chunkNumber}: No valid products, skipping`);
        continue;
      }

      const chunkAplusProducts = validProducts.map(product => ({
        Asins: product.asin,
        status: product.aplus ? 'APPROVED' : 'NOT_AVAILABLE'
      }));
      allAplusProducts.push(...chunkAplusProducts);

      const productsToSave = validProducts.map(({ aplus, ...rest }) => rest);

      if (reviewDocId === null) {
        const addReview = await NumberOfProductReviews.create({
          User: userId,
          region: region,
          country: country,
          Products: productsToSave
        });

        if (!addReview) {
          logger.error(`Chunk ${chunkNumber}: Failed to create review document`);
          return false;
        }

        reviewDocId = addReview._id;
        totalProductsSaved += productsToSave.length;
        logger.info(`Chunk ${chunkNumber}: Created document with ${productsToSave.length} products`);
      } else {
        await NumberOfProductReviews.findByIdAndUpdate(
          reviewDocId,
          { $push: { Products: { $each: productsToSave } } }
        );
        totalProductsSaved += productsToSave.length;
        logger.info(`Chunk ${chunkNumber}: Added ${productsToSave.length} products to document`);
      }
    }

    if (totalProductsSaved === 0) {
      logger.warn("NumberOfProductReviews: No valid products found from RapidAPI", {
        userId,
        country,
        region,
        totalAsinsAttempted: asinArray.length
      });
      // Return success with 0 products - this is not an error, just no data available
      return { success: true, data: null, message: "No valid products found from API", productsProcessed: 0 };
    }

    if (allAplusProducts.length > 0) {
      await APlusContentModel.create({
        User: userId,
        region: region,
        country: country,
        ApiContentDetails: allAplusProducts
      });
    }

    const getUser = await User.findById(userId);
    if (getUser && reviewDocId) {
      getUser.numberOfProductReviews = reviewDocId;
      await getUser.save();
    }

    logger.info("NumberOfProductReviews completed successfully", { 
      totalProductsSaved,
      totalAsinsAttempted: asinArray.length,
      userId,
      country,
      region,
      reviewDocId: reviewDocId?.toString()
    });

    const savedDoc = await NumberOfProductReviews.findById(reviewDocId);
    return { success: true, data: savedDoc, productsProcessed: totalProductsSaved };
  } catch (error) {
    logger.error("Error saving product reviews to database:", {
      error: error.message,
      stack: error.stack,
      userId,
      country,
      region
    });
    return { success: false, error: error.message };
  }
};

module.exports = { addReviewDataTODatabase };