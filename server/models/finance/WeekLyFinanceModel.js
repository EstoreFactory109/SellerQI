const mongoose = require("mongoose");

const weeklyFinanceDataSchema = new mongoose.Schema({
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
   },
   startDate:{
    type:String,
    required:true
   },
   endDate:{
    type:String,
    required:true
   }
})

const WeeklyFinanceModel = new mongoose.Schema({
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
    weeklyFinanceData:{
        FirstSevenDays:{
            type:weeklyFinanceDataSchema,
            required:true
        },
        SecondSevenDays:{
            type:weeklyFinanceDataSchema,
            required:true
        },
        ThirdSevenDays:{
            type:weeklyFinanceDataSchema,
            required:true
        },
        FourthNineDays:{
            type:weeklyFinanceDataSchema,
            required:true
        }
    }
}, { timestamps: true });

module.exports = mongoose.model("WeeklyFinanceModel",WeeklyFinanceModel);