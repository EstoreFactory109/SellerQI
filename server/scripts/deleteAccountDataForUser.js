#!/usr/bin/env node
/**
 * Delete ALL operational data for one seller account (userId + country + region).
 *
 * KEEPS (never deleted):
 *   - User
 *   - Seller document (tokens, ProfileId, selling_partner_id stay intact)
 *
 * ALSO KEEPS (user-wide / billing — not scoped per marketplace):
 *   - Subscription, PaymentLogs, AgencySeller, EmailLogs
 *   - MCP Task / TaskItem (no country on schema)
 *   - QMateChat (User only)
 *   - OrchestrationCronLock (global)
 *
 * Clears on the matching Seller subdocument (not the doc itself):
 *   - products[], TotatProducts[] for that country/region
 *
 * Optional Redis: analyse_data cache key for this account.
 *
 * Usage (from repo root):
 *   Dry run:
 *     node server/scripts/deleteAccountDataForUser.js \
 *       --userId=<id> --country=<code> --region=<NA|EU|FE> --dryRun
 *
 *   Delete:
 *     node server/scripts/deleteAccountDataForUser.js \
 *       --userId=<id> --country=<code> --region=<NA|EU|FE> --confirm
 */

require('dotenv').config();
const mongoose = require('mongoose');

// ── Amazon Ads ──
const PPCMetrics = require('../models/amazon-ads/PPCMetricsModel.js');
const GetDateWisePPCspend = require('../models/amazon-ads/GetDateWisePPCspendModel.js');
const PPCUnitsSold = require('../models/amazon-ads/PPCUnitsSoldModel.js');
const adsKeywordsPerformance = require('../models/amazon-ads/adsKeywordsPerformanceModel.js');
const AdsGroup = require('../models/amazon-ads/adsgroupModel.js');
const Campaign = require('../models/amazon-ads/CampaignModel.js');
const SearchTerms = require('../models/amazon-ads/SearchTermsModel.js');
const Keyword = require('../models/amazon-ads/keywordModel.js');
const KeywordTracking = require('../models/amazon-ads/KeywordTrackingModel.js');
const ProductWiseSponsoredAdsData = require('../models/amazon-ads/ProductWiseSponseredAdsModel.js');
const ProductWiseSponsoredAdsItem = require('../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const NegativeKeywords = require('../models/amazon-ads/NegetiveKeywords.js');
const { KeywordRecommendations, AsinKeywordRecommendations } = require('../models/amazon-ads/KeywordRecommendationsModel.js');

// ── Finance ──
const DailySkuFinance = require('../models/finance/DailySkuFinanceModel.js');
const DailyOverheadFinance = require('../models/finance/DailyOverheadFinanceModel.js');
const AsinRelationship = require('../models/finance/AsinRelationshipModel.js');
const FinanceSyncLog = require('../models/finance/FinanceSyncLogModel.js');
const PendingExpenseOrder = require('../models/finance/PendingExpenseOrderModel.js');
const Cogs = require('../models/finance/CogsModel.js');
const ProductWiseStorageFees = require('../models/finance/ProductWiseStorageFees.js');
const FBAFees = require('../models/finance/FBAFeesModel.js');
const ProductWiseFinancial = require('../models/finance/ProductWiseFinancialModel.js');
const WeekLyFinance = require('../models/finance/WeekLyFinanceModel.js');
const LedgerSummaryView = require('../models/finance/LedgerSummaryViewModel.js');
const LedgerSummaryViewItem = require('../models/finance/LedgerSummaryViewItemModel.js');
const LedgerDetailView = require('../models/finance/LedgerDetailViewModel.js');
const FBAReimbursements = require('../models/finance/FBAReimbursementsModel.js');
const LongTermStorageFees = require('../models/finance/LongTermStorageFeesModel.js');
const ExpenseDateAgg = require('../models/finance/ExpenseDateAggModel.js');
const ExpenseSkuAgg = require('../models/finance/ExpenseSkuAggModel.js');
const ExpenseSkuDateAgg = require('../models/finance/ExpenseSkuDateAggModel.js');
const ExpenseRawRow = require('../models/finance/ExpenseRawRowModel.js');
const ExpenseReportRun = require('../models/finance/ExpenseReportRunModel.js');
const ExpenseCategoryAgg = require('../models/finance/ExpenseCategoryAggModel.js');
const ExpenseAmazonFeeDateAgg = require('../models/finance/ExpenseAmazonFeeDateAggModel.js');
const ExpenseAmazonFeeCategoryAgg = require('../models/finance/ExpenseAmazonFeeCategoryAggModel.js');
const AsinWiseSalesRun = require('../models/finance/AsinWiseSalesRunModel.js');
const AsinWiseSalesItem = require('../models/finance/AsinWiseSalesItemModel.js');
const AsinWiseSalesDateItem = require('../models/finance/AsinWiseSalesDateItemModel.js');
const SalesOrderId = require('../models/finance/SalesorderidModel.js');

// ── Inventory ──
const ProductWiseFBAData = require('../models/inventory/ProductWiseFBADataModel.js');
const ProductWiseFBADataItem = require('../models/inventory/ProductWiseFBADataItemModel.js');
const GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE = require('../models/inventory/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA.js');
const GET_FBA_INVENTORY_PLANNING_DATA = require('../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js');
const GET_STRANDED_INVENTORY_UI_DATA = require('../models/inventory/GET_STRANDED_INVENTORY_UI_DATA_MODEL.js');
const StrandedInventoryUIDataItem = require('../models/inventory/StrandedInventoryUIDataItemModel.js');
const RestockInventoryRecommendations = require('../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
const ShipmentModel = require('../models/inventory/ShipmentModel.js');
const FbaInventoryApiDetail = require('../models/inventory/FbaInventoryApiDetailModel.js');

// ── Products / performance ──
const ListingItemsKeyword = require('../models/products/ListingItemsKeywordModel.js');
const ListingItems = require('../models/products/GetListingItemsModel.js');
const ProductWiseSales = require('../models/products/ProductWiseSalesModel.js');
const OrderAndRevenue = require('../models/products/OrderAndRevenueModel.js');
const V2_Seller_Performance_Report = require('../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const V1_Seller_Performance_Report = require('../models/seller-performance/V1_Seller_Performance_Report_Model.js');
const APlusContent = require('../models/seller-performance/APlusContentModel.js');
const NumberOfProductReviews = require('../models/seller-performance/NumberOfProductReviewsModel.js');

// ── MCP ──
const BuyBoxData = require('../models/MCP/BuyBoxDataModel.js');
const EconomicsMetrics = require('../models/MCP/EconomicsMetricsModel.js');
const SalesOnlyMetrics = require('../models/MCP/SalesOnlyMetricsModel.js');
const AsinWiseSalesForBigAccounts = require('../models/MCP/AsinWiseSalesForBigAccountsModel.js');

// ── Review ──
const ReviewOrder = require('../models/review/ReviewOrderModel.js');
const ReviewOrderItem = require('../models/review/ReviewOrderItemModel.js');

// ── System / dashboard / alerts ──
const DataFetchTracking = require('../models/system/DataFetchTrackingModel.js');
const AccountHistory = require('../models/user-auth/AccountHistory.js');
const IssuesDataChunks = require('../models/system/IssuesDataChunksModel.js');
const IssuesData = require('../models/system/IssuesDataModel.js');
const IssueSummary = require('../models/system/IssueSummaryModel.js');
const JobStatus = require('../models/system/JobStatusModel.js');
const UserAccountLogs = require('../models/system/ErrorLogs.js');
const ListingFixStatus = require('../models/system/ListingFixStatusModel.js');
const DashboardSlice = require('../models/dashboard/DashboardSliceModel.js');
const { Alert } = require('../models/alerts/Alert.js');

const Seller = require('../models/user-auth/sellerCentralModel.js');
const UserUpdateSchedule = require('../models/user-auth/UserUpdateScheduleModel.js');

const DB_URI = process.env.DB_URI;
const DB_NAME = process.env.DB_NAME;
const MONGODB_URI =
  DB_URI && DB_NAME
    ? `${DB_URI}/${DB_NAME}`
    : process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/sellerqi';

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const eq = arg.indexOf('=');
    if (eq > -1) args[arg.slice(2, eq)] = arg.slice(eq + 1);
    else args[arg.slice(2)] = true;
  });
  return args;
}

const normalizeCountry = (c) => String(c || '').trim().toUpperCase();
const normalizeRegion = (r) => String(r || '').trim().toUpperCase();

function normalizeUserId(userId) {
  const raw = String(userId || '').trim();
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
    throw new Error(`Invalid userId: "${userId}"`);
  }
  return raw;
}

function getUserObjectId(userIdStr) {
  return new mongoose.Types.ObjectId(userIdStr);
}

/** userId stored as String and/or ObjectId */
function buildUserIdFilter(userIdStr) {
  const or = [{ userId: userIdStr }];
  or.push({ userId: getUserObjectId(userIdStr) });
  return { $or: or };
}

function buildAccountFilterUserId(userIdStr, country, region) {
  return {
    ...buildUserIdFilter(userIdStr),
    country,
    region,
  };
}

function buildAccountFilterUser(userObjectId, country, region) {
  return {
    User: userObjectId,
    country,
    region,
  };
}

function buildAccountFilterUserid(userObjectId, country, region) {
  return {
    userid: userObjectId,
    country,
    region,
  };
}

/** Collections deleted with { userId, country, region } */
const USER_ID_TARGETS = [
  { label: 'PPCMetrics', model: PPCMetrics },
  { label: 'GetDateWisePPCspend', model: GetDateWisePPCspend },
  { label: 'PPCUnitsSold', model: PPCUnitsSold },
  { label: 'adsKeywordsPerformance', model: adsKeywordsPerformance },
  { label: 'AdsGroup', model: AdsGroup },
  { label: 'Campaign', model: Campaign },
  { label: 'SearchTerms', model: SearchTerms },
  { label: 'Keyword', model: Keyword },
  { label: 'KeywordTracking', model: KeywordTracking },
  { label: 'ProductWiseSponsoredAdsData', model: ProductWiseSponsoredAdsData },
  { label: 'ProductWiseSponsoredAdsItem', model: ProductWiseSponsoredAdsItem },
  { label: 'NegativeKeywords', model: NegativeKeywords },
  { label: 'KeywordRecommendations', model: KeywordRecommendations },
  { label: 'AsinKeywordRecommendations', model: AsinKeywordRecommendations },
  { label: 'ProductWiseFBAData', model: ProductWiseFBAData },
  { label: 'ProductWiseFBADataItem', model: ProductWiseFBADataItem },
  { label: 'GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE', model: GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE },
  { label: 'Cogs', model: Cogs },
  { label: 'ProductWiseStorageFees', model: ProductWiseStorageFees },
  { label: 'FBAFees', model: FBAFees },
  { label: 'IssuesDataChunks', model: IssuesDataChunks },
  { label: 'IssuesData', model: IssuesData },
  { label: 'IssueSummary', model: IssueSummary },
  { label: 'DashboardSlice', model: DashboardSlice },
  { label: 'ListingFixStatus', model: ListingFixStatus },
];

/** Collections deleted with { User, country, region } */
const USER_TARGETS = [
  { label: 'DailySkuFinance', model: DailySkuFinance },
  { label: 'DailyOverheadFinance', model: DailyOverheadFinance },
  { label: 'AsinRelationship', model: AsinRelationship },
  { label: 'FinanceSyncLog', model: FinanceSyncLog },
  { label: 'PendingExpenseOrder', model: PendingExpenseOrder },
  { label: 'ExpenseDateAgg', model: ExpenseDateAgg },
  { label: 'ExpenseSkuAgg', model: ExpenseSkuAgg },
  { label: 'ExpenseSkuDateAgg', model: ExpenseSkuDateAgg },
  { label: 'ExpenseRawRow', model: ExpenseRawRow },
  { label: 'ExpenseReportRun', model: ExpenseReportRun },
  { label: 'ExpenseCategoryAgg', model: ExpenseCategoryAgg },
  { label: 'ExpenseAmazonFeeDateAgg', model: ExpenseAmazonFeeDateAgg },
  { label: 'ExpenseAmazonFeeCategoryAgg', model: ExpenseAmazonFeeCategoryAgg },
  { label: 'AsinWiseSalesRun', model: AsinWiseSalesRun },
  { label: 'AsinWiseSalesItem', model: AsinWiseSalesItem },
  { label: 'AsinWiseSalesDateItem', model: AsinWiseSalesDateItem },
  { label: 'SalesOrderId', model: SalesOrderId },
  { label: 'ListingItemsKeyword', model: ListingItemsKeyword },
  { label: 'ListingItems', model: ListingItems },
  { label: 'ProductWiseSales', model: ProductWiseSales },
  { label: 'OrderAndRevenue', model: OrderAndRevenue },
  { label: 'V2_Seller_Performance_Report', model: V2_Seller_Performance_Report },
  { label: 'V1_Seller_Performance_Report', model: V1_Seller_Performance_Report },
  { label: 'APlusContent', model: APlusContent },
  { label: 'NumberOfProductReviews', model: NumberOfProductReviews },
  { label: 'BuyBoxData', model: BuyBoxData },
  { label: 'EconomicsMetrics', model: EconomicsMetrics },
  { label: 'SalesOnlyMetrics', model: SalesOnlyMetrics },
  { label: 'AsinWiseSalesForBigAccounts', model: AsinWiseSalesForBigAccounts },
  { label: 'GET_FBA_INVENTORY_PLANNING_DATA', model: GET_FBA_INVENTORY_PLANNING_DATA },
  { label: 'GET_STRANDED_INVENTORY_UI_DATA', model: GET_STRANDED_INVENTORY_UI_DATA },
  { label: 'StrandedInventoryUIDataItem', model: StrandedInventoryUIDataItem },
  { label: 'RestockInventoryRecommendations', model: RestockInventoryRecommendations },
  { label: 'ShipmentModel', model: ShipmentModel },
  { label: 'FbaInventoryApiDetail', model: FbaInventoryApiDetail },
  { label: 'LedgerSummaryView', model: LedgerSummaryView },
  { label: 'LedgerSummaryViewItem', model: LedgerSummaryViewItem },
  { label: 'LedgerDetailView', model: LedgerDetailView },
  { label: 'FBAReimbursements', model: FBAReimbursements },
  { label: 'LongTermStorageFees', model: LongTermStorageFees },
  { label: 'WeekLyFinance', model: WeekLyFinance },
  { label: 'DataFetchTracking', model: DataFetchTracking },
  { label: 'AccountHistory', model: AccountHistory },
  { label: 'ReviewOrder', model: ReviewOrder },
  { label: 'Alert', model: Alert },
];

const USERID_TARGETS = [
  { label: 'ProductWiseFinancial', model: ProductWiseFinancial },
];

async function countForFilter(model, filter) {
  return model.countDocuments(filter);
}

async function deleteForFilter(model, filter) {
  const result = await model.deleteMany(filter);
  return result.deletedCount || 0;
}

async function runTargetList(targets, filter, dryRun) {
  const rows = [];
  const skipped = [];
  let total = 0;

  for (const { label, model } of targets) {
    if (!model || typeof model.countDocuments !== 'function') {
      skipped.push(label);
      continue;
    }
    try {
      const count = await countForFilter(model, filter);
      if (count > 0) {
        rows.push({ label, count });
        total += count;
        if (!dryRun) {
          await deleteForFilter(model, filter);
        }
      }
    } catch (err) {
      console.warn(`  [warn] ${label}: ${err.message}`);
    }
  }

  return { rows, total, skipped };
}

async function deleteReviewOrderItems(userObjectId, country, region, dryRun) {
  const orders = await ReviewOrder.find(
    { User: userObjectId, country, region },
    { _id: 1 }
  ).lean();
  if (orders.length === 0) return 0;

  const orderIds = orders.map((o) => o._id);
  const filter = { User: userObjectId, orderId: { $in: orderIds } };
  const count = await ReviewOrderItem.countDocuments(filter);
  if (count > 0 && !dryRun) {
    await ReviewOrderItem.deleteMany(filter);
  }
  return count;
}

async function deleteJobStatusForAccount(userObjectId, country, region, dryRun) {
  const filter = {
    userId: userObjectId,
    'metadata.country': country,
    'metadata.region': region,
  };
  const count = await JobStatus.countDocuments(filter);
  if (count > 0 && !dryRun) {
    await JobStatus.deleteMany(filter);
  }
  return count;
}

async function deleteUserAccountLogs(userObjectId, country, region, dryRun) {
  const filter = { userId: userObjectId, country, region };
  const count = await UserAccountLogs.countDocuments(filter);
  if (count > 0 && !dryRun) {
    await UserAccountLogs.deleteMany(filter);
  }
  return count;
}

async function clearSellerCatalog(userObjectId, country, region, dryRun) {
  const seller = await Seller.findOne({ User: userObjectId }).lean();
  if (!seller) return { found: false, productsBefore: 0 };

  const account = (seller.sellerAccount || []).find(
    (a) => normalizeCountry(a.country) === country && normalizeRegion(a.region) === region
  );
  if (!account) return { found: false, productsBefore: 0 };

  const productsBefore = Array.isArray(account.products) ? account.products.length : 0;
  const inactiveBefore = Array.isArray(account.TotatProducts) ? account.TotatProducts.length : 0;

  if (!dryRun) {
    await Seller.updateOne(
      {
        User: userObjectId,
        'sellerAccount.country': country,
        'sellerAccount.region': region,
      },
      {
        $set: {
          'sellerAccount.$.products': [],
          'sellerAccount.$.TotatProducts': [],
        },
      }
    );
  }

  return { found: true, productsBefore, inactiveBefore };
}

async function resetScheduleForAccount(userObjectId, country, region, dryRun) {
  const doc = await UserUpdateSchedule.findOne({ userId: userObjectId }).lean();
  if (!doc) return false;

  const hasAccount = (doc.sellerAccounts || []).some(
    (a) => normalizeCountry(a.country) === country && normalizeRegion(a.region) === region
  );
  if (!hasAccount) return false;

  if (!dryRun) {
    await UserUpdateSchedule.updateOne(
      {
        userId: userObjectId,
        'sellerAccounts.country': country,
        'sellerAccounts.region': region,
      },
      { $set: { 'sellerAccounts.$.lastDailyUpdate': null } }
    );
  }
  return true;
}

async function clearRedisAnalyseCache(userIdStr, country, region) {
  try {
    const { getRedisClient } = require('../config/redisConn.js');
    const redis = getRedisClient();
    const key = `analyse_data:${userIdStr}:${country}:${region}:null`;
    const deleted = await redis.del(key);
    return { key, deleted: deleted > 0 };
  } catch (err) {
    return { key: null, error: err.message };
  }
}

function printRows(title, rows) {
  if (rows.length === 0) {
    console.log(`  (none)`);
    return;
  }
  for (const { label, count } of rows) {
    console.log(`  ${label}: ${count}`);
  }
}

async function main() {
  const args = parseArgs();
  const { userId, country, region, dryRun, confirm } = args;

  if (!userId || !country || !region) {
    console.error(
      'Usage: node server/scripts/deleteAccountDataForUser.js --userId=<id> --country=<code> --region=<NA|EU|FE> [--dryRun|--confirm]'
    );
    process.exit(1);
  }

  const normalizedCountry = normalizeCountry(country);
  const normalizedRegion = normalizeRegion(region);
  if (!['NA', 'EU', 'FE'].includes(normalizedRegion)) {
    console.error('Error: region must be one of: NA, EU, FE');
    process.exit(1);
  }

  if (!dryRun && !confirm) {
    console.error('Safety check: pass --dryRun to preview counts or --confirm to delete.');
    process.exit(1);
  }

  let userIdStr;
  try {
    userIdStr = normalizeUserId(userId);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const userObjectId = getUserObjectId(userIdStr);
  const filterUserId = buildAccountFilterUserId(userIdStr, normalizedCountry, normalizedRegion);
  const filterUser = buildAccountFilterUser(userObjectId, normalizedCountry, normalizedRegion);
  const filterUserid = buildAccountFilterUserid(userObjectId, normalizedCountry, normalizedRegion);

  console.log('[Delete Account Data] Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('[Delete Account Data] Connected.');
  console.log(
    `[Delete Account Data] Target => userId=${userIdStr}, country=${normalizedCountry}, region=${normalizedRegion}`
  );
  console.log(`[Delete Account Data] Mode => ${dryRun ? 'DRY RUN' : 'DELETE'}\n`);

  const userIdResults = await runTargetList(USER_ID_TARGETS, filterUserId, dryRun);
  const userResults = await runTargetList(USER_TARGETS, filterUser, dryRun);
  const useridResults = await runTargetList(USERID_TARGETS, filterUserid, dryRun);

  const reviewItems = await deleteReviewOrderItems(
    userObjectId,
    normalizedCountry,
    normalizedRegion,
    dryRun
  );
  const jobStatusCount = await deleteJobStatusForAccount(
    userObjectId,
    normalizedCountry,
    normalizedRegion,
    dryRun
  );
  const logsCount = await deleteUserAccountLogs(
    userObjectId,
    normalizedCountry,
    normalizedRegion,
    dryRun
  );

  const catalog = await clearSellerCatalog(
    userObjectId,
    normalizedCountry,
    normalizedRegion,
    dryRun
  );
  const scheduleReset = await resetScheduleForAccount(
    userObjectId,
    normalizedCountry,
    normalizedRegion,
    dryRun
  );

  let redisResult = null;
  if (!dryRun) {
    redisResult = await clearRedisAnalyseCache(userIdStr, normalizedCountry, normalizedRegion);
  }

  console.log('── Collections (userId + country + region) ──');
  printRows('', userIdResults.rows);
  console.log('\n── Collections (User + country + region) ──');
  printRows('', userResults.rows);
  console.log('\n── Collections (userid + country + region) ──');
  printRows('', useridResults.rows);

  console.log('\n── Extra ──');
  if (reviewItems > 0) console.log(`  ReviewOrderItem: ${reviewItems}`);
  if (jobStatusCount > 0) console.log(`  JobStatus (metadata match): ${jobStatusCount}`);
  if (logsCount > 0) console.log(`  UserAccountLogs: ${logsCount}`);
  if (catalog.found) {
    console.log(
      `  Seller.products cleared: ${catalog.productsBefore} products, ${catalog.inactiveBefore} TotatProducts rows`
    );
  } else {
    console.log('  Seller subdocument: not found for this country/region');
  }
  if (scheduleReset) console.log('  UserUpdateSchedule: lastDailyUpdate reset for this account');
  if (redisResult) {
    if (redisResult.error) console.log(`  Redis: skipped (${redisResult.error})`);
    else console.log(`  Redis: ${redisResult.deleted ? 'deleted' : 'no key'} ${redisResult.key}`);
  }

  const grandTotal =
    userIdResults.total +
    userResults.total +
    useridResults.total +
    reviewItems +
    jobStatusCount +
    logsCount;

  const allSkipped = [
    ...(userIdResults.skipped || []),
    ...(userResults.skipped || []),
    ...(useridResults.skipped || []),
  ];
  if (allSkipped.length > 0) {
    console.log(`\n[Delete Account Data] Skipped (invalid model export): ${allSkipped.join(', ')}`);
  }

  console.log(`\n[Delete Account Data] Document total: ${grandTotal}`);
  if (dryRun) {
    console.log('[Delete Account Data] DRY RUN complete. No data deleted. Pass --confirm to delete.');
  } else {
    console.log('[Delete Account Data] Done. User and Seller auth records were kept.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[Delete Account Data] Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
