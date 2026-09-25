/**
 * Verify every figure on the ESF reports against the raw collections.
 *
 * WHY THIS EXISTS
 * The unit tests run against mocks, so they prove the service is internally
 * consistent — not that the numbers are right. Every real bug found while this
 * feature was built slipped past a green test suite:
 *
 *   - Units Sold read 0 for every account, because it used the wrong collection
 *   - The review-request window reported "no data" for an account holding 15,973
 *     orders, because it anchored on today instead of the newest order
 *   - Monthly performance went blank whenever metric backfills lagged
 *
 * All three were caught by recomputing the figures straight from Mongo and
 * comparing. That is what this script does, for every ESF client and every
 * marketplace they have.
 *
 * The arithmetic here is deliberately written WITHOUT reusing the service's
 * helpers: a bug in that service must not be able to hide by being repeated in
 * its own check.
 *
 * READ-ONLY. Touches nothing, sends nothing.
 *
 * USAGE
 *   node server/scripts/verifyEsfReportData.js              # every ESF client
 *   node server/scripts/verifyEsfReportData.js --email=a@b.com   # just one
 *   node server/scripts/verifyEsfReportData.js --verbose    # print every check
 */
require('dotenv').config();

const mongoose = require('mongoose');
const dbConsts = require('../config/config.js');

const User = require('../models/user-auth/userModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const BuyBoxData = require('../models/MCP/BuyBoxDataModel.js');
const Restock = require('../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
const Planning = require('../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js');
const AccountHistory = require('../models/user-auth/AccountHistory.js');
const Content = require('../models/seller-performance/NumberOfProductReviewsModel.js');
const APlus = require('../models/seller-performance/APlusContentModel.js');
const ReviewOrder = require('../models/review/ReviewOrderModel.js');
const SalesOnly = require('../models/MCP/SalesOnlyMetricsModel.js');
const PPC = require('../models/amazon-ads/PPCMetricsModel.js');
const { getEsfReports, getEsfReportRows } = require('../Services/Calculations/EsfReportsService.js');

const arg = (name) => {
    const found = process.argv.find((a) => a.startsWith(`--${name}=`));
    return found ? found.split('=').slice(1).join('=') : null;
};
const VERBOSE = process.argv.includes('--verbose');

/** SP-API report columns arrive as strings; coerce the same way the report does. */
const n = (v) => { const p = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(p) ? p : 0; };
const ymd = (d) => d.toISOString().slice(0, 10);

let passed = 0;
const failures = [];
const check = (scope, label, reported, raw) => {
    if (String(reported) === String(raw)) {
        passed += 1;
        if (VERBOSE) console.log(`    ok    ${label.padEnd(30)} ${reported}`);
        return;
    }
    failures.push(`${scope} :: ${label} -> report=${reported}  raw=${raw}`);
};

const stat = (report, label) => {
    const found = report?.summary?.stats?.find((s) => s.label === label);
    return found ? found.value : undefined;
};

(async () => {
    await mongoose.connect(`${dbConsts.dbUri}/${dbConsts.dbName}`, { connectTimeoutMS: 60000 });

    const onlyEmail = arg('email');
    const query = onlyEmail
        ? { email: new RegExp(`^${onlyEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        : { isEsfClient: true };

    const clients = await User.find(query).select('_id email').lean();
    console.log(`Verifying ${clients.length} account(s) against raw collections\n`);

    let marketplaces = 0;
    let pdfs = 0;

    for (const client of clients) {
        const seller = await Seller.findOne({ User: client._id }).select('sellerAccount').lean();
        for (const acc of (seller?.sellerAccount || []).filter((a) => a.country && a.region)) {
            const { country, region } = acc;
            const q = { User: client._id, country, region };
            const scope = `${String(client._id).slice(-6)} ${country}`;
            marketplaces += 1;

            const payload = await getEsfReports(client._id, country, region);
            const R = (k) => payload.reports.find((r) => r.key === k);
            const products = acc.products || [];
            const available = payload.reports.filter((r) => r.available);
            console.log(`${scope.padEnd(12)} ${available.length}/7 reports  (${products.length} listings)`);

            // ---- account overview ------------------------------------------
            const ao = R('account-overview');
            if (ao?.available) {
                const active = products.filter((p) => String(p.status || '').toLowerCase() === 'active');
                const withStock = active.filter((p) => n(p.quantity) > 0).length;
                check(scope, 'AO total listings', stat(ao, 'Total listings'), products.length);
                check(scope, 'AO active', stat(ao, 'Active'), active.length);
                check(scope, 'AO with stock', stat(ao, 'Active with stock'), withStock);
                check(scope, 'AO out of stock', stat(ao, 'Out of stock'), active.length - withStock);
            }

            // ---- buy box ----------------------------------------------------
            const bb = R('buybox');
            if (bb?.available) {
                const snap = await BuyBoxData.findOne(q).sort({ createdAt: -1 }).lean();
                const losing = (snap.asinBuyBoxData || []).filter((r) => n(r.buyBoxPercentage) === 0).length;
                check(scope, 'BB tracked', stat(bb, 'ASINs tracked'), snap.totalProducts || 0);
                check(scope, 'BB winning', stat(bb, 'Winning'), snap.productsWithBuyBox || 0);
                check(scope, 'BB losing', stat(bb, 'Losing'), losing);
                check(scope, 'BB insight', bb.insight, `${losing} of ${snap.totalProducts || 0} ASINs losing buy box`);
            }

            // ---- restock -----------------------------------------------------
            const rs = R('inventory-restock');
            if (rs?.available) {
                const doc = await Restock.findOne(q).sort({ createdAt: -1 }).lean();
                const P = doc.Products || [];
                const urgent = P.filter((p) => /urgent|out of stock/i.test(String(p.alert || ''))).length;
                const need = P.filter((p) => n(p.recommendedReplenishmentQty) > 0).length;
                const value = Math.round(P.reduce((s, p) => s + (n(p.recommendedReplenishmentQty) > 0 ? n(p.recommendedReplenishmentQty) * n(p.price) : 0), 0) * 100) / 100;
                check(scope, 'RS tracked', stat(rs, 'SKUs tracked'), P.length);
                check(scope, 'RS urgent', stat(rs, 'Urgent'), urgent);
                check(scope, 'RS need restock', stat(rs, 'Need restock'), need);
                check(scope, 'RS reorder value', stat(rs, 'Est. reorder value'), value);
                check(scope, 'RS inbound', stat(rs, 'Inbound units'), P.reduce((s, p) => s + (n(p.inbound) || n(p.working) + n(p.shipped) + n(p.receiving)), 0));
                check(scope, 'RS unfulfillable', stat(rs, 'Unfulfillable'), P.reduce((s, p) => s + n(p.unfulfillable), 0));

                // Trace a few table rows all the way back to the source document.
                const paged = await getEsfReportRows(client._id, country, region, 'inventory-restock', { page: 1, limit: 40 });
                const bySku = new Map(P.map((p) => [p.merchantSku, p]));
                for (const row of (paged?.rows || []).slice(0, 3)) {
                    const src = bySku.get(row.sku);
                    if (!src) { failures.push(`${scope} :: RS row ${row.sku} not found in source`); continue; }
                    check(scope, `RS row ${row.sku} qty`, row.recommendedQty, n(src.recommendedReplenishmentQty));
                    check(scope, `RS row ${row.sku} value`, row.reorderValue, Math.round(n(src.recommendedReplenishmentQty) * n(src.price) * 100) / 100);
                    check(scope, `RS row ${row.sku} reserved`, row.reserved, n(src.customerOrder));
                }
            }

            // ---- aged inventory ----------------------------------------------
            const ag = R('fba-aged-inventory');
            if (ag?.available) {
                const doc = await Planning.findOne(q).sort({ createdAt: -1 }).lean();
                const d = doc.data || [];
                check(scope, 'AG tracked', stat(ag, 'ASINs tracked'), d.length);
                check(scope, 'AG 365+', stat(ag, '365+ days'), d.reduce((s, i) => s + n(i.quantity_to_be_charged_ais_365_plus_days), 0));
                check(scope, 'AG unfulfillable', stat(ag, 'Unfulfillable'), d.reduce((s, i) => s + n(i.unfulfillable_quantity), 0));
            }

            // ---- listings audit ------------------------------------------------
            const au = R('listings-audit');
            if (au?.available) {
                const ct = await Content.findOne(q).sort({ createdAt: -1 }).lean();
                const ap = await APlus.findOne(q).sort({ createdAt: -1 }).lean();
                const byAsin = new Map((ct?.Products || []).map((p) => [p.asin, p]));
                const apMap = new Map((ap?.ApiContentDetails || []).map((i) => [i.Asins, String(i.status || '').toUpperCase()]));
                let scored = 0; let bullets = 0; let images = 0;
                for (const p of products) {
                    const d = byAsin.get(p.asin);
                    const flags = [
                        !!d?.about_product?.length,
                        !!d?.product_description?.length,
                        (d?.product_photos?.length || 0) >= 5,
                        !!d?.video_url?.length,
                        ['APPROVED', 'ACTIVE', 'SUBMITTED'].includes(apMap.get(p.asin) || ''),
                        !!d?.has_brandstory,
                    ];
                    bullets += flags[0] ? 1 : 0;
                    images += flags[2] ? 1 : 0;
                    scored += flags.filter(Boolean).length;
                }
                check(scope, 'AU completion', stat(au, 'Completion'), Math.round((scored / (products.length * 6)) * 100));
                check(scope, 'AU reviewed', stat(au, 'Listings reviewed'), products.length);
                check(scope, 'AU bullets', stat(au, 'Bullet points'), bullets);
                check(scope, 'AU 5+ images', stat(au, '5+ images'), images);
            }

            // ---- review requests --------------------------------------------
            const rv = R('review-requests');
            if (rv?.available) {
                const newest = await ReviewOrder.findOne(q).sort({ purchaseDate: -1 }).select('purchaseDate').lean();
                const anchor = new Date(`${ymd(new Date(newest.purchaseDate))}T00:00:00.000Z`);
                const w = { ...q, purchaseDate: { $gte: new Date(anchor.getTime() - 7 * 86400000) } };
                const total = await ReviewOrder.countDocuments(w);
                const sent = await ReviewOrder.countDocuments({ ...w, reviewRequestStatus: 'sent' });
                const eligible = await ReviewOrder.countDocuments({ ...w, canRequestReview: true });
                check(scope, 'RV orders checked', stat(rv, 'Orders checked'), total);
                check(scope, 'RV sent', stat(rv, 'Requests sent'), sent);
                check(scope, 'RV eligible', stat(rv, 'Eligible'), eligible);
                check(scope, 'RV ineligible', stat(rv, 'Ineligible'), Math.max(total - eligible, 0));
            }

            // ---- monthly performance -------------------------------------------
            const mp = R('monthly-performance');
            if (mp?.available) {
                const ls = await SalesOnly.findOne(q).sort({ date: -1 }).select('date').lean();
                const lp = await PPC.findOne({ userId: String(client._id), country, region }).sort({ metricDate: -1 }).select('metricDate').lean();
                const latest = [ls?.date, lp?.metricDate].filter(Boolean).sort().pop();
                const anchor = new Date(`${latest}T00:00:00.000Z`);
                const mStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
                const mEnd = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
                const cEnd = anchor < mEnd ? anchor : mEnd;

                const salesRows = await SalesOnly.find({ ...q, date: { $gte: ymd(mStart), $lte: ymd(cEnd) } }).select('sales').lean();
                const sales = Math.round(salesRows.reduce((s, r) => s + (r.sales?.amount || 0), 0) * 100) / 100;
                const ppcRows = await PPC.find({ userId: String(client._id), country, region, metricDate: { $gte: ymd(mStart), $lte: ymd(cEnd) } }).select('summary').lean();
                const adSales = Math.round(ppcRows.reduce((s, r) => s + (r.summary?.totalSales || 0), 0) * 100) / 100;
                const adSpend = Math.round(ppcRows.reduce((s, r) => s + (r.summary?.totalSpend || 0), 0) * 100) / 100;
                const impressions = ppcRows.reduce((s, r) => s + (r.summary?.totalImpressions || 0), 0);
                const clicks = ppcRows.reduce((s, r) => s + (r.summary?.totalClicks || 0), 0);

                check(scope, 'MP total sales', stat(mp, 'Total sales'), sales);
                check(scope, 'MP ad sales', stat(mp, 'Ad sales'), adSales);
                check(scope, 'MP ad spend', stat(mp, 'Ad spend'), adSpend);
                check(scope, 'MP acos', stat(mp, 'ACOS'), adSales ? Math.round((adSpend / adSales) * 10000) / 100 : null);
                check(scope, 'MP impressions', stat(mp, 'Impressions'), impressions);
                check(scope, 'MP clicks', stat(mp, 'Clicks'), clicks);
                check(scope, 'MP ctr', stat(mp, 'CTR'), impressions ? Math.round((clicks / impressions) * 10000) / 100 : null);
                check(scope, 'MP organic', stat(mp, 'Organic sales'), Math.round((sales - adSales) * 100) / 100);

                // Units and sessions come from the deduped Data Kiosk snapshots:
                // one capture per day, latest wins. Summing documents instead would
                // double-count any day captured twice.
                const snaps = await BuyBoxData.find({ ...q, date: { $gte: ymd(mStart), $lte: ymd(cEnd) } })
                    .sort({ date: 1, createdAt: 1 }).select('date asinBuyBoxData').lean();
                const byDate = new Map();
                for (const s of snaps) if (s.date) byDate.set(s.date, s);
                let units = 0; let sessions = 0;
                for (const s of byDate.values()) {
                    for (const r of s.asinBuyBoxData || []) { units += r.unitsOrdered || 0; sessions += r.sessions || 0; }
                }
                check(scope, 'MP units sold', stat(mp, 'Units sold'), units);
                check(scope, 'MP sessions', stat(mp, 'Sessions'), sessions);
            }

            pdfs += available.length;
        }
    }

    console.log(`\n${marketplaces} marketplaces, ${pdfs} reports built`);
    console.log(`${passed} figures match the raw data, ${failures.length} mismatched`);
    for (const f of failures) console.log(`  FAIL ${f}`);

    await mongoose.disconnect();
    process.exit(failures.length ? 1 : 0);
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
