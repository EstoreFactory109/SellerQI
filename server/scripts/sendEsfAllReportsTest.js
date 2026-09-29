/**
 * TEST SEND — every ESF report for one account, in ONE email.
 *
 * Builds all seven reports for the account exactly as the scheduled mailer
 * does (account-wide, every marketplace, at PDF depth), prints a checklist of
 * what each report actually carries, and emails them all together so the whole
 * set can be reviewed in one place.
 *
 *   To  ankanmandal2001@gmail.com
 *   Cc  ayanm102435@gmail.com
 *
 * SAFETY
 *   - Recipients are HARDCODED below and passed as an override, so the script
 *     never resolves anyone else's address and never loops over clients.
 *   - DRY RUN unless --send is passed: a bare run builds every PDF and prints
 *     the checklist without opening an SMTP connection.
 *
 * USAGE
 *   node server/scripts/sendEsfAllReportsTest.js                 # dry run
 *   node server/scripts/sendEsfAllReportsTest.js --send          # send it
 *   node server/scripts/sendEsfAllReportsTest.js --out=./pdfs    # also save the PDFs
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const dbConnect = require('../config/dbConn.js');
const User = require('../models/user-auth/userModel.js');
const { buildAttachmentsForClient, CADENCE_GROUPS } = require('../Services/BackgroundJobs/esfReportsMailer.js');
const { getEsfAccountReports } = require('../Services/Calculations/EsfAccountReportsService.js');
const { MAX_PDF_ROWS } = require('../Services/Reports/reportPdf.js');
const { sendEsfReportsEmail, createReportsTransport } = require('../Services/Email/SendEsfReportsEmail.js');

const SOURCE_ACCOUNT = 'ankanmandal2001@gmail.com';
const TO = 'ankanmandal2001@gmail.com';
const CC = 'ayanm102435@gmail.com';

/** Every report, in the order a reader meets them. */
const ALL_REPORTS = {
    label: 'All',
    reportKeys: Object.values(CADENCE_GROUPS).flatMap((group) => group.reportKeys),
};

const arg = (name) => {
    const found = process.argv.find((a) => a.startsWith(`--${name}=`));
    return found ? found.split('=').slice(1).join('=') : null;
};
const send = process.argv.includes('--send');
const outDir = arg('out');

/** What a reader should find in each report: the newest fields, by where they live. */
const EXPECTED = {
    'account-overview': {
        tiles: ['Suppressed'],
        rows: ['Order Defect Rate', 'On-Time Delivery', 'Chargebacks', 'Shipments without valid tracking', 'IP complaints received', 'Suspected IP violations', 'Product authenticity complaints', 'Product condition complaints', 'Product safety complaints'],
    },
    buybox: { tiles: ['Suppressed listings', 'Priced above Buy Box'], columns: ['Buy Box price', 'Gap', 'Pricing', 'Buy Box seller'] },
    'fba-aged-inventory': { tiles: ['Pending removal orders', 'Units pending removal'] },
    'listings-audit': { tiles: ['A+ Premium'], columns: ['A+ Premium'] },
    'monthly-performance': { tiles: ['Regular units', 'B2B units', 'B2B share of units'], charts: 2 },
    'inventory-restock': {},
    'review-requests': {},
};

/** Tiles that are correctly absent in some states, and the test for that state. */
const CONDITIONAL_TILES = {
    'Priced above Buy Box': Object.assign(
        (summaries) => summaries.every((s) => !(s?.rows || []).length),
        { why: 'no ASIN is losing the Buy Box' }
    ),
};

/** The per-marketplace summaries a report carries: its sections, or itself. */
const summariesOf = (report) => (report.multi ? (report.sections || []).filter((s) => s.available).map((s) => s.summary) : [report.summary]);

const checklist = (report) => {
    const expected = EXPECTED[report.key] || {};
    const summaries = summariesOf(report);
    const lines = [];
    const found = (label, ok) => lines.push(`      ${ok ? 'ok  ' : 'MISS'} ${label}`);

    for (const label of expected.tiles || []) {
        const present = summaries.some((s) => (s?.stats || []).some((stat) => stat.label === label));
        // Pricing tiles exist only when an ASIN is losing the Buy Box; with
        // none losing, their absence is the right answer, not a gap.
        if (!present && CONDITIONAL_TILES[label]?.(summaries)) {
            lines.push(`      n/a  tile: ${label} (${CONDITIONAL_TILES[label].why})`);
            continue;
        }
        found(`tile: ${label}`, present);
    }
    for (const label of expected.columns || []) {
        found(`column: ${label}`, summaries.some((s) => (s?.columns || []).some((c) => c.label === label)));
    }
    for (const prefix of expected.rows || []) {
        const row = summaries.flatMap((s) => s?.secondaryTable?.rows || []).find((r) => String(r.metric).startsWith(prefix));
        found(`health row: ${prefix}${row ? `  →  ${row.status}` : ''}`, Boolean(row));
    }
    if (expected.charts) {
        const charts = report.multi ? report.overview?.charts : report.summary?.charts;
        found(`charts: ${(charts || []).map((c) => c.title).join(', ') || 'none'}`, (charts || []).length === expected.charts);
    }
    found(`takeaway: "${String((report.multi ? report.overview?.takeaway : report.summary?.takeaway) || '').slice(0, 90)}…"`,
        Boolean(report.multi ? report.overview?.takeaway : report.summary?.takeaway));
    return lines;
};

const main = async () => {
    console.log('='.repeat(76));
    console.log('ESF ALL-REPORTS TEST SEND');
    console.log(`  account : ${SOURCE_ACCOUNT}`);
    console.log(`  to      : ${TO}`);
    console.log(`  cc      : ${CC}`);
    console.log(`  mode    : ${send ? '*** SENDING REAL EMAIL ***' : 'dry run (pass --send to send)'}`);
    console.log('='.repeat(76));

    await dbConnect();
    const user = await User.findOne({ email: SOURCE_ACCOUNT }).select('_id firstName email isEsfClient').lean();
    if (!user) throw new Error(`No user with email ${SOURCE_ACCOUNT}`);

    // The checklist reads the same account-wide build the PDFs are made from.
    const account = await getEsfAccountReports(user._id, { rowLimit: MAX_PDF_ROWS });
    console.log(`\nmarketplaces: ${account.marketplaces.map((m) => m.country).join(', ') || 'none'}   primary: ${account.primary?.country || '—'}\n`);

    for (const report of account.reports) {
        console.log(`  ${report.available ? '■' : '□'} ${report.name}${report.available ? `  —  ${report.insight}` : `  —  NOT AVAILABLE: ${report.reason}`}`);
        if (report.available) checklist(report).forEach((line) => console.log(line));
    }

    const { attachments, summaries } = await buildAttachmentsForClient(user, ALL_REPORTS);
    console.log(`\n${attachments.length} PDF(s) built:`);
    if (outDir) fs.mkdirSync(outDir, { recursive: true });
    for (const a of attachments) {
        console.log(`    ${a.filename}  (${(a.content.length / 1024).toFixed(1)} KB)`);
        if (outDir) fs.writeFileSync(path.join(outDir, a.filename), a.content);
    }

    if (!attachments.length) {
        console.log('\nNothing available for this account — no email.');
    } else if (!send) {
        console.log('\nDry run only. Re-run with --send to deliver.');
    } else {
        const transport = createReportsTransport();
        try {
            const messageId = await sendEsfReportsEmail({
                email: user.email,
                firstName: user.firstName || 'there',
                userId: user._id,
                cadenceLabel: 'All (TEST)',
                reports: summaries,
                attachments,
                transport,
                recipientOverride: TO,
                cc: CC,
            });
            console.log(messageId ? `\nSENT — messageId ${messageId}` : '\nFAILED to send — see the logs above');
            if (!messageId) process.exitCode = 1;
        } finally {
            transport.close();
        }
    }

    console.log('='.repeat(76));
    await mongoose.disconnect();
};

main().catch(async (error) => {
    console.error('\nFAILED:', error.message);
    try { await mongoose.disconnect(); } catch { /* already closed */ }
    process.exit(1);
});
