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

module.exports = mongoose.model("APlusContent", APlusContentSchema);