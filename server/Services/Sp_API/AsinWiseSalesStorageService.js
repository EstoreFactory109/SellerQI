const mongoose = require('mongoose');
const logger = require('../../utils/Logger.js');

const AsinWiseSalesRun = require('../../models/finance/AsinWiseSalesRunModel.js');
const AsinWiseSalesItem = require('../../models/finance/AsinWiseSalesItemModel.js');
const AsinWiseSalesDateItem = require('../../models/finance/AsinWiseSalesDateItemModel.js');
const SalesOrderId = require('../../models/finance/SalesOrderIdModel.js');

const { getSalesReport } = require('./asinwiseSales.js');

const CHUNK_INSERT_SIZE = 500;

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function internalRegionFromModel(regionModel) {
  if (regionModel === 'NA') return 'na';
  if (regionModel === 'EU') return 'eu';
  if (regionModel === 'FE') return 'apac';
  return null;
}

async function persistAsinWiseSalesResult({ userId, country, regionModel, result }) {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const metadata = result?.metadata || {};
  const data = result?.data || {};

  // ── Collect order IDs from the result (added by Fix 1) ──
  // getSalesReport() now returns result.orderIds alongside result.data
  const orderIds = Array.isArray(result?.orderIds) ? result.orderIds : [];

  const run = await AsinWiseSalesRun.create({
    User: userObjectId,
    country,
    region: regionModel,
    regionInternal: metadata.region || internalRegionFromModel(regionModel),
    marketplaceId: metadata.marketplaceId || 'UNKNOWN',
    dataSource: metadata.dataSource || 'report',
    days: Number(metadata.days) || 30,
    generatedAt: data.generatedAt ? new Date(data.generatedAt) : new Date(),
    totalAsins: Number(data.totalAsins) || 0,
    summary: {
      last7Days: {
        totalUnits: Number(data.summary?.last7Days?.totalUnits) || 0,
        totalRevenue: Number(data.summary?.last7Days?.totalRevenue) || 0,
        startDate: data.summary?.last7Days?.startDate || '',
        endDate: data.summary?.last7Days?.endDate || '',
      },
      last14Days: {
        totalUnits: Number(data.summary?.last14Days?.totalUnits) || 0,
        totalRevenue: Number(data.summary?.last14Days?.totalRevenue) || 0,
        startDate: data.summary?.last14Days?.startDate || '',
        endDate: data.summary?.last14Days?.endDate || '',
      },
      last30Days: {
        totalUnits: Number(data.summary?.last30Days?.totalUnits) || 0,
        totalRevenue: Number(data.summary?.last30Days?.totalRevenue) || 0,
        startDate: data.summary?.last30Days?.startDate || '',
        endDate: data.summary?.last30Days?.endDate || '',
      },
    },
  });

  const runId = run._id;
  const asinSales = Array.isArray(data.asinSales) ? data.asinSales : [];

  // Per-ASIN summary rows
  const asinDocs = asinSales.map((a) => ({
    runId,
    User: userObjectId,
    country,
    region: regionModel,
    asin: a.asin || '',
    sku: a.sku || '',
    productName: a.productName || '',
    currency: a.currency || '',
    last7Days: {
      totalUnits: Number(a.last7Days?.totalUnits) || 0,
      totalRevenue: Number(a.last7Days?.totalRevenue) || 0,
    },
    last14Days: {
      totalUnits: Number(a.last14Days?.totalUnits) || 0,
      totalRevenue: Number(a.last14Days?.totalRevenue) || 0,
    },
    last30Days: {
      totalUnits: Number(a.last30Days?.totalUnits) || 0,
      totalRevenue: Number(a.last30Days?.totalRevenue) || 0,
    },
  }));

  for (const chunk of chunkArray(asinDocs, CHUNK_INSERT_SIZE)) {
    if (chunk.length === 0) continue;
    await AsinWiseSalesItem.insertMany(chunk, { ordered: false });
  }

  // Per-ASIN per-date rows
  const dateDocs = [];
  for (const a of asinSales) {
    const dateWise = Array.isArray(a.dateWiseSales) ? a.dateWiseSales : [];
    for (const d of dateWise) {
      dateDocs.push({
        runId,
        User: userObjectId,
        country,
        region: regionModel,
        asin: a.asin || '',
        date: d.date || '',
        units: Number(d.units) || 0,
        revenue: Number(d.revenue) || 0,
      });
    }
  }

  for (const chunk of chunkArray(dateDocs, CHUNK_INSERT_SIZE)) {
    if (chunk.length === 0) continue;
    await AsinWiseSalesDateItem.insertMany(chunk, { ordered: false });
  }

  // ┌──────────────────────────────────────────────────────────────────┐
  // │  NEW: Persist order IDs for expense matching (Fix 2 prep)       │
  // │                                                                  │
  // │  These are the amazon-order-ids from the sales report that      │
  // │  passed all filters (not cancelled, not MCF, not zero-price).   │
  // │  The expense system will query this collection to determine     │
  // │  whether an expense belongs to the current sales period.        │
  // └──────────────────────────────────────────────────────────────────┘
  if (orderIds.length > 0) {
    const orderIdDocs = orderIds.map((oid) => ({
      runId,
      User: userObjectId,
      country,
      region: regionModel,
      orderId: oid,
    }));

    for (const chunk of chunkArray(orderIdDocs, CHUNK_INSERT_SIZE)) {
      if (chunk.length === 0) continue;
      await SalesOrderId.insertMany(chunk, { ordered: false });
    }

    logger.info(`[AsinWiseSalesStorageService] Saved ${orderIds.length} order IDs to SalesOrderId.`);
  }

  return runId;
}

async function buildAsinWiseSalesResponseFromDB({ userId, country, regionModel }) {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const run = await AsinWiseSalesRun.findOne({
    User: userObjectId,
    country,
    region: regionModel,
  })
    .sort({ generatedAt: -1 })
    .lean();

  if (!run) return null;

  const [asinRows, dateRows] = await Promise.all([
    AsinWiseSalesItem.find({ runId: run._id })
      .sort({ 'last30Days.totalRevenue': -1 })
      .lean(),
    AsinWiseSalesDateItem.find({ runId: run._id })
      .sort({ date: 1 })
      .lean(),
  ]);

  const dateMapByAsin = new Map();
  for (const d of dateRows) {
    if (!dateMapByAsin.has(d.asin)) dateMapByAsin.set(d.asin, []);
    dateMapByAsin.get(d.asin).push({
      date: d.date,
      units: d.units,
      revenue: d.revenue,
    });
  }

  const asinSales = asinRows.map((a) => ({
    asin: a.asin,
    sku: a.sku || '',
    productName: a.productName || '',
    currency: a.currency || '',
    last7Days: {
      totalUnits: Number(a.last7Days?.totalUnits) || 0,
      totalRevenue: Number(a.last7Days?.totalRevenue) || 0,
    },
    last14Days: {
      totalUnits: Number(a.last14Days?.totalUnits) || 0,
      totalRevenue: Number(a.last14Days?.totalRevenue) || 0,
    },
    last30Days: {
      totalUnits: Number(a.last30Days?.totalUnits) || 0,
      totalRevenue: Number(a.last30Days?.totalRevenue) || 0,
    },
    dateWiseSales: dateMapByAsin.get(a.asin) || [],
  }));

  return {
    data: {
      generatedAt: run.generatedAt ? new Date(run.generatedAt).toISOString() : new Date().toISOString(),
      totalAsins: run.totalAsins || asinSales.length,
      summary: {
        last7Days: {
          totalUnits: Number(run.summary?.last7Days?.totalUnits) || 0,
          totalRevenue: Number(run.summary?.last7Days?.totalRevenue) || 0,
          startDate: run.summary?.last7Days?.startDate || '',
          endDate: run.summary?.last7Days?.endDate || '',
        },
        last14Days: {
          totalUnits: Number(run.summary?.last14Days?.totalUnits) || 0,
          totalRevenue: Number(run.summary?.last14Days?.totalRevenue) || 0,
          startDate: run.summary?.last14Days?.startDate || '',
          endDate: run.summary?.last14Days?.endDate || '',
        },
        last30Days: {
          totalUnits: Number(run.summary?.last30Days?.totalUnits) || 0,
          totalRevenue: Number(run.summary?.last30Days?.totalRevenue) || 0,
          startDate: run.summary?.last30Days?.startDate || '',
          endDate: run.summary?.last30Days?.endDate || '',
        },
      },
      asinSales,
    },
    metadata: {
      country,
      region: run.regionInternal || internalRegionFromModel(regionModel),
      marketplaceId: run.marketplaceId,
      dataSource: run.dataSource,
      days: run.days,
      generatedAt: run.generatedAt ? new Date(run.generatedAt).toISOString() : new Date().toISOString(),
    },
  };
}

/**
 * Get the set of order IDs from the latest sales run for a user/country/region.
 * Used by the expense system (Fix 2) to match expenses to current-period sales.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.country
 * @param {string} params.regionModel - 'NA' | 'EU' | 'FE'
 * @returns {Set<string>} Set of amazon-order-ids from the latest sales run
 */
async function getSalesOrderIdSet({ userId, country, regionModel }) {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  // Find the latest sales run
  const latestRun = await AsinWiseSalesRun.findOne({
    User: userObjectId,
    country,
    region: regionModel,
  })
    .sort({ generatedAt: -1 })
    .select('_id')
    .lean();

  if (!latestRun) return new Set();

  // Get all order IDs for that run
  const orderIdDocs = await SalesOrderId.find({ runId: latestRun._id })
    .select('orderId')
    .lean();

  return new Set(orderIdDocs.map((doc) => doc.orderId));
}

async function fetchPersistAndReturnAsinWiseSales({
  userId,
  country,
  regionModel,
  refreshToken,
  accessToken,
  days = 30,
  dataSource = 'report',
  clientId = process.env.SPAPI_CLIENT_ID,
  clientSecret = process.env.SPAPI_CLIENT_SECRET,
}) {
  const regionInternal = internalRegionFromModel(regionModel);
  if (!regionInternal) {
    throw new Error(`Invalid regionModel: ${regionModel}. Expected NA, EU, FE.`);
  }

  logger.info('[AsinWiseSalesStorageService] Fetching ASIN-wise sales from SP-API...', {
    userId,
    country,
    regionModel,
    days,
    dataSource,
  });

  const computed = await getSalesReport({
    refreshToken,
    accessToken,
    clientId,
    clientSecret,
    country,
    region: regionInternal,
    days: Number(days) || 30,
    dataSource,
  });

  await persistAsinWiseSalesResult({
    userId,
    country,
    regionModel,
    result: computed,
  });

  logger.info('[AsinWiseSalesStorageService] Returning ASIN-wise sales from Mongo...');
  return buildAsinWiseSalesResponseFromDB({ userId, country, regionModel });
}

module.exports = {
  fetchPersistAndReturnAsinWiseSales,
  buildAsinWiseSalesResponseFromDB,
  getSalesOrderIdSet,
};