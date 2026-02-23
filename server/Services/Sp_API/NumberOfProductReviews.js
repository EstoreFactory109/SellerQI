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
        "x-rapidapi-key": "da4f9c009emsh1155c6b317494b6p13e477jsn370565189fee",
        "x-rapidapi-host": "real-time-amazon-data.p.rapidapi.com"
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
    concurrency: REVIEWS_CONCURRENCY
  });

  if (!asinArray || !country || !userId) {
    return false;
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
      video_url: data.data.product_videos?.map(video => video.video_url) || [],
      product_num_ratings: String(data.data.product_num_ratings || 0),
      product_star_ratings: String(data.data.product_star_rating || "0"),
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
      logger.warn("NumberOfProductReviews: No valid products found");
      return false;
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

    logger.info("Data saved successfully", { totalProductsSaved });
    logger.info("NumberOfProductReviews ended");

    return await NumberOfProductReviews.findById(reviewDocId);
  } catch (error) {
    logger.error("Error saving product reviews to database:", error.message);
    return false;
  }
};

module.exports = { addReviewDataTODatabase };