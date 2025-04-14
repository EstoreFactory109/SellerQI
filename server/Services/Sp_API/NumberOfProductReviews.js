const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const promiseLimit = require("promise-limit"); // ✅ Concurrency limiter
const logger = require("../../utils/Logger.js");
const User = require("../../models/userModel.js");
const NumberOfProductReviews = require("../../models/NumberOfProductReviewsModel.js");

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
    if (!asin || !country) {
      logger.warn("❗ Missing required parameters: asin or country");
      return false;
    }

    const options = {
      method: "GET",
      url: process.env.NUMBER_OF_REVIEWS_URI,
      params: { asin, country },
      headers: {
        "x-rapidapi-key": "8a167bf2d8msh99c5c3585ebe1e2p17442ajsnfe586db8a533",
        "x-rapidapi-host": "real-time-amazon-data.p.rapidapi.com"
      }
    };

    logger.info({ asin, country }, "🔍 Fetching product reviews...");
    const response = await axios.request(options);

    if (!response.data) {
      logger.warn("❗ No data received from API");
      return false;
    }

    logger.info(
      { asin, country, reviewsCount: response.data?.product_num_ratings },
      "✅ Reviews fetched successfully"
    );

    return response.data;
  } catch (error) {
    logger.error(
      {
        message: error.message,
        stack: error.stack,
        responseData: error.response?.data
      },
      "❌ Error fetching product reviews"
    );
    return null;
  }
};

const addReviewDataTODatabase = async (asinArray, country, userId,region) => {
  console.log("asinArray: ", asinArray);
  
  if (!asinArray || !country || !userId) {
    logger.warn("❗ Missing required parameters: asin, country, or userId");
    return false;
  }

  const limit = promiseLimit(1); // ✅ Limit concurrency to 3

  try {
    const tasks = asinArray.map((asin, index) =>
      limit(async () => {
        await delay(index * 500); // ✅ Staggered delay (0ms, 200ms, 400ms...)

        const data = await getNumberOfProductReviews(asin, country);
        if (!data || !data.data) return null;


        return {
          asin: asin,
          product_title: data.data.product_title || "",
          about_product: data.data.about_product || "",
          product_description: data.data.product_description || "",
          product_photos: data.data.product_photos || [],
          video_url: data.data.product_videos?.map(video => video.video_url) || [],
          product_num_ratings: data.data.product_num_ratings || "",
          product_star_ratings: data.data.product_star_rating || "",
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
      region:region,
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
