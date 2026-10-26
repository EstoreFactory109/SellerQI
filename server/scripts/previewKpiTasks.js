#!/usr/bin/env node
/**
 * Preview the tasks-logics.xlsx tasks (all waves) against real accounts. READ-ONLY.
 *
 * Runs Analyse + analyseData with `persistTasks: false` (writes nothing) and the
 * wave forced on inside THIS process only — the deployed flag is not touched.
 * Prints, per marketplace, how many tasks of each new type would be created and
 * a few samples, so the thresholds can be checked against Seller Central before
 * KPI_TASKS_WAVE1 is enabled for anyone.
 *
 * Usage (from the repo root):
 *   node server/scripts/previewKpiTasks.js --user-id=<id>[,<id>...]
 *   node server/scripts/previewKpiTasks.js --limit=10
 *   node server/scripts/previewKpiTasks.js --limit=10 --samples=5 --json=/tmp/kpi-preview.json
 *
 * Note: it connects to whatever DB the root .env names — in this repo that is
 * production. It only reads.
 */

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Before anything that reads the gate is required: on for every account, here only.
process.env.KPI_TASKS_WAVE1 = 'true';
process.env.KPI_TASKS_WAVE2 = 'true';
process.env.KPI_TASKS_WAVE3 = 'true';
delete process.env.KPI_TASKS_USER_IDS;

const dbConsts = require('../config/config.js');
const MONGODB_URI =
    dbConsts.dbUri && dbConsts.dbName
        ? `${dbConsts.dbUri}/${dbConsts.dbName}`
        : process.env.MONGODB_URI || process.env.MONGO_URI;

const Seller = require('../models/user-auth/sellerCentralModel.js');

const getArg = (name) => {
    const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
    return m ? m.slice(name.length + 3).trim() : null;
};

const ONLY_USERS = (getArg('user-id') || '').split(',').map(s => s.trim()).filter(Boolean);
const LIMIT = Number(getArg('limit')) || Infinity;
const SAMPLES = Number(getArg('samples')) || 3;
const JSON_OUT = getArg('json');
const TIMEOUT_MS = 10 * 60 * 1000;

const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms))
]);

async function previewMarketplace(userId, country, region) {
    const { AnalyseService } = require('../Services/main/Analyse.js');
    const { analyseData } = require('../Services/Calculations/DashboardCalculation.js');

    const analysed = await AnalyseService.Analyse(userId, country, region);
    if (!analysed || analysed.status !== 200 || !analysed.message) {
        throw new Error(`Analyse returned status ${analysed && analysed.status}`);
    }
    // persistTasks:false = no task writes. The userId stays, so live per-ASIN finance is read.
    const result = await analyseData(analysed.message, userId, { persistTasks: false });
    const inputs = analysed.message.KpiInputs || null;
    const conversion = analysed.message?.ConversionData || {};
    const ready = {
        // Listing checks only (before), and no open P1-P3 task (now shown on the dashboard).
        listingChecks: (conversion.AmazonReadyproducts || []).length,
        noP1toP3: (result?.dashboardData?.amazonReadyProducts || []).length,
        candidates: (conversion.AmazonReadyCandidates || []).length
    };
    return { tasks: result?.kpiTasks || [], allTasks: result?.previewTasks || [], inputs, stale: result?.kpiStaleSources || [], faults: result?.kpiDataFaults || [], ready };
}

const describeInputs = (inputs) => {
    if (!inputs) return 'KpiInputs MISSING';
    return [
        `stock=${inputs.stock ? `${Object.keys(inputs.stock.byAsin).length} asins @${(inputs.stock.fetchedAt || '?').slice(0, 10)}` : 'none'}`,
        `cogs=${Array.isArray(inputs.cogsAsins) ? inputs.cogsAsins.length : 'unread'}`,
        `ahr=${(inputs.ahrHistory || []).length} reports`,
        `suppressed=${inputs.suppressed ? `${inputs.suppressed.items.length} @${(inputs.suppressed.createdAt || '?').slice(0, 10)}` : 'none'}`,
        `removals=${inputs.removals ? `${inputs.removals.lines.length} lines @${(inputs.removals.createdAt || '?').slice(0, 10)}` : 'none'}`,
        // Orders whose reimbursements matched by order id: 0 everywhere would mean the join never hits.
        `removalReimbursed=${inputs.removalReimbursements ? `${Object.keys(inputs.removalReimbursements).length} orders` : 'unread'}`,
        `sales60=${inputs.salesLookback ? `${Object.keys(inputs.salesLookback).length} asins` : 'none'}`,
        `traffic=${inputs.traffic ? `${Object.keys(inputs.traffic.byAsin).length} asins @${inputs.traffic.newestDate} base=${inputs.traffic.baselineDays}d` : 'none'}`,
        `tacos=${inputs.tacos ? `@${inputs.tacos.newestDate}` : 'none'}`,
        `reviews=${inputs.reviews ? `@${(inputs.reviews.newest.at || '').slice(0, 10)}${inputs.reviews.older ? ' +older' : ''}` : 'none'}`,
        `restock=${inputs.restock ? inputs.restock.rows.length : 'none'}`,
        `fbaFees=${inputs.fbaFees ? (inputs.fbaFees.previous ? '2 snapshots' : '1 snapshot') : 'none'}`,
        `planningCols=${inputs.planning ? (inputs.planning.rows.some(r => r.short !== null || r.long !== null || r.feeApplied !== null) ? 'yes' : 'no') : 'none'}`,
        `invoice=${inputs.invoice ? (Object.keys(inputs.invoice).length ? inputs.invoice.invoiceDefectRateStatus || 'blank' : 'not read yet') : 'none'}`
    ].join(' ');
};

async function main() {
    if (!MONGODB_URI) throw new Error('No Mongo URI configured');
    await mongoose.connect(MONGODB_URI);
    console.log('KPI preview (waves 1-3) — READ ONLY (persistTasks:false, flag forced on in this process only)');

    const tuples = await Seller.aggregate([
        { $unwind: '$sellerAccount' },
        { $group: { _id: '$User', marketplaces: { $addToSet: { country: '$sellerAccount.country', region: '$sellerAccount.region' } } } },
        { $sort: { _id: 1 } }
    ]);
    let accounts = tuples
        .filter(t => t._id)
        .map(t => ({ userId: String(t._id), marketplaces: (t.marketplaces || []).filter(m => m && m.country && m.region) }))
        .filter(a => a.marketplaces.length > 0);
    if (ONLY_USERS.length > 0) accounts = accounts.filter(a => ONLY_USERS.includes(a.userId));
    accounts = accounts.slice(0, LIMIT);

    const totals = {};
    const report = [];
    for (const account of accounts) {
        for (const { country, region } of account.marketplaces) {
            const label = `${account.userId} ${country}-${region}`;
            try {
                const { tasks, allTasks, inputs, stale, faults, ready } = await withTimeout(previewMarketplace(account.userId, country, region), TIMEOUT_MS, label);
                const byType = {};
                for (const t of tasks) (byType[t.errorType] = byType[t.errorType] || []).push(t);
                console.log(`\n${label}: ${tasks.length} tasks  [${describeInputs(inputs)}]`);
                if (ready) console.log(`  Amazon Ready: ${ready.noP1toP3} of ${ready.candidates} judged (listing checks alone gave ${ready.listingChecks})`);
                if (faults.length) console.log(`  DATA FAULT: ${faults.map(f => `${f.source}: ${f.fault}`).join('; ')}`);
                if (stale.length) console.log(`  STALE: ${stale.map(s => `${s.source} ${s.ageHours}h > ${s.maxHours}h`).join(', ')}`);
                for (const [type, list] of Object.entries(byType)) {
                    totals[type] = (totals[type] || 0) + list.length;
                    console.log(`  ${type}: ${list.length}`);
                    for (const t of list.slice(0, SAMPLES)) {
                        const money = t.amount ? `  amount=${t.amount}${t.amountIsEstimated ? ' (est)' : ''}` : '';
                        console.log(`    - ${t.asin} ${t.productName}${money}\n      ${t.error}`);
                    }
                }
                // Every task the account would get (old checks and new), by category:type.
                const allByType = {};
                for (const t of allTasks) {
                    const key = `${t.errorCategory}:${String(t.errorType).replace(/^replenishment_needed_.*/, 'replenishment_needed')}`;
                    allByType[key] = (allByType[key] || 0) + 1;
                }
                report.push({ userId: account.userId, country, region, inputs: describeInputs(inputs), stale, tasks, allByType, allCount: allTasks.length });
            } catch (error) {
                console.log(`\n${label}: ERROR ${error.message}`);
                report.push({ userId: account.userId, country, region, error: error.message });
            }
        }
    }

    console.log('\nTotals by type:', totals);
    if (JSON_OUT) {
        fs.writeFileSync(JSON_OUT, JSON.stringify({ totals, report }, null, 2));
        console.log(`Full detail written to ${JSON_OUT}`);
    }
    await mongoose.disconnect();
    process.exit(0);
}

main().catch(async (error) => {
    console.error('Preview failed:', error.message);
    try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
    process.exit(1);
});
