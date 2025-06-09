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
        
        if(response.status === 200 && response.data){
            const data=response.data.data;
            const rankingResult=getRankings(data);
            const totalPossibleErrors=13
            const imageResult=checkNumberOfImages(data["product_photos"]);
            const videoResult=checkIfVideoExists(data["product_videos"]);
            const reviewResult=checkNumberOfProductReviews(data["product_num_ratings"]);
            const starRatingResult=checkStarRating(data["product_star_rating"]);
            
            console.log("Ranking Result: ",rankingResult)
           
            let TotalErrors=rankingResult.TotalErrors;

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
            const numberOfSales=data["sales_volume"]?.split(" ")[0]||"N/A";
            
            return {
                Title:data["product_title"],
                Brand:data["product_details"]["Manufacturer"],
                price:data["product_price"],
                starRatting:data["product_star_rating"],
                ReviewsCount: data["product_num_ratings"],
                unitsSold:data["sales_volume"],
                orderAmount:parseInt(numberOfSales,10)*data["product_price"] || "N/A",
                image:data["product_photo"],
                category:data["category"]["name"],
                score,
                rankingResult,
                imageResult,
                videoResult,
                reviewResult,
                starRatingResult,
                rankingErrors:rankingResult.TotalErrors,
                conversionErrors:conversionErrors,
            }
        }
      } catch (error) {
        console.log("Error: ",error)
        return false;
      }

}

export { AnalyseProduct };