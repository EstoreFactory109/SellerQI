/**
 * Tests for the ESF Reports service.
 *
 * The parts most likely to go quietly wrong, and so the parts pinned here:
 *
 *  - SP-API report columns arrive as STRINGS ("0", "", "--", "1,234"). Every
 *    count and total on the page is a sum of those, so a coercion slip shows up
 *    as a plausible-looking wrong number rather than an error.
 *  - The aged-inventory bands are recombined from Amazon's narrower bands. Drop
 *    one and the report under-reports ageing stock — again, silently.
 *  - "Snapshots losing" counts a CONSECUTIVE run from the newest snapshot
 *    backwards. Counting all zero snapshots instead would overstate how long a
 *    listing has been losing the Buy Box.
 *  - A report with no data must come back `available: false` with no numbers,
 *    and one builder throwing must not take the other six down with it.
 */

const mockFindOne = (result) => ({ sort: () => ({ lean: () => Promise.resolve(result) }), select: () => ({ lean: () => Promise.resolve(result) }), lean: () => Promise.resolve(result) });

jest.mock('../../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/MCP/BuyBoxDataModel.js', () => ({ find: jest.fn() }));
jest.mock('../../../models/user-auth/AccountHistory.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/seller-performance/V2_Seller_Performance_ReportModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/seller-performance/V1_Seller_Performance_Report_Model.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/inventory/StrandedInventoryUIDataItemModel.js', () => ({ countDocuments: jest.fn() }));
jest.mock('../../../models/system/TopOpportunitiesModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/inventory/FbaInventoryApiDetailModel.js', () => ({ countDocuments: jest.fn() }));
jest.mock('../../../models/inventory/ProductWiseFBADataItemModel.js', () => ({ countDocuments: jest.fn() }));
jest.mock('../../../models/seller-performance/NumberOfProductReviewsModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/seller-performance/APlusContentModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/seller-performance/APlusPremiumModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/products/CompetitiveOffersModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/review/ReviewOrderModel.js', () => ({ aggregate: jest.fn(), countDocuments: jest.fn(), findOne: jest.fn() }));
jest.mock('../../../models/MCP/SalesOnlyMetricsModel.js', () => ({ aggregate: jest.fn(), findOne: jest.fn() }));
jest.mock('../../../models/amazon-ads/PPCMetricsModel.js', () => ({ aggregate: jest.fn(), findOne: jest.fn() }));
jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const Restock = require('../../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
const Planning = require('../../../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js');
const BuyBoxData = require('../../../models/MCP/BuyBoxDataModel.js');
const AccountHistory = require('../../../models/user-auth/AccountHistory.js');
const V2Perf = require('../../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const V1Perf = require('../../../models/seller-performance/V1_Seller_Performance_Report_Model.js');
const Stranded = require('../../../models/inventory/StrandedInventoryUIDataItemModel.js');
const TopOpps = require('../../../models/system/TopOpportunitiesModel.js');
const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const FbaDetail = require('../../../models/inventory/FbaInventoryApiDetailModel.js');
const FbaFeeItem = require('../../../models/inventory/ProductWiseFBADataItemModel.js');
const Content = require('../../../models/seller-performance/NumberOfProductReviewsModel.js');
const APlus = require('../../../models/seller-performance/APlusContentModel.js');
const APlusPremium = require('../../../models/seller-performance/APlusPremiumModel.js');
const Pricing = require('../../../models/products/CompetitiveOffersModel.js');
const ReviewOrder = require('../../../models/review/ReviewOrderModel.js');
const SalesOnlyMetrics = require('../../../models/MCP/SalesOnlyMetricsModel.js');
const PPCMetrics = require('../../../models/amazon-ads/PPCMetricsModel.js');

const {
    getEsfReports,
    getEsfReportRows,
    getEsfReportHistory,
    num,
    pctChange,
    PREVIEW_ROWS,
    MAX_PAGE_ROWS,
} = require('../../../Services/Calculations/EsfReportsService.js');

const USER = '507f1f77bcf86cd799439011';

/** Every collection empty — the baseline each test overrides one piece of. */
const stubEmpty = () => {
    Restock.findOne.mockReturnValue(mockFindOne(null));
    Planning.findOne.mockReturnValue(mockFindOne(null));
    BuyBoxData.find.mockReturnValue({
        sort: () => ({
            limit: () => ({ lean: () => Promise.resolve([]) }),
            select: () => ({ lean: () => Promise.resolve([]) }),
        }),
    });
    AccountHistory.findOne.mockReturnValue(mockFindOne(null));
    V2Perf.findOne.mockReturnValue(mockFindOne(null));
    V1Perf.findOne.mockReturnValue(mockFindOne(null));
    Stranded.countDocuments.mockResolvedValue(0);
    TopOpps.findOne.mockReturnValue(mockFindOne(null));
    Seller.findOne.mockReturnValue(mockFindOne(null));
    FbaDetail.countDocuments.mockResolvedValue(0);
    FbaFeeItem.countDocuments.mockResolvedValue(0);
    Content.findOne.mockReturnValue(mockFindOne(null));
    APlus.findOne.mockReturnValue(mockFindOne(null));
    APlusPremium.findOne.mockReturnValue(mockFindOne(null));
    Pricing.findOne.mockReturnValue(mockFindOne(null));
    ReviewOrder.aggregate.mockResolvedValue([]);
    ReviewOrder.countDocuments.mockResolvedValue(0);
    ReviewOrder.findOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) });
    SalesOnlyMetrics.aggregate.mockResolvedValue([]);
    SalesOnlyMetrics.findOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) });
    PPCMetrics.aggregate.mockResolvedValue([]);
    PPCMetrics.findOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) });
};

/** The newest metric day each collection holds — what anchors the month. */
const latestMetricDays = ({ sales = null, ppc = null }) => {
    SalesOnlyMetrics.findOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: () => Promise.resolve(sales ? { date: sales } : null) }) }) });
    PPCMetrics.findOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: () => Promise.resolve(ppc ? { metricDate: ppc } : null) }) }) });
};

const byKey = (payload, key) => payload.reports.find((report) => report.key === key);

beforeEach(stubEmpty);

describe('num', () => {
    it('coerces the string forms SP-API reports actually contain', () => {
        expect(num('0')).toBe(0);
        expect(num('42')).toBe(42);
        expect(num('1,234')).toBe(1234);
        expect(num('12.50')).toBe(12.5);
        expect(num('--')).toBe(0);
        expect(num('')).toBe(0);
        expect(num(null)).toBe(0);
        expect(num(undefined)).toBe(0);
    });
});

describe('pctChange', () => {
    it('returns null rather than Infinity when there is no baseline', () => {
        expect(pctChange(100, 0)).toBeNull();
    });

    it('treats zero-from-zero as no change, not as missing', () => {
        expect(pctChange(0, 0)).toBe(0);
    });

    it('computes a signed percentage', () => {
        expect(pctChange(150, 100)).toBe(50);
        expect(pctChange(50, 100)).toBe(-50);
    });
});

describe('getEsfReports', () => {
    it('returns every report type, all unavailable, when no data exists', async () => {
        const payload = await getEsfReports(USER, 'US', 'NA');

        expect(payload.reports).toHaveLength(7);
        expect(payload.counts).toEqual({ total: 7, available: 0 });
        expect(payload.featuredKey).toBeNull();

        for (const report of payload.reports) {
            expect(report.available).toBe(false);
            expect(report.reason).toEqual(expect.any(String));
            // The point of the rule: nothing that reads as a real figure.
            expect(report.insight).toBe('');
            expect(report.summary).toBeUndefined();
        }
    });

    it('does not let one failing report take down the others', async () => {
        Restock.findOne.mockImplementation(() => { throw new Error('collection exploded'); });
        Planning.findOne.mockReturnValue(mockFindOne({
            createdAt: new Date('2026-03-01T00:00:00Z'),
            data: [{ asin: 'B1', quantity_to_be_charged_ais_365_plus_days: '10', unfulfillable_quantity: '0' }],
        }));

        const payload = await getEsfReports(USER, 'US', 'NA');

        expect(byKey(payload, 'inventory-restock').available).toBe(false);
        expect(byKey(payload, 'fba-aged-inventory').available).toBe(true);
    });

    describe('inventory restock', () => {
        const withProducts = (products) => Restock.findOne.mockReturnValue(mockFindOne({
            createdAt: new Date('2026-04-25T00:00:00Z'),
            Products: products,
        }));

        it('counts urgency from Amazon\'s alert column and totals the reorder value', async () => {
            withProducts([
                { asin: 'B1', merchantSku: 'SKU-1', price: '10.00', recommendedReplenishmentQty: '5', available: '0', alert: 'Urgent - Out of Stock' },
                { asin: 'B2', merchantSku: 'SKU-2', price: '20.00', recommendedReplenishmentQty: '3', available: '12', alert: '' },
                { asin: 'B3', merchantSku: 'SKU-3', price: '5.00', recommendedReplenishmentQty: '0', available: '40', alert: '' },
            ]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'inventory-restock');
            const stat = (label) => report.summary.stats.find((item) => item.label === label).value;

            expect(report.available).toBe(true);
            expect(stat('SKUs tracked')).toBe(3);
            expect(stat('Urgent')).toBe(1);
            expect(stat('Need restock')).toBe(2);   // only rows with a qty > 0
            expect(stat('Out of stock')).toBe(1);
            expect(stat('Est. reorder value')).toBe(5 * 10 + 3 * 20);
            // Singular, because exactly one row is urgent.
            expect(report.insight).toBe('1 SKU urgent, 2 need restock');
        });

        it('converts Amazon\'s days of supply into weeks of cover', async () => {
            withProducts([
                { asin: 'B1', merchantSku: 'SKU-1', price: '10', recommendedReplenishmentQty: '1', available: '5', totalDaysOfSupply: '14' },
            ]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'inventory-restock');
            expect(report.summary.rows[0].weeksOfCover).toBe(2);
        });

        it('blames the empty marketplace, not our sync, when there is no FBA stock', async () => {
            FbaDetail.countDocuments.mockResolvedValue(0);
            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'inventory-restock');

            expect(report.available).toBe(false);
            expect(report.reason).toMatch(/no fba inventory in this marketplace/i);
            expect(report.reason).not.toMatch(/fetched/i);
        });

        it('treats fee-report rows alone as proof of FBA, so one stale sync cannot mislabel a seller', async () => {
            FbaDetail.countDocuments.mockResolvedValue(0);   // this sync has not run
            FbaFeeItem.countDocuments.mockResolvedValue(120); // but this one shows FBA

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'inventory-restock');
            expect(report.reason).toMatch(/not publish this report for every marketplace/i);
            expect(report.reason).not.toMatch(/no fba inventory/i);
        });

        it('says Amazon withheld the report when FBA stock does exist', async () => {
            // The live India case: stock and ageing data present, restock never
            // supplied because Amazon does not publish it for that marketplace.
            FbaDetail.countDocuments.mockResolvedValue(739);
            const report = byKey(await getEsfReports(USER, 'IN', 'EU'), 'inventory-restock');

            expect(report.available).toBe(false);
            expect(report.reason).toMatch(/not publish this report for every marketplace/i);
        });

        it('puts urgent rows first', async () => {
            withProducts([
                { asin: 'B1', merchantSku: 'CALM', price: '10', recommendedReplenishmentQty: '100', available: '50', alert: '' },
                { asin: 'B2', merchantSku: 'URGENT', price: '1', recommendedReplenishmentQty: '1', available: '0', alert: 'Urgent - Out of Stock' },
            ]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'inventory-restock');
            // Ahead of CALM despite CALM having the far larger reorder value.
            expect(report.summary.rows[0].sku).toBe('URGENT');
        });
    });

    describe('FBA aged inventory', () => {
        it('recombines Amazon\'s narrow bands into the reported ones', async () => {
            Planning.findOne.mockReturnValue(mockFindOne({
                createdAt: new Date('2026-02-01T00:00:00Z'),
                data: [{
                    asin: 'B1',
                    quantity_to_be_charged_ais_181_210_days: '1',
                    quantity_to_be_charged_ais_211_240_days: '2',
                    quantity_to_be_charged_ais_241_270_days: '3',
                    quantity_to_be_charged_ais_271_300_days: '4',
                    quantity_to_be_charged_ais_301_330_days: '5',
                    quantity_to_be_charged_ais_331_365_days: '6',
                    quantity_to_be_charged_ais_365_plus_days: '7',
                    unfulfillable_quantity: '8',
                }],
            }));

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'fba-aged-inventory');
            const stat = (label) => report.summary.stats.find((item) => item.label === label).value;

            expect(stat('181–270 days')).toBe(1 + 2 + 3);
            expect(stat('271–365 days')).toBe(4 + 5 + 6);
            expect(stat('365+ days')).toBe(7);
            expect(stat('Unfulfillable')).toBe(8);
        });

        it('separates "nothing has aged" from "no stock at all"', async () => {
            FbaDetail.countDocuments.mockResolvedValue(500);
            let report = byKey(await getEsfReports(USER, 'US', 'NA'), 'fba-aged-inventory');
            expect(report.reason).toMatch(/aged past 180 days/i);

            FbaDetail.countDocuments.mockResolvedValue(0);
            report = byKey(await getEsfReports(USER, 'US', 'NA'), 'fba-aged-inventory');
            expect(report.reason).toMatch(/nothing ageing/i);
        });

        it('declares the two bands Amazon sends but we never store', async () => {
            Planning.findOne.mockReturnValue(mockFindOne({
                createdAt: new Date('2026-02-01T00:00:00Z'),
                data: [{ asin: 'B1', quantity_to_be_charged_ais_365_plus_days: '1', unfulfillable_quantity: '0' }],
            }));

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'fba-aged-inventory');
            expect(report.caveats.join(' ')).toMatch(/0–90 and 91–180/);
        });
    });

    describe('buy box', () => {
        /** Newest snapshot first, the order the service reads them in. */
        const snapshots = (percentagesNewestFirst) => BuyBoxData.find.mockReturnValue({
            sort: () => ({
                limit: () => ({
                    lean: () => Promise.resolve(percentagesNewestFirst.map((pct, index) => ({
                        createdAt: new Date(2026, 0, 30 - index),
                        date: `2026-01-${String(30 - index).padStart(2, '0')}`,
                        totalProducts: 2,
                        productsWithBuyBox: pct === 0 ? 1 : 2,
                        productsWithLowBuyBox: 0,
                        asinBuyBoxData: [
                            { childAsin: 'B1', buyBoxPercentage: pct, sessions: 10 },
                            { childAsin: 'B2', buyBoxPercentage: 100, sessions: 5 },
                        ],
                    }))),
                }),
            }),
        });

        it('counts only the consecutive run of losing snapshots', async () => {
            // Lost the last three, held it before that. A naive count of every
            // zero snapshot would say 4.
            snapshots([0, 0, 0, 100, 0]);
            Seller.findOne.mockReturnValue(mockFindOne({
                sellerAccount: [{ region: 'NA', country: 'US', products: [{ asin: 'B1', sku: 'SKU-1', price: '19.99', itemName: 'Thing' }] }],
            }));

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');
            const row = report.summary.rows.find((item) => item.asin === 'B1');

            expect(row.periodsLosing).toBe(3);
            expect(row.sku).toBe('SKU-1');      // joined through the catalogue
            expect(row.ourPrice).toBe(19.99);
        });

        describe('competitor pricing', () => {
            /** A catalogue whose one losing ASIN is listed at 19.99. */
            const catalogue = () => Seller.findOne.mockReturnValue(mockFindOne({
                sellerAccount: [{
                    region: 'NA', country: 'US',
                    products: [{ asin: 'B1', sku: 'SKU-1', price: '19.99', itemName: 'Thing' }],
                }],
            }));

            it('says nothing at all before the first pricing fetch', async () => {
                snapshots([0]);
                catalogue();

                const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');
                const row = report.summary.rows[0];

                // Not null and not zero: an em dash, because "we have not
                // looked" and "there is no competitor" are opposite facts that
                // a blank cell would render identically.
                expect(row.competingSeller).toBe('\u2014');
                expect(row.competingPrice).toBeNull();
                expect(row.priceGap).toBeNull();
                expect(row.pricingFlag).toBe('\u2014');
                // No tile either — "0 priced above" on an unfetched account is
                // a false all-clear.
                expect(report.summary.stats.some((stat) => stat.label === 'Priced above Buy Box')).toBe(false);
                expect(report.caveats.join(' ')).toMatch(/from the next sync onwards/);
            });

            it('reports the Buy Box price, its seller and the gap against our landed price', async () => {
                snapshots([0]);
                catalogue();
                Pricing.findOne.mockReturnValue(mockFindOne({
                    createdAt: new Date('2026-09-20T00:00:00Z'),
                    asinsRequested: 1,
                    items: [{
                        asin: 'B1',
                        currency: 'USD',
                        buyBoxPrice: 17.5,
                        buyBoxSellerId: 'A1COMPETITOR',
                        buyBoxIsFba: true,
                        ourLandedPrice: 22.49,
                        totalOfferCount: 4,
                    }],
                }));

                const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');
                const row = report.summary.rows[0];

                expect(row.competingPrice).toBe(17.5);
                expect(row.competingSeller).toBe('A1COMPETITOR');
                // 22.49 - 17.50, from LANDED prices on both sides. The
                // catalogue's 19.99 list price is deliberately not used here.
                expect(row.priceGap).toBe(4.99);
                expect(row.pricingFlag).toBe('Priced above');
                expect(report.summary.stats.find((stat) => stat.label === 'Priced above Buy Box').value).toBe(1);
                expect(report.summary.stats.find((stat) => stat.label === 'Widest price gap').value).toBe(4.99);
                expect(report.summary.columns.map((column) => column.key))
                    .toEqual(expect.arrayContaining(['competingPrice', 'priceGap', 'pricingFlag', 'competingSeller']));
            });

            it('falls back to the list price only when our own offer is missing, and says so', async () => {
                snapshots([0]);
                catalogue();
                Pricing.findOne.mockReturnValue(mockFindOne({
                    createdAt: new Date('2026-09-20T00:00:00Z'),
                    asinsRequested: 1,
                    // Amazon returned the Buy Box but not our offer.
                    items: [{ asin: 'B1', currency: 'USD', buyBoxPrice: 17.5, ourLandedPrice: null }],
                }));

                const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');

                expect(report.summary.rows[0].priceGap).toBe(2.49); // 19.99 list - 17.50
                // The fallback is stated, not silently applied: that gap has no
                // delivery in it and can be wrong by the shipping charge.
                expect(report.caveats.join(' ')).toMatch(/catalogue list price, which excludes delivery/);
            });

            it('calls a cheaper listing Priced below, and a matching one Matched', async () => {
                snapshots([0]);
                catalogue();
                Pricing.findOne.mockReturnValue(mockFindOne({
                    createdAt: new Date('2026-09-20T00:00:00Z'),
                    items: [{ asin: 'B1', currency: 'USD', buyBoxPrice: 25, ourLandedPrice: 20 }],
                }));
                let report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');
                expect(report.summary.rows[0].pricingFlag).toBe('Priced below');
                expect(report.summary.rows[0].priceGap).toBe(-5);
                // Losing while cheaper is the finding that matters: price is
                // not the reason, so no "priced above" count.
                expect(report.summary.stats.find((stat) => stat.label === 'Priced above Buy Box').value).toBe(0);

                Pricing.findOne.mockReturnValue(mockFindOne({
                    createdAt: new Date('2026-09-20T00:00:00Z'),
                    items: [{ asin: 'B1', currency: 'USD', buyBoxPrice: 20, ourLandedPrice: 20 }],
                }));
                report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');
                expect(report.summary.rows[0].pricingFlag).toBe('Matched');
            });

            it('separates "nobody holds the Buy Box" from "we did not look"', async () => {
                snapshots([0]);
                catalogue();
                Pricing.findOne.mockReturnValue(mockFindOne({
                    createdAt: new Date('2026-09-20T00:00:00Z'),
                    // Amazon answered; there is simply no Buy Box holder.
                    items: [{ asin: 'B1', currency: 'USD', buyBoxPrice: null, ourLandedPrice: 20 }],
                }));

                const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');
                expect(report.summary.rows[0].pricingFlag).toBe('No Buy Box holder');
                expect(report.summary.rows[0].priceGap).toBeNull();
            });

            it('keeps the price when Amazon withholds the seller identity', async () => {
                snapshots([0]);
                catalogue();
                Pricing.findOne.mockReturnValue(mockFindOne({
                    createdAt: new Date('2026-09-20T00:00:00Z'),
                    items: [{ asin: 'B1', currency: 'USD', buyBoxPrice: 17.5, buyBoxSellerId: '', ourLandedPrice: 22.49 }],
                }));

                const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');

                // Half an answer beats none: the gap is what gets actioned.
                expect(report.summary.rows[0].competingSeller).toBe('\u2014');
                expect(report.summary.rows[0].priceGap).toBe(4.99);
                expect(report.caveats.join(' ')).toMatch(/withheld the seller identity/);
            });

            it('reports an ASIN the fetch could not price, without inventing a gap', async () => {
                snapshots([0]);
                catalogue();
                Pricing.findOne.mockReturnValue(mockFindOne({
                    createdAt: new Date('2026-09-20T00:00:00Z'),
                    asinsRequested: 1,
                    items: [{ asin: 'B1', error: 'Amazon returned 404 for this ASIN' }],
                }));

                const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');
                expect(report.summary.rows[0].pricingFlag).toBe('\u2014');
                expect(report.summary.rows[0].priceGap).toBeNull();
            });
        });

        it('stays good-toned when nothing is losing', async () => {
            snapshots([100]);
            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');

            expect(report.tone).toBe('good');
            expect(report.insight).toBe('0 of 2 ASINs losing buy box');
        });

        it('explains an empty table instead of leaving the panel blank', async () => {
            // Nothing losing is the good outcome, but it leaves no rows to list.
            snapshots([100]);
            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');

            expect(report.summary.rows).toEqual([]);
            expect(report.summary.emptyMessage).toMatch(/currently holds the Buy Box/i);
        });
    });

    describe('listings audit', () => {
        it('scores each listing against the content checks and names what is missing', async () => {
            Seller.findOne.mockReturnValue(mockFindOne({
                sellerAccount: [{
                    region: 'NA',
                    country: 'US',
                    products: [
                        { asin: 'B1', sku: 'FULL', itemName: 'Complete', status: 'Active' },
                        { asin: 'B2', sku: 'BARE', itemName: 'Empty', status: 'Active' },
                    ],
                }],
            }));
            Content.findOne.mockReturnValue(mockFindOne({
                createdAt: new Date('2026-09-17T00:00:00Z'),
                Products: [{
                    asin: 'B1',
                    about_product: ['a'],
                    product_description: ['d'],
                    product_photos: ['1', '2', '3', '4', '5'],
                    video_url: ['v'],
                    has_brandstory: true,
                }],
            }));
            APlus.findOne.mockReturnValue(mockFindOne({ ApiContentDetails: [{ Asins: 'B1', status: 'APPROVED' }] }));

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'listings-audit');
            const rows = Object.fromEntries(report.summary.rows.map((row) => [row.sku, row]));

            expect(rows.FULL.score).toBe('6/6');
            expect(rows.FULL.missing).toBe('—');
            expect(rows.BARE.score).toBe('0/6');
            // Worst listing first, so the audit opens on what needs work.
            expect(report.summary.rows[0].sku).toBe('BARE');
            // 6 of 12 possible checks passed.
            expect(report.summary.stats.find((item) => item.label === 'Completion').value).toBe(50);
        });

        it('declares the fields it cannot audit', async () => {
            Seller.findOne.mockReturnValue(mockFindOne({
                sellerAccount: [{ region: 'NA', country: 'US', products: [{ asin: 'B1', sku: 'S', status: 'Active' }] }],
            }));

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'listings-audit');
            expect(report.caveats.join(' ')).toMatch(/Premium A\+.*Storefront.*language/);
        });
    });

    describe('A+ Premium in the listings audit', () => {
        const oneListing = () => {
            Seller.findOne.mockReturnValue(mockFindOne({
                sellerAccount: [{
                    region: 'NA', country: 'US',
                    products: [{ asin: 'B1', sku: 'S', itemName: 'One', status: 'Active' }],
                }],
            }));
        };

        /** Premium is a separate eligibility tier, so it gets its own column. */
        it('reports Yes for a listing Amazon badges as Premium', async () => {
            oneListing();
            APlusPremium.findOne.mockReturnValue(mockFindOne({
                documents: [{ asin: 'B1', isPremium: true }],
            }));

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'listings-audit');
            expect(report.summary.rows[0].aPlusPremium).toBe('Yes');
            expect(report.summary.columns.some((column) => column.key === 'aPlusPremium')).toBe(true);
            expect(report.summary.stats.find((stat) => stat.label === 'A+ Premium').value).toBe(1);
        });

        /** Fetched, and genuinely not Premium — a real No. */
        it('reports No for a listing the fetch did not cover', async () => {
            oneListing();
            APlusPremium.findOne.mockReturnValue(mockFindOne({ documents: [] }));

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'listings-audit');
            expect(report.summary.rows[0].aPlusPremium).toBe('No');
            expect(report.summary.stats.find((stat) => stat.label === 'A+ Premium').value).toBe(0);
        });

        /**
         * The distinction that matters. Before the A+ Content API has ever run
         * there is no answer, and "No" would read as a finding about the
         * listing. An em dash says nothing, which is the honest thing to say.
         */
        it('says nothing at all before the first fetch, rather than No', async () => {
            oneListing();
            APlusPremium.findOne.mockReturnValue(mockFindOne(null));

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'listings-audit');
            expect(report.summary.rows[0].aPlusPremium).toBe('\u2014');
            // No count either: reporting zero Premium is the same false claim
            // in another shape.
            expect(report.summary.stats.some((stat) => stat.label === 'A+ Premium')).toBe(false);
            expect(report.caveats.join(' ')).toMatch(/captured from the next/);
        });

        it('drops the not-captured caveat once the fetch has run', async () => {
            oneListing();
            APlusPremium.findOne.mockReturnValue(mockFindOne({ documents: [] }));

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'listings-audit');
            expect(report.caveats.join(' ')).not.toMatch(/captured from the next/);
            expect(report.caveats.join(' ')).toMatch(/Storefront.*language/);
        });
    });

    describe('review requests', () => {
        /** The newest order the account holds, which anchors the reported week. */
        const newestOrderAt = (iso) => ReviewOrder.findOne.mockReturnValue({
            sort: () => ({ select: () => ({ lean: () => Promise.resolve(iso ? { purchaseDate: new Date(iso) } : null) }) }),
        });

        beforeEach(() => newestOrderAt('2026-09-22T00:00:00Z'));

        it('anchors the week on the newest order, not on today', async () => {
            // Regression: anchoring on today reported "no orders" for accounts
            // holding tens of thousands, purely because ingestion had not run
            // for over a week. Found on a live account with 15,973 orders.
            newestOrderAt('2026-06-16T00:00:00Z');
            ReviewOrder.countDocuments.mockResolvedValue(15973);
            ReviewOrder.aggregate.mockResolvedValue([{ _id: 'sent', count: 15973, eligible: 15973 }]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'review-requests');

            expect(report.available).toBe(true);
            expect(report.date).toBe('Week of 9 Jun 2026');
            // And it must say the edition is stale rather than pass as current.
            expect(report.caveats.join(' ')).toMatch(/most recent week with order data/);
        });

        it('does not cry stale when the newest order is recent', async () => {
            ReviewOrder.countDocuments.mockResolvedValue(10);
            ReviewOrder.aggregate.mockResolvedValue([{ _id: 'sent', count: 10, eligible: 10 }]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'review-requests');
            expect(report.caveats).toEqual([]);
        });

        it('is unavailable only when there is genuinely no order at all', async () => {
            newestOrderAt(null);
            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'review-requests');

            expect(report.available).toBe(false);
            expect(report.reason).toMatch(/no orders have been ingested/i);
        });

        it('builds the funnel from request status counts', async () => {
            ReviewOrder.countDocuments.mockResolvedValue(100);
            ReviewOrder.aggregate.mockResolvedValue([
                { _id: 'sent', count: 60, eligible: 60 },
                { _id: 'not_requested', count: 30, eligible: 10 },
                { _id: 'failed', count: 10, eligible: 10 },
            ]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'review-requests');
            const stat = (label) => report.summary.stats.find((item) => item.label === label).value;

            expect(stat('Orders checked')).toBe(100);
            expect(stat('Requests sent')).toBe(60);
            expect(stat('Failed')).toBe(10);
            expect(stat('Eligible')).toBe(80);
            expect(stat('Ineligible')).toBe(20);   // checked minus eligible
            expect(report.insight).toBe('60 requests sent, 40 skipped');
        });

        it('keeps the insight line grammatical for a single request', async () => {
            ReviewOrder.countDocuments.mockResolvedValue(1);
            ReviewOrder.aggregate.mockResolvedValue([{ _id: 'sent', count: 1, eligible: 1 }]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'review-requests');
            expect(report.insight).toBe('1 request sent, 0 skipped');
        });
    });

    describe('monthly performance', () => {
        it('anchors on the newest metric day rather than the last calendar month', async () => {
            // Regression: asking for "last complete month" reported nothing for
            // accounts holding months of sales, because metric backfills lag by
            // weeks. Seen live on an account with 70 days of sales recorded.
            latestMetricDays({ sales: '2026-06-30' });
            SalesOnlyMetrics.aggregate.mockResolvedValue([{ totalSales: 500, unitsSold: 50 }]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'monthly-performance');

            expect(report.available).toBe(true);
            expect(report.date).toBe('June 2026');   // a complete month, so no day suffix
        });

        it('compares only equal spans when the anchor month is incomplete', async () => {
            // A part month against a whole one reads as a collapse in sales.
            latestMetricDays({ sales: '2026-09-10' });
            SalesOnlyMetrics.aggregate.mockResolvedValue([{ totalSales: 100, unitsSold: 10 }]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'monthly-performance');

            // "Sept", not "Sep" — en-GB uses the four-letter abbreviation.
            expect(report.date).toBe('September 2026 to 10 Sept 2026');
            expect(report.summary.headline).toBe('September 2026 to 10 Sept 2026 against the same 10 days of August 2026');
            expect(report.caveats.join(' ')).toMatch(/same 10 days of August 2026/);
            // The 1st to the 10th inclusive of the previous month, not all of it.
            const ranges = SalesOnlyMetrics.aggregate.mock.calls.map((call) => call[0][0].$match.date);
            expect(ranges[0]).toEqual({ $gte: '2026-09-01', $lte: '2026-09-10' });
            expect(ranges[1]).toEqual({ $gte: '2026-08-01', $lte: '2026-08-10' });
        });

        it('is unavailable when no metric day exists at all', async () => {
            latestMetricDays({});
            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'monthly-performance');

            expect(report.available).toBe(false);
            expect(report.reason).toMatch(/no sales or advertising data has been recorded/i);
        });

        it('calls a dormant marketplace dormant rather than missing', async () => {
            // Seen live: 31 days of metrics, every one of them zero. Reporting
            // that as missing data reads as a sync failure to the client.
            latestMetricDays({ sales: '2026-08-06' });
            SalesOnlyMetrics.aggregate.mockResolvedValue([{ totalSales: 0, unitsSold: 0 }]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'monthly-performance');

            expect(report.available).toBe(false);
            expect(report.reason).toMatch(/dormant/i);
        });

        it('compares the anchor month against the one before it', async () => {
            latestMetricDays({ sales: '2026-08-31', ppc: '2026-08-31' });
            // First call is the current month, second the previous one.
            SalesOnlyMetrics.aggregate
                .mockResolvedValueOnce([{ totalSales: 150, unitsSold: 15 }])
                .mockResolvedValueOnce([{ totalSales: 100, unitsSold: 10 }]);
            PPCMetrics.aggregate
                .mockResolvedValueOnce([{ adSales: 100, adSpend: 40 }])
                .mockResolvedValueOnce([{ adSales: 100, adSpend: 50 }]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'monthly-performance');
            const stat = (label) => report.summary.stats.find((item) => item.label === label);

            expect(stat('Total sales').value).toBe(150);
            expect(stat('Total sales').delta).toBe(50);
            expect(stat('ACOS').value).toBe(40);
            expect(stat('ACOS').delta).toBe(-10);
            // Falling ACOS and ad spend are improvements, and must be coloured so.
            expect(stat('ACOS').deltaGoodWhen).toBe('down');
            expect(stat('Ad spend').deltaGoodWhen).toBe('down');
        });

        it('derives ACOS from summed spend and sales, never from averaged daily rates', async () => {
            latestMetricDays({ sales: '2026-08-31', ppc: '2026-08-31' });
            SalesOnlyMetrics.aggregate.mockResolvedValue([{ totalSales: 1000, unitsSold: 10 }]);
            PPCMetrics.aggregate.mockResolvedValue([{ adSales: 200, adSpend: 50 }]);

            const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'monthly-performance');
            expect(report.summary.stats.find((item) => item.label === 'ACOS').value).toBe(25);
        });
    });

    it('features the most recently generated available report', async () => {
        Restock.findOne.mockReturnValue(mockFindOne({
            createdAt: new Date('2026-01-01T00:00:00Z'),
            Products: [{ asin: 'B1', merchantSku: 'S', price: '1', recommendedReplenishmentQty: '1', available: '1' }],
        }));
        Planning.findOne.mockReturnValue(mockFindOne({
            createdAt: new Date('2026-06-01T00:00:00Z'),
            data: [{ asin: 'B1', quantity_to_be_charged_ais_365_plus_days: '1', unfulfillable_quantity: '0' }],
        }));

        const payload = await getEsfReports(USER, 'US', 'NA');
        expect(payload.featuredKey).toBe('fba-aged-inventory');
        expect(payload.counts.available).toBe(2);
    });
});

/**
 * Pagination.
 *
 * The card payload carries only the first page, and the total row count travels
 * with it. If those two ever disagree the pager shows the wrong number of pages,
 * so the truncation point is pinned here rather than left to each builder.
 */
describe('report row pagination', () => {
    /** N restock products, enough to span several pages. */
    const withManyProducts = (count) => Restock.findOne.mockReturnValue(mockFindOne({
        createdAt: new Date('2026-04-25T00:00:00Z'),
        Products: Array.from({ length: count }, (_, i) => ({
            asin: `B${i}`,
            merchantSku: `SKU-${i}`,
            price: '10',
            // Descending qty so the sort order is deterministic and checkable.
            recommendedReplenishmentQty: String(count - i),
            available: '5',
        })),
    }));

    it('sends only a preview page on the card, but the true total alongside it', async () => {
        withManyProducts(57);
        const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'inventory-restock');

        expect(report.summary.rows).toHaveLength(PREVIEW_ROWS);
        expect(report.summary.totalRows).toBe(57);
        expect(report.pageSize).toBe(PREVIEW_ROWS);
    });

    it('walks the full set page by page without gaps or repeats', async () => {
        withManyProducts(25);

        const seen = [];
        for (let page = 1; page <= 3; page += 1) {
            const result = await getEsfReportRows(USER, 'US', 'NA', 'inventory-restock', { page, limit: 10 });
            expect(result.totalRows).toBe(25);
            expect(result.totalPages).toBe(3);
            seen.push(...result.rows.map((row) => row.sku));
        }

        expect(seen).toHaveLength(25);
        expect(new Set(seen).size).toBe(25);   // every row exactly once
    });

    it('page 1 of the paged endpoint matches what the card already showed', async () => {
        withManyProducts(30);
        const card = byKey(await getEsfReports(USER, 'US', 'NA'), 'inventory-restock');
        const paged = await getEsfReportRows(USER, 'US', 'NA', 'inventory-restock', { page: 1, limit: PREVIEW_ROWS });

        expect(paged.rows).toEqual(card.summary.rows);
    });

    it('clamps a page beyond the end instead of returning nothing', async () => {
        withManyProducts(12);
        const result = await getEsfReportRows(USER, 'US', 'NA', 'inventory-restock', { page: 999, limit: 10 });

        expect(result.page).toBe(2);
        expect(result.rows).toHaveLength(2);
    });

    it('clamps a hostile limit so one request cannot dump the catalogue', async () => {
        withManyProducts(500);
        const result = await getEsfReportRows(USER, 'US', 'NA', 'inventory-restock', { page: 1, limit: 100000 });

        expect(result.pageSize).toBe(MAX_PAGE_ROWS);
        expect(result.rows).toHaveLength(MAX_PAGE_ROWS);
    });

    it('survives junk page and limit values', async () => {
        withManyProducts(15);
        const result = await getEsfReportRows(USER, 'US', 'NA', 'inventory-restock', { page: 'abc', limit: -5 });

        expect(result.page).toBe(1);
        expect(result.rows.length).toBeGreaterThan(0);
    });

    it('returns null for a report key that does not exist', async () => {
        expect(await getEsfReportRows(USER, 'US', 'NA', 'not-a-report', {})).toBeNull();
    });

    it('reports unavailability rather than an empty page when the report has no data', async () => {
        const result = await getEsfReportRows(USER, 'US', 'NA', 'inventory-restock', { page: 1 });

        expect(result.available).toBe(false);
        expect(result.rows).toEqual([]);
        expect(result.reason).toEqual(expect.any(String));
    });
});

/**
 * Highlights are the bullets on the document preview. They are prose built from
 * real figures, so the risk is a sentence that contradicts the table beside it.
 */
describe('document highlights', () => {
    it('states the good outcome when no ASIN is losing the Buy Box', async () => {
        BuyBoxData.find.mockReturnValue({
            sort: () => ({
                limit: () => ({
                    lean: () => Promise.resolve([{
                        createdAt: new Date('2026-01-30'),
                        date: '2026-01-30',
                        totalProducts: 4,
                        productsWithBuyBox: 4,
                        productsWithLowBuyBox: 0,
                        asinBuyBoxData: [{ childAsin: 'B1', buyBoxPercentage: 100, sessions: 1 }],
                    }]),
                }),
            }),
        });

        const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'buybox');
        const texts = report.highlights.map((h) => h.text).join(' ');

        expect(texts).toMatch(/All 4 tracked ASINs held the Buy Box/);
        // A healthy report must not carry a red flag bullet.
        expect(report.highlights.some((h) => h.tone === 'watch')).toBe(false);
    });

    it('always leaves one blue fill-in bullet for the account manager', async () => {
        Restock.findOne.mockReturnValue(mockFindOne({
            createdAt: new Date('2026-04-25T00:00:00Z'),
            Products: [{ asin: 'B1', merchantSku: 'S1', price: '10', recommendedReplenishmentQty: '4', available: '2' }],
        }));

        const report = byKey(await getEsfReports(USER, 'US', 'NA'), 'inventory-restock');
        expect(report.highlights.filter((h) => h.tone === 'fill')).toHaveLength(1);
    });
});

/**
 * Report history.
 *
 * An "edition" is a captured snapshot, not a published document — nothing
 * stores publications. The risks pinned here: claiming editions exist when the
 * collection is empty, and the buy box losing-streak counter, which must count
 * a CONSECUTIVE run and reset the moment an ASIN wins the box back.
 */
describe('getEsfReportHistory', () => {
    const buyBoxSnapshots = (perSnapshotLosingAsins) => BuyBoxData.find.mockReturnValue({
        sort: () => ({
            limit: () => ({
                lean: () => Promise.resolve(perSnapshotLosingAsins.map((losing, i) => ({
                    createdAt: new Date(Date.UTC(2026, 0, 30 - i)),
                    date: `2026-01-${String(30 - i).padStart(2, '0')}`,
                    totalProducts: 3,
                    asinBuyBoxData: ['A', 'B', 'C'].map((asin) => ({
                        childAsin: asin,
                        buyBoxPercentage: losing.includes(asin) ? 0 : 100,
                        sessions: 1,
                    })),
                }))),
            }),
        }),
    });

    it('returns null for a key that is not one of our reports', async () => {
        expect(await getEsfReportHistory(USER, 'US', 'NA', 'not-a-report')).toBeNull();
    });

    it('reports no editions rather than inventing them', async () => {
        const history = await getEsfReportHistory(USER, 'US', 'NA', 'buybox');

        expect(history.available).toBe(false);
        expect(history.editions).toEqual([]);
        expect(history.totalEditions).toBe(0);
        expect(history.reason).toMatch(/no editions/i);
    });

    it('turns each snapshot into an edition, newest first', async () => {
        buyBoxSnapshots([['A'], [], ['A', 'B']]);

        const history = await getEsfReportHistory(USER, 'US', 'NA', 'buybox');

        expect(history.available).toBe(true);
        expect(history.name).toBe('Weekly Buybox Report');
        expect(history.totalEditions).toBe(3);
        expect(history.editions[0].summary).toBe('1 of 3 ASINs losing buy box');
        expect(history.editions[1].summary).toBe('0 of 3 ASINs losing buy box');
        expect(history.editions[1].tone).toBe('good');
        expect(history.editions[2].tone).toBe('watch');
        // Newest first, so the dates descend.
        expect(history.editions[0].iso > history.editions[2].iso).toBe(true);
    });

    it('counts the longest CONSECUTIVE losing run, not the total', async () => {
        // A loses in the newest three, wins in the fourth, loses again in the
        // fifth. A naive total would say 4; the run is 3.
        buyBoxSnapshots([['A'], ['A'], ['A'], [], ['A']]);

        const history = await getEsfReportHistory(USER, 'US', 'NA', 'buybox');
        const streak = history.stats.find((s) => s.label === 'Longest losing run');

        expect(streak.value).toBe(3);
    });

    it('says an edition is a capture, not a publication', async () => {
        buyBoxSnapshots([[]]);
        const history = await getEsfReportHistory(USER, 'US', 'NA', 'buybox');

        expect(history.capturedNote).toMatch(/capture of your account data/i);
        expect(history.editions[0].capturedAt).toEqual(expect.any(String));
    });

    it('builds account overview editions from the weekly history array', async () => {
        AccountHistory.findOne.mockReturnValue(mockFindOne({
            accountHistory: [
                { Date: new Date('2026-08-01'), HealthScore: '70', TotalProducts: 10, ProductsWithIssues: 4, TotalNumberOfIssues: 9 },
                { Date: new Date('2026-08-08'), HealthScore: '80', TotalProducts: 10, ProductsWithIssues: 2, TotalNumberOfIssues: 5 },
            ],
        }));

        const history = await getEsfReportHistory(USER, 'US', 'NA', 'account-overview');

        expect(history.totalEditions).toBe(2);
        // Newest first, and the delta compares it against the week before.
        expect(history.editions[0].date).toBe('8 Aug 2026');
        expect(history.stats.find((s) => s.label === 'Health score').delta).toBe(10);
        expect(history.stats.find((s) => s.label === 'Open issues').delta).toBe(-4);
    });

    it('degrades to unavailable when a history builder throws', async () => {
        BuyBoxData.find.mockImplementation(() => { throw new Error('collection exploded'); });

        const history = await getEsfReportHistory(USER, 'US', 'NA', 'buybox');
        expect(history.available).toBe(false);
    });
});
