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
                default:""
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
                default:""
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
                default:""
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
                default:""
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
                default:""
            }

    },
   responseUnder24HoursCount:{
    type:String,
    default:""
   },
   // Buyer messages left unanswered past 24 hours (noResponseForContactsOlderThan24Hours).
   // null when the report does not carry the field: no task is raised on a guess.
   noResponseOver24HoursCount:{
    type:Number,
    default:null
   },
   // When the negative-feedback count last went up against the previous report,
   // carried forward between reports (tasks-logics.xlsx: "new 1 or 2 star feedback
   // since the last run"). Compared is false when there was no previous report to
   // compare with, and the check then falls back to "any negative feedback".
   negativeFeedbacksRoseAt:{
    type:Date,
    default:null
   },
   negativeFeedbacksCompared:{
    type:Boolean,
    default:false
   },

  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

// Compound index for efficient queries by User, country, region and sorted by createdAt
GET_V1_SELLER_PERFORMANCE_REPORT_Schema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

// Create the model
const Seller = mongoose.model("GET_V1_SELLER_PERFORMANCE_REPORT", GET_V1_SELLER_PERFORMANCE_REPORT_Schema);

module.exports = Seller;
