const mongoose = require("mongoose");

const strandedInventoryUIDataForProductSchema=new mongoose.Schema({
    asin: {
        type: String,
        required: true,
      },
      status_primary: {
        type: String,
        required: true,
      },
      stranded_reason: {
        type: String,
        required: true,
      },
})

const strandedInventoryUIDataSchema=new mongoose.Schema({
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
    strandedUIData:[{
        type:[strandedInventoryUIDataForProductSchema],
        require:true
    }]
},{timestamps:true})

module.exports = mongoose.model("strandedInventoryUIData", strandedInventoryUIDataSchema);

