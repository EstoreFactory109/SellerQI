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

// Compound index for efficient queries by User, country, region and sorted by createdAt
strandedInventoryUIDataSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model("strandedInventoryUIData", strandedInventoryUIDataSchema);

