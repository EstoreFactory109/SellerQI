const mongoose = require("mongoose");


// Define the schema
const GET_V1_SELLER_PERFORMANCE_REPORT_Schema = new mongoose.Schema(
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
    negativeFeedbacks:{
        startDate:{
                type:String,
                require:true
            },
            endDate:{
                type:String,
                require:true
            },
            count:{
                type:String,
                require:true
            }
    },
    lateShipmentCount:{
        
            startDate:{
                type:String,
                require:true
            },
            endDate:{
                type:String,
                require:true
            },
            count:{
                type:String,
                require:true
            }

    },
    preFulfillmentCancellationCount:{
        
            startDate:{
                type:String,
                require:true
            },
            endDate:{
                type:String,
                require:true
            },
            count:{
                type:String,
                require:true
            }
        
    },
    refundsCount:{
        
            startDate:{
                type:String,
                require:true
            },
            endDate:{
                type:String,
                require:true
            },
            count:{
                type:String,
                require:true
            }
       
    },
    a_z_claims:{
        
            startDate:{
                type:String,
                require:true
            },
            endDate:{
                type:String,
                require:true
            },
            count:{
                type:String,
                require:true
            }

    },
   responseUnder24HoursCount:{
    type:String,
    required:true
   },

  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

// **🛡️ Hash Refresh Token Before Storing**

// Create the model
const Seller = mongoose.model("GET_V1_SELLER_PERFORMANCE_REPORT", GET_V1_SELLER_PERFORMANCE_REPORT_Schema);

module.exports = Seller;
