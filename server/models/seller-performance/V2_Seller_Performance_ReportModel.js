const mongoose = require("mongoose");


// Define the schema
const GET_V2_SELLER_PERFORMANCE_REPORT_Schema = new mongoose.Schema(
  {
    User:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        required:false,
        default: null
    },
    region:{
        type:String,
        required:false,
        default: ""
    },
    country:{
        type:String,
        required:false,
        default: ""
    },
    ahrScore:{
        type:Number,
        required:false,
        default: 0
    },
    accountStatuses:{
        type:String,
        required:false,
        default: ""
    },
    listingPolicyViolations:{
        type:String,
        required:false,
        default: ""
    },
    validTrackingRateStatus:{
       type:String,
       required:false,
       default: ""
   },
   orderWithDefectsStatus:{
    type:String,
    required:false,
    default: ""
   },
   lateShipmentRateStatus:{
    type:String,
    required:false,
    default: ""
   },
   CancellationRate:{
    type:String,
    required:false,
    default: ""
   },

   // ── Read from the same report since the fields below were added ──
   // Amazon has always sent these; only the seven statuses above were kept.
   // Numbers default to null, never 0: a snapshot taken before this was parsed
   // has no answer, and "0 chargebacks" would be a finding it cannot back.
   // Rates are stored as percentages (0.24 means 0.24%).
   // Status of the channel that carried the orders (FBA or FBM), unlike
   // orderWithDefectsStatus above, which has always been read from FBA.
   orderDefectRateStatus: { type: String, default: "" },
   orderDefectRatePct: { type: Number, default: null },
   lateShipmentRatePct: { type: Number, default: null },
   cancellationRatePct: { type: Number, default: null },
   validTrackingRatePct: { type: Number, default: null },
   onTimeDeliveryRateStatus: { type: String, default: "" },
   onTimeDeliveryRatePct: { type: Number, default: null },
   // Unit-based OTDR, added by Amazon in August 2025 and US-only.
   unitOnTimeDeliveryRateStatus: { type: String, default: "" },
   unitOnTimeDeliveryRatePct: { type: Number, default: null },
   // ODR components, summed across the FBA and FBM blocks present.
   chargebackCount: { type: Number, default: null },
   chargebackStatus: { type: String, default: "" },
   claimsCount: { type: Number, default: null },
   odrWindowFrom: { type: String, default: "" },
   odrWindowTo: { type: String, default: "" },
   // Shipments counted for Valid Tracking Rate; the gap is missing tracking.
   trackedShipmentCount: { type: Number, default: null },
   validTrackingCount: { type: Number, default: null },
   // Per rate: { status, pct, targetPct, condition, basis }. Targets vary by
   // marketplace (Late Shipment is 4% in the US, 2% in India), and basis 0
   // means there was nothing to measure, whatever the rate says.
   rateDetails: { type: mongoose.Schema.Types.Mixed, default: undefined },
   // IP complaints, customer complaints and the other policy metrics, each a
   // status plus a defect count, keyed by Amazon's own field name.
   policyMetrics: {
    type: [{
      _id: false,
      key: { type: String, default: "" },
      status: { type: String, default: "" },
      count: { type: Number, default: null }
    }],
    default: undefined
   }
  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

// Compound index for efficient queries by User, country, region and sorted by createdAt
GET_V2_SELLER_PERFORMANCE_REPORT_Schema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

// Create the model
const Seller = mongoose.model("GET_V2_SELLER_PERFORMANCE_REPORT", GET_V2_SELLER_PERFORMANCE_REPORT_Schema);

module.exports = Seller;
