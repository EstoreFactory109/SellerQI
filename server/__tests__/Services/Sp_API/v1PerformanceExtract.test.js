/**
 * GET_V1_SELLER_PERFORMANCE_REPORT: which window's counts are kept, and the
 * unanswered-messages count. Shapes are xml2js output with explicitArray:false.
 */
jest.mock('../../../models/seller-performance/V1_Seller_Performance_Report_Model.js', () => ({ create: jest.fn() }));
const { extractV1Metrics } = require('../../../Services/Sp_API/GET_V1_SELLER_PERFORMANCE_REPORT.js');

const window = (start, end, over) => ({ timeFrame: { start, end }, ...over });
const report = ({ defects, cx, contact }) => ({
    sellerPerformanceReports: {
        sellerPerformanceReport: {
            orderDefects: { orderDefectMetrics: defects },
            customerExperience: { customerExperienceMetrics: cx },
            buyerSellerContactResponseTimeMetrics: contact
        }
    }
});

const cxWindow = (start, end, n) => window(start, end, {
    lateShipment: { count: String(n) }, preFulfillmentCancellation: { count: '0' }, refunds: { count: '1' }
});

describe('extractV1Metrics', () => {
    // Reports fetched 20-24 Oct 2026 all stored windows ending 23-24 Sep: the oldest.
    it('keeps the window that ends latest, not the oldest', () => {
        const out = extractV1Metrics(report({
            defects: [
                window('2026-06-26', '2026-09-23', { negativeFeedbacks: { count: '9' }, a_z_claims: { count: '4' } }),
                window('2026-07-26', '2026-10-23', { negativeFeedbacks: { count: '1' }, a_z_claims: { count: '0' } })
            ],
            cx: [cxWindow('2026-06-26', '2026-09-23', 5), cxWindow('2026-07-26', '2026-10-23', 2)],
            contact: {}
        }));
        expect(out.negativeFeedbacks).toEqual({ startDate: '2026-07-26', endDate: '2026-10-23', count: '1' });
        expect(out.a_z_claims.count).toBe('0');
        expect(out.lateShipmentCount).toEqual({ startDate: '2026-07-26', endDate: '2026-10-23', count: '2' });
    });

    it('adds up entries that share the latest window (e.g. one per fulfilment channel)', () => {
        const out = extractV1Metrics(report({
            defects: [
                window('2026-07-26', '2026-10-23', { negativeFeedbacks: { count: '2' }, a_z_claims: { count: '1' } }),
                window('2026-07-26', '2026-10-23', { negativeFeedbacks: { count: '3' }, a_z_claims: { count: '0' } })
            ],
            cx: cxWindow('2026-07-26', '2026-10-23', 0),
            contact: {}
        }));
        expect(out.negativeFeedbacks.count).toBe('5');
        expect(out.a_z_claims.count).toBe('1');
    });

    it('accepts a list of one arriving as a bare object', () => {
        const out = extractV1Metrics(report({
            defects: window('2026-07-26', '2026-10-23', { negativeFeedbacks: { count: '0' }, a_z_claims: { count: '0' } }),
            cx: cxWindow('2026-07-26', '2026-10-23', 0),
            contact: {}
        }));
        expect(out.negativeFeedbacks.count).toBe('0');
        expect(out.refundsCount.count).toBe('1');
    });

    it('reads unanswered messages where Amazon documents them, or one level down, else null', () => {
        const base = { defects: [], cx: [] };
        expect(extractV1Metrics(report({ ...base, contact: { noResponseForContactsOlderThan24Hours: '4' } })).noResponseOver24HoursCount).toBe(4);
        expect(extractV1Metrics(report({ ...base, contact: { responseTimeMetrics: { noResponseForContactsOlderThan24Hours: '2', responseUnder24Hours: '30' } } })))
            .toMatchObject({ noResponseOver24HoursCount: 2, responseUnder24HoursCount: '30' });
        expect(extractV1Metrics(report({ ...base, contact: { responseTimeMetrics: { responseUnder24Hours: '30' } } })).noResponseOver24HoursCount).toBeNull();
    });
});
