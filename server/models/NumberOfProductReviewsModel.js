const mongoose = require("mongoose");

const productSchema=new mongoose.Schema({
    asin: {
        type: String
        
      },
      product_title: {
        type: String
        
      },
      about_product: {
        type: [String]
      },
      product_description: {
        type: [String]
      },
      product_photos:[
        {
          type: String
      }],
      video_url:{
        type: String
      },
      product_num_ratings:{
       type:String
      },product_star_ratings:{
       type:String
      }
})
// Define the schema
const NumberOfProductReviewsSchema = new mongoose.Schema(
  {
    User:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        require:true
    },
    region:{
      type:String,
      require:true
  },
  country:{
      type:String,
      require:true
  },
    Products:[productSchema]
  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

module.exports = mongoose.model("NumberOfProductReviews", NumberOfProductReviewsSchema);