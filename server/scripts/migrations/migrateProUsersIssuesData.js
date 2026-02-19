/**
 * Migration: Store Issues Data for PRO and PRO Trial users
 *
 * Purpose:
 * - For every PRO / PRO Trial user, run the full analysis once per seller account
 *   and store the detailed issues data in the IssuesData model (used by Issues by Category
 *   and Issues by Product pages).
 *
 * What it does per (userId, country, region):
 * 1. Runs AnalyseService.Analyse() + analyseData() to get dashboard data.
 * 2. Upserts IssuesData with productWiseError, rankingProductWiseErrors, conversionProductWiseErrors,
 *    inventoryProductWiseErrors, buyBoxData, counts, etc.
 *
 * Usage:
 *   node server/scripts/migrations/migrateProUsersIssuesData.js [options]
 *
 * Options (env or CLI):
 *   DRY_RUN=1           Skip writes (only run analysis and log what would be stored). Default: 0
 *   LIMIT=50            Max number of users to process. Default: no limit
 *   USER_ID=xxx         Process only this user ID (overrides LIMIT)
 *
 * Examples:
 *   node server/scripts/migrations/migrateProUsersIssuesData.js
 *   DRY_RUN=1 node server/scripts/migrations/migrateProUsersIssuesData.js
 *   LIMIT=10 node server/scripts/migrations/migrateProUsersIssuesData.js
 *   USER_ID=507f1f77bcf86cd799439011 node server/scripts/migrations/migrateProUsersIssuesData.js
 *
 * Run from project root. Requires .env with MongoDB (DB_URI / DB_NAME or equivalent).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const mongoose = require('mongoose');
const dbConnect = require('../../config/dbConn.js');
const Subscription = require('../../models/user-auth/SubscriptionModel.js');
const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { AnalyseService } = require('../../Services/main/Analyse.js');
const { analyseData } = require('../../Services/Calculations/DashboardCalculation.js');
const IssuesDataService = require('../../Services/Calculations/IssuesDataService.js');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : null;
const SINGLE_USER_ID = process.env.USER_ID || null;

function log(msg, data = {}) {
    const prefix = DRY_RUN ? '[DRY-RUN] ' : '';
    console.log(`${prefix}[migrateProUsersIssuesData] ${msg}`, Object.keys(data).length ? data : '');
}

/**
 * Get list of (userId, country, region) for all PRO and PRO Trial users.
 * Uses BOTH Subscription and User model so no Pro Trial user is missed:
 * - Subscription: planType PRO, status active or trialing.
 * - User: packageType PRO and (subscriptionStatus active/trialing OR isInTrialPeriod true).
 */
async function getProUserAccounts() {
    let userIds;

    if (SINGLE_USER_ID) {
        userIds = [new mongoose.Types.ObjectId(SINGLE_USER_ID)];
        log('Single user mode', { userId: SINGLE_USER_ID });
    } else {
        const fromSubs = await Subscription.find({
            planType: 'PRO',
            status: { $in: ['active', 'trialing'] }
        })
            .select('userId')
            .lean();
        const idsFromSubs = new Set(fromSubs.map(s => s.userId?.toString()).filter(Boolean));

        const fromUsers = await User.find({
            packageType: 'PRO',
            $or: [
                { subscriptionStatus: { $in: ['active', 'trialing'] } },
                { isInTrialPeriod: true }
            ]
        })
            .select('_id')
            .lean();
        const idsFromUsers = new Set(fromUsers.map(u => u._id?.toString()).filter(Boolean));

        const mergedIds = new Set([...idsFromSubs, ...idsFromUsers]);
        userIds = [...mergedIds].map(id => new mongoose.Types.ObjectId(id));

        if (LIMIT) {
            userIds = userIds.slice(0, LIMIT);
        }
        log('Pro/Pro Trial user IDs (Subscription + User)', {
            count: userIds.length,
            fromSubscription: idsFromSubs.size,
            fromUser: idsFromUsers.size,
            merged: mergedIds.size
        });
    }

    const accounts = [];
    for (const uid of userIds) {
        const seller = await Seller.findOne({ User: uid }).select('sellerAccount.country sellerAccount.region').lean();
        if (!seller || !seller.sellerAccount || seller.sellerAccount.length === 0) {
            log('No seller account(s) for user', { userId: uid.toString() });
            continue;
        }
        for (const acc of seller.sellerAccount) {
            if (acc.country && acc.region) {
                accounts.push({
                    userId: uid,
                    country: acc.country,
                    region: acc.region
                });
            }
        }
    }

    return accounts;
}

/**
 * Process one (userId, country, region): analyse, then store IssuesData.
 */
async function processAccount(userId, country, region) {
    const userIdStr = userId.toString();

    const getAnalyseData = await AnalyseService.Analyse(userIdStr, country, region);

    if (!getAnalyseData || getAnalyseData.status !== 200) {
        log('Analyse failed', {
            userId: userIdStr,
            country,
            region,
            status: getAnalyseData?.status
        });
        return { success: false, reason: 'analyse_failed' };
    }

    const calculationResult = await analyseData(getAnalyseData.message, userIdStr);

    if (!calculationResult?.dashboardData) {
        log('analyseData returned no dashboardData', { userId: userIdStr, country, region });
        return { success: false, reason: 'no_dashboard_data' };
    }

    const dashboardData = calculationResult.dashboardData;

    if (!DRY_RUN) {
        const issuesDataResult = await IssuesDataService.storeIssuesDataFromDashboard(
            userIdStr,
            country,
            region,
            dashboardData,
            'manual'
        );

        if (!issuesDataResult.success) {
            log('IssuesData store failed', {
                userId: userIdStr,
                country,
                region,
                error: issuesDataResult.error
            });
            return { success: false, reason: 'issues_data_store_failed' };
        }
    } else {
        const productCount = (dashboardData.productWiseError || []).length;
        const totalIssues = (dashboardData.TotalRankingerrors || 0) +
            (dashboardData.totalErrorInConversion || 0) +
            (dashboardData.totalInventoryErrors || 0) +
            (dashboardData.totalErrorInAccount || 0) +
            (dashboardData.totalProfitabilityErrors || 0) +
            (dashboardData.totalSponsoredAdsErrors || 0);
        log('Would store IssuesData', {
            userId: userIdStr,
            country,
            region,
            productsWithIssues: productCount,
            totalIssues
        });
    }

    return { success: true };
}

async function main() {
    const startedAt = Date.now();

    try {
        await dbConnect();
        log('DB connected');

        const accounts = await getProUserAccounts();
        if (accounts.length === 0) {
            log('No PRO/Pro Trial accounts to process. Exiting.');
            await mongoose.connection.close();
            process.exit(0);
            return;
        }

        log('Accounts to process', { count: accounts.length });
        if (DRY_RUN) {
            log('DRY RUN: no data will be written.');
        }

        let ok = 0;
        let fail = 0;

        for (let i = 0; i < accounts.length; i++) {
            const { userId, country, region } = accounts[i];
            log(`Processing ${i + 1}/${accounts.length}`, {
                userId: userId.toString(),
                country,
                region
            });

            try {
                const result = await processAccount(userId, country, region);
                if (result.success) ok++;
                else fail++;
            } catch (err) {
                fail++;
                log('Exception processing account', {
                    userId: userId.toString(),
                    country,
                    region,
                    error: err.message
                });
            }
        }

        const duration = Date.now() - startedAt;
        log('Migration completed', {
            total: accounts.length,
            success: ok,
            failed: fail,
            durationMs: duration
        });

        await mongoose.connection.close();
        process.exit(fail > 0 ? 1 : 0);
    } catch (err) {
        console.error('[migrateProUsersIssuesData] Fatal error', err?.message || err);
        try {
            await mongoose.connection.close();
        } catch (_) {
            // ignore
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { getProUserAccounts, processAccount };
