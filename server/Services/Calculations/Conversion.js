// One threshold for every surface: tasks said 7 while the ESF report said 5.
const MIN_PRODUCT_IMAGES = 5;

// A check that had nothing to judge. Never an issue and never a task: downstream
// only acts on status "Error", and the Amazon-ready gate only on "Error" too.
const NO_DATA = "NoData";

const checkNumberOfImages = (imageArr) => {
    // Docs written outside the normal ingest (scripts, backfills) can lack the array;
    // that is missing data, not a listing with no images.
    if (!Array.isArray(imageArr)) {
        return { status: NO_DATA, Message: "Image data is not available for this product yet.", HowToSolve: "", MainImage: undefined };
    }
    if (imageArr.length < MIN_PRODUCT_IMAGES) {
        return {
            status: "Error",
            Message: `Your product listing includes fewer than ${MIN_PRODUCT_IMAGES} images. Having fewer images may limit potential buyers' ability to fully evaluate the product, which can negatively impact conversion rates.`,
            HowToSolve: `Increase the number of images to the recommended total of ${MIN_PRODUCT_IMAGES} or more, ensuring that these cover all angles and important features of your product. Include high-quality images that showcase the product in use, any important details, variations, and packaging. This visual enhancement will help improve customer engagement and confidence in making a purchase.`,
            MainImage: imageArr[0]
        }
    } else {
        return {
            status: "Success",
            Message: "Great job! Your product listing features the recommended number of images or more, providing potential buyers with a comprehensive visual understanding of the product.",
            HowToSolve: "",
            MainImage: imageArr[0]
        }
    }
}


const checkIfVideoExists = (video) => {
    if (!Array.isArray(video)) {
        return { status: NO_DATA, Message: "Video data is not available for this product yet.", HowToSolve: "" };
    }
    if (video.filter(Boolean).length === 0) {
        return {
            status: "Error",
            Message: "Your product listing does not include a video. Missing a video may reduce the opportunity to fully engage potential buyers and demonstrate the product's features effectively, potentially impacting conversion rates.",
            HowToSolve: "Add a high-quality video to your product listing that demonstrates the product in use and highlights its key features and benefits. Ensure the video is informative, professionally made, and concise, providing clear value to viewers. This addition can significantly enhance user engagement and help boost your product's appeal."
        }
    } else {
        return {
            status: "Success",
            Message: "Excellent! Including a video in your product listing enhances its attractiveness and provides a dynamic way to communicate your product’s value to customers.",
            HowToSolve: ""
        }
    }
}

/**
 * @param {string|number|null} product_star_ratings
 * @param {string|number|null} [product_num_ratings]
 *
 * A product with no reviews has no rating. Ingest used to store that as "0", which
 * read as "below 4.3": 33,549 of 44,415 open low-rating tasks in production were for
 * ASINs with zero reviews. "0", a missing value and zero ratings are all no data.
 */
const checkStarRating = (product_star_ratings, product_num_ratings) => {
    const rating = Number(product_star_ratings);
    const hasRatingCount = product_num_ratings !== undefined && product_num_ratings !== null && product_num_ratings !== '';
    const noReviews = hasRatingCount && Number(product_num_ratings) === 0;
    if (product_star_ratings === null || product_star_ratings === undefined || product_star_ratings === ''
        || !Number.isFinite(rating) || rating <= 0 || noReviews) {
        return {
            status: NO_DATA,
            Message: "This product has no customer ratings yet.",
            HowToSolve: ""
        };
    }
    if (rating < 4.3) {
        return {
            status: "Error",
            Message: "Your product rating is below 4.3 stars. A lower rating can deter potential buyers and negatively impact your product's visibility and sales on Amazon.",
            HowToSolve: "Investigate the causes of lower ratings by reviewing customer feedback. Address any recurring issues related to product quality, packaging, or discrepancies in the listing description. Enhance the product experience and actively engage with customers to resolve their concerns. Consider making improvements to the product based on feedback and encourage satisfied customers to leave positive reviews."
        }
    } else {
        return {
            status: "Success",
            Message: "Great job! Your product maintains a rating of 4.3 stars or higher, indicating high customer satisfaction and contributing positively to attracting more buyers.",
            HowToSolve: ""
        }
    }
}


/**
 * What a stored A+ status means. The field is a String in the schema, and the values
 * in production are text written by different ingest generations:
 *   present  APPROVED / PUBLISHED (current), "true" (pre-2026-01 scraper)
 *   missing  NOT_AVAILABLE (current), "false" (pre-2026-01), DRAFT (not live)
 *   unknown  null or anything else: no verdict, no task
 * Comparing against the boolean false (as checkAPlus did) never matched any of them,
 * so no A+ task was ever created and every product counted as having A+.
 * @returns {'present'|'missing'|'unknown'}
 */
const aplusStateOf = (status) => {
    if (status === true) return 'present';
    if (status === false) return 'missing';
    if (typeof status !== 'string') return 'unknown';
    const s = status.trim().toUpperCase();
    if (s === 'APPROVED' || s === 'PUBLISHED' || s === 'TRUE') return 'present';
    if (s === 'NOT_AVAILABLE' || s === 'FALSE' || s === 'DRAFT') return 'missing';
    return 'unknown';
};

const checkAPlus = (asinList) => {
    let result = [];
    (Array.isArray(asinList) ? asinList : []).forEach(product => {
        const state = aplusStateOf(product?.status);
        // No verdict for an unknown status: no task, and description errors stay
        // visible for it (DashboardCalculation hides them only on A+ Success).
        if (state === 'unknown') return;
        if (state === 'missing') {
            result.push({
                asin: product.Asins,
                data: {
                    status: "Error",
                    Message: "Your product listing lacks A+ Content. Not utilizing A+ Content may lead to a missed opportunity for enhanced visual storytelling and detailed product explanations, which could impact customer engagement and conversion rates.",
                    HowToSolve: "Create A+ Content for your product listing to provide a richer buying experience. Include detailed descriptions, high-quality images, comparison charts, and more to effectively showcase the benefits and features of your product. This enhanced content helps in building brand trust and can significantly increase conversion rates. Hire agencies like eStore Factory for creating A+ page. "
                }
            })
        } else {
            result.push({
                asin: product.Asins,
                data: {
                    status: "Success",
                    Message: "Great job! Your product listing includes A+ Content, enhancing the presentation and providing customers with a comprehensive understanding of the product's value and features.",
                    HowToSolve: ""
                }
            })
        }
    })

    return result;
}


const checkProductWithOutBuyBox = (asinList) => {
    let result = [];
    let presentAsin = [];

    asinList.map((elm) => {
        presentAsin.push(elm.asin);
        if (elm.belongsToRequester === true) {
            let obj = {
                asin: elm.asin,
                status: "Success",
                Message: "Excellent! You currently hold the Buy Box for your product. This not only boosts your sales potential but also allows you to run sponsored ads, significantly enhancing your product's visibility and market reach on Amazon.",
                HowToSolve: ""
            };
            result.push(obj);
        } else {
            let obj = {
                asin: elm.asin,
                status: "Error",
                Message: "The Buy Box is not available for your product. Lack of the Buy Box can severely limit your sales, as it directly influences buyer purchasing decisions on Amazon. Additionally, without the Buy Box, you are unable to run sponsored ads for the product, further reducing visibility.",
                HowToSolve: "To gain or regain the Buy Box, ensure your seller account metrics are excellent, including low order defect rates, high customer feedback scores, and on-time shipping. Adjust your pricing strategy to be competitive, ensure consistent inventory availability, and consider enrolling in Amazon Prime. Also, check for and address any hijackers on your listing who may be selling counterfeit or unauthorized versions of your product, as this can affect your Buy Box eligibility. You can report these sellers to Amazon for investigation and potential removal."
            };
            result.push(obj); // <-- this was missing
        }
    });

    return {
        buyboxResult: result,
        presentAsin: presentAsin
    };
};

/**
 * Whether a marketplace's latest scrape can be trusted to say "no Brand Story".
 *
 * Brand Story needs Brand Registry, and nothing in SellerQI stores Brand Registry
 * status. Ingest writes `has_brandstory: data.has_brandstory || false`, so "the
 * scraper did not see one" and "this seller cannot have one" both arrive as false.
 * In production 36 of 76 active marketplaces had no product at all showing a Brand
 * Story, behind 11,543 open missing_brand_story tasks: for those sellers the task
 * is either impossible (no Brand Registry) or a scrape blind spot. One product that
 * does show a Brand Story proves both that the seller can add one and that the
 * scrape sees it, so only then is "missing" on the others a real finding.
 *
 * @param {Array} productsList - numberofproductreviews Products for one marketplace
 * @returns {boolean}
 */
const marketplaceShowsBrandStory = (productsList) =>
    Array.isArray(productsList) && productsList.some(p => p && p.has_brandstory === true);

/**
 * Check if product has Brand Story
 * @param {Array} productsList - Array of products with has_brandstory field from NumberOfProductReviews
 * @returns {Array} Array of results with status and messages; empty when the
 *   marketplace is gated (see marketplaceShowsBrandStory) - no verdict either way.
 */
const checkBrandStory = (productsList) => {
    let result = [];

    if (!marketplaceShowsBrandStory(productsList)) return result;

    productsList.forEach(product => {
        if (!product) return;
        if (product.has_brandstory === false || product.has_brandstory === undefined) {
            result.push({
                asin: product.asin,
                data: {
                    status: "Error",
                    Message: "The product lacks a brand story, making it difficult for customers to connect emotionally, leading to reduced trust, engagement, and sales in a competitive marketplace.",
                    HowToSolve: "Develop a compelling brand story that highlights the product's unique values, mission, and benefits, using engaging content to build trust and differentiate it from competitors."
                }
            });
        } else {
            result.push({
                asin: product.asin,
                data: {
                    status: "Success",
                    Message: "Great job! Your product listing includes a Brand Story, enhancing customer connection and trust in your brand.",
                    HowToSolve: ""
                }
            });
        }
    });

    return result;
};


module.exports = { checkNumberOfImages, checkIfVideoExists, checkStarRating, checkAPlus, checkProductWithOutBuyBox, checkBrandStory, marketplaceShowsBrandStory, aplusStateOf, MIN_PRODUCT_IMAGES, NO_DATA }