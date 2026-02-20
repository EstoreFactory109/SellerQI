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
      }
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

const addReviewDataTODatabase = async (asinArray, country, userId,region) => {
  logger.info("NumberOfProductReviews starting", {
    asinCount: asinArray?.length,
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
    const tasks = asinArray.map((asin) => limit(() => fetchOne(asin)));
    const products = (await Promise.all(tasks)).filter(Boolean);
    
    // Filter out null products and products with missing required fields
    const validProducts = products.filter(product => 
      product !== null && 
      product.asin && 
      product.product_title && 
      product.product_title.trim() !== ''
    );
    
    const aplusProducts = validProducts
      .map(product => ({
        Asins: product.asin,
        // Use 'APPROVED' for true, 'NOT_AVAILABLE' for false to match expected status values
        status: product.aplus ? 'APPROVED' : 'NOT_AVAILABLE'
      }));
    const filteredProducts = validProducts;

    if (filteredProducts.length === 0) {
      return false;
    }

    if(aplusProducts.length>0){
      const aplusContent= await APlusContentModel.create({
        User: userId,
        region:region,
        country: country,
        ApiContentDetails: aplusProducts
      })

      if(!aplusContent){
        return false;
      }
    }

    const addReview = await NumberOfProductReviews.create({
      User: userId,
      region:region,
      country: country,
      Products: filteredProducts
    });

    if (!addReview) {
      return false;
    }

    const getUser = await User.findById(userId);
    if (!getUser) {
      return false;
    }

    getUser.numberOfProductReviews = addReview._id;
    await getUser.save();

    logger.info("Data saved successfully");
    logger.info("NumberOfProductReviews ended");
    return addReview;
  } catch (error) {
    logger.error("Error saving product reviews to database:", error.message);
    return false;
  }
};

module.exports = { addReviewDataTODatabase };