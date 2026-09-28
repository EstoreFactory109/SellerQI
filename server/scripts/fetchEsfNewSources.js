#!/usr/bin/env node
/**
 * Fetch, once and by hand, the four sources added from the ESF API feasibility
 * check — without waiting for the next scheduled sync.
 *
 *   v2        V2 Seller Performance report (rates, on-time delivery,
 *             chargebacks, IP / customer complaints, missing tracking)
 *   fyp       Suppressed Listings Report
 *   removals  FBA removal order detail
 *   b2b       Data Kiosk sales & traffic, now keeping the B2B split
 *   offers    Buy Box competitor price, for the ASINs we are losing
 *   aplus     A+ Content API, for the A+ Premium column
 *
 * WRITES TO MONGO, exactly as the sync would: one new snapshot per source per
 * marketplace, through the same parsers and models. Nothing else is touched.
 *
 * It also saves Amazon's raw responses (--raw-dir, default ./esf-raw) so the
 * parsers can be checked against a real response for the first time — none of
 * them could be when they were written.
 *
 * Usage:
 *   node server/scripts/fetchEsfNewSources.js                       # every ESF client
 *   node server/scripts/fetchEsfNewSources.js --user-id=<id> --country=UK
 *   node server/scripts/fetchEsfNewSources.js --only=v2,fyp --raw-dir=/tmp/raw
 */
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const User = require('../models/user-auth/userModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const V2SellerPerformance = require('../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const SuppressedListings = require('../models/products/SuppressedListingsModel.js');
const RemovalOrders = require('../models/inventory/RemovalOrdersModel.js');
const { getAccessToken, resolveMarketplaceAndRegion } = require('../Services/Sp_API/SpApiMarketplace.js');
const spCredentials = require('../Services/Sp_API/config.js');
const { runSpApiReportInline } = require('../Services/Sp_API/spApiReportAdapter.js');
const { buildSnapshot } = require('../Services/Sp_API/V2_Seller_Performance_Report.js');
const { parseSuppressedListings } = require('../Services/Sp_API/GET_MERCHANTS_LISTINGS_FYP_REPORT.js');
const removals = require('../Services/Sp_API/GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA.js');
const { fetchAndStoreSalesOnlyData } = require('../Services/MCP/MCPSalesOnlyIntegration.js');
// The two sources added earlier on this branch, also never fetched from here.
const { syncCompetitiveOffers } = require('../Services/Sp_API/GET_COMPETITIVE_OFFERS.js');
const getAPlusContent = require('../Services/Sp_API/GET_APLUS_CONTENT.js');

const arg = (name) => {
    const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=').trim() : null;
};
const USER_ID = arg('user-id');
const COUNTRY = (arg('country') || '').toUpperCase();
const ONLY = new Set((arg('only') || 'v2,fyp,removals,b2b,offers,aplus').split(',').map((s) => s.trim()));
const RAW_DIR = path.resolve(arg('raw-dir') || 'esf-raw');

const gunzipIfNeeded = (buffer) => (buffer?.[0] === 0x1f && buffer?.[1] === 0x8b ? zlib.gunzipSync(buffer) : buffer);
const saveRaw = (name, buffer) => {
    fs.mkdirSync(RAW_DIR, { recursive: true });
    const file = path.join(RAW_DIR, name);
    fs.writeFileSync(file, gunzipIfNeeded(buffer));
    return file;
};

/** One source, reported as a line; never throws past here. */
const run = async (label, fn) => {
    const started = Date.now();
    try {
        const note = await fn();
        console.log(`    ok    ${label.padEnd(10)} ${note}  (${Math.round((Date.now() - started) / 1000)}s)`);
        return true;
    } catch (error) {
        const detail = error.response?.data ? JSON.stringify(error.response.data).slice(0, 300) : error.message;
        console.log(`    FAIL  ${label.padEnd(10)} ${detail}`);
        return false;
    }
};

const fetchV2 = async (ctx) => {
    const now = new Date();
    const end = new Date(now.getTime() - 2 * 60 * 1000);
    const body = {
        reportType: 'GET_V2_SELLER_PERFORMANCE_REPORT',
        marketplaceIds: [ctx.marketplaceId],
        dataStartTime: new Date(end.getTime() - 7 * 86400000).toISOString(),
        dataEndTime: end.toISOString(),
    };
    const result = await runSpApiReportInline({ accessToken: ctx.accessToken, baseuri: ctx.baseuri, body, pollMs: 30000, maxPolls: 20 });
    if (result.status !== 'DONE') throw new Error(`report ${result.status}${result.note ? `: ${result.note}` : ''}`);
    const file = saveRaw(`${ctx.tag}-v2.json`, result.buffer);
    const snapshot = buildSnapshot(JSON.parse(fs.readFileSync(file, 'utf8')));
    await V2SellerPerformance.create({ User: ctx.userId, country: ctx.country, region: ctx.region, ...snapshot });
    return `ODR ${snapshot.orderDefectRatePct ?? '—'}%, OTDR ${snapshot.unitOnTimeDeliveryRatePct ?? snapshot.onTimeDeliveryRatePct ?? '—'}%, `
        + `chargebacks ${snapshot.chargebackCount ?? '—'}, ${snapshot.policyMetrics?.length ?? 0} policy metrics, raw -> ${file}`;
};

const fetchFyp = async (ctx) => {
    const result = await runSpApiReportInline({
        accessToken: ctx.accessToken, baseuri: ctx.baseuri, retries: 1,
        body: { reportType: 'GET_MERCHANTS_LISTINGS_FYP_REPORT', marketplaceIds: [ctx.marketplaceId] },
    });
    if (result.status === 'FAILED') throw new Error(result.note);
    const parsed = result.status === 'NO_DATA'
        ? { items: [], itemCount: 0, suppressedCount: 0, atRiskCount: 0, headers: [], unreadable: false }
        : await parseSuppressedListings(result.buffer);
    if (result.buffer) saveRaw(`${ctx.tag}-fyp.tsv`, result.buffer);
    await SuppressedListings.create({ User: ctx.userId, country: ctx.country, region: ctx.region, ...parsed });
    return `${parsed.suppressedCount} suppressed, ${parsed.atRiskCount} at risk${parsed.unreadable ? ' — UNREADABLE' : ''}; headers: ${parsed.headers.join(' | ') || '(none)'}`;
};

const fetchRemovals = async (ctx) => {
    const now = new Date();
    const body = {
        reportType: removals.REPORT_TYPE,
        marketplaceIds: [ctx.marketplaceId],
        dataStartTime: new Date(now.getTime() - removals.WINDOW_DAYS * 86400000).toISOString(),
        dataEndTime: now.toISOString(),
    };
    const result = await runSpApiReportInline({ accessToken: ctx.accessToken, baseuri: ctx.baseuri, body, retries: 1 });
    if (result.status === 'FAILED') throw new Error(result.note);
    const parsed = result.status === 'NO_DATA'
        ? { lines: [], lineCount: 0, pendingOrderCount: 0, pendingUnits: 0, headers: [], unreadable: false }
        : await removals.parseRemovalOrders(result.buffer);
    if (result.buffer) saveRaw(`${ctx.tag}-removals.tsv`, result.buffer);
    await RemovalOrders.create({
        User: ctx.userId, country: ctx.country, region: ctx.region,
        windowStart: body.dataStartTime, windowEnd: body.dataEndTime, ...parsed,
    });
    return `${parsed.lineCount} lines, ${parsed.pendingOrderCount} orders pending (${parsed.pendingUnits} units)${parsed.unreadable ? ' — UNREADABLE' : ''}`;
};

const fetchB2b = async (ctx) => {
    const result = await fetchAndStoreSalesOnlyData(ctx.userId, ctx.refreshToken, ctx.region, ctx.country);
    if (!result?.success) throw new Error(result?.error || 'sales-only fetch failed');
    const days = await mongoose.model('SalesOnlyMetrics').find({ User: ctx.userId, country: ctx.country, region: ctx.region, 'b2b.unitsOrderedTotal': { $ne: null } }).select('b2b').lean();
    const reported = days.filter((d) => d.b2b?.unitsOrderedB2B !== null && d.b2b?.unitsOrderedB2B !== undefined);
    const b2bUnits = reported.reduce((sum, d) => sum + (d.b2b.unitsOrderedB2B || 0), 0);
    return `${days.length} days carry the split, ${reported.length} with a B2B figure (${b2bUnits} B2B units)`;
};

const fetchOffers = async (ctx) => {
    const doc = await syncCompetitiveOffers(ctx.accessToken, [ctx.marketplaceId], ctx.userId, ctx.baseuri, ctx.country, ctx.region);
    if (!doc) return 'nothing stored (no contested ASIN, or the call failed — see log)';
    const items = doc.items || [];
    return `${items.length} contested ASIN(s) priced, ${items.filter((i) => i.buyBoxPrice !== null && i.buyBoxPrice !== undefined).length} with a Buy Box price`;
};

const fetchAplus = async (ctx) => {
    const doc = await getAPlusContent(ctx.accessToken, [ctx.marketplaceId], ctx.userId, ctx.baseuri, ctx.country, ctx.region);
    if (!doc) throw new Error('A+ fetch returned nothing — see log');
    const docs = doc.documents || [];
    return `${docs.length} ASIN(s) with A+, ${docs.filter((d) => d.isPremium).length} Premium`;
};

(async () => {
    const uri = dbConsts.dbUri && dbConsts.dbName ? `${dbConsts.dbUri}/${dbConsts.dbName}` : process.env.MONGODB_URI;
    await mongoose.connect(uri, { connectTimeoutMS: 60000 });

    const clientId = spCredentials.clientId || process.env.SPAPI_CLIENT_ID;
    const clientSecret = spCredentials.clientSecret || process.env.SPAPI_CLIENT_SECRET;

    const users = USER_ID
        ? await User.find({ _id: USER_ID }).select('_id email').lean()
        : await User.find({ isEsfClient: true }).select('_id email').lean();

    let ok = 0;
    let failed = 0;
    for (const user of users) {
        const seller = await Seller.findOne({ User: user._id }).select('sellerAccount').lean();
        const accounts = (seller?.sellerAccount || []).filter((a) => a.country && a.region && (!COUNTRY || a.country === COUNTRY));
        for (const account of accounts) {
            console.log(`\n${user.email}  ${account.country}/${account.region}`);
            if (!account.spiRefreshToken) {
                console.log('    skip  no SP-API refresh token on this marketplace');
                continue;
            }
            let marketplaceId;
            let baseUrl;
            try {
                ({ marketplaceId, baseUrl } = resolveMarketplaceAndRegion(account.country));
            } catch (error) {
                console.log(`    skip  ${error.message}`);
                continue;
            }

            let accessToken;
            try {
                accessToken = await getAccessToken(clientId, clientSecret, account.spiRefreshToken);
            } catch (error) {
                console.log(`    FAIL  token      ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
                failed += ONLY.size;
                continue;
            }

            const ctx = {
                userId: user._id,
                country: account.country,
                region: account.region,
                marketplaceId,
                baseuri: String(baseUrl).replace(/^https?:\/\//, ''),
                accessToken,
                refreshToken: account.spiRefreshToken,
                tag: `${String(user._id).slice(-6)}-${account.country}`,
            };

            const jobs = [];
            if (ONLY.has('v2')) jobs.push(run('v2', () => fetchV2(ctx)));
            if (ONLY.has('fyp')) jobs.push(run('fyp', () => fetchFyp(ctx)));
            if (ONLY.has('removals')) jobs.push(run('removals', () => fetchRemovals(ctx)));
            if (ONLY.has('b2b')) jobs.push(run('b2b', () => fetchB2b(ctx)));
            if (ONLY.has('offers')) jobs.push(run('offers', () => fetchOffers(ctx)));
            if (ONLY.has('aplus')) jobs.push(run('aplus', () => fetchAplus(ctx)));
            for (const success of await Promise.all(jobs)) success ? ok += 1 : failed += 1;
        }
    }

    await mongoose.disconnect();
    console.log(`\n${ok} fetched, ${failed} failed. Raw responses in ${RAW_DIR}`);
    process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
