import axios from "axios";
import { getRankings} from "../helpers/Rankingsj";
import { checkNumberOfImages, checkIfVideoExists, checkStarRating} from "../helpers/Conversion";


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
            // 9 ranking checks (5 title, 2 bullet point, 2 description - special
            // characters are a title-only rule) + 3 conversion checks
            const totalPossibleErrors=12
            
            // Safe null checks for arrays
            const productPhotos = data["product_photos"] || [];
            // Same reading as the server ingest (NumberOfProductReviews.js): a video
            // is an entry with a video_url. Passing the raw objects counted any
            // entry, even one without a URL. A missing list is no data, not "no video".
            const productVideos = Array.isArray(data["product_videos"])
                ? data["product_videos"].map(v => v?.video_url).filter(Boolean)
                : undefined;
            const productNumRatings = data["product_num_ratings"] || 0;
            const productStarRating = data["product_star_rating"] || 0;

            
            
            const imageResult=checkNumberOfImages(productPhotos);
            const videoResult=checkIfVideoExists(productVideos);
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
                starRatting: productStarRating,
                ReviewsCount: productNumRatings,
                unitsSold: salesVolume || "N/A",
                orderAmount: orderAmount || 0,
                image: data["product_photo"] || "",
                category: data["category"]?.["name"] || "N/A",
                score,
                rankingResult,
                imageResult,
                videoResult,
                starRatingResult,
                rankingErrors: rankingResult.TotalErrors || 0,
                conversionErrors: conversionErrors,
                actualImageCount: productPhotos.length,
                actualVideoCount: productVideos?.length || 0,
            }
        }
      } catch (error) {
        console.log("Error: ",error)
        return false;
      }

}

export { AnalyseProduct };