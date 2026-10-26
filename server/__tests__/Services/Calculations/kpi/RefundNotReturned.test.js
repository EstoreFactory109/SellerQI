/**
 * tasks-logics.xlsx "Potential reimbursements: refund given, item not returned".
 */
const W1 = require('../../../../Services/Calculations/kpi/Wave1Detectors.js');
const { buildRefundCheck } = require('../../../../Services/Calculations/kpi/KpiInputs.js');
const { saveRefundOrders } = require('../../../../Services/Sp_API/FinanceService.js');

const NOW = new Date('2026-10-26T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);
const refund = (orderId, d = 70, over = {}) => ({ orderId, sku: 'S1', asin: 'A1', refundDate: daysAgo(d), amount: 20, units: 1, ...over });
const check = (refunds, { returned = [], reimbursed = [] } = {}) => buildRefundCheck(
    refunds,
    { createdAt: daysAgo(2), windowStart: daysAgo(150), lines: returned.map(orderId => ({ orderId })) },
    { data: reimbursed.map(amazon_order_id => ({ amazon_order_id })) }
);
const STOCK = { byAsin: { A1: { skus: ['S1'] } } };
const run = (refundCheck, products = [{ asin: 'A1', sku: 'S1' }], stock = STOCK) => W1.detectRefundNotReturned({ refundCheck, stock, products, now: NOW });

describe('detectRefundNotReturned', () => {
    it('flags refunds with no return and no reimbursement, per product', () => {
        const { tasks, covered } = run(check([refund('111-1', 70), refund('111-2', 90), refund('111-3', 65)], { returned: ['111-2'], reimbursed: ['111-3'] }));
        expect(covered).toBe(true);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ errorType: 'refund_not_returned', amount: 20, renderData: { orders: ['111-1'], refundCount: 1 } });
        // Refunded 70 days ago -> claim window closes in 50 days.
        expect(tasks[0].error).toContain('Dec 15');
    });

    it('skips seller-fulfilled orders and refunds older than the returns report', () => {
        expect(run(check([refund('111-1')]), [{ asin: 'A1', sku: 'S1', fulfillmentChannel: 'DEFAULT' }]).tasks).toHaveLength(0);
        // Not in Amazon's inventory: seller-fulfilled, its returns never reach the report.
        expect(run(check([refund('111-1', 70, { sku: 'FBM-1' })])).tasks).toHaveLength(0);
        // No FBA inventory read: no verdict.
        expect(run(check([refund('111-1')]), undefined, null).covered).toBe(false);
        const short = buildRefundCheck([refund('111-1', 100)], { createdAt: daysAgo(2), windowStart: daysAgo(90), lines: [] }, { data: [] });
        expect(run(short).tasks).toHaveLength(0);
    });

    it('makes no verdict without fresh returns or the reimbursement report', () => {
        expect(run(buildRefundCheck([refund('111-1')], null, { data: [] })).covered).toBe(false);
        expect(run(buildRefundCheck([refund('111-1')], { createdAt: daysAgo(2), windowStart: daysAgo(150), lines: [] }, null)).covered).toBe(false);
        expect(run(buildRefundCheck([refund('111-1')], { createdAt: daysAgo(30), windowStart: daysAgo(150), lines: [] }, { data: [] })).covered).toBe(false);
    });
});

describe('saveRefundOrders', () => {
    it('sums rows per order and SKU and keeps the earliest date', async () => {
        const RefundOrder = require('../../../../models/finance/RefundOrderModel.js');
        const spy = jest.spyOn(RefundOrder, 'bulkWrite').mockResolvedValue({});
        const n = await saveRefundOrders('U', 'US', 'NA', [
            { orderId: 'O1', sku: 'S1', asin: 'A1', units: 1, amount: -15, postedDate: '2026-10-02T00:00:00Z' },
            { orderId: 'O1', sku: 'S1', asin: 'A1', units: 1, amount: -5, postedDate: '2026-10-01T00:00:00Z' }
        ]);
        expect(n).toBe(1);
        const op = spy.mock.calls[0][0][0].updateOne;
        expect(op.update.$set).toMatchObject({ amount: 20, units: 1 });
        expect(op.update.$min.refundDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
        spy.mockRestore();
    });
});
