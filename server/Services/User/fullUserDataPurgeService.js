/**
 * fullUserDataPurgeService.js
 *
 * Purges all remaining operational user data from every collection that
 * references the user. Call this after deleteUserById has removed the
 * user's Seller document(s).
 *
 * Whether the User document survives is decided by the caller, not here:
 * the six-month inactivity cleanup keeps it (stamped with purgedAt), while an
 * admin's manual delete removes it. See deleteUserService.js.
 *
 * Billing history (Subscription + PaymentLogs) follows the same split, via the
 * `includeBillingHistory` option:
 *   - six-month cleanup: kept, because the account itself is kept and the person
 *     can come back.
 *   - admin manual delete: removed, since nothing of the account remains.
 *
 * Keeping this list complete matters: any model with a `ref: 'User'` field that
 * is missing below leaves rows behind forever. To audit, compare the entries
 * here against `grep -rl "ref: 'User'" server/models`.
 *
 * Used by the dedicated delete-user worker; does not touch existing delete flow or other workers.
 */

const mongoose = require('mongoose');
const logger = require('../../utils/Logger.js');

// Models keyed by User (ObjectId)
const JobStatus = require('../../models/system/JobStatusModel.js');
const UserUpdateSchedule = require('../../models/user-auth/UserUpdateScheduleModel.js');
const Task = require('../../models/MCP/TaskModel.js');
const TaskItem = require('../../models/MCP/TaskItemModel.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const IssuesData = require('../../models/system/IssuesDataModel.js');
const IssueSummary = require('../../models/system/IssueSummaryModel.js');
const Cogs = require('../../models/finance/CogsModel.js');
const ProductWiseStorageFees = require('../../models/finance/ProductWiseStorageFees.js');
const FBAFees = require('../../models/finance/FBAFeesModel.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const GetDateWisePPCspend = require('../../models/amazon-ads/GetDateWisePPCspendModel.js');
const PPCUnitsSold = require('../../models/amazon-ads/PPCUnitsSoldModel.js');
const NegativeKeywords = require('../../models/amazon-ads/NegetiveKeywords.js');
const { KeywordRecommendations, AsinKeywordRecommendations } = require('../../models/amazon-ads/KeywordRecommendationsModel.js');
const adsKeywordsPerformance = require('../../models/amazon-ads/adsKeywordsPerformanceModel.js');
const adsgroupModel = require('../../models/amazon-ads/adsgroupModel.js');
const CampaignModel = require('../../models/amazon-ads/CampaignModel.js');
const SearchTermsModel = require('../../models/amazon-ads/SearchTermsModel.js');
const keywordModel = require('../../models/amazon-ads/keywordModel.js');
const keywordChunkModel = require('../../models/amazon-ads/keywordChunkModel.js');
const negativeKeywordChunkModel = require('../../models/amazon-ads/negativeKeywordChunkModel.js');
const campaignChunkModel = require('../../models/amazon-ads/campaignChunkModel.js');
const adsGroupChunkModel = require('../../models/amazon-ads/adsGroupChunkModel.js');
const KeywordTrackingModel = require('../../models/amazon-ads/KeywordTrackingModel.js');
const ProductWiseSponsoredAdsData = require('../../models/amazon-ads/ProductWiseSponseredAdsModel.js');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const ProductWiseFBAData = require('../../models/inventory/ProductWiseFBADataModel.js');
const ProductWiseFBADataItem = require('../../models/inventory/ProductWiseFBADataItemModel.js');
const GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE = require('../../models/inventory/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA.js');
const EmailLogs = require('../../models/system/EmailLogsModel.js');
const UserAccountLogs = require('../../models/system/ErrorLogs.js');

const ListingItemsKeyword = require('../../models/products/ListingItemsKeywordModel.js');
const ListingItems = require('../../models/products/GetListingItemsModel.js');
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
const LedgerSummaryView = require('../../models/finance/LedgerSummaryViewModel.js');
const LedgerSummaryViewItem = require('../../models/finance/LedgerSummaryViewItemModel.js');
const LedgerDetailViewItem = require('../../models/finance/LedgerDetailViewItemModel.js');
const FBAReimbursementsItem = require('../../models/finance/FBAReimbursementsItemModel.js');
const StrandedInventoryUIData = require('../../models/inventory/GET_STRANDED_INVENTORY_UI_DATA_MODEL.js');
const StrandedInventoryUIDataItem = require('../../models/inventory/StrandedInventoryUIDataItemModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const LongTermStorageFees = require('../../models/finance/LongTermStorageFeesModel.js');
const RestockInventoryRecommendations = require('../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const ProductWiseSales = require('../../models/products/ProductWiseSalesModel.js');
const OrderAndRevenue = require('../../models/products/OrderAndRevenueModel.js');
const FBAReimbursements = require('../../models/finance/FBAReimbursementsModel.js');
const AgencySeller = require('../../models/user-auth/AgencySellerModel.js');
const DataFetchTracking = require('../../models/system/DataFetchTrackingModel.js');
const AccountHistory = require('../../models/user-auth/AccountHistory.js');
const LedgerDetailView = require('../../models/finance/LedgerDetailViewModel.js');
const V2_Seller_Performance_Report = require('../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const APlusContent = require('../../models/seller-performance/APlusContentModel.js');
const NumberOfProductReviews = require('../../models/seller-performance/NumberOfProductReviewsModel.js');
// Alert.js exports a map of discriminators, not a model. Importing the module
// object made `Alert.deleteMany` undefined, so every alert purge threw and was
// swallowed by the per-collection try/catch — alerts were never purged. The base
// model has no __t filter, so deleting through it covers all alert types.
const { Alert } = require('../../models/alerts/Alert.js');
const GET_FBA_INVENTORY_PLANNING_DATA = require('../../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js');
const V1_Seller_Performance_Report = require('../../models/seller-performance/V1_Seller_Performance_Report_Model.js');
const QMateChat = require('../../models/ai/QMateChatModel.js');
const ProductWiseFinancial = require('../../models/finance/ProductWiseFinancialModel.js');
const WeekLyFinance = require('../../models/finance/WeekLyFinanceModel.js');
const ShipmentModel = require('../../models/inventory/ShipmentModel.js');
// Finance / expense / review collections added later than this service. They were
// never in the purge lists below, so they accumulated rows for purged users.
const AsinRelationship = require('../../models/finance/AsinRelationshipModel.js');
const AsinWiseSalesDateItem = require('../../models/finance/AsinWiseSalesDateItemModel.js');
const AsinWiseSalesItem = require('../../models/finance/AsinWiseSalesItemModel.js');
const AsinWiseSalesRun = require('../../models/finance/AsinWiseSalesRunModel.js');
const DailyOverheadFinance = require('../../models/finance/DailyOverheadFinanceModel.js');
const DailySkuFinance = require('../../models/finance/DailySkuFinanceModel.js');
const ExpenseAmazonFeeCategoryAgg = require('../../models/finance/ExpenseAmazonFeeCategoryAggModel.js');
const ExpenseAmazonFeeDateAgg = require('../../models/finance/ExpenseAmazonFeeDateAggModel.js');
const ExpenseCategoryAgg = require('../../models/finance/ExpenseCategoryAggModel.js');
const ExpenseDateAgg = require('../../models/finance/ExpenseDateAggModel.js');
const ExpenseRawRow = require('../../models/finance/ExpenseRawRowModel.js');
const ExpenseReportRun = require('../../models/finance/ExpenseReportRunModel.js');
const ExpenseSkuAgg = require('../../models/finance/ExpenseSkuAggModel.js');
const ExpenseSkuDateAgg = require('../../models/finance/ExpenseSkuDateAggModel.js');
const FinanceBackfillCursor = require('../../models/finance/FinanceBackfillCursorModel.js');
const FinanceSyncLog = require('../../models/finance/FinanceSyncLogModel.js');
const PendingExpenseOrder = require('../../models/finance/PendingExpenseOrderModel.js');
const SalesOrderId = require('../../models/finance/SalesOrderIdModel.js');
const FbaInventoryApiDetail = require('../../models/inventory/FbaInventoryApiDetailModel.js');
const SalesOnlyMetrics = require('../../models/MCP/SalesOnlyMetricsModel.js');
const ReviewIngestSlice = require('../../models/review/ReviewIngestSliceModel.js');
const ReviewOrderItem = require('../../models/review/ReviewOrderItemModel.js');
const ReviewOrder = require('../../models/review/ReviewOrderModel.js');
const ListingFixStatus = require('../../models/system/ListingFixStatusModel.js');
const WhatsAppLink = require('../../models/user-auth/WhatsAppLinkModel.js');
// Billing history — purged only for an admin's manual delete, see below.
const Subscription = require('../../models/user-auth/SubscriptionModel.js');
const PaymentLogs = require('../../models/system/PaymentLogsModel.js');

/** @type {{ model: import('mongoose').Model, key: string }[]} Collections with User (ObjectId) */
const collectionsWithUser = [
    { model: ListingItemsKeyword, key: 'User' },
    { model: ListingItems, key: 'User' },
    { model: BuyBoxData, key: 'User' },
    { model: LedgerSummaryView, key: 'User' },
    { model: LedgerSummaryViewItem, key: 'User' },
    { model: StrandedInventoryUIData, key: 'User' },
    { model: StrandedInventoryUIDataItem, key: 'User' },
    { model: AsinWiseSalesForBigAccounts, key: 'User' },
    { model: LongTermStorageFees, key: 'User' },
    { model: RestockInventoryRecommendations, key: 'User' },
    { model: EconomicsMetrics, key: 'User' },
    { model: ProductWiseSales, key: 'User' },
    { model: OrderAndRevenue, key: 'User' },
    { model: FBAReimbursements, key: 'User' },
    { model: FBAReimbursementsItem, key: 'User' },
    { model: AgencySeller, key: 'User' },
    { model: DataFetchTracking, key: 'User' },
    { model: AccountHistory, key: 'User' },
    { model: LedgerDetailView, key: 'User' },
    // Item collection holding the actual rows. MUST be purged with its parent, whose
    // embedded array is no longer written — otherwise the rows outlive the account.
    { model: LedgerDetailViewItem, key: 'User' },
    { model: V2_Seller_Performance_Report, key: 'User' },
    { model: APlusContent, key: 'User' },
    { model: NumberOfProductReviews, key: 'User' },
    { model: Alert, key: 'User' },
    { model: GET_FBA_INVENTORY_PLANNING_DATA, key: 'User' },
    { model: V1_Seller_Performance_Report, key: 'User' },
    { model: QMateChat, key: 'User' },
    { model: WeekLyFinance, key: 'User' },
    { model: ShipmentModel, key: 'User' },
    // Finance / expense / sales
    { model: AsinRelationship, key: 'User' },
    { model: AsinWiseSalesDateItem, key: 'User' },
    { model: AsinWiseSalesItem, key: 'User' },
    { model: AsinWiseSalesRun, key: 'User' },
    { model: DailyOverheadFinance, key: 'User' },
    { model: DailySkuFinance, key: 'User' },
    { model: ExpenseAmazonFeeCategoryAgg, key: 'User' },
    { model: ExpenseAmazonFeeDateAgg, key: 'User' },
    { model: ExpenseCategoryAgg, key: 'User' },
    { model: ExpenseDateAgg, key: 'User' },
    { model: ExpenseRawRow, key: 'User' },
    { model: ExpenseReportRun, key: 'User' },
    { model: ExpenseSkuAgg, key: 'User' },
    { model: ExpenseSkuDateAgg, key: 'User' },
    { model: FinanceBackfillCursor, key: 'User' },
    { model: FinanceSyncLog, key: 'User' },
    { model: PendingExpenseOrder, key: 'User' },
    { model: SalesOrderId, key: 'User' },
    // Inventory / metrics
    { model: FbaInventoryApiDetail, key: 'User' },
    { model: SalesOnlyMetrics, key: 'User' },
    // Review request data
    { model: ReviewIngestSlice, key: 'User' },
    { model: ReviewOrderItem, key: 'User' },
    { model: ReviewOrder, key: 'User' },
];

/** ProductWiseFinancial uses lowercase userid */
const collectionsWithUserId = [
    // Billing history lives in billingHistoryCollections below, not here — it is
    // only purged when the caller asks for it (admin manual delete).
    { model: JobStatus, key: 'userId' },
    { model: UserUpdateSchedule, key: 'userId' },
    { model: Task, key: 'userId' },
    { model: TaskItem, key: 'userId' },
    { model: IssuesDataChunks, key: 'userId' },
    { model: IssuesData, key: 'userId' },
    { model: IssueSummary, key: 'userId' },
    { model: Cogs, key: 'userId' },
    { model: ProductWiseStorageFees, key: 'userId' },
    { model: FBAFees, key: 'userId' },
    { model: PPCMetrics, key: 'userId' },
    { model: GetDateWisePPCspend, key: 'userId' },
    { model: PPCUnitsSold, key: 'userId' },
    { model: adsKeywordsPerformance, key: 'userId' },
    { model: adsgroupModel, key: 'userId' },
    { model: CampaignModel, key: 'userId' },
    { model: SearchTermsModel, key: 'userId' },
    { model: keywordModel, key: 'userId' },
    { model: keywordChunkModel, key: 'userId' },
    { model: KeywordTrackingModel, key: 'userId' },
    { model: ProductWiseSponsoredAdsData, key: 'userId' },
    { model: ProductWiseSponsoredAdsItem, key: 'userId' },
    { model: ProductWiseFBAData, key: 'userId' },
    { model: ProductWiseFBADataItem, key: 'userId' },
    { model: GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE, key: 'userId' },
    { model: UserAccountLogs, key: 'userId' },
    { model: ListingFixStatus, key: 'userId' },
    { model: WhatsAppLink, key: 'userId' },
];

/**
 * Billing history. Purged ONLY when the caller passes includeBillingHistory — the
 * six-month cleanup keeps the account, so its payment record is kept with it; an
 * admin's manual delete removes the account, so this goes too.
 */
const billingHistoryCollections = [
    { model: Subscription, key: 'userId' },
    { model: PaymentLogs, key: 'userId' },
];

/** EmailLogs uses receiverId */
const collectionsWithReceiverId = [{ model: EmailLogs, key: 'receiverId' }];

/** ProductWiseFinancial uses userid (lowercase) */
const collectionsWithUserid = [{ model: ProductWiseFinancial, key: 'userid' }];

/** Some models store userId as string (use string for query) */
const collectionsWithUserIdString = [
    { model: NegativeKeywords, key: 'userId' },
    // Overflow-chunk siblings. Must be purged alongside their primary snapshot or the
    // chunk documents outlive the account. See utils/snapshotChunkStore.js.
    { model: negativeKeywordChunkModel, key: 'userId' },
    { model: campaignChunkModel, key: 'userId' },
    { model: adsGroupChunkModel, key: 'userId' },
    { model: AsinKeywordRecommendations, key: 'userId' },
    { model: KeywordRecommendations, key: 'userId' },
];

const DELAY_BETWEEN_COLLECTIONS_MS = 100;

/**
 * Run deleteMany for one collection; returns deleted count.
 * @param {import('mongoose').Model} model
 * @param {object} filter
 * @returns {Promise<number>}
 */
async function deleteForModel(model, filter) {
    const result = await model.deleteMany(filter);
    return result.deletedCount ?? 0;
}

/**
 * Purge all remaining user data from every collection.
 * The Seller document(s) must already be deleted before calling this.
 * @param {string} userId - MongoDB user ObjectId (string or ObjectId)
 * @param {{ includeBillingHistory?: boolean }} [options] - also purge Subscription
 *        and PaymentLogs. Set by the admin's manual delete, which removes the whole
 *        account; the six-month cleanup leaves billing history in place.
 * @returns {Promise<{ success: boolean, deletedByCollection: object, totalDeleted: number, errors: string[] }>}
 */
async function purgeAllUserData(userId, options = {}) {
    const { includeBillingHistory = false } = options;
    const userObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const userIdStr = userObjectId.toString();
    const deletedByCollection = {};
    const errors = [];

    const runOne = async (list, filter) => {
        for (const { model, key } of list) {
            const name = model.collection?.collectionName ?? model.modelName ?? 'unknown';
            try {
                const count = await deleteForModel(model, filter);
                if (count > 0) deletedByCollection[name] = count;
                await new Promise((r) => setTimeout(r, DELAY_BETWEEN_COLLECTIONS_MS));
            } catch (err) {
                logger.error(`[fullUserDataPurge] Error purging ${name} for user ${userIdStr}:`, err);
                errors.push(`${name}: ${err.message}`);
            }
        }
    };

    await runOne(collectionsWithUser, { User: userObjectId });
    await runOne(collectionsWithUserId, { userId: userObjectId });
    await runOne(collectionsWithUserIdString, { userId: userIdStr });
    await runOne(collectionsWithReceiverId, { receiverId: userObjectId });
    await runOne(collectionsWithUserid, { userid: userObjectId });
    if (includeBillingHistory) {
        await runOne(billingHistoryCollections, { userId: userObjectId });
    }

    const totalDeleted = Object.values(deletedByCollection).reduce((s, n) => s + n, 0);
    logger.info(`[fullUserDataPurge] Purged user ${userIdStr}: total docs ${totalDeleted}, collections: ${Object.keys(deletedByCollection).length}`, {
        userId: userIdStr,
        deletedByCollection,
        includeBillingHistory,
        errors: errors.length,
    });

    return {
        success: errors.length === 0,
        deletedByCollection,
        totalDeleted,
        errors: errors.length ? errors : undefined,
    };
}

module.exports = {
    purgeAllUserData,
};
