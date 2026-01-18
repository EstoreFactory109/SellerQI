const checkNumberOfImages = (imageArr) => {
    if (imageArr.length < 7) {
        return {
            status: "Error",
            Message: "Your product listing includes fewer than 7 images. Having fewer images may limit potential buyers' ability to fully evaluate the product, which can negatively impact conversion rates.",
            HowToSolve: "Increase the number of images to the recommended total of 7 or more, ensuring that these cover all angles and important features of your product. Include high-quality images that showcase the product in use, any important details, variations, and packaging. This visual enhancement will help improve customer engagement and confidence in making a purchase.",
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
    if (video.length === 0) {
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

const checkStarRating = (product_star_ratings) => {
    if (Number(product_star_ratings) < 4.3) {
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


const checkAPlus = (asinList) => {
    let result = [];
    asinList.forEach(product => {
        if (product.status === false) {
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
 * Check if product has Brand Story
 * @param {Array} productsList - Array of products with has_brandstory field from NumberOfProductReviews
 * @returns {Array} Array of results with status and messages
 */
const checkBrandStory = (productsList) => {
    let result = [];
    
    productsList.forEach(product => {
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


module.exports = { checkNumberOfImages, checkIfVideoExists, checkStarRating, checkAPlus, checkProductWithOutBuyBox, checkBrandStory }