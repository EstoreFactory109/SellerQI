/**
 * Verify the report paths that have no data behind them YET.
 *
 * WHY THIS EXISTS
 * verifyEsfReportData.js and verifyEsfPdfContent.js check every figure the
 * reports currently produce. Both pass — and both are silent about the three
 * newest sources, because all three collections are empty:
 *
 *   CompetitiveOffers  0 documents   (Buy Box price, gap, pricing flag, seller)
 *   APlusPremium       0 documents   (A+ Premium column)
 *   listingIssues[]    0 listings    (suppressed-listings table)
 *
 * Empty is the correct state today: the first two need a live Amazon call that
 * cannot be made from here (every SP-API account returns 401 invalid_client),
 * and the third fills on the next catalogue sync. But it means the code that
 * reads them has never run against real account data, and "the suite is green"
 * would be a misleading thing to say about it.
 *
 * So this script supplies that data in memory — never to the database — over a
 * REAL ESF account's real ASINs, and drives the whole chain: builders, report
 * payload, and the PDF a client is actually emailed. It is what tells us the
 * feature will work the day the fetchers first run, rather than finding out in
 * production.
 *
 * WHAT IT CANNOT TELL US
 * Nothing here proves the FETCHERS parse Amazon correctly — no live response
 * was ever available. It proves everything downstream of them.
 *
 * READ-ONLY. Writes nothing, sends nothing. The model stubs are installed on
 * in-process objects and removed again before exit.
 *
 * USAGE
 *   node server/scripts/verifyEsfPendingSources.js
 *   node server/scripts/verifyEsfPendingSources.js --verbose
 */
require('dotenv').config();

const mongoose = require('mongoose');
const dbConsts = require('../config/config.js');

const User = require('../models/user-auth/userModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const CompetitiveOffers = require('../models/products/CompetitiveOffersModel.js');
const APlusPremium = require('../models/seller-performance/APlusPremiumModel.js');
const { getEsfReports } = require('../Services/Calculations/EsfReportsService.js');
const { buildReportDocDefinition, renderReportPdf } = require('../Services/Reports/reportPdf.js');

const VERBOSE = process.argv.includes('--verbose');

let passed = 0;
const failures = [];
const check = (scope, label, actual, expected) => {
    if (String(actual) === String(expected)) {
        passed += 1;
        if (VERBOSE) console.log(`    ok    ${label.padEnd(46)} ${actual}`);
        return;
    }
    failures.push(`${scope} :: ${label} -> got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

/** Every string in a pdfmake document definition, flattened. */
const allText = (node, out = []) => {
    if (node === null || node === undefined) return out;
    if (Array.isArray(node)) { node.forEach((child) => allText(child, out)); return out; }
    if (typeof node === 'object') {
        if (typeof node.text === 'string') out.push(node.text);
        Object.values(node).forEach((value) => allText(value, out));
    }
    return out;
};

/** A stand-in for `Model.findOne(...).sort(...).lean()`. */
const stubFindOne = (value) => () => ({ sort: () => ({ lean: async () => value }) });

const column = (report, key) => (report?.summary?.columns || []).find((c) => c.key === key);
const stat = (report, label) => (report?.summary?.stats || []).find((s) => s.label === label);
const caveats = (report) => (report?.caveats || []).join(' ');

(async () => {
    await mongoose.connect(`${dbConsts.dbUri}/${dbConsts.dbName}`, { connectTimeoutMS: 60000 });

    // Confirm the premise before relying on it: if these ever stop being empty,
    // this script is measuring the wrong thing and should say so.
    const liveOffers = await CompetitiveOffers.countDocuments();
    const livePremium = await APlusPremium.countDocuments();
    console.log(`CompetitiveOffers in DB: ${liveOffers}   APlusPremium in DB: ${livePremium}`);
    if (liveOffers || livePremium) {
        console.log('NOTE: real data now exists — verifyEsfReportData.js covers it; this script is no longer the only check.\n');
    } else {
        console.log('Both empty, as expected. Supplying data in memory only.\n');
    }

    const clients = await User.find({ isEsfClient: true }).select('_id email').lean();

    // The first account that actually has a catalogue and a Buy Box snapshot;
    // stubbing sources onto an empty account would prove nothing.
    let target = null;
    for (const client of clients) {
        const seller = await Seller.findOne({ User: client._id }).select('sellerAccount').lean();
        for (const acc of (seller?.sellerAccount || []).filter((a) => a.country && a.region)) {
            const payload = await getEsfReports(client._id, acc.country, acc.region);
            const buybox = payload.reports.find((r) => r.key === 'buybox');
            const audit = payload.reports.find((r) => r.key === 'listings-audit');
            if (buybox?.available && audit?.available && buybox.summary.rows.length) {
                target = { client, acc, payload, contested: buybox.summary.rows.map((r) => r.asin) };
                break;
            }
        }
        if (target) break;
    }

    if (!target) {
        console.error('No ESF account has both a contested ASIN and a listings audit; cannot verify.');
        await mongoose.disconnect();
        process.exit(1);
    }

    const { client, acc, contested } = target;
    const asin = contested[0];
    const scope = `${client.email} ${acc.country}/${acc.region}`;
    console.log(`Driving ${scope}`);
    console.log(`  contested ASIN under test: ${asin}\n`);

    const realSellerFindOne = Seller.findOne.bind(Seller);
    const restore = () => {
        CompetitiveOffers.findOne = CompetitiveOffers.__real;
        APlusPremium.findOne = APlusPremium.__real;
        Seller.findOne = realSellerFindOne;
    };
    CompetitiveOffers.__real = CompetitiveOffers.findOne.bind(CompetitiveOffers);
    APlusPremium.__real = APlusPremium.findOne.bind(APlusPremium);

    try {
        /* ============================================================ 1 + 2
         * Reseller price, price gap and the pricing flag.
         * Our landed price 22.49 against a Buy Box of 17.50 is a 4.99 gap —
         * chosen so a rounding-to-whole-units bug shows up as 22/18/5.
         */
        console.log('[1+2] Buy Box competitor price, gap and pricing flag');
        CompetitiveOffers.findOne = stubFindOne({
            createdAt: new Date('2026-09-20T00:00:00Z'),
            asinsRequested: contested.length,
            sellerIdsReturned: true,
            items: [{
                asin,
                currency: 'USD',
                buyBoxPrice: 17.5,
                buyBoxSellerId: 'A1B2C3D4E5F6G',
                buyBoxIsFba: true,
                ourLandedPrice: 22.49,
                totalOfferCount: 4,
            }],
        });

        let payload = await getEsfReports(client._id, acc.country, acc.region);
        let buybox = payload.reports.find((r) => r.key === 'buybox');
        let row = buybox.summary.rows.find((r) => r.asin === asin);

        check(scope, 'Buy Box price column exists', Boolean(column(buybox, 'competingPrice')), true);
        check(scope, 'Gap column exists', Boolean(column(buybox, 'priceGap')), true);
        check(scope, 'Pricing column exists', Boolean(column(buybox, 'pricingFlag')), true);
        check(scope, 'Buy Box seller column exists', Boolean(column(buybox, 'competingSeller')), true);
        check(scope, 'price columns render to the cent', column(buybox, 'priceGap').format, 'money');
        check(scope, 'competing price', row.competingPrice, 17.5);
        check(scope, 'competing seller', row.competingSeller, 'A1B2C3D4E5F6G');
        // Recomputed here, deliberately not with the service's own helper.
        check(scope, 'price gap = ours - theirs', row.priceGap, Math.round((22.49 - 17.5) * 100) / 100);
        check(scope, 'pricing flag', row.pricingFlag, 'Priced above');
        check(scope, '"priced above" tile counts it', stat(buybox, 'Priced above Buy Box').value, 1);
        check(scope, 'widest gap tile', stat(buybox, 'Widest price gap').value, 4.99);
        check(scope, 'caveat drops "not captured"', /from the next sync onwards/.test(caveats(buybox)), false);
        check(scope, 'caveat dates the offer read', /offer feed on /.test(caveats(buybox)), true);

        let text = allText(buildReportDocDefinition(buybox, { marketplace: target.payload.marketplace, currency: '$' }));
        check(scope, 'PDF carries the Buy Box price', text.includes('$17.50'), true);
        check(scope, 'PDF carries the gap, cents intact', text.includes('$4.99'), true);
        check(scope, 'PDF carries the seller id', text.includes('A1B2C3D4E5F6G'), true);
        check(scope, 'PDF does NOT round to $18', text.includes('$18'), false);
        check(scope, 'PDF turns the page for 12 columns',
            buildReportDocDefinition(buybox, {}).pageOrientation, 'landscape');
        check(scope, 'PDF actually renders', Buffer.isBuffer(await renderReportPdf(buybox, {})), true);

        /* ---- priced BELOW: losing while cheaper, the finding that matters --- */
        CompetitiveOffers.findOne = stubFindOne({
            createdAt: new Date('2026-09-20T00:00:00Z'),
            items: [{ asin, currency: 'USD', buyBoxPrice: 25, ourLandedPrice: 20 }],
        });
        payload = await getEsfReports(client._id, acc.country, acc.region);
        buybox = payload.reports.find((r) => r.key === 'buybox');
        row = buybox.summary.rows.find((r) => r.asin === asin);
        check(scope, 'cheaper than the Buy Box -> flag', row.pricingFlag, 'Priced below');
        check(scope, 'cheaper than the Buy Box -> gap', row.priceGap, -5);
        check(scope, 'not counted as priced above', stat(buybox, 'Priced above Buy Box').value, 0);
        text = allText(buildReportDocDefinition(buybox, { currency: '$' }));
        check(scope, 'PDF signs a negative gap correctly', text.includes('-$5.00'), true);

        /* ---- nobody holds the Buy Box: answered, but no competitor --------- */
        CompetitiveOffers.findOne = stubFindOne({
            createdAt: new Date('2026-09-20T00:00:00Z'),
            items: [{ asin, currency: 'USD', buyBoxPrice: null, ourLandedPrice: 20 }],
        });
        buybox = (await getEsfReports(client._id, acc.country, acc.region)).reports.find((r) => r.key === 'buybox');
        row = buybox.summary.rows.find((r) => r.asin === asin);
        check(scope, 'no Buy Box holder is said, not implied', row.pricingFlag, 'No Buy Box holder');
        check(scope, 'no holder means no gap', row.priceGap, null);

        /* ---- not fetched: must not read as "no competitor" ----------------- */
        CompetitiveOffers.findOne = stubFindOne(null);
        buybox = (await getEsfReports(client._id, acc.country, acc.region)).reports.find((r) => r.key === 'buybox');
        row = buybox.summary.rows.find((r) => r.asin === asin);
        check(scope, 'unfetched shows an em dash', row.pricingFlag, '—');
        check(scope, 'unfetched shows no seller', row.competingSeller, '—');
        check(scope, 'unfetched gets NO false all-clear tile', Boolean(stat(buybox, 'Priced above Buy Box')), false);
        check(scope, 'unfetched says so in a caveat', /from the next sync onwards/.test(caveats(buybox)), true);

        /* =================================================================== 4
         * A+ Premium.
         */
        console.log('[4] A+ Premium');
        const audit0 = (await getEsfReports(client._id, acc.country, acc.region))
            .reports.find((r) => r.key === 'listings-audit');
        const auditAsin = audit0.summary.rows[0]?.asin || contested[0];

        APlusPremium.findOne = stubFindOne({
            createdAt: new Date('2026-09-20T00:00:00Z'),
            documents: [{ asin: auditAsin, isPremium: true }],
        });
        let audit = (await getEsfReports(client._id, acc.country, acc.region))
            .reports.find((r) => r.key === 'listings-audit');

        check(scope, 'A+ Premium column exists', Boolean(column(audit, 'aPlusPremium')), true);
        check(scope, 'badged ASIN reads Yes',
            audit.summary.rows.find((r) => r.asin === auditAsin).aPlusPremium, 'Yes');
        check(scope, 'unbadged ASIN reads No',
            audit.summary.rows.filter((r) => r.asin !== auditAsin).every((r) => r.aPlusPremium === 'No'), true);
        check(scope, 'Premium tile counts exactly one', stat(audit, 'A+ Premium').value, 1);
        check(scope, 'caveat drops "not captured"', /captured from the next/.test(caveats(audit)), false);
        check(scope, 'PDF carries the column',
            allText(buildReportDocDefinition(audit, {})).includes('A+ Premium'), true);

        APlusPremium.findOne = stubFindOne(null);
        audit = (await getEsfReports(client._id, acc.country, acc.region))
            .reports.find((r) => r.key === 'listings-audit');
        check(scope, 'unfetched shows an em dash, not No', audit.summary.rows[0].aPlusPremium, '—');
        check(scope, 'unfetched gets no Premium tile', Boolean(stat(audit, 'A+ Premium')), false);
        check(scope, 'unfetched says so in a caveat', /captured from the next/.test(caveats(audit)), true);

        /* =================================================================== 3
         * Suppressed listings, which need no new fetcher — only the next
         * catalogue sync, since the parser that fills listingIssues[] is new.
         */
        console.log('[3] Suppressed listings');
        // Deliberately NOT the contested ASIN: BuyBoxData and the catalogue are
        // separate sources and do not always overlap — on this account the
        // contested ASIN is absent from the catalogue entirely, which is why
        // its SKU shows as an em dash. Suppression is a property of a LISTING,
        // so it goes on a listing.
        const catalogue = await realSellerFindOne({ User: client._id }).select('sellerAccount').lean();
        const catAccount = (catalogue?.sellerAccount || [])
            .find((a) => a.country === acc.country && a.region === acc.region);
        const suppressedAsin = (catAccount?.products || [])[0]?.asin;
        if (!suppressedAsin) throw new Error('account has no catalogue listing to mark suppressed');
        console.log(`  listing marked suppressed: ${suppressedAsin}`);

        Seller.findOne = (...args) => {
            const query = realSellerFindOne(...args);
            const chain = {
                select: () => chain,
                sort: () => chain,
                lean: async () => {
                    const doc = await query.lean();
                    if (!doc) return doc;
                    const copy = JSON.parse(JSON.stringify(doc));
                    for (const account of copy.sellerAccount || []) {
                        if (account.country !== acc.country || account.region !== acc.region) continue;
                        const product = (account.products || []).find((p) => p.asin === suppressedAsin);
                        if (product) {
                            product.listingIssues = [{
                                code: '90220',
                                message: 'Missing required attribute',
                                severity: 'ERROR',
                                enforcementActions: ['LISTING_SUPPRESSED', 'SEARCH_SUPPRESSED'],
                                exemptionStatus: '',
                                isSuppression: true,
                            }];
                        }
                    }
                    return copy;
                },
            };
            return chain;
        };
        CompetitiveOffers.findOne = stubFindOne(null);

        buybox = (await getEsfReports(client._id, acc.country, acc.region)).reports.find((r) => r.key === 'buybox');
        const secondary = buybox.summary.secondaryTable;
        check(scope, 'suppressed listings get their own table', Boolean(secondary), true);
        check(scope, 'suppressed tile counts it', stat(buybox, 'Suppressed listings').value, 1);
        check(scope, 'both enforcements are shown',
            secondary.rows[0].enforcement, 'LISTING_SUPPRESSED, SEARCH_SUPPRESSED');
        check(scope, 'not marked exempt when it is not', secondary.rows[0].exempt, 'No');
        check(scope, 'suppression is called out in the highlights',
            buybox.highlights.some((h) => /suppressed by Amazon/.test(h.text || h)), true);
        text = allText(buildReportDocDefinition(buybox, {}));
        check(scope, 'PDF carries the enforcement', text.some((t) => t.includes('LISTING_SUPPRESSED')), true);
    } finally {
        restore();
    }

    await mongoose.disconnect();

    console.log(`\n${passed} checks passed, ${failures.length} failed`);
    if (failures.length) {
        console.log('\nFAILURES');
        failures.forEach((f) => console.log(`  ${f}`));
        process.exit(1);
    }
})().catch((error) => { console.error(error); process.exit(1); });
