/**
 * Final backfill: NumberOfProductReviews (RapidAPI) + issue aggregates + per-product issue counts
 *
 * Per (userId, country, region) for PRO / PRO Trial users:
 *  1. addReviewDataTODatabase — fetches review/listing data via NumberOfProductReviews service,
 *     writes NumberOfProductReviews + APlusContentModel, updates User.numberOfProductReviews.
 *  2. AnalyseService.Analyse + analyseData (DashboardCalculation) — same pipeline as dashboard.
 *  3. IssueSummaryService.storeIssueSummaryFromDashboardData → IssueSummary model.
 *  4. ProductIssuesService.storeProductIssuesFromDashboardData → Seller.products[].issueCount.
 *
 * Eligibility (same as migrateProUsersIssueSummaryAndSellerIssues.js):
 *  - Subscription: planType PRO, status active|trialing
 *  - OR User: packageType PRO and (subscriptionStatus active|trialing OR isInTrialPeriod)
 *
 * Usage (from repo root):
 *   node server/scripts/migrations/backfillReviewsAndIssuesProUsers.js [--dry-run] [--limit=N] [--user-id=<ObjectId>] [--delay-ms=500]
 *        [--skip-reviews] [--skip-issues]
 *
 * Env (reviews): NUMBER_OF_REVIEWS_URI, optional NUMBER_OF_REVIEWS_CONCURRENCY, REVIEWS_CHUNK_SIZE
 * Env (DB): DB_URI, DB_NAME (via server/config/config.js)
 *
 * Legacy env (same as migrateProUsersIssueSummaryAndSellerIssues): DRY_RUN=1, LIMIT=, USER_ID=
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const mongoose = require('mongoose');
const dbConnect = require('../../config/dbConn.js');
const Subscription = require('../../models/user-auth/SubscriptionModel.js');
const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { AnalyseService } = require('../../Services/main/Analyse.js');
const { analyseData } = require('../../Services/Calculations/DashboardCalculation.js');
const IssueSummaryService = require('../../Services/Calculations/IssueSummaryService.js');
const ProductIssuesService = require('../../Services/Calculations/ProductIssuesService.js');
const { addReviewDataTODatabase } = require('../../Services/Sp_API/NumberOfProductReviews.js');

const args = process.argv.slice(2);
const CLI_DRY_RUN = args.includes('--dry-run');
const LIMIT_ARG = args.find((a) => a.startsWith('--limit='));
const USER_ID_ARG = args.find((a) => a.startsWith('--user-id='));
const DELAY_ARG = args.find((a) => a.startsWith('--delay-ms='));
const CLI_LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : null;
const CLI_USER_ID = USER_ID_ARG ? USER_ID_ARG.split('=')[1].trim() : null;
const DELAY_MS = DELAY_ARG ? parseInt(DELAY_ARG.split('=')[1], 10) : 0;
const SKIP_REVIEWS = args.includes('--skip-reviews');
const SKIP_ISSUES = args.includes('--skip-issues');

const DRY_RUN =
  CLI_DRY_RUN ||
  process.env.DRY_RUN === '1' ||
  process.env.DRY_RUN === 'true';
const LIMIT = CLI_LIMIT ?? (process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : null);
const SINGLE_USER_ID = CLI_USER_ID || process.env.USER_ID || null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg, data = {}) {
  const prefix = DRY_RUN ? '[DRY-RUN] ' : '';
  console.log(`${prefix}[reviews+issues] ${msg}`, Object.keys(data).length ? data : '');
}

/**
 * PRO / PRO Trial accounts: merged Subscription + User (same as migrateProUsersIssueSummaryAndSellerIssues).
 */
async function getProUserAccounts() {
  let userIds;

  if (SINGLE_USER_ID) {
    userIds = [new mongoose.Types.ObjectId(SINGLE_USER_ID)];
    log('Single user mode', { userId: SINGLE_USER_ID });
  } else {
    const fromSubs = await Subscription.find({
      planType: 'PRO',
      status: { $in: ['active', 'trialing'] },
    })
      .select('userId')
      .lean();
    const idsFromSubs = new Set(fromSubs.map((s) => s.userId?.toString()).filter(Boolean));

    const fromUsers = await User.find({
      packageType: 'PRO',
      $or: [
        { subscriptionStatus: { $in: ['active', 'trialing'] } },
        { isInTrialPeriod: true },
      ],
    })
      .select('_id')
      .lean();
    const idsFromUsers = new Set(fromUsers.map((u) => u._id?.toString()).filter(Boolean));

    const mergedIds = new Set([...idsFromSubs, ...idsFromUsers]);
    userIds = [...mergedIds].map((id) => new mongoose.Types.ObjectId(id));

    if (LIMIT && Number.isFinite(LIMIT) && LIMIT > 0) {
      userIds = userIds.slice(0, LIMIT);
    }
    log('Pro/Pro Trial user IDs (Subscription + User)', {
      count: userIds.length,
      fromSubscription: idsFromSubs.size,
      fromUser: idsFromUsers.size,
      merged: mergedIds.size,
    });
  }

  const accounts = [];
  for (const uid of userIds) {
    const seller = await Seller.findOne({ User: uid }).select('sellerAccount.country sellerAccount.region').lean();
    if (!seller?.sellerAccount?.length) {
      log('No seller account(s) for user', { userId: uid.toString() });
      continue;
    }
    for (const acc of seller.sellerAccount) {
      if (acc.country && acc.region) {
        accounts.push({
          userId: uid,
          country: acc.country,
          region: acc.region,
        });
      }
    }
  }
  return accounts;
}

function collectActiveAsins(sellerDoc, country, region) {
  const acc = sellerDoc?.sellerAccount?.find((a) => a.country === country && a.region === region);
  if (!acc?.products?.length) return [];
  return acc.products
    .filter((p) => p.status === 'Active')
    .map((p) => p.asin)
    .filter((asin) => asin && typeof asin === 'string' && asin.trim().length > 0);
}

async function runReviewsPhase(userId, country, region, sellerDoc) {
  const asins = collectActiveAsins(sellerDoc, country, region);
  const userIdStr = userId.toString();

  if (asins.length === 0) {
    log('Reviews skipped — no active ASINs', { userId: userIdStr, country, region });
    return { success: true, skipped: true, reason: 'no_asins' };
  }

  if (DRY_RUN) {
    log('Would run addReviewDataTODatabase', {
      userId: userIdStr,
      country,
      region,
      asinCount: asins.length,
    });
    return { success: true, skipped: true, reason: 'dry_run' };
  }

  if (!process.env.NUMBER_OF_REVIEWS_URI) {
    log('Reviews skipped — NUMBER_OF_REVIEWS_URI not set', { userId: userIdStr, country, region });
    return { success: false, skipped: true, reason: 'no_reviews_uri' };
  }

  const result = await addReviewDataTODatabase(asins, country, userId, region);
  if (!result?.success) {
    return { success: false, error: result?.error || 'addReviewDataTODatabase failed' };
  }
  return {
    success: true,
    productsProcessed: result.productsProcessed ?? 0,
  };
}

async function runIssuesPhase(userId, country, region) {
  const userIdStr = userId.toString();

  if (DRY_RUN) {
    const getAnalyseData = await AnalyseService.Analyse(userIdStr, country, region);
    if (!getAnalyseData || getAnalyseData.status !== 200) {
      log('Analyse failed (dry-run check)', {
        userId: userIdStr,
        country,
        region,
        status: getAnalyseData?.status,
      });
      return { success: false, reason: 'analyse_failed' };
    }
    const calculationResult = await analyseData(getAnalyseData.message, userIdStr);
    const dashboardData = calculationResult?.dashboardData;
    if (!dashboardData) {
      return { success: false, reason: 'no_dashboard_data' };
    }
    const totalIssues =
      (dashboardData.totalProfitabilityErrors || 0) +
      (dashboardData.totalSponsoredAdsErrors || 0) +
      (dashboardData.totalInventoryErrors || 0) +
      (dashboardData.TotalRankingerrors || 0) +
      (dashboardData.totalErrorInConversion || 0) +
      (dashboardData.totalErrorInAccount || 0);
    log('Would store IssueSummary + product issueCount', {
      userId: userIdStr,
      country,
      region,
      totalIssues,
      productsWithIssues: (dashboardData.productWiseError || []).length,
    });
    return { success: true };
  }

  const getAnalyseData = await AnalyseService.Analyse(userIdStr, country, region);
  if (!getAnalyseData || getAnalyseData.status !== 200) {
    log('Analyse failed', {
      userId: userIdStr,
      country,
      region,
      status: getAnalyseData?.status,
    });
    return { success: false, reason: 'analyse_failed' };
  }

  const calculationResult = await analyseData(getAnalyseData.message, userIdStr);
  if (!calculationResult?.dashboardData) {
    log('analyseData returned no dashboardData', { userId: userIdStr, country, region });
    return { success: false, reason: 'no_dashboard_data' };
  }

  const dashboardData = calculationResult.dashboardData;

  const summaryResult = await IssueSummaryService.storeIssueSummaryFromDashboardData(
    userIdStr,
    country,
    region,
    dashboardData,
    'migration_reviews_issues'
  );
  if (!summaryResult.success) {
    log('IssueSummary store failed', {
      userId: userIdStr,
      country,
      region,
      error: summaryResult.error,
    });
    return { success: false, reason: 'issue_summary_store_failed' };
  }

  const sellerResult = await ProductIssuesService.storeProductIssuesFromDashboardData(
    userIdStr,
    country,
    region,
    dashboardData,
    'migration_reviews_issues'
  );
  if (!sellerResult.success) {
    log('Seller issueCount update failed', {
      userId: userIdStr,
      country,
      region,
      error: sellerResult.error,
    });
    return { success: false, reason: 'seller_update_failed' };
  }

  return { success: true };
}

async function processAccount(userId, country, region, stats) {
  const userIdStr = userId.toString();
  const sellerDoc = await Seller.findOne({ User: userId }).lean();
  if (!sellerDoc) {
    stats.noSeller += 1;
    log('Skip — no Seller document', { userId: userIdStr, country, region });
    return;
  }

  if (!SKIP_REVIEWS) {
    const rev = await runReviewsPhase(userId, country, region, sellerDoc);
    if (rev.skipped && rev.reason === 'no_asins') stats.reviewsSkippedNoAsins += 1;
    else if (rev.skipped && rev.reason === 'dry_run') stats.reviewsDryRun += 1;
    else if (rev.skipped && rev.reason === 'no_reviews_uri') stats.reviewsSkippedNoUri += 1;
    else if (rev.success) stats.reviewsOk += 1;
    else {
      stats.reviewsFailed += 1;
      log('Reviews phase failed (continuing to issues if enabled)', {
        userId: userIdStr,
        country,
        region,
        error: rev.error,
      });
    }
  } else {
    stats.reviewsSkippedFlag += 1;
  }

  if (!SKIP_ISSUES) {
    const iss = await runIssuesPhase(userId, country, region);
    if (iss.success) stats.issuesOk += 1;
    else {
      stats.issuesFailed += 1;
    }
  } else {
    stats.issuesSkippedFlag += 1;
  }

  if (DELAY_MS > 0) await sleep(DELAY_MS);
}

async function main() {
  if (SKIP_REVIEWS && SKIP_ISSUES) {
    console.error('ERROR: Both --skip-reviews and --skip-issues; nothing to do.');
    process.exit(1);
  }

  const startedAt = Date.now();
  try {
    await dbConnect();
    log('DB connected');
    if (DRY_RUN) log('DRY RUN: no writes for reviews/issues storage (issues phase still runs Analyse to log counts).');
    if (SKIP_REVIEWS) log('Skipping reviews phase');
    if (SKIP_ISSUES) log('Skipping issues phase');
    if (LIMIT) log('User limit', { LIMIT });
    if (DELAY_MS) log('Delay between accounts (ms)', { DELAY_MS });

    const accounts = await getProUserAccounts();
    if (accounts.length === 0) {
      log('No accounts to process. Exiting.');
      await mongoose.connection.close();
      process.exit(0);
      return;
    }

    log('Accounts to process', { count: accounts.length });

    const stats = {
      reviewsOk: 0,
      reviewsFailed: 0,
      reviewsSkippedNoAsins: 0,
      reviewsSkippedNoUri: 0,
      reviewsDryRun: 0,
      reviewsSkippedFlag: 0,
      issuesOk: 0,
      issuesFailed: 0,
      issuesSkippedFlag: 0,
      noSeller: 0,
      accountExceptions: 0,
    };

    for (let i = 0; i < accounts.length; i++) {
      const { userId, country, region } = accounts[i];
      log(`Processing ${i + 1}/${accounts.length}`, {
        userId: userId.toString(),
        country,
        region,
      });
      try {
        await processAccount(userId, country, region, stats);
      } catch (err) {
        stats.accountExceptions += 1;
        log('Exception', {
          userId: userId.toString(),
          country,
          region,
          error: err.message,
        });
      }
    }

    const duration = Date.now() - startedAt;
    log('Done', { ...stats, durationMs: duration });
    console.log(JSON.stringify(stats, null, 2));

    await mongoose.connection.close();
    const exitCode =
      stats.accountExceptions > 0 || (!SKIP_ISSUES && stats.issuesFailed > 0) ? 1 : 0;
    process.exit(exitCode);
  } catch (err) {
    console.error('[backfillReviewsAndIssuesProUsers] Fatal', err?.message || err);
    try {
      await mongoose.connection.close();
    } catch (_) {}
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { getProUserAccounts, runReviewsPhase, runIssuesPhase };
