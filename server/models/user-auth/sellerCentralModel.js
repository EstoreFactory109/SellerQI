const mongoose = require("mongoose");
const { v4: uuidv4 } = require('uuid');

const TotatProductsBasedOnDate=new mongoose.Schema({
  NumberOfProducts:{
    type:Number,
    require:true
  }
},{timestamps:true})

const Products=new mongoose.Schema({
  asin: {
    type: String,
    required: true,
  },
  sku:{
    type: String,
    required: true
  },
  itemName:{
    type:String,
    required:true
  },
  price:{
    type:String,
    required:true
  },
  status:{
    type:String,
    required:true
  },
  quantity:{
    type: Number,
    required: false,
    default: 0
  },
  issues:{
    type: [String],
    required: false,
    default: undefined
  },
  // Total issue count for this product (sum of ranking, conversion, inventory errors)
  // Calculated by ProductIssuesService and updated during integration/scheduled jobs
  issueCount:{
    type: Number,
    required: false,
    default: 0
  },
  // Timestamp when issueCount was last calculated
  issueCountUpdatedAt:{
    type: Date,
    required: false
  },
  has_b2b_pricing:{
    type: Boolean,
    required: false,
    default: false
  }
},{timestamps:true})

const sellerCentral=new mongoose.Schema({
  selling_partner_id: {
    type: String,
    unique: true,
    default: uuidv4,
  },
  spiRefreshToken: {
    type: String,
    required: false,
  },
  adsRefreshToken:{
    type: String,
    required: false,  
  },
  ProfileId:{
    type: String,
    required: false,
  },
  countryCode:{
    type:String,
    required:false
  },
  country: {
    type: String,
    required: false,
  },
  region: {
    type: String,
    required: false,
    enum: ["NA", "EU", "FE"], // North America, Europe, Far East
  },
  products:[Products],
  TotatProducts:[TotatProductsBasedOnDate]
}, {timestamps: true})


// Define the schema
const SellerSchema = new mongoose.Schema(
  {
    User:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        require:true
    },
    brand:{
      type:String,
      required:false
    },
    selling_partner_id:{
      type:String,
      required:true,
    },
    sellerAccount:[sellerCentral]
    
  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

// Index for efficient queries by User
SellerSchema.index({ User: 1 });

// Create the model
const Seller = mongoose.model("Seller", SellerSchema);

module.exports = Seller;
