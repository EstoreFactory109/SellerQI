const mongoose = require("mongoose");

const productSchema=new mongoose.Schema({
    asin: {
        type: String,
        required: true,
      },
      product_title: {
        type: String,
        required: true,
      },
      about_product: {
        type: [String],
        required: true,
      },
      product_description: {
        type: [String],
        required: true, 
      },
      product_photos:[
        {
          type: String,
          required: true
      }],
      video_url:[{
        type: String,
        required: true
      }],
      product_num_ratings:{
       type:String,
       require:true
      },      product_star_ratings:{
       type:String,
       require:true
      },
      has_brandstory:{
       type:Boolean,
       default:false
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

// Compound index for efficient queries by User, country, region and sorted by createdAt
NumberOfProductReviewsSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model("NumberOfProductReviews", NumberOfProductReviewsSchema);