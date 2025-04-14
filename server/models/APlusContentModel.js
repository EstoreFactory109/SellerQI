const mongoose = require("mongoose");

// Define the schema
const ApiContentDetails= new mongoose.Schema({
    ContentReferenceKey:{
        type:String,
        require:true
    },
    Asins:[{
        type:String,
        require:true
    }],
    status:{
        type:String,
        require:true
    }
})
const APlusContentSchema = new mongoose.Schema(
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
    ApiContentDetails:[ApiContentDetails]
  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

module.exports = mongoose.model("APlusContent", APlusContentSchema);