const mongoose = require("mongoose");

const productSchema=new mongoose.Schema({
    asin: {
        type: String,
        required: true,
      },
      RecommendedReplenishmentQty:{
       type:String,
       require:true
      }
})
// Define the schema
const RestockInventoryRecommendationsSchema = new mongoose.Schema(
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

module.exports = mongoose.model("RestockInventoryRecommendations", RestockInventoryRecommendationsSchema);