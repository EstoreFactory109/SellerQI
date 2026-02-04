/**
 * Alert.js
 *
 * Single MongoDB model for all alert types using Mongoose discriminators.
 * Collection: alerts. Types: product_content_change, buybox_missing, negative_reviews, aplus_missing, sales_drop, conversion_rates.
 */

const mongoose = require('mongoose');

const ALERT_STATUS = ['active', 'acknowledged', 'resolved'];

// ----- Base schema (common fields) -----
const alertBaseSchema = new mongoose.Schema(
  {
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    region: {
      type: String,
      required: true,
      index: true,
    },
    country: {
      type: String,
      required: true,
      index: true,
    },
    message: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      enum: ALERT_STATUS,
      default: 'active',
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    viewed: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    discriminatorKey: 'alertType',
    collection: 'alerts',
  }
);

alertBaseSchema.index({ User: 1, region: 1, country: 1, status: 1 });
alertBaseSchema.index({ User: 1, 'products.asin': 1, createdAt: -1 });

const Alert = mongoose.model('Alert', alertBaseSchema);

// ----- Product content change (products: asin, sku, title, changeTypes[], message) -----
const CHANGE_TYPES = ['title', 'description', 'bullet_points', 'images'];
const productContentItemSchema = new mongoose.Schema(
  {
    asin: { type: String, required: true },
    sku: { type: String, required: false },
    title: { type: String, required: false },
    changeTypes: { type: [String], enum: CHANGE_TYPES, required: true, default: [] },
    message: { type: String, required: false },
  },
  { _id: false }
);

const ProductContentChangeAlert = Alert.discriminator(
  'ProductContentChange',
  new mongoose.Schema(
    {
      products: {
        type: [productContentItemSchema],
        required: true,
        default: [],
        validate: {
          validator: (v) => Array.isArray(v) && v.length > 0,
          message: 'At least one product (ASIN) is required',
        },
      },
    },
    { _id: false }
  )
);

// ----- Buy box missing (products: asin, sku, title, message) -----
const buyBoxProductItemSchema = new mongoose.Schema(
  {
    asin: { type: String, required: true },
    sku: { type: String, required: false },
    title: { type: String, required: false },
    message: { type: String, required: false },
  },
  { _id: false }
);

const BuyBoxMissingAlert = Alert.discriminator(
  'BuyBoxMissing',
  new mongoose.Schema(
    {
      products: {
        type: [buyBoxProductItemSchema],
        required: true,
        default: [],
        validate: {
          validator: (v) => Array.isArray(v) && v.length > 0,
          message: 'At least one product (ASIN) is required',
        },
      },
    },
    { _id: false }
  )
);

// ----- Negative reviews (products: asin, sku, title, rating, reviewCount, message) -----
const negativeReviewProductItemSchema = new mongoose.Schema(
  {
    asin: { type: String, required: true },
    sku: { type: String, required: false },
    title: { type: String, required: false },
    rating: { type: Number, required: false },
    reviewCount: { type: Number, required: false },
    message: { type: String, required: false },
  },
  { _id: false }
);

const NegetiveReviewsAlert = Alert.discriminator(
  'NegativeReviews',
  new mongoose.Schema(
    {
      products: {
        type: [negativeReviewProductItemSchema],
        required: true,
        default: [],
        validate: {
          validator: (v) => Array.isArray(v) && v.length > 0,
          message: 'At least one product (ASIN) is required',
        },
      },
    },
    { _id: false }
  )
);

// ----- A+ missing (products: asin, sku, title, message) -----
const aplusMissingProductItemSchema = new mongoose.Schema(
  {
    asin: { type: String, required: true },
    sku: { type: String, required: false },
    title: { type: String, required: false },
    message: { type: String, required: false },
  },
  { _id: false }
);

const APlusMissingAlert = Alert.discriminator(
  'APlusMissing',
  new mongoose.Schema(
    {
      products: {
        type: [aplusMissingProductItemSchema],
        required: true,
        default: [],
        validate: {
          validator: (v) => Array.isArray(v) && v.length > 0,
          message: 'At least one product (ASIN) is required',
        },
      },
    },
    { _id: false }
  )
);

// ----- Sales drop (dateRange, marketplace, drops[]) -----
const salesDropItemSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    previousDate: { type: String, required: true },
    unitsOrderedDropPct: { type: Number, required: false },
    revenueDropPct: { type: Number, required: false },
    previousUnits: { type: Number, required: true },
    currentUnits: { type: Number, required: true },
    previousRevenue: { type: Number, required: true },
    currentRevenue: { type: Number, required: true },
    currencyCode: { type: String, required: false, default: 'USD' },
    flaggedByUnits: { type: Boolean, required: false },
    flaggedByRevenue: { type: Boolean, required: false },
  },
  { _id: false }
);

const SalesDropAlert = Alert.discriminator(
  'SalesDrop',
  new mongoose.Schema(
    {
      dateRange: {
        startDate: { type: String, required: true },
        endDate: { type: String, required: true },
      },
      marketplace: { type: String, required: true },
      drops: {
        type: [salesDropItemSchema],
        required: true,
        default: [],
        validate: {
          validator: (v) => Array.isArray(v) && v.length > 0,
          message: 'At least one drop is required',
        },
      },
    },
    { _id: false }
  )
);

// ----- Conversion rates (dateRange, marketplace, conversionRates[]) -----
const conversionRateDaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    sessions: { type: Number, required: true, default: 0 },
    conversionRate: { type: Number, required: true, default: 0 },
    pageViews: { type: Number, required: false },
    unitsOrdered: { type: Number, required: false },
  },
  { _id: false }
);

const ConversionRatesAlert = Alert.discriminator(
  'ConversionRates',
  new mongoose.Schema(
    {
      dateRange: {
        startDate: { type: String, required: true },
        endDate: { type: String, required: true },
      },
      marketplace: { type: String, required: true },
      conversionRates: {
        type: [conversionRateDaySchema],
        required: true,
        default: [],
      },
    },
    { _id: false }
  )
);

// ----- Low inventory / out of stock (products: asin, sku, available, recommendedReplenishmentQty, alert, message) -----
const lowInventoryProductItemSchema = new mongoose.Schema(
  {
    asin: { type: String, required: true },
    sku: { type: String, required: false },
    available: { type: String, required: false },
    recommendedReplenishmentQty: { type: String, required: false },
    alert: { type: String, required: false },
    message: { type: String, required: false },
  },
  { _id: false }
);

const LowInventoryAlert = Alert.discriminator(
  'LowInventory',
  new mongoose.Schema(
    {
      products: {
        type: [lowInventoryProductItemSchema],
        required: true,
        default: [],
        validate: {
          validator: (v) => Array.isArray(v) && v.length > 0,
          message: 'At least one product (ASIN) is required',
        },
      },
    },
    { _id: false }
  )
);

// ----- Stranded inventory (products: asin, status_primary, stranded_reason, message) -----
const strandedInventoryProductItemSchema = new mongoose.Schema(
  {
    asin: { type: String, required: true },
    status_primary: { type: String, required: false },
    stranded_reason: { type: String, required: false },
    message: { type: String, required: false },
  },
  { _id: false }
);

const StrandedInventoryAlert = Alert.discriminator(
  'StrandedInventory',
  new mongoose.Schema(
    {
      products: {
        type: [strandedInventoryProductItemSchema],
        required: true,
        default: [],
        validate: {
          validator: (v) => Array.isArray(v) && v.length > 0,
          message: 'At least one product (ASIN) is required',
        },
      },
    },
    { _id: false }
  )
);

// ----- Inbound shipment issues (products: asin, issueReportedDate, shipmentCreationDate, problemType, message) -----
const inboundShipmentProductItemSchema = new mongoose.Schema(
  {
    asin: { type: String, required: true },
    issueReportedDate: { type: String, required: false },
    shipmentCreationDate: { type: String, required: false },
    problemType: { type: String, required: false },
    message: { type: String, required: false },
  },
  { _id: false }
);

const InboundShipmentAlert = Alert.discriminator(
  'InboundShipment',
  new mongoose.Schema(
    {
      products: {
        type: [inboundShipmentProductItemSchema],
        required: true,
        default: [],
        validate: {
          validator: (v) => Array.isArray(v) && v.length > 0,
          message: 'At least one product (ASIN) is required',
        },
      },
    },
    { _id: false }
  )
);

module.exports = {
  Alert,
  ProductContentChangeAlert,
  BuyBoxMissingAlert,
  NegetiveReviewsAlert,
  APlusMissingAlert,
  SalesDropAlert,
  ConversionRatesAlert,
  LowInventoryAlert,
  StrandedInventoryAlert,
  InboundShipmentAlert,
};
