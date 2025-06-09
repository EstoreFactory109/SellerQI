const checkNumberOfImages=(imageArr)=>{
    if(imageArr.length<7){
        return {
            status:"Error",
            Message:"Your product listing includes fewer than 7 images. Having fewer images may limit potential buyers' ability to fully evaluate the product, which can negatively impact conversion rates.",
            HowToSolve:"Increase the number of images to the recommended total of 7 or more, ensuring that these cover all angles and important features of your product. Include high-quality images that showcase the product in use, any important details, variations, and packaging. This visual enhancement will help improve customer engagement and confidence in making a purchase.",
            MainImage:imageArr[0]
        }
    }else{
        return {
            status:"Success",
            Message:"Great job! Your product listing features the recommended number of images or more, providing potential buyers with a comprehensive visual understanding of the product.",
            HowToSolve:"",
            MainImage:imageArr[0]
        }
    }
}


const checkIfVideoExists=(video)=>{
    if(video.length===0){
        return {
            status:"Error",
            Message:"Your product listing does not include a video. Missing a video may reduce the opportunity to fully engage potential buyers and demonstrate the product's features effectively, potentially impacting conversion rates.",
            HowToSolve:"Increase the number of images to the recommended total of 7 or more, ensuring that these cover all angles and important features of your product. Include high-quality images that showcase the product in use, any important details, variations, and packaging. This visual enhancement will help improve customer engagement and confidence in making a purchase."
        }
    }else{
        return {
            status:"Success",
            Message:"Excellent! Including a video in your product listing enhances its attractiveness and provides a dynamic way to communicate your product's value to customers.",
            HowToSolve:""
        }
    }
}

const checkNumberOfProductReviews=(product_num_ratings)=>{
    if(Number(product_num_ratings)<50){
        return {
            status:"Error",
            Message:"Your product listing has fewer than 50 reviews. A low number of reviews may affect buyer confidence and product credibility, potentially impacting sales.",
            HowToSolve:"Encourage satisfied customers to leave reviews by following up after purchases with email reminders or using Amazon's 'Request a Review' feature. Ensure your product meets customer expectations to naturally increase positive feedback. Consider participating in Amazon's Vine program if eligible, to get more reviews quickly."
        }
    }else{
        return {
            status:"Success",
            Message:"Excellent! Your product listing has 50 or more reviews, which helps build credibility and trust with potential buyers, positively influencing their purchasing decisions.",
            HowToSolve:""
        }
    }
}

const checkStarRating=(product_star_ratings)=>{
    if(Number(product_star_ratings)<4.3){
        return {
            status:"Error",
            Message:"Your product rating is below 4.3 stars. A lower rating can deter potential buyers and negatively impact your product's visibility and sales on Amazon.",
            HowToSolve:"Investigate the causes of lower ratings by reviewing customer feedback. Address any recurring issues related to product quality, packaging, or discrepancies in the listing description. Enhance the product experience and actively engage with customers to resolve their concerns. Consider making improvements to the product based on feedback and encourage satisfied customers to leave positive reviews."
        }
    }else{
        return {
            status:"Success",
            Message:"Great job! Your product maintains a rating of 4.3 stars or higher, indicating high customer satisfaction and contributing positively to attracting more buyers.",
            HowToSolve:""
        }
    }
}

export {checkNumberOfImages,checkIfVideoExists,checkNumberOfProductReviews,checkStarRating}