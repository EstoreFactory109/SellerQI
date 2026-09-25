/**
 * Verify what actually reaches the PDF, not just what the payload holds.
 *
 * WHY THIS EXISTS SEPARATELY FROM verifyEsfReportData.js
 * That script proves the numbers are right. This one proves they arrive on the
 * page — a different failure, and one that has already happened: the stat band
 * rendered `stats.slice(0, 4)`, silently dropping everything past the fourth
 * tile. Monthly Performance lost ACOS, Listings Audit lost four of its six
 * content checks. Every figure was correct and none of them printed.
 *
 * The PDF's text is subset-encoded and cannot be read back out of the file, so
 * this walks the pdfmake document definition instead — the same object the
 * renderer consumes — and checks every stat has a tile, every table has rows,
 * and the file really is a PDF.
 *
 * READ-ONLY. Renders in memory; writes nothing unless --out is given.
 *
 * USAGE
 *   node server/scripts/verifyEsfPdfContent.js
 *   node server/scripts/verifyEsfPdfContent.js --email=a@b.com
 *   node server/scripts/verifyEsfPdfContent.js --out=./tmp-pdfs   # also save them
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dbConsts = require('../config/config.js');

const User = require('../models/user-auth/userModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const { getEsfReports, getEsfReportRows } = require('../Services/Calculations/EsfReportsService.js');
const { buildReportDocDefinition, renderReportPdf, reportPdfFilename, MAX_PDF_ROWS } = require('../Services/Reports/reportPdf.js');

const arg = (name) => {
    const found = process.argv.find((a) => a.startsWith(`--${name}=`));
    return found ? found.split('=').slice(1).join('=') : null;
};

/** The tile band paints every cell with the template's light blue. */
const TILE_FILL = '#DCE6F1';

let passed = 0;
const failures = [];
const check = (scope, label, actual, expected) => {
    if (String(actual) === String(expected)) { passed += 1; return; }
    failures.push(`${scope} :: ${label} -> got ${actual}, expected ${expected}`);
};

/** Count the stat tiles the document definition will actually draw. */
const countTiles = (definition) => {
    let tiles = 0;
    for (const node of definition.content) {
        const row = node?.table?.body?.[0];
        if (Array.isArray(row)) tiles += row.filter((cell) => cell && cell.fillColor === TILE_FILL).length;
    }
    return tiles;
};

(async () => {
    await mongoose.connect(`${dbConsts.dbUri}/${dbConsts.dbName}`, { connectTimeoutMS: 60000 });

    const onlyEmail = arg('email');
    const outDir = arg('out');
    if (outDir) fs.mkdirSync(outDir, { recursive: true });

    const query = onlyEmail
        ? { email: new RegExp(`^${onlyEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        : { isEsfClient: true };
    const clients = await User.find(query).select('_id email').lean();
    console.log(`Checking PDF content for ${clients.length} account(s)\n`);

    let rendered = 0;

    for (const client of clients) {
        const seller = await Seller.findOne({ User: client._id }).select('sellerAccount').lean();
        for (const acc of (seller?.sellerAccount || []).filter((a) => a.country && a.region)) {
            const { country, region } = acc;
            const scope = `${String(client._id).slice(-6)} ${country}`;
            const payload = await getEsfReports(client._id, country, region);

            for (const report of payload.reports) {
                if (!report.available) continue;

                // Deepen the table the same way the mailer does before rendering.
                const paged = await getEsfReportRows(client._id, country, region, report.key, { page: 1, limit: MAX_PDF_ROWS });
                if (paged?.available && paged.rows?.length) {
                    report.summary = { ...report.summary, rows: paged.rows, totalRows: paged.totalRows };
                }

                const definition = buildReportDocDefinition(report, { marketplace: payload.marketplace, currency: '$' });

                // Every stat must have a tile. This is the check that caught the
                // slice(0, 4) bug; a substring search over the page text did not,
                // because values like "0" also appear in the table below.
                check(scope, `${report.key} tiles`, countTiles(definition), (report.summary.stats || []).length);

                // A table that has rows in the payload must have rows on the page.
                if (report.summary.rows?.length) {
                    const hasRows = definition.content.some((node) => node?.table?.body?.length > 1);
                    check(scope, `${report.key} table rendered`, hasRows, true);
                }

                // Secondary tables (Account Health, Sales by ASIN) must render too.
                if (report.summary.secondaryTable?.rows?.length) {
                    const tables = definition.content.filter((node) => node?.table?.body?.length > 1).length;
                    check(scope, `${report.key} has 2 tables`, tables >= 2, true);
                }

                const buffer = await renderReportPdf(report, { marketplace: payload.marketplace, currency: '$' });
                check(scope, `${report.key} valid PDF`, buffer.slice(0, 5).toString(), '%PDF-');
                rendered += 1;

                if (outDir) {
                    fs.writeFileSync(path.join(outDir, `${scope.replace(/\s/g, '_')}_${reportPdfFilename(report, payload.marketplace)}`), buffer);
                }
            }
            console.log(`${scope.padEnd(12)} ${payload.reports.filter((r) => r.available).length}/7 reports checked`);
        }
    }

    console.log(`\n${rendered} PDFs rendered`);
    console.log(`${passed} checks passed, ${failures.length} failed`);
    for (const f of failures) console.log(`  FAIL ${f}`);
    if (outDir) console.log(`PDFs written to ${outDir}`);

    await mongoose.disconnect();
    process.exit(failures.length ? 1 : 0);
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
