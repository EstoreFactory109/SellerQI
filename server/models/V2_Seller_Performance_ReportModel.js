const mongoose = require("mongoose");


// Define the schema
const GET_V2_SELLER_PERFORMANCE_REPORT_Schema = new mongoose.Schema(
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
    ahrScore:{
        type:Number,
        required:true
    },
    accountStatuses:{
        type:String,
        required:true
    },
    listingPolicyViolations:{
        type:String,
        required:true
    },
    validTrackingRateStatus:{
       type:String,
       required:true
   },
   orderWithDefectsStatus:{
    type:String,
    required:true
   },
   lateShipmentRateStatus:{
    type:String,
    required:true
   },
   CancellationRate:{
    type:String,
    required:true
   }
  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

// **🛡️ Hash Refresh Token Before Storing**

// Create the model
const Seller = mongoose.model("GET_V2_SELLER_PERFORMANCE_REPORT", GET_V2_SELLER_PERFORMANCE_REPORT_Schema);

module.exports = Seller;
