const checkNumberOfImages=(imageArr)=>{
    // Handle null, undefined, or non-array inputs
    if (!imageArr || !Array.isArray(imageArr)) {
        return {
            status:"Error",
            Message:"No images found for this product. Having no images will severely limit potential buyers' ability to evaluate the product.",
            HowToSolve:"Add at least 7 high-quality images that showcase your product from different angles, including close-ups of important features, the product in use, and packaging.",
            MainImage: null
        }
    }

    console.log(imageArr.length)
    
    if(imageArr.length<7){
        return {
            status:"Error",
            Message:"Your product listing includes fewer than 7 images. Having fewer images may limit potential buyers' ability to fully evaluate the product, which can negatively impact conversion rates.",
            HowToSolve:"Increase the number of images to the recommended total of 7 or more, ensuring that these cover all angles and important features of your product. Include high-quality images that showcase the product in use, any important details, variations, and packaging. This visual enhancement will help improve customer engagement and confidence in making a purchase.",
            MainImage:imageArr[0] || null
        }
    }else{
        return {
            status:"Success",
            Message:"Great job! Your product listing features the recommended number of images or more, providing potential buyers with a comprehensive visual understanding of the product.",
            HowToSolve:"",
            MainImage:imageArr[0] || null
        }
    }
}


const checkIfVideoExists=(video)=>{
    // Handle null, undefined, or non-array inputs
    if (!video || !Array.isArray(video)) {
        return {
            status:"Error",
            Message:"Your product listing does not include a video. Missing a video may reduce the opportunity to fully engage potential buyers and demonstrate the product's features effectively, potentially impacting conversion rates.",
            HowToSolve:"Add a product video that demonstrates key features, usage instructions, and benefits. Videos help customers better understand your product and can significantly improve conversion rates."
        }
    }
    
    if(video.length===0){
        return {
            status:"Error",
            Message:"Your product listing does not include a video. Missing a video may reduce the opportunity to fully engage potential buyers and demonstrate the product's features effectively, potentially impacting conversion rates.",
            HowToSolve:"Add a product video that demonstrates key features, usage instructions, and benefits. Videos help customers better understand your product and can significantly improve conversion rates."
        }
    }else{
        return {
            status:"Success",
            Message:"Excellent! Including a video in your product listing enhances its attractiveness and provides a dynamic way to communicate your product's value to customers.",
            HowToSolve:""
        }
    }
}

const checkStarRating=(product_star_ratings)=>{
    // Handle null, undefined, or non-numeric inputs
    const starRating = Number(product_star_ratings) || 0;
    
    if(starRating<4.3){
        return {
            status:"Error",
            Message:`Your product rating is ${starRating} stars. A rating below 4.3 stars can deter potential buyers and negatively impact your product's visibility and sales on Amazon.`,
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

export {checkNumberOfImages,checkIfVideoExists,checkStarRating}