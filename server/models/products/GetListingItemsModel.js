const mongoose = require("mongoose");

const generic_Keyword=new mongoose.Schema({
    asin:{
      type:String,
      require:true
    },
      value:{
       type:String,
       require:true
      },
      marketplace_id:{
        type:String,
        require:true
      }
})
// Define the schema
const ListingItemsSchema = new mongoose.Schema(
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
    GenericKeyword:[generic_Keyword]
  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

module.exports = mongoose.model("ListingItems", ListingItemsSchema);