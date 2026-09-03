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
      // True when the stored phone number cannot be trusted and the user should
      // be asked for it. Two cases, told apart by phoneUpdateReason:
      //   'missing'      - Google OAuth signup never collects a phone, so a unique
      //                    placeholder is written to satisfy the required field.
      //   'country_code' - a real number is stored, but without its country code
      //                    (signups from before the country-code fix, and agency
      //                    clients added through the 10-digit-only client form).
      needsPhoneUpdate: {
        type: Boolean,
        default: false,
      },
      phoneUpdateReason: {
        type: String,
        enum: ["missing", "country_code", null],
        default: null,
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
        required: false, // Not required for agency clients
        minlength: [8, "Password must be at least 8 characters long"],
        select: false, // Prevents returning password in queries
      },
      agencyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false, // Set when user is a client of an agency
        default: null,
      },
      isAgencyClient: {
        type: Boolean,
        default: false, // True if user is a client of an agency
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
        // "esfUser" = internal eStore Factory staff. They sign in at the ESF
        // portal only (blocked from /app/login) and manage ESF clients.
        enum: ["user", "superAdmin", "enterpriseAdmin", "esfUser"],
        default: "user"
      },
      // True if this user is a client created through the ESF staff portal.
      // Deliberately separate from isAgencyClient/agencyId so ESF clients never
      // appear in an agency owner's list (their queries match agencyId/adminId).
      isEsfClient: {
        type: Boolean,
        default: false,
      },
      // Which staff member added this client. Audit only — every ESF staff
      // member can see every ESF client.
      esfAddedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false,
        default: null,
      },
      // Role inside the ESF staff portal. Only meaningful when
      // accessType === 'esfUser'. See Services/User/esfRoles.js for the rules.
      // 'owner' is never assignable through the API - it is seeded.
      esfRole: {
        type: String,
        enum: ["owner", "admin", "member"],
        default: "member",
      },
      // Pages this staff member may NOT open inside an ESF client's account.
      // A blocklist, so empty === full access and new pages default to visible.
      // Only meaningful when accessType === 'esfUser'. See Services/User/esfPages.js.
      esfDeniedPages: {
        type: [String],
        default: [],
      },
      // Stamped on ESF portal login; shown in the portal's team member list.
      lastLoginAt: {
        type: Date,
        required: false,
        default: null,
      },
      packageType:{
        type:String,
        required:true,
        enum: ["LITE", "PRO", "AGENCY"],
        default:"PRO"
      },
      agencyName: {
        type: String,
        required: false, // Required only for AGENCY packageType users (validated at controller level)
        trim: true,
        maxlength: [100, "Agency name must not exceed 100 characters"],
      },
      subscriptionStatus: {
        type: String,
        enum: ["active", "inactive", "cancelled", "past_due", "trialing", "incomplete"],
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
      servedTrial: {
        type: Boolean,
        default: false
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
      },
      subscribedToAlerts: {
        type: Boolean,
        default: true
      },
      FirstAnalysisDone: {
        type: Boolean,
        default: false
      },
      reviewRequestAuthStatus: {
        type: Boolean,
        default: false,
        index: true,
      },
      // Set when the six-month inactivity warning email is confirmed sent.
      // Gates the 3-day grace period before auto-cleanup and prevents re-sending.
      sixMonthWarningSentAt: {
        type: Date,
        required: false,
        default: null,
      },
      // Set when this account's operational data was auto-purged (6-month
      // inactivity cleanup) or manually purged by an admin. The User document
      // itself is kept for audit/history — only Seller + other collections
      // are removed. Null means the account has never been purged.
      purgedAt: {
        type: Date,
        required: false,
        default: null,
      },
    },
    {
      timestamps: true, // Adds createdAt and updatedAt fields
    }
  );

// Indexes for better query performance
// Note: email index is automatically created by unique: true in schema
userSchema.index({ packageType: 1 });
userSchema.index({ subscriptionStatus: 1 });
userSchema.index({ isInTrialPeriod: 1 });
userSchema.index({ isVerified: 1 });
userSchema.index({ agencyId: 1 });
userSchema.index({ isAgencyClient: 1 });
// Compound indexes for common queries
userSchema.index({ packageType: 1, subscriptionStatus: 1 });
userSchema.index({ isVerified: 1, packageType: 1 });
userSchema.index({ agencyId: 1, isAgencyClient: 1 });
// ESF portal: list all staff-managed clients, newest first
userSchema.index({ isEsfClient: 1, createdAt: -1 });
// ESF portal: list staff accounts
userSchema.index({ accessType: 1 });
// Used by the six-month inactivity cleanup cron to scan candidates efficiently
userSchema.index({ purgedAt: 1 });
userSchema.index({ sixMonthWarningSentAt: 1 });

const User = mongoose.models.User || mongoose.model("User", userSchema);
module.exports = User;
