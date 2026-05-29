#!/usr/bin/env node
/**
 * exportAdsDataDateWise.js
 *
 * Pull date-wise PPC ads data (sales, spend, units sold, impressions, clicks,
 * ACoS, ROAS, CTR, CPC, purchases) from MongoDB for one (user, country, region)
 * over a given date range, and write a CSV to `exports/ads/`.
 *
 * Source collection: PPCMetrics (one row per day per account).
 *
 * Usage:
 *   node server/scripts/exportAdsDataDateWise.js \
 *        --user-id=69ce5770e7af88006e46a36d \
 *        --country=IN --region=EU \
 *        --start=2026-05-01 --end=2026-05-27
 *
 *   # Output: exports/ads/ads-69ce5770e7af88006e46a36d-IN-EU-2026-05-01_to_2026-05-27.csv
 *
 * Optional flags:
 *   --json       also write a JSON file alongside the CSV
 *   --include-breakdown   add per-campaign-type (SP/SB/SD) columns
 */

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const PPCMetrics = require('../models/amazon-ads/PPCMetricsModel.js');

// ── Arg parsing ──────────────────────────────────────────────
function getArg(name) {
    const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
    return m ? m.split('=')[1].trim() : null;
}
function hasFlag(name) {
    return process.argv.slice(2).includes(`--${name}`);
}

const USER_ID = getArg('user-id');
const COUNTRY = (getArg('country') || '').toUpperCase();
const REGION = (getArg('region') || '').toUpperCase();
const START = getArg('start');
const END = getArg('end');
const INCLUDE_BREAKDOWN = hasFlag('include-breakdown');
const ALSO_JSON = hasFlag('json');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

if (!USER_ID || !COUNTRY || !REGION || !START || !END) {
    console.error('Missing args. Example:');
    console.error('  node server/scripts/exportAdsDataDateWise.js \\');
    console.error('       --user-id=69ce5770e7af88006e46a36d --country=IN --region=EU \\');
    console.error('       --start=2026-05-01 --end=2026-05-27');
    process.exit(1);
}
if (!ISO_DATE.test(START) || !ISO_DATE.test(END)) {
    console.error(`Dates must be YYYY-MM-DD (got start=${START}, end=${END})`);
    process.exit(1);
}
if (START > END) {
    console.error(`--start (${START}) must be <= --end (${END})`);
    process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────
function num(v, decimals = 2) {
    const n = typeof v === 'number' ? v : Number(v || 0);
    if (!Number.isFinite(n)) return '0';
    return n.toFixed(decimals);
}

function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function buildDateList(start, end) {
    const out = [];
    const cur = new Date(`${start}T00:00:00.000Z`);
    const last = new Date(`${end}T00:00:00.000Z`);
    while (cur <= last) {
        out.push(cur.toISOString().substring(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
    const uri = dbConsts.dbUri && dbConsts.dbName
        ? `${dbConsts.dbUri}/${dbConsts.dbName}`
        : process.env.MONGODB_URI || process.env.MONGO_URI;
    await mongoose.connect(uri);
    console.log(`[export-ads] Connected. Fetching PPCMetrics for ${USER_ID} ${COUNTRY}-${REGION} ${START}→${END}...`);

    const rows = await PPCMetrics.find({
        userId: USER_ID,
        country: COUNTRY,
        region: REGION,
        metricDate: { $gte: START, $lte: END }
    })
        .sort({ metricDate: 1 })
        .lean();

    console.log(`[export-ads] Found ${rows.length} day-rows in PPCMetrics.`);

    // Map by date for O(1) lookup so missing days show as blanks.
    const byDate = new Map();
    for (const r of rows) byDate.set(r.metricDate, r);

    const allDates = buildDateList(START, END);

    // Column order (consistent across all rows):
    const baseHeaders = [
        'date',
        'sales',
        'spend',
        'unitsSold',
        'purchases',
        'impressions',
        'clicks',
        'acos_percent',
        'roas',
        'ctr_percent',
        'cpc'
    ];
    const breakdownHeaders = INCLUDE_BREAKDOWN ? [
        'sp_sales', 'sp_spend', 'sp_impressions', 'sp_clicks', 'sp_units',
        'sb_sales', 'sb_spend', 'sb_impressions', 'sb_clicks', 'sb_units',
        'sd_sales', 'sd_spend', 'sd_impressions', 'sd_clicks', 'sd_units'
    ] : [];
    const headers = [...baseHeaders, ...breakdownHeaders];

    // Build per-date output rows
    const outputRows = [];
    let totalsAll = {
        sales: 0, spend: 0, unitsSold: 0, purchases: 0,
        impressions: 0, clicks: 0
    };
    let missingCount = 0;

    for (const date of allDates) {
        const r = byDate.get(date);
        if (!r) {
            missingCount++;
            const blank = { date };
            for (const h of headers.slice(1)) blank[h] = '';
            outputRows.push(blank);
            continue;
        }
        const s = r.summary || {};
        const sp = r.campaignTypeBreakdown?.sponsoredProducts || {};
        const sb = r.campaignTypeBreakdown?.sponsoredBrands || {};
        const sd = r.campaignTypeBreakdown?.sponsoredDisplay || {};

        const row = {
            date,
            sales: num(s.totalSales, 2),
            spend: num(s.totalSpend, 2),
            unitsSold: s.totalUnitsSoldClicks1d || 0,
            purchases: s.totalPurchases || 0,
            impressions: s.totalImpressions || 0,
            clicks: s.totalClicks || 0,
            acos_percent: num(s.overallAcos, 2),
            roas: num(s.overallRoas, 4),
            ctr_percent: num(s.ctr, 4),
            cpc: num(s.cpc, 4)
        };
        if (INCLUDE_BREAKDOWN) {
            row.sp_sales = num(sp.sales, 2);
            row.sp_spend = num(sp.spend, 2);
            row.sp_impressions = sp.impressions || 0;
            row.sp_clicks = sp.clicks || 0;
            row.sp_units = sp.unitsSoldClicks1d || 0;
            row.sb_sales = num(sb.sales, 2);
            row.sb_spend = num(sb.spend, 2);
            row.sb_impressions = sb.impressions || 0;
            row.sb_clicks = sb.clicks || 0;
            row.sb_units = sb.unitsSoldClicks1d || 0;
            row.sd_sales = num(sd.sales, 2);
            row.sd_spend = num(sd.spend, 2);
            row.sd_impressions = sd.impressions || 0;
            row.sd_clicks = sd.clicks || 0;
            row.sd_units = sd.unitsSoldClicks1d || 0;
        }
        outputRows.push(row);

        totalsAll.sales += Number(s.totalSales) || 0;
        totalsAll.spend += Number(s.totalSpend) || 0;
        totalsAll.unitsSold += Number(s.totalUnitsSoldClicks1d) || 0;
        totalsAll.purchases += Number(s.totalPurchases) || 0;
        totalsAll.impressions += Number(s.totalImpressions) || 0;
        totalsAll.clicks += Number(s.totalClicks) || 0;
    }

    // Totals row
    const totalAcos = totalsAll.sales > 0
        ? (totalsAll.spend / totalsAll.sales) * 100
        : 0;
    const totalRoas = totalsAll.spend > 0
        ? totalsAll.sales / totalsAll.spend
        : 0;
    const totalCtr = totalsAll.impressions > 0
        ? (totalsAll.clicks / totalsAll.impressions) * 100
        : 0;
    const totalCpc = totalsAll.clicks > 0
        ? totalsAll.spend / totalsAll.clicks
        : 0;

    const totalRow = {
        date: 'TOTAL',
        sales: num(totalsAll.sales, 2),
        spend: num(totalsAll.spend, 2),
        unitsSold: totalsAll.unitsSold,
        purchases: totalsAll.purchases,
        impressions: totalsAll.impressions,
        clicks: totalsAll.clicks,
        acos_percent: num(totalAcos, 2),
        roas: num(totalRoas, 4),
        ctr_percent: num(totalCtr, 4),
        cpc: num(totalCpc, 4)
    };
    if (INCLUDE_BREAKDOWN) {
        for (const h of breakdownHeaders) totalRow[h] = '';
    }
    outputRows.push(totalRow);

    // ── Write CSV ──────────────────────────────────────────
    const exportDir = path.resolve(__dirname, '../../exports/ads');
    fs.mkdirSync(exportDir, { recursive: true });

    const baseName = `ads-${USER_ID}-${COUNTRY}-${REGION}-${START}_to_${END}`;
    const csvPath = path.join(exportDir, `${baseName}.csv`);

    const csvLines = [headers.join(',')];
    for (const r of outputRows) {
        csvLines.push(headers.map((h) => csvCell(r[h])).join(','));
    }
    fs.writeFileSync(csvPath, csvLines.join('\n') + '\n', 'utf8');
    console.log(`[export-ads] Wrote ${outputRows.length - 1} day-rows + 1 total row → ${csvPath}`);

    if (ALSO_JSON) {
        const jsonPath = path.join(exportDir, `${baseName}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify({
            userId: USER_ID,
            country: COUNTRY,
            region: REGION,
            start: START,
            end: END,
            generatedAt: new Date().toISOString(),
            daysInRange: allDates.length,
            daysWithData: allDates.length - missingCount,
            daysMissing: missingCount,
            totals: totalRow,
            rows: outputRows.slice(0, -1)
        }, null, 2), 'utf8');
        console.log(`[export-ads] Wrote JSON → ${jsonPath}`);
    }

    // Summary to stdout
    console.log('\n── Summary ──');
    console.log(`Days in range:           ${allDates.length}`);
    console.log(`Days with PPC data:      ${allDates.length - missingCount}`);
    console.log(`Days missing (no row):   ${missingCount}`);
    console.log(`Total sales:             ${num(totalsAll.sales, 2)}`);
    console.log(`Total spend:             ${num(totalsAll.spend, 2)}`);
    console.log(`Total units sold:        ${totalsAll.unitsSold}`);
    console.log(`Total impressions:       ${totalsAll.impressions}`);
    console.log(`Total clicks:            ${totalsAll.clicks}`);
    console.log(`Range ACoS %:            ${num(totalAcos, 2)}`);
    console.log(`Range ROAS:              ${num(totalRoas, 4)}`);
}

main()
    .catch((err) => {
        console.error('[export-ads] FAILED:', err.message);
        if (err.stack) console.error(err.stack);
        process.exitCode = 1;
    })
    .finally(async () => {
        try { await mongoose.disconnect(); } catch {}
    });
