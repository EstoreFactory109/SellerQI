const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const promiseLimit = require("promise-limit"); // ✅ Concurrency limiter
const logger = require("../../utils/Logger.js");
const User = require("../../models/userModel.js");
const NumberOfProductReviews = require("../../models/NumberOfProductReviewsModel.js");
const APlusContentModel = require("../../models/APlusContentModel.js");

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
        "x-rapidapi-key": "da4f9c009emsh1155c6b317494b6p13e477jsn370565189fee",
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

const CalculateNumberOfElementsPerRequest=(totalElements)=>{
  let root=Math.floor(Math.sqrt(totalElements));
  let numDiv=0;

  for(let i=root;i>0;i--){
    if(totalElements%i===0){
      numDiv=i;
      break;
    }
  }
  return totalElements/numDiv;
}

const addReviewDataTODatabase = async (asinArray, country, userId,region) => {
          // console.log("asinArray: ", asinArray);
  
  if (!asinArray || !country || !userId) {
    logger.warn("❗ Missing required parameters: asin, country, or userId");
    return false;
  }

  const limitNum=CalculateNumberOfElementsPerRequest(asinArray.length);

  const limit = promiseLimit(limitNum); // ✅ Limit concurrency to 3

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
          aplus:data.data.has_aplus || false
        };
      })
    );

    const products = await Promise.all(tasks);
    const aplusProducts = products
      .filter(product => product !== null) // First filter out null products
      .map(product => ({
        Asins: product.asin, // Single ASIN as string (matches schema)
        status: product.aplus ? 'true' : 'false' // Convert boolean to string to match schema
      }));
    const filteredProducts = products.filter(product => product !== null);

    if (filteredProducts.length === 0) {
      logger.warn("❗ No valid products found. Skipping database insert.");
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
        logger.warn("❗ Failed to save A+ content.");
        return false;
      }

      logger.info("✅ A+ content saved successfully");
      
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

                // console.log("addReview: ", addReview);

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