const mongoose = require('mongoose');
const DailySkuFinance = require('../../models/finance/DailySkuFinanceModel.js');
const DailyOverheadFinance = require('../../models/finance/DailyOverheadFinanceModel.js');
const AsinRelationship = require('../../models/finance/AsinRelationshipModel.js');
const FinanceSyncLog = require('../../models/finance/FinanceSyncLogModel.js');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');

function toObjectId(id) {
  return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
}

function buildBaseMatch(userId, country, region, startDate, endDate) {
  return {
    User: toObjectId(userId),
    country,
    region,
    date: { $gte: startDate, $lte: endDate },
  };
}

const NUMERIC_FIELDS = [
  // Revenue
  'productSales', 'shippingRevenue', 'giftWrapRevenue', 'fbaInventoryReimbursement',
  'units', 'orderCount',
  // Amazon Fees
  'fbaFulfillmentFee', 'referralCommission', 'closingFee', 'technologyFee',
  'shippingChargeback', 'giftWrapChargeback',
  // Refund Cost
  'refundedAmount', 'refundCommission', 'refundedReferralFee', 'refundedPromotion', 'restockingFee',
  // Promotions & Discounts
  'promotionsDiscount', 'shippingDiscount',
  // Tax
  'salesTaxCollected', 'shippingTaxCollected', 'giftWrapTaxCollected',
  'marketplaceFacilitatorTax', 'taxDiscount', 'shippingTaxDiscount',
  'tdsDeducted', 'tcsCollected',
  // Reimbursements & Clawback
  'fbaReversedReimbursement', 'fbaDisposalFee',
  // Catch-all
  'otherExpenses',
  // Pre-computed totals
  'totalRevenue', 'totalExpenses', 'totalTax', 'netAmount',
];

function buildSumGroup(idExpr) {
  const group = { _id: idExpr };
  for (const f of NUMERIC_FIELDS) {
    group[f] = { $sum: `$${f}` };
  }
  return group;
}

function buildRoundProject(extraFields) {
  const project = { _id: 0, ...extraFields };
  for (const f of NUMERIC_FIELDS) {
    project[f] = { $round: [`$${f}`, 2] };
  }
  return project;
}

// ── Step 2: Totals across all SKUs for a date range ──
async function getTotals({ userId, country, region, startDate, endDate }) {
  const match = buildBaseMatch(userId, country, region, startDate, endDate);

  const [totalsResult, otherBreakdownResult, adsTotalResult] = await Promise.all([
    DailySkuFinance.aggregate([
      { $match: match },
      { $group: buildSumGroup(null) },
      { $project: buildRoundProject({}) },
    ]),
    DailySkuFinance.aggregate([
      { $match: match },
      { $unwind: { path: '$otherExpensesBreakdown', preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: '$otherExpensesBreakdown.category',
          amount: { $sum: '$otherExpensesBreakdown.amount' },
        },
      },
      { $sort: { amount: 1 } },
      { $project: { _id: 0, category: '$_id', amount: { $round: ['$amount', 2] } } },
    ]),
    ProductWiseSponsoredAdsItem.aggregate([
      {
        $match: {
          userId: toObjectId(userId),
          country,
          region,
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: '$adType',
          spend: { $sum: { $ifNull: ['$spend', 0] } },
        },
      },
    ]).catch(() => []),
  ]);

  if (!totalsResult.length) {
    const empty = {};
    for (const f of NUMERIC_FIELDS) empty[f] = 0;
    empty.otherExpensesBreakdown = [];
    empty.adsSpend = 0;
    empty.adsSpendSP = 0;
    empty.adsSpendSD = 0;
    return empty;
  }

  const totals = totalsResult[0];
  totals.otherExpensesBreakdown = otherBreakdownResult || [];

  let totalAdsSpend = 0;
  let spSpend = 0;
  let sdSpend = 0;
  for (const row of adsTotalResult) {
    const s = Math.round((row.spend || 0) * 100) / 100;
    if (row._id === 'SP') spSpend = s;
    else if (row._id === 'SD') sdSpend = s;
    totalAdsSpend += s;
  }
  totals.adsSpend = Math.round(totalAdsSpend * 100) / 100;
  totals.adsSpendSP = spSpend;
  totals.adsSpendSD = sdSpend;
  totals.totalExpenses = Math.round(((totals.totalExpenses || 0) + totalAdsSpend) * 100) / 100;

  return totals;
}

// ── Step 3: ASIN-wise P&L ──
async function getAsinWisePL({ userId, country, region, startDate, endDate }) {
  const match = buildBaseMatch(userId, country, region, startDate, endDate);
  const group = buildSumGroup('$asin');
  group.sku = { $first: '$sku' };
  group.productName = { $first: '$productName' };

  const [asinRows, otherBreakdowns, adsRows] = await Promise.all([
    DailySkuFinance.aggregate([
      { $match: match },
      { $sort: { date: -1 } },
      { $group: group },
      { $sort: { productSales: -1 } },
      {
        $project: buildRoundProject({
          asin: '$_id',
          sku: 1,
          productName: { $ifNull: ['$productName', ''] },
        }),
      },
    ]),
    DailySkuFinance.aggregate([
      { $match: match },
      { $unwind: { path: '$otherExpensesBreakdown', preserveNullAndEmptyArrays: false } },
      { $group: { _id: { asin: '$asin', category: '$otherExpensesBreakdown.category' }, amount: { $sum: '$otherExpensesBreakdown.amount' } } },
      { $sort: { amount: 1 } },
      { $group: { _id: '$_id.asin', items: { $push: { category: '$_id.category', amount: { $round: ['$amount', 2] } } } } },
    ]),
    ProductWiseSponsoredAdsItem.aggregateByAsinAndAdType(
      userId, country, region, startDate, endDate
    ).catch(() => []),
  ]);

  // Build PPC spend map: asin → { total, SP, SD }
  const adsSpendMap = new Map();
  for (const row of adsRows) {
    if (!row.asin) continue;
    if (!adsSpendMap.has(row.asin)) {
      adsSpendMap.set(row.asin, { total: 0, SP: 0, SD: 0 });
    }
    const entry = adsSpendMap.get(row.asin);
    const spend = Math.round((row.spend || 0) * 100) / 100;
    const adType = row.adType || 'SP';
    entry[adType] = (entry[adType] || 0) + spend;
    entry.total += spend;
  }

  if (otherBreakdowns.length > 0) {
    const breakdownMap = new Map(otherBreakdowns.map(b => [b._id, b.items]));
    for (const row of asinRows) {
      row.otherExpensesBreakdown = breakdownMap.get(row.asin) || [];
    }
  }

  // Attach PPC spend to each ASIN row and add it to totalExpenses
  for (const row of asinRows) {
    const ads = adsSpendMap.get(row.asin);
    if (ads) {
      row.adsSpend = Math.round(ads.total * 100) / 100;
      row.adsSpendSP = Math.round((ads.SP || 0) * 100) / 100;
      row.adsSpendSD = Math.round((ads.SD || 0) * 100) / 100;
      row.totalExpenses = Math.round(((row.totalExpenses || 0) + ads.total) * 100) / 100;
    } else {
      row.adsSpend = 0;
      row.adsSpendSP = 0;
      row.adsSpendSD = 0;
    }
    adsSpendMap.delete(row.asin);
  }

  // ASINs with PPC spend but no finance data — add as expense-only rows
  for (const [asin, ads] of adsSpendMap) {
    asinRows.push({
      asin,
      sku: '',
      productName: '',
      ...Object.fromEntries(NUMERIC_FIELDS.map(f => [f, 0])),
      adsSpend: Math.round(ads.total * 100) / 100,
      adsSpendSP: Math.round((ads.SP || 0) * 100) / 100,
      adsSpendSD: Math.round((ads.SD || 0) * 100) / 100,
      totalExpenses: Math.round(ads.total * 100) / 100,
      otherExpensesBreakdown: [],
    });
  }

  return asinRows;
}

// ── Step 4: Date-wise totals (for chart) ──
async function getDateWiseTotals({ userId, country, region, startDate, endDate }) {
  const DATE_CHART_FIELDS = [
    'totalRevenue', 'totalExpenses', 'totalTax', 'netAmount',
    'units', 'orderCount', 'productSales',
  ];

  const group = { _id: '$date' };
  const project = { _id: 0, date: '$_id' };
  for (const f of DATE_CHART_FIELDS) {
    group[f] = { $sum: `$${f}` };
    project[f] = { $round: [`$${f}`, 2] };
  }

  return DailySkuFinance.aggregate([
    { $match: buildBaseMatch(userId, country, region, startDate, endDate) },
    { $group: group },
    { $sort: { _id: 1 } },
    { $project: project },
  ]);
}

// ── Step 5: Overhead from DailyOverheadFinance ──
async function getOverhead({ userId, country, region, startDate, endDate }) {
  const match = buildBaseMatch(userId, country, region, startDate, endDate);

  const result = await DailyOverheadFinance.aggregate([
    { $match: match },
    {
      $facet: {
        items: [
          {
            $group: {
              _id: { category: '$category', isRevenue: '$isRevenue' },
              amount: { $sum: '$amount' },
              count: { $sum: '$count' },
            },
          },
          { $sort: { amount: 1 } },
          {
            $project: {
              _id: 0,
              category: '$_id.category',
              isRevenue: '$_id.isRevenue',
              amount: { $round: ['$amount', 2] },
              count: 1,
            },
          },
        ],
        grandTotal: [
          { $group: { _id: null, total: { $sum: '$amount' } } },
          { $project: { _id: 0, total: { $round: ['$total', 2] } } },
        ],
      },
    },
  ]);

  const facet = result[0] || {};
  return {
    items: facet.items || [],
    overheadTotal: facet.grandTotal?.[0]?.total || 0,
  };
}

// ── Step 6: ASIN relationships (parent/child grouping) ──
async function getRelationships({ userId, country, region }) {
  const baseMatch = { User: toObjectId(userId), country, region };

  const result = await AsinRelationship.aggregate([
    { $match: baseMatch },
    {
      $facet: {
        families: [
          { $match: { role: 'parent' } },
          {
            $project: {
              _id: 0,
              parentAsin: '$asin',
              variationTheme: { $ifNull: ['$variationTheme', ''] },
              variationAttributes: { $ifNull: ['$variationAttributes', []] },
              children: { $ifNull: ['$childAsins', []] },
            },
          },
        ],
        standalone: [
          { $match: { role: 'standalone' } },
          { $project: { _id: 0, asin: 1 } },
        ],
        childMappings: [
          { $match: { role: 'child' } },
          { $project: { _id: 0, asin: 1, parentAsin: 1 } },
        ],
      },
    },
  ]);

  const facet = result[0] || {};
  const standalone = (facet.standalone || []).map((d) => d.asin);
  const asinToParent = {};
  for (const d of facet.childMappings || []) {
    asinToParent[d.asin] = d.parentAsin;
  }

  return {
    families: facet.families || [],
    standalone,
    asinToParent,
  };
}

// ── Step 7: Combined dashboard response ──
async function getDashboard({ userId, country, region, startDate, endDate }) {
  const ctx = { userId, country, region, startDate, endDate };

  const [totals, asinWise, dateWise, overheadResult, relationships] =
    await Promise.all([
      getTotals(ctx),
      getAsinWisePL(ctx),
      getDateWiseTotals(ctx),
      getOverhead(ctx),
      getRelationships({ userId, country, region }),
    ]);

  return {
    totals,
    asinWise,
    dateWise,
    overhead: overheadResult.items,
    overheadTotal: overheadResult.overheadTotal,
    relationships,
    metadata: {
      startDate,
      endDate,
      country,
      region,
      uniqueAsins: asinWise.length,
      totalDays: dateWise.length,
    },
  };
}

// ── Step 8: Single ASIN day-by-day detail ──
const ASIN_DETAIL_FIELDS = {
  _id: 0,
  date: 1,
  sku: 1,
  productName: 1,
  // Revenue
  productSales: 1,
  shippingRevenue: 1,
  giftWrapRevenue: 1,
  fbaInventoryReimbursement: 1,
  units: 1,
  orderCount: 1,
  // Amazon Fees
  fbaFulfillmentFee: 1,
  referralCommission: 1,
  closingFee: 1,
  technologyFee: 1,
  shippingChargeback: 1,
  giftWrapChargeback: 1,
  // Refund Cost
  refundedAmount: 1,
  refundCommission: 1,
  refundedReferralFee: 1,
  refundedPromotion: 1,
  restockingFee: 1,
  // Promotions
  promotionsDiscount: 1,
  shippingDiscount: 1,
  // Tax
  salesTaxCollected: 1,
  shippingTaxCollected: 1,
  giftWrapTaxCollected: 1,
  marketplaceFacilitatorTax: 1,
  taxDiscount: 1,
  shippingTaxDiscount: 1,
  tdsDeducted: 1,
  tcsCollected: 1,
  // Reimbursements & Clawback
  fbaReversedReimbursement: 1,
  fbaDisposalFee: 1,
  // Catch-all
  otherExpenses: 1,
  otherExpensesBreakdown: 1,
  // Totals
  totalRevenue: 1,
  totalExpenses: 1,
  totalTax: 1,
  netAmount: 1,
  // Estimation tracking (internal)
  isEstimated: 1,
  estimatedOrderCount: 1,
};

async function getAsinDetail({ userId, country, region, asin, startDate, endDate }) {
  return DailySkuFinance.aggregate([
    {
      $match: {
        User: toObjectId(userId),
        country,
        region,
        asin,
        date: { $gte: startDate, $lte: endDate },
      },
    },
    { $sort: { date: 1 } },
    { $project: ASIN_DETAIL_FIELDS },
  ]);
}

// ── Step 9: Sync status from FinanceSyncLog ──
async function getSyncStatus({ userId, country, region }) {
  const baseMatch = {
    User: toObjectId(userId),
    country,
    region,
    status: 'success',
  };

  const result = await FinanceSyncLog.aggregate([
    { $match: baseMatch },
    {
      $group: {
        _id: null,
        latestDate: { $max: '$date' },
        earliestDate: { $min: '$date' },
        totalSyncedDays: { $sum: 1 },
      },
    },
    { $project: { _id: 0 } },
  ]);

  if (!result.length) {
    return { latestDate: null, earliestDate: null, totalSyncedDays: 0 };
  }

  return result[0];
}

// ── Step 10: Single-ASIN snapshot for Product Details page ──
async function getAsinSnapshot({ userId, country, region, startDate, endDate, asin }) {
  const normalized = String(asin || '').trim().toUpperCase();
  if (!normalized) return null;

  const match = {
    ...buildBaseMatch(userId, country, region, startDate, endDate),
    asin: normalized,
  };

  const group = buildSumGroup(null);
  group.sku = { $first: '$sku' };
  group.productName = { $first: '$productName' };

  const [totalsResult, otherBreakdownResult, adsRows] = await Promise.all([
    DailySkuFinance.aggregate([
      { $match: match },
      { $sort: { date: -1 } },
      { $group: group },
      { $project: buildRoundProject({ sku: 1, productName: { $ifNull: ['$productName', ''] } }) },
    ]),
    DailySkuFinance.aggregate([
      { $match: match },
      { $unwind: { path: '$otherExpensesBreakdown', preserveNullAndEmptyArrays: false } },
      { $group: { _id: '$otherExpensesBreakdown.category', amount: { $sum: '$otherExpensesBreakdown.amount' } } },
      { $sort: { amount: 1 } },
      { $project: { _id: 0, category: '$_id', amount: { $round: ['$amount', 2] } } },
    ]),
    ProductWiseSponsoredAdsItem.aggregateByAsinAndAdType(
      userId, country, region, startDate, endDate
    ).catch(() => []),
  ]);

  const t = totalsResult[0] || null;

  let adsSpend = 0, adsSpendSP = 0, adsSpendSD = 0;
  for (const row of adsRows) {
    if ((row.asin || '').toUpperCase() !== normalized) continue;
    const spend = Math.round((row.spend || 0) * 100) / 100;
    const adType = row.adType || 'SP';
    if (adType === 'SP') adsSpendSP += spend;
    else if (adType === 'SD') adsSpendSD += spend;
    adsSpend += spend;
  }

  const productSales = t ? (t.productSales || 0) : 0;
  const units = t ? (t.units || 0) : 0;

  const amazonFees = t ? (
    Math.abs(t.fbaFulfillmentFee || 0) +
    Math.abs(t.referralCommission || 0) +
    Math.abs(t.closingFee || 0) +
    Math.abs(t.technologyFee || 0) +
    Math.abs(t.shippingChargeback || 0) +
    Math.abs(t.giftWrapChargeback || 0) +
    Math.abs(t.fbaDisposalFee || 0) +
    Math.abs(t.fbaReversedReimbursement || 0)
  ) : 0;

  const refunds = t ? (
    Math.abs(t.refundedAmount || 0) +
    Math.abs(t.refundCommission || 0)
  ) : 0;

  const reimbursements = t ? Math.abs(t.fbaInventoryReimbursement || 0) : 0;

  const promotions = t ? (
    Math.abs(t.promotionsDiscount || 0) +
    Math.abs(t.shippingDiscount || 0)
  ) : 0;

  const totalExpenses = Math.round((amazonFees + refunds + promotions - reimbursements + adsSpend) * 100) / 100;
  const grossProfit = Math.round((productSales - totalExpenses) * 100) / 100;

  const breakdown = [];
  const push = (category, amount) => { const a = Math.round((Number(amount) || 0) * 100) / 100; if (a !== 0) breakdown.push({ category, amount: a }); };

  if (t) {
    push('FBA Fulfillment Fee', t.fbaFulfillmentFee);
    push('Referral Commission', t.referralCommission);
    push('Closing Fee', t.closingFee);
    push('Technology Fee', t.technologyFee);
    push('Shipping Chargeback', t.shippingChargeback);
    push('Gift Wrap Chargeback', t.giftWrapChargeback);
    push('FBA Disposal Fee', t.fbaDisposalFee);
    push('Compensated Clawback', t.fbaReversedReimbursement);
    push('Refunded Amount', t.refundedAmount);
    push('Refund Commission', t.refundCommission);
    push('Refunded Referral Fee', t.refundedReferralFee);
    push('Refunded Promotion', t.refundedPromotion);
    push('Restocking Fee', t.restockingFee);
    push('FBA Inventory Reimbursement', t.fbaInventoryReimbursement);
    push('Promotions Discount', t.promotionsDiscount);
    push('Shipping Discount', t.shippingDiscount);
    for (const item of (otherBreakdownResult || [])) {
      push(item.category, item.amount);
    }
  }
  if (adsSpendSP) push('Sponsored Products (SP)', -adsSpendSP);
  if (adsSpendSD) push('Sponsored Display (SD)', -adsSpendSD);

  breakdown.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  return {
    asin: normalized,
    sku: t?.sku || '',
    productName: t?.productName || '',
    totalSales: productSales,
    unitsSold: units,
    orderCount: t ? (t.orderCount || 0) : 0,
    totalExpenses,
    amazonFees: Math.round(amazonFees * 100) / 100,
    refunds: Math.round(refunds * 100) / 100,
    reimbursements: Math.round(reimbursements * 100) / 100,
    promotions: Math.round(promotions * 100) / 100,
    adsSpend: Math.round(adsSpend * 100) / 100,
    adsSpendSP: Math.round(adsSpendSP * 100) / 100,
    adsSpendSD: Math.round(adsSpendSD * 100) / 100,
    grossProfit,
    breakdown,
    startDate,
    endDate,
    source: 'DailySkuFinance',
  };
}

module.exports = {
  getTotals,
  getAsinWisePL,
  getDateWiseTotals,
  getOverhead,
  getRelationships,
  getDashboard,
  getAsinDetail,
  getSyncStatus,
  getAsinSnapshot,
};