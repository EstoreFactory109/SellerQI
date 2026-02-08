const mongoose = require("mongoose");

// Define the schema
const ApiContentDetails= new mongoose.Schema({
   
    Asins:{
        type:String,
        required:true
    },
    status:{
        type:String,
        required:true
    }
})
const APlusContentSchema = new mongoose.Schema(
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
    ApiContentDetails:[ApiContentDetails]
  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

// Compound index for efficient queries by User, country, region and sorted by createdAt
APlusContentSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model("APlusContent", APlusContentSchema);