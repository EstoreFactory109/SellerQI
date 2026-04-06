const mongoose = require('mongoose');

/**
 * One document per (User, country, region, sellerSku) — full FBA Inventory API row snapshot.
 * fulfillableQuantity is also written to Seller.sellerAccount[].products[].quantity for matched SKUs.
 */

const fbaInventoryApiDetailSchema = new mongoose.Schema(
  {
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    country: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    region: {
      type: String,
      required: true,
      enum: ['NA', 'EU', 'FE'],
      index: true,
    },
    marketplaceId: {
      type: String,
      default: '',
    },

    asin: { type: String, default: '' },
    fnSku: { type: String, default: '' },
    sellerSku: { type: String, required: true },
    productName: { type: String, default: '' },
    condition: { type: String, default: '' },
    lastUpdatedTime: { type: String, default: '' },

    totalQuantity: { type: Number, default: 0 },
    fulfillableQuantity: { type: Number, default: 0 },

    inboundWorkingQuantity: { type: Number, default: 0 },
    inboundShippedQuantity: { type: Number, default: 0 },
    inboundReceivingQuantity: { type: Number, default: 0 },

    totalReservedQuantity: { type: Number, default: 0 },
    pendingCustomerOrderQuantity: { type: Number, default: 0 },
    pendingTransshipmentQuantity: { type: Number, default: 0 },
    fcProcessingQuantity: { type: Number, default: 0 },

    totalUnfulfillableQuantity: { type: Number, default: 0 },
    customerDamagedQuantity: { type: Number, default: 0 },
    warehouseDamagedQuantity: { type: Number, default: 0 },
    distributorDamagedQuantity: { type: Number, default: 0 },
    carrierDamagedQuantity: { type: Number, default: 0 },
    defectiveQuantity: { type: Number, default: 0 },
    expiredQuantity: { type: Number, default: 0 },

    totalResearchingQuantity: { type: Number, default: 0 },
    researchingQuantityInShortTerm: { type: Number, default: 0 },
    researchingQuantityInMidTerm: { type: Number, default: 0 },
    researchingQuantityInLongTerm: { type: Number, default: 0 },

    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

fbaInventoryApiDetailSchema.index(
  { User: 1, country: 1, region: 1, sellerSku: 1 },
  { unique: true }
);
fbaInventoryApiDetailSchema.index({ User: 1, country: 1, region: 1, asin: 1 });

module.exports = mongoose.model('FbaInventoryApiDetail', fbaInventoryApiDetailSchema);
