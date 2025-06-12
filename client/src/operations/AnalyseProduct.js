import axios from "axios";
import { getRankings} from "../helpers/Rankingsj";
import { checkNumberOfImages, checkIfVideoExists, checkNumberOfProductReviews, checkStarRating} from "../helpers/Conversion";


const AnalyseProduct = async (asin,country) => {

    const options = {
        method: "GET",
        url: import.meta.env.VITE_RAPIDAPI_URI,
        params: { asin, country },
        headers: {
          "x-rapidapi-key": import.meta.env.VITE_X_RAPIDAPI_KEY,
          "x-rapidapi-host": import.meta.env.VITE_X_RAPIDAPI_HOST
        }
      };

      console.log("Options: ",options)

      try {
        const response = await axios.request(options);
        console.log("Response: ",response)
        if(response.status === 200 && response.data){
          
            const data=response.data.data;
            const rankingResult=getRankings(data);
            const totalPossibleErrors=13
            
            // Safe null checks for arrays
            const productPhotos = data["product_photos"] || [];
            const productVideos = data["product_videos"] || [];
            const productNumRatings = data["product_num_ratings"] || 0;
            const productStarRating = data["product_star_rating"] || 0;
            
            const imageResult=checkNumberOfImages(productPhotos);
            const videoResult=checkIfVideoExists(productVideos);
            const reviewResult=checkNumberOfProductReviews(productNumRatings);
            const starRatingResult=checkStarRating(productStarRating);
            
            console.log("Ranking Result: ",rankingResult)
           
            let TotalErrors=rankingResult.TotalErrors || 0;

            let conversionErrors=0;

            if(imageResult.status==="Error"){
                TotalErrors++;
                conversionErrors++;
            }
            if(videoResult.status==="Error"){
                TotalErrors++;
                conversionErrors++;
            }
            if(reviewResult.status==="Error"){
                TotalErrors++;
                conversionErrors++;
            }
            if(starRatingResult.status==="Error"){
                TotalErrors++;
                conversionErrors++;
            }
            

            const score=((totalPossibleErrors-TotalErrors)/totalPossibleErrors)*100;
            
            // Safe parsing of sales volume
            const salesVolume = data["sales_volume"] || "";
            const numberOfSales = salesVolume.split(" ")[0] || "0";
            const parsedNumberOfSales = parseInt(numberOfSales.replace(/,/g, ''), 10) || 0;
            
            // Safe parsing of product price
            const productPrice = data["product_price"] || 0;
            const parsedPrice = typeof productPrice === 'string' 
                ? parseFloat(productPrice.replace(/[$,]/g, '')) || 0 
                : parseFloat(productPrice) || 0;
            
            // Calculate order amount safely
            const orderAmount = parsedNumberOfSales * parsedPrice;
            
            return {
                Title: data["product_title"] || "N/A",
                Brand: data["product_details"]?.["Manufacturer"] || data["product_details"]?.["Brand"] || "N/A",
                price: parsedPrice,
                starRatting: productStarRating || "N/A",
                ReviewsCount: productNumRatings || "N/A",
                unitsSold: salesVolume || "N/A",
                orderAmount: orderAmount || 0,
                image: data["product_photo"] || "",
                category: data["category"]?.["name"] || "N/A",
                score,
                rankingResult,
                imageResult,
                videoResult,
                reviewResult,
                starRatingResult,
                rankingErrors: rankingResult.TotalErrors || 0,
                conversionErrors: conversionErrors,
            }
        }
      } catch (error) {
        console.log("Error: ",error)
        return false;
      }

}

export { AnalyseProduct };