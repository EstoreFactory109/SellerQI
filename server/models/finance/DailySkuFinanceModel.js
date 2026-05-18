const mongoose = require('mongoose');

/**
 * DailySkuFinanceModel
 *
 * One document per (User, country, region, sku, date).
 * Pre-aggregated daily bucket containing ALL revenue and expense data
 * for a single SKU on a single day.
 *
 * Architecture:
 *   - First fetch: 30 days backfill (creates 30 × N_SKUs documents)
 *   - Daily fetch: 1 day only (creates N_SKUs documents)
 *   - No duplicates, no run-based aggregation needed
 *   - Date range queries are simple $match on the `date` field
 *
 * Frontend queries:
 *   - "Total expenses for March 15 → April 14":
 *       $match { date: { $gte, $lte } } → $group { $sum each field }
 *   - "ASIN-wise P&L for custom range":
 *       $match { date range } → $group by asin → $sum revenue + expense fields
 *   - "Date-wise chart":
 *       $match { date range } → $group by date → $sum fields
 *   - "Category breakdown":
 *       Each category is its own field → $sum individual fields
 *
 * Replaces:
 *   - ExpenseCategoryAggModel (aggregate from this)
 *   - ExpenseSkuAggModel (aggregate from this)
 *   - ExpenseSkuDateAggModel (this IS the sku+date model)
 *   - ExpenseDateAggModel (aggregate from this)
 *   - ExpenseAmazonFeeCategoryAggModel (aggregate from this)
 *   - ExpenseAmazonFeeDateAggModel (aggregate from this)
 *   - AsinWiseSalesItemModel (aggregate from this)
 *   - AsinWiseSalesDateItemModel (this IS the asin+date sales model)
 */

const DailySkuFinanceSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },

    // ── Identity ──
    date: {
      type: String, // YYYY-MM-DD (postedDate from Finance API)
      required: true,
      index: true,
    },
    sku: {
      type: String,
      required: true,
      index: true,
    },
    asin: {
      type: String,
      default: '',
      index: true,
    },
    productName: {
      type: String,
      default: '',
    },

    // ── Revenue (positive values) ──
    // Source: extractRevenueFromTransactions() → "Product Sales" category
    productSales: { type: Number, default: 0 },
    // Source: "Shipping Revenue" category
    shippingRevenue: { type: Number, default: 0 },
    // Source: "Gift Wrap Revenue" category
    giftWrapRevenue: { type: Number, default: 0 },
    // Source: "FBA Inventory Reimbursement" — Amazon paying back for lost/damaged stock
    fbaInventoryReimbursement: { type: Number, default: 0 },

    // ── Units & Order Count ──
    // Units shipped (from ProductContext.quantityShipped, counted only for "Product Sales")
    units: { type: Number, default: 0 },
    // Unique order IDs seen for this SKU on this date
    orderCount: { type: Number, default: 0 },

    // ── Amazon Fees (negative values) ──
    // Source: parseTransactionsV2024() categories
    fbaFulfillmentFee: { type: Number, default: 0 },
    referralCommission: { type: Number, default: 0 },
    closingFee: { type: Number, default: 0 },
    technologyFee: { type: Number, default: 0 },
    shippingChargeback: { type: Number, default: 0 },
    giftWrapChargeback: { type: Number, default: 0 },
    refundCommission: { type: Number, default: 0 },

    // ── Refund Cost sub-items (from Refund transactions, posted-date based) ──
    // Sellerboard shows these as a separate "Refund cost" group, NOT mixed with forward fees.
    // refundedAmount:       negative (money returned to buyer) — reversed Product Sales from Refund txn
    // refundedReferralFee:  positive (Amazon returns the referral fee) — reversed Commission from Refund txn
    // refundedPromotion:    positive (promo discount reversed) — reversed OurPriceDiscount from Refund txn
    refundedAmount: { type: Number, default: 0 },
    refundedReferralFee: { type: Number, default: 0 },
    refundedPromotion: { type: Number, default: 0 },
    // restockingFee: positive (Amazon charges buyer a restocking fee on return,
    // reducing the refund — money retained by seller)
    restockingFee: { type: Number, default: 0 },

    // ── Promotions / Discounts (negative values) ──
    promotionsDiscount: { type: Number, default: 0 },
    shippingDiscount: { type: Number, default: 0 },
    taxDiscount: { type: Number, default: 0 },
    shippingTaxDiscount: { type: Number, default: 0 },

    // ── Tax (pass-through to government) ──
    salesTaxCollected: { type: Number, default: 0 },
    shippingTaxCollected: { type: Number, default: 0 },
    giftWrapTaxCollected: { type: Number, default: 0 },

    // ── India-specific tax withholding ──
    tdsDeducted: { type: Number, default: 0 },
    tcsCollected: { type: Number, default: 0 },

    // ── US Marketplace Facilitator Tax (pass-through) ──
    // Amazon collects sales tax from buyer (+salesTaxCollected) and remits
    // it to the state (-marketplaceFacilitatorTax). These two cancel out to ~$0.
    // Tracked separately for transparency but does NOT affect seller's profit.
    marketplaceFacilitatorTax: { type: Number, default: 0 },

    // ── Reversed reimbursement (Amazon clawback) ──
    fbaReversedReimbursement: { type: Number, default: 0 },

    // ── FBA Disposal Fee ──
    fbaDisposalFee: { type: Number, default: 0 },

    // ── Catch-all for uncategorized expenses ──
    // Any category not explicitly listed above goes here.
    // The `otherExpensesBreakdown` array stores the detail.
    otherExpenses: { type: Number, default: 0 },
    otherExpensesBreakdown: {
      type: [{ category: String, amount: Number }],
      default: [],
    },

    // ── Pre-computed totals (for fast queries) ──
    totalRevenue: { type: Number, default: 0 },
    totalExpenses: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },

    // ── Estimation tracking ──
    // When Finance API hasn't posted Shipment fees yet, we estimate
    // FBA and referral fees from historical averages. These fields
    // let the frontend show "estimated" indicators and Step 2 can
    // precisely reverse estimates when actual data arrives.
    isEstimated: { type: Boolean, default: false },
    estimatedOrderCount: { type: Number, default: 0 },
    estimatedFba: { type: Number, default: 0 },       // total estimated FBA in this bucket
    estimatedCommission: { type: Number, default: 0 }, // total estimated commission in this bucket
  },
  { timestamps: true }
);

// Primary query: user's data for a date range
DailySkuFinanceSchema.index({ User: 1, country: 1, region: 1, date: 1 });

// ASIN-based queries
DailySkuFinanceSchema.index({ User: 1, country: 1, region: 1, asin: 1, date: 1 });

// One doc per user+country+region+sku+date (unique index also serves SKU+date lookups)
DailySkuFinanceSchema.index(
  { User: 1, country: 1, region: 1, sku: 1, date: 1 },
  { unique: true }
);

// Marketplace-specific queries (for multi-marketplace sellers)
DailySkuFinanceSchema.index({ User: 1, marketplaceId: 1, date: 1 });

module.exports = mongoose.model('DailySkuFinance', DailySkuFinanceSchema);