const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
      firstName: {
        type: String,
        required: [true, "First name is required"],
        trim: true,
        minlength: [2, "First name must be at least 2 characters"],
        maxlength: [50, "First name must not exceed 50 characters"],
      },
      lastName: {
        type: String,
        required: [true, "Last name is required"],
        trim: true,
        minlength: [2, "Last name must be at least 2 characters"],
        maxlength: [50, "Last name must not exceed 50 characters"],
      },
      phone: {
        type: String,
        required: [true, "Phone number is required"],
      
      },
      whatsapp: {
        type: String,
        required: [true, "WhatsApp number is required"],
     
      },
      email: {
        type: String,
        required: [true, "Email is required"],
        unique: true,
        trim: true,
        lowercase: true,
        match: [
          /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/,
          "Please enter a valid email address",
        ],
      },

      password: {
        type: String,
        required: [true, "Password is required"],
        minlength: [8, "Password must be at least 8 characters long"],
        select: false, // Prevents returning password in queries
      },
      allTermsAndConditionsAgreed: {
        type: Boolean,
        required: [true, "Terms and conditions agreement is required"],
        validate: {
          validator: function(value) {
            return value === true;
          },
          message: "You must agree to the Terms of Use and Privacy Policy"
        }
      },
      profilePic:{
        type: String,
        required: false,
        default:""
      },
      accessType: {
        type: String,
        required: [true, "Access type is required"],
        enum: ["user", "superAdmin", "enterpriseAdmin"],
        default: "user"
      },
      packageType:{
        type:String,
        required:true,
        enum: ["LITE", "PRO", "AGENCY"],
        default:"LITE"
      },
      subscriptionStatus: {
        type: String,
        enum: ["active", "inactive", "cancelled", "past_due"],
        default: "active"
      },
      isInTrialPeriod: {
        type: Boolean,
        default: false
      },
      trialEndsDate: {
        type: Date,
        required: false
      },
      adminId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'User',
        require:false
      },
      sellerCentral:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'Seller',
        require:false
      },
      OTP: {
        type: String,
        required: false,
      },
      isVerified: {
        type: Boolean,
        default: false,
      },
      resetPasswordCode: {
        type: String,
        required: false,
      },
      listFinancialEvents: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ListFinancialEvents",
        required: false,
      },
      numberOfProductReviews: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "NumberOfProductReviews",
        required: false,
      },
      restockInventoryRecommendations: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RestockInventoryRecommendations",
        required: false,
      },
      GET_FBA_INVENTORY_PLANNING_DATA: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "GET_FBA_INVENTORY_PLANNING_DATA",
        required: false,
      },
      GET_V2_SELLER_PERFORMANCE_REPORT: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "GET_V2_SELLER_PERFORMANCE_REPORT",
        required: false,
      },
      APlusContent:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"APlusContent",
        require:true
      },
      connectAccountReminder:{
        type:Number,
        default:2
      },
      analyseAccountSuccess:{
        type:Number,
        default:1
      }
    },
    {
      timestamps: true, // Adds createdAt and updatedAt fields
    }
  );

const User = mongoose.model("User", userSchema);
module.exports = User;
