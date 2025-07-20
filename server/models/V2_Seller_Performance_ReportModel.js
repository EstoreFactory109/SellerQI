const mongoose = require("mongoose");


// Define the schema
const GET_V2_SELLER_PERFORMANCE_REPORT_Schema = new mongoose.Schema(
  {
    User:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        required:false,
        default: null
    },
    region:{
        type:String,
        required:false,
        default: ""
    },
    country:{
        type:String,
        required:false,
        default: ""
    },
    ahrScore:{
        type:Number,
        required:false,
        default: 0
    },
    accountStatuses:{
        type:String,
        required:false,
        default: ""
    },
    listingPolicyViolations:{
        type:String,
        required:false,
        default: ""
    },
    validTrackingRateStatus:{
       type:String,
       required:false,
       default: ""
   },
   orderWithDefectsStatus:{
    type:String,
    required:false,
    default: ""
   },
   lateShipmentRateStatus:{
    type:String,
    required:false,
    default: ""
   },
   CancellationRate:{
    type:String,
    required:false,
    default: ""
   }
  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

// **🛡️ Hash Refresh Token Before Storing**

// Create the model
const Seller = mongoose.model("GET_V2_SELLER_PERFORMANCE_REPORT", GET_V2_SELLER_PERFORMANCE_REPORT_Schema);

module.exports = Seller;
