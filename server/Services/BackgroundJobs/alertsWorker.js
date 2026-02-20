/**
 * alertsWorker.js
 *
 * Independent Alerts Worker (cron-based)
 *
 * Runs ONLY on:
 * - Sunday (0)
 * - Wednesday (3)
 *
 * Responsibilities:
 * - Iterate all verified users who are subscribedToAlerts !== false
 * - For each seller account (country/region), run ALL alert services:
 *   - Product content change + negative reviews + A+ missing (detectAndStoreAlerts)
 *   - Buy box missing (detectAndStoreBuyBoxMissingAlerts)
 *   - Low inventory, stranded inventory, inbound shipment (inventory alert services)
 *   - Sales drop (detectSalesDrop -> create SalesDropAlert + email)
 *
 * Notes:
 * - This worker does NOT depend on the queue-based daily updates.
 * - It is safe to run in parallel with other workers; it only reads/writes alerts and sends emails.
 *
 * Usage:
 *   node server/Services/BackgroundJobs/alertsWorker.js
 *
 * Optional env:
 * - ALERTS_WORKER_CRON (default: "0 6 * * 0,3")  // 06:00 UTC on Sun/Wed
 * - TIMEZONE (default: "UTC")
 */

require('dotenv').config();

const cron = require('node-cron');
const mongoose = require('mongoose');

const dbConnect = require('../../config/dbConn.js');
const logger = require('../../utils/Logger.js');

const Seller = require('../../models/user-auth/sellerCentralModel.js');
const User = require('../../models/user-auth/userModel.js');

const { sendAlertsEmail } = require('../Email/SendAlertsEmail.js');
const { SalesDropAlert } = require('../../models/alerts/Alert.js');

const { detectAndStoreAlerts } = require('../Alerts/Other-Alerts/ProductContentChangeAlertService.js');
const { detectAndStoreBuyBoxMissingAlerts } = require('../Alerts/Other-Alerts/BuyBoxMissingAlertService.js');
const { detectAndStoreLowInventoryAlerts } = require('../Alerts/Other-Alerts/LowInventoryAlertService.js');
const { detectAndStoreStrandedInventoryAlerts } = require('../Alerts/Other-Alerts/StrandedInventoryAlertService.js');
const { detectAndStoreInboundShipmentAlerts } = require('../Alerts/Other-Alerts/InboundShipmentAlertService.js');
const { detectSalesDrop } = require('../Alerts/Other-Alerts/SalesDropAlertService.js');

const DEFAULT_CRON = '0 6 * * 0,3'; // 06:00 UTC Sunday + Wednesday
const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES_MS = 1000;

function normalizeId(id) {
  if (!id) return id;
  if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  return id;
}

async function processAccountAlerts({ user, userId, email, firstName, account }) {
  const country = account.country;
  const region = account.region;

  if (!country || !region) return { success: true, skipped: 'missing_country_or_region' };

  const results = {
    country,
    region,
    productContent: { ran: false, error: null, counts: { productContent: 0, negativeReviews: 0, aplus: 0 } },
    buyBoxMissing: { ran: false, error: null, count: 0 },
    inventory: { low: null, stranded: null, inbound: null, counts: { low: 0, stranded: 0, inbound: 0 } },
    salesDrop: { created: false, error: null, count: 0 },
  };

  // 1) Product content change + negative reviews + A+ missing (no email; we send one at the end)
  try {
    results.productContent.ran = true;
    const contentRes = await detectAndStoreAlerts(userId, region, country, { sendEmail: false });
    results.productContent.counts.productContent = contentRes?.productContentChange?.productsWithChanges ?? 0;
    results.productContent.counts.negativeReviews = contentRes?.negativeReviews?.productsWithChanges ?? 0;
    results.productContent.counts.aplus = contentRes?.aplusMissing?.productsWithChanges ?? 0;
  } catch (e) {
    results.productContent.error = e?.message || 'product content alerts failed';
    logger.warn('[AlertsWorker] Product content alerts failed (non-fatal)', { userId: String(userId), country, region, error: results.productContent.error });
  }

  // 2) Buy box missing (no email; we send one at the end)
  try {
    results.buyBoxMissing.ran = true;
    const buyBoxRes = await detectAndStoreBuyBoxMissingAlerts(userId, region, country, { sendEmail: false });
    results.buyBoxMissing.count = buyBoxRes?.productsWithChanges ?? 0;
  } catch (e) {
    results.buyBoxMissing.error = e?.message || 'buy box missing alerts failed';
    logger.warn('[AlertsWorker] Buy box missing alerts failed (non-fatal)', { userId: String(userId), country, region, error: results.buyBoxMissing.error });
  }

  // 3) Inventory alerts (create alerts only; no email here)
  try {
    const [lowRes, strandedRes, inboundRes] = await Promise.allSettled([
      detectAndStoreLowInventoryAlerts(userId, region, country),
      detectAndStoreStrandedInventoryAlerts(userId, region, country),
      detectAndStoreInboundShipmentAlerts(userId, region, country),
    ]);

    results.inventory.low = lowRes.status === 'fulfilled' ? lowRes.value : { created: false, productsCount: 0 };
    results.inventory.stranded = strandedRes.status === 'fulfilled' ? strandedRes.value : { created: false, productsCount: 0 };
    results.inventory.inbound = inboundRes.status === 'fulfilled' ? inboundRes.value : { created: false, productsCount: 0 };

    results.inventory.counts.low = results.inventory.low?.productsCount ?? (results.inventory.low?.alert?.products?.length ?? 0);
    results.inventory.counts.stranded = results.inventory.stranded?.productsCount ?? (results.inventory.stranded?.alert?.products?.length ?? 0);
    results.inventory.counts.inbound = results.inventory.inbound?.productsCount ?? (results.inventory.inbound?.alert?.products?.length ?? 0);
  } catch (e) {
    logger.warn('[AlertsWorker] Inventory alerts block failed (non-fatal)', { userId: String(userId), country, region, error: e?.message });
  }

  // 4) Sales drop (detect + store alert only; no email here)
  try {
    const dropRes = await detectSalesDrop(userId, region, country, {});
    if (dropRes?.detected && Array.isArray(dropRes.drops) && dropRes.drops.length > 0) {
      await SalesDropAlert.create({
        User: userId,
        region,
        country,
        message: `${dropRes.drops.length} sales drop(s) detected`,
        status: 'active',
        dateRange: dropRes.dateRange,
        marketplace: dropRes.marketplace,
        drops: dropRes.drops,
      });
      results.salesDrop.created = true;
      results.salesDrop.count = dropRes.drops.length;
    }
  } catch (e) {
    results.salesDrop.error = e?.message || 'sales drop alert failed';
    logger.warn('[AlertsWorker] Sales drop alert failed (non-fatal)', { userId: String(userId), country, region, error: results.salesDrop.error });
  }

  // 5) Single email with summary-only rows (one row per alert type with count)
  const productContentCount = results.productContent.counts.productContent;
  const negativeReviewsCount = results.productContent.counts.negativeReviews;
  const aplusCount = results.productContent.counts.aplus;
  const buyBoxCount = results.buyBoxMissing.count;
  const lowCount = results.inventory.counts.low;
  const strandedCount = results.inventory.counts.stranded;
  const inboundCount = results.inventory.counts.inbound;
  const salesDropCount = results.salesDrop.count;

  const totalAlerts = productContentCount + negativeReviewsCount + aplusCount + buyBoxCount + lowCount + strandedCount + inboundCount + salesDropCount;

  if (totalAlerts > 0 && email) {
    try {
      await sendAlertsEmail(
        email,
        firstName || 'Seller',
        {
          productContentChange: { count: productContentCount, products: [] },
          negativeReviews: { count: negativeReviewsCount, products: [] },
          buyBoxMissing: { count: buyBoxCount, products: [] },
          aplusMissing: { count: aplusCount, products: [] },
          salesDrop: { count: salesDropCount, drops: [] },
          lowInventory: { count: lowCount, products: [] },
          strandedInventory: { count: strandedCount, products: [] },
          inboundShipment: { count: inboundCount, products: [] },
        },
        undefined,
        userId,
        { summaryOnly: true }
      );
    } catch (emailErr) {
      logger.warn('[AlertsWorker] Consolidated alerts email failed (non-fatal)', { userId: String(userId), country, region, error: emailErr?.message });
    }
  }

  return { success: true, results };
}

async function processAllUsersAlerts() {
  const startedAt = Date.now();
  logger.info('[AlertsWorker] Starting alerts run – all alert services will run (product content, negative reviews, A+ missing, buybox missing, low/stranded/inbound inventory, sales drop)');

  await dbConnect();

  // Only run for subscribed users (missing field defaults true; migration backfills it).
  const subscribedUsers = await User.find({ isVerified: true, subscribedToAlerts: { $ne: false } })
    .select('_id email firstName subscribedToAlerts')
    .lean();

  const userById = new Map(subscribedUsers.map((u) => [String(u._id), u]));
  logger.info('[AlertsWorker] Subscribed verified users loaded', { count: subscribedUsers.length });

  // Load sellers for those users only
  const sellers = await Seller.find({ User: { $in: subscribedUsers.map((u) => u._id) } })
    .select('User sellerAccount')
    .lean();

  let processedAccounts = 0;
  let failedAccounts = 0;

  // Build processing list: each item is { user, account }
  const items = [];
  for (const s of sellers) {
    const uid = s?.User ? String(s.User) : null;
    if (!uid) continue;
    const user = userById.get(uid);
    if (!user) continue;
    const accounts = Array.isArray(s.sellerAccount) ? s.sellerAccount : [];
    for (const account of accounts) {
      // Skip entries without any token; many alerts require stored data or refresh token.
      if (!account?.country || !account?.region) continue;
      items.push({ user, account });
    }
  }

  logger.info('[AlertsWorker] Accounts to process', { count: items.length });

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchNo = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(items.length / BATCH_SIZE) || 1;

    logger.info('[AlertsWorker] Processing batch', { batchNo, totalBatches, batchSize: batch.length });

    const settled = await Promise.allSettled(
      batch.map(async ({ user, account }) => {
        const userId = normalizeId(user._id);
        return processAccountAlerts({
          user,
          userId,
          email: user.email,
          firstName: user.firstName,
          account,
        });
      })
    );

    for (const r of settled) {
      processedAccounts++;
      if (r.status === 'rejected' || r.value?.success !== true) {
        failedAccounts++;
      }
    }

    if (i + BATCH_SIZE < items.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  logger.info('[AlertsWorker] Alerts run completed', { processedAccounts, failedAccounts, durationSeconds });

  return { success: true, processedAccounts, failedAccounts, durationSeconds };
}

function setupAlertsCron() {
  const tz = process.env.TIMEZONE || 'UTC';
  const expr = process.env.ALERTS_WORKER_CRON || DEFAULT_CRON;

  // Cron expression (e.g. "0 6 * * 0,3") ensures this only fires on Sunday and Wednesday.
  // When it runs, we execute ALL alert services for every subscribed user/account.
  const cronJob = cron.schedule(
    expr,
    async () => {
      try {
        logger.info('[AlertsWorker] Cron fired – running all alert services (Sun/Wed run)');
        await processAllUsersAlerts();
      } catch (err) {
        logger.error('[AlertsWorker] Cron run failed', { error: err?.message, stack: err?.stack });
      }
    },
    { scheduled: false, timezone: tz }
  );

  cronJob.start();
  logger.info('[AlertsWorker] Alerts worker scheduled', { cron: expr, timezone: tz });
  return cronJob;
}

async function manualRun() {
  return processAllUsersAlerts();
}

if (require.main === module) {
  (async () => {
    try {
      logger.info('[AlertsWorker] Starting alerts worker...');
      await dbConnect();
      setupAlertsCron();
      logger.info('[AlertsWorker] Alerts worker is running');

      // Graceful shutdown handlers
      process.on('SIGINT', () => {
        logger.info('[AlertsWorker] Received SIGINT. Shutting down gracefully...');
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        logger.info('[AlertsWorker] Received SIGTERM. Shutting down gracefully...');
        process.exit(0);
      });
    } catch (err) {
      logger.error('[AlertsWorker] Failed to start', { error: err?.message, stack: err?.stack });
      process.exit(1);
    }
  })();
}

module.exports = {
  setupAlertsCron,
  processAllUsersAlerts,
  processAccountAlerts,
  manualRun,
};

