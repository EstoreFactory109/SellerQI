const mongoose = require("mongoose");


// Define the schema
const listFinancialEventsSchema = new mongoose.Schema(
  {
    User:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        required:true
    },
    region:{
        type:String,
        required:true
    },
    country:{
        type:String,
        required:true
    },
    Total_Sales:{
        type:String,
        required:true
    },
    Gross_Profit:{
        type:String,
        required:true
    },
    ProductAdsPayment:{
        type:String,
        required:true
    },
    FBA_Fees:{
        type:String,
        required:true
    },
    Amazon_Charges:{
       type:String,
       required:true
   },
   Refunds:{
    type:String,
    required:true
   },
   Storage:{
    type:String,
    required:true
   }
  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

// **🛡️ Hash Refresh Token Before Storing**

// Create the model
const Seller = mongoose.model("ListFinancialEvents", listFinancialEventsSchema);

module.exports = Seller;
