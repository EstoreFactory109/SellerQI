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
 * and, since the API feasibility check, four more:
 *
 *   V2 extended fields    (rates, on-time delivery, chargebacks, IP and
 *                          customer complaints, missing tracking)
 *   SuppressedListings    (Suppressed tile, merged suppressed table)
 *   RemovalOrders         (pending removals on FBA Aged Inventory)
 *   SalesOnlyMetrics.b2b  (regular vs B2B split on Monthly Performance)
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
const V2SellerPerformance = require('../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const SuppressedListings = require('../models/products/SuppressedListingsModel.js');
const RemovalOrders = require('../models/inventory/RemovalOrdersModel.js');
const SalesOnlyMetrics = require('../models/MCP/SalesOnlyMetricsModel.js');
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
    const realV2FindOne = V2SellerPerformance.findOne.bind(V2SellerPerformance);
    const realAggregate = SalesOnlyMetrics.aggregate.bind(SalesOnlyMetrics);
    const restore = () => {
        CompetitiveOffers.findOne = CompetitiveOffers.__real;
        APlusPremium.findOne = APlusPremium.__real;
        SuppressedListings.findOne = SuppressedListings.__real;
        RemovalOrders.findOne = RemovalOrders.__real;
        V2SellerPerformance.findOne = realV2FindOne;
        SalesOnlyMetrics.aggregate = realAggregate;
        Seller.findOne = realSellerFindOne;
    };
    CompetitiveOffers.__real = CompetitiveOffers.findOne.bind(CompetitiveOffers);
    APlusPremium.__real = APlusPremium.findOne.bind(APlusPremium);
    SuppressedListings.__real = SuppressedListings.findOne.bind(SuppressedListings);
    RemovalOrders.__real = RemovalOrders.findOne.bind(RemovalOrders);

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
            // Column headers are drawn in capitals, as in the reference report.
            allText(buildReportDocDefinition(audit, {})).includes('A+ PREMIUM'), true);

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
        Seller.findOne = realSellerFindOne;

        /* ================================================================ 2B
         * The rest of the V2 performance report: rates, on-time delivery,
         * chargebacks, IP and customer complaints, missing tracking. Laid over
         * this account's REAL latest snapshot, so the seven fields it already
         * holds are exercised alongside the new ones.
         */
        console.log('[2B] Account health from the V2 report');
        const realPerf = await realV2FindOne({ User: client._id, country: acc.country, region: acc.region }).sort({ createdAt: -1 }).lean();
        V2SellerPerformance.findOne = stubFindOne({
            ...(realPerf || {}),
            orderWithDefectsStatus: realPerf?.orderWithDefectsStatus || 'GOOD',
            validTrackingRateStatus: 'AT RISK',
            orderDefectRatePct: 0.24,
            validTrackingRatePct: 93.5,
            unitOnTimeDeliveryRateStatus: 'GOOD',
            unitOnTimeDeliveryRatePct: 97.2,
            chargebackCount: 2,
            trackedShipmentCount: 200,
            validTrackingCount: 187,
            policyMetrics: [
                { key: 'receivedIntellectualPropertyComplaints', status: 'GOOD', count: 0 },
                { key: 'productAuthenticityCustomerComplaints', status: 'AT RISK', count: 1 },
            ],
        });
        let overview = (await getEsfReports(client._id, acc.country, acc.region)).reports.find((r) => r.key === 'account-overview');
        const healthRows = overview.summary.secondaryTable?.rows || [];
        const healthRow = (prefix) => healthRows.find((r) => r.metric.startsWith(prefix));
        check(scope, 'ODR carries its figure', healthRow('Order Defect Rate')?.status.endsWith('(0.24%)'), true);
        check(scope, 'on-time delivery row', healthRow('On-Time Delivery Rate (units)')?.status, 'Good (97.2%)');
        check(scope, 'chargebacks row', healthRow('Chargebacks')?.status, '2');
        check(scope, 'missing tracking = 200 - 187', healthRow('Shipments without valid tracking')?.status, '13 of 200');
        check(scope, 'missing tracking flagged with the rate', healthRow('Shipments without valid tracking')?.action, 'Add tracking in Seller Central');
        check(scope, 'IP complaints always shown', healthRow('IP complaints received')?.status, 'Good (0)');
        check(scope, 'customer complaint flagged', healthRow('Product authenticity complaints')?.action, 'Review in Seller Central');
        check(scope, 'no "status only" caveat once captured', /status only in this edition/.test(caveats(overview)), false);
        text = allText(buildReportDocDefinition(overview, {}));
        check(scope, 'PDF carries the complaints row', text.includes('Product authenticity complaints'), true);
        check(scope, 'PDF carries the rate', text.includes('At risk (93.5%)'), true);

        V2SellerPerformance.findOne = realV2FindOne;
        overview = (await getEsfReports(client._id, acc.country, acc.region)).reports.find((r) => r.key === 'account-overview');
        check(scope, 'real snapshot, pre-parser: says statuses only',
            /status only in this edition/.test(caveats(overview)), Boolean(realPerf) && !Array.isArray(realPerf?.policyMetrics));
        check(scope, 'no-API items are named', /have no Amazon API/.test(caveats(overview)), true);

        /* ================================================================ 2A
         * Amazon's Suppressed Listings Report, merged with listing issues.
         */
        console.log('[2A] Suppressed Listings Report');
        const catalogueSku = (catAccount?.products || []).find((p) => p.sku)?.sku;
        SuppressedListings.findOne = stubFindOne({
            createdAt: new Date('2026-09-27T00:00:00Z'),
            items: [
                { sku: catalogueSku, asin: suppressedAsin, status: 'Search Suppressed', reason: 'Missing main image', isAtRisk: false },
                { sku: 'NOT-IN-CATALOGUE', asin: 'B000000000', productName: 'Only in the report', status: 'Blocked', reason: 'Pricing error', isAtRisk: false },
                { sku: 'AT-RISK', asin: 'B000000001', status: 'At Risk', isAtRisk: true },
            ],
            suppressedCount: 2,
            atRiskCount: 1,
            unreadable: false,
        });
        payload = await getEsfReports(client._id, acc.country, acc.region);
        overview = payload.reports.find((r) => r.key === 'account-overview');
        buybox = payload.reports.find((r) => r.key === 'buybox');
        check(scope, 'Account Overview gets a Suppressed tile', stat(overview, 'Suppressed')?.value, 2);
        check(scope, 'Buy Box agrees on the count', stat(buybox, 'Suppressed listings')?.value, 2);
        check(scope, 'report-only row reaches the table',
            (buybox.summary.secondaryTable?.rows || []).some((r) => r.sku === 'NOT-IN-CATALOGUE' && r.enforcement === 'Blocked'), true);
        check(scope, 'at-risk kept out of the table',
            (buybox.summary.secondaryTable?.rows || []).some((r) => r.sku === 'AT-RISK'), false);
        check(scope, 'caveat dates the report read', /Suppressed Listings Report, read on/.test(caveats(buybox)), true);
        text = allText(buildReportDocDefinition(buybox, {}));
        check(scope, 'PDF carries the report-only row', text.includes('NOT-IN-CATALOGUE'), true);
        text = allText(buildReportDocDefinition(overview, {}));
        // Tile labels are drawn in capitals.
        check(scope, 'Account Overview PDF carries the tile', text.includes('SUPPRESSED'), true);

        SuppressedListings.findOne = stubFindOne({ createdAt: new Date(), items: [], unreadable: true, headers: ['Estado'] });
        overview = (await getEsfReports(client._id, acc.country, acc.region)).reports.find((r) => r.key === 'account-overview');
        check(scope, 'unreadable report gets no false all-clear', Boolean(stat(overview, 'Suppressed')), false);
        SuppressedListings.findOne = SuppressedListings.__real;

        /* ================================================================== 6
         * Pending removals. Needs an account with ageing stock; the account
         * under test may not have any, and that is reported, not failed.
         */
        console.log('[6] Pending removals');
        RemovalOrders.findOne = stubFindOne({
            createdAt: new Date('2026-09-27T00:00:00Z'),
            windowStart: new Date('2026-04-01T00:00:00Z'),
            windowEnd: new Date('2026-09-27T00:00:00Z'),
            pendingOrderCount: 1,
            pendingUnits: 15,
            lines: [{ orderId: 'RMV-TEST-1', sku: 'S1', orderType: 'Return', orderStatus: 'Pending', requestedQuantity: 20, pendingQuantity: 15, isPending: true, requestDate: '2026-09-10T00:00:00Z' }],
        });
        let agedTarget = null;
        for (const candidate of clients) {
            const seller = await realSellerFindOne({ User: candidate._id }).select('sellerAccount').lean();
            for (const account of (seller?.sellerAccount || []).filter((a) => a.country && a.region)) {
                const aged = (await getEsfReports(candidate._id, account.country, account.region)).reports.find((r) => r.key === 'fba-aged-inventory');
                if (aged?.available) { agedTarget = { aged, scope: `${candidate.email} ${account.country}/${account.region}` }; break; }
            }
            if (agedTarget) break;
        }
        if (!agedTarget) {
            console.log('  no ESF account has ageing stock today; pending removals covered by the unit suite only');
        } else {
            const { aged, scope: agedScope } = agedTarget;
            check(agedScope, 'pending orders tile', stat(aged, 'Pending removal orders')?.value, 1);
            check(agedScope, 'pending units tile', stat(aged, 'Units pending removal')?.value, 15);
            check(agedScope, 'pending removals table', aged.summary.secondaryTable?.title, 'Pending removals');
            text = allText(buildReportDocDefinition(aged, {}));
            check(agedScope, 'PDF carries the removal order', text.includes('RMV-TEST-1'), true);
            check(agedScope, 'PDF renders', Buffer.isBuffer(await renderReportPdf(aged, {})), true);
        }
        RemovalOrders.findOne = RemovalOrders.__real;

        /* ================================================================ 2G
         * Regular vs B2B. The real aggregate runs; only the split fields —
         * which no stored day carries yet — are added to its first answer
         * (the current period).
         */
        console.log('[2G] Regular vs B2B split');
        let aggregateCalls = 0;
        SalesOnlyMetrics.aggregate = async (...args) => {
            // Numbered at call time, not on resolution: both periods are
            // queried at once and may resolve in either order.
            aggregateCalls += 1;
            const call = aggregateCalls;
            const result = await realAggregate(...args);
            if (call === 1 && result[0]) {
                Object.assign(result[0], { b2bCapturedDays: 5, b2bReportedDays: 5, b2bUnits: 3, b2bOrderItems: 2, splitTotalUnits: 30 });
            }
            return result;
        };
        const monthly = (await getEsfReports(client._id, acc.country, acc.region)).reports.find((r) => r.key === 'monthly-performance');
        if (!monthly?.available) {
            console.log('  monthly report unavailable on this account; B2B split covered by the unit suite only');
        } else {
            check(scope, 'B2B units tile', stat(monthly, 'B2B units')?.value, 3);
            check(scope, 'regular = total - B2B', stat(monthly, 'Regular units')?.value, 27);
            check(scope, 'B2B share', stat(monthly, 'B2B share of units')?.value, 10);
            check(scope, 'no change against an uncaptured month', stat(monthly, 'B2B units')?.delta, null);
            check(scope, 'partial coverage is named', /covers 5 of the/.test(caveats(monthly)), true);
            text = allText(buildReportDocDefinition(monthly, {}));
            check(scope, 'PDF carries the B2B row', text.includes('B2B order items'), true);
        }
        SalesOnlyMetrics.aggregate = realAggregate;
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
