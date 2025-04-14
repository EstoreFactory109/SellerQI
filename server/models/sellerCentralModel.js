const mongoose = require("mongoose");

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
  price:{
    type:String,
    required:true
  },
  status:{
    type:String,
    required:true
  }
},{timestamps:true})

const sellerCentral=new mongoose.Schema({
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
})
// Define the schema
const SellerSchema = new mongoose.Schema(
  {
    User:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        require:true
    },
    selling_partner_id: {
      type: String,
      unique: true,
    },
    sellerAccount:[sellerCentral]
    
  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

// **🛡️ Hash Refresh Token Before Storing**

// Create the model
const Seller = mongoose.model("Seller", SellerSchema);

module.exports = Seller;
