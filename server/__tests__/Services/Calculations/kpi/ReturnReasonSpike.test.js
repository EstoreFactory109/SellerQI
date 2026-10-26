/**
 * tasks-logics.xlsx "Return reason spike": defective / not as described / wrong item
 * are 30%+ of a product's returns in 30 days (10+ returns, internal floor).
 */
jest.mock('../../../../models/inventory/CustomerReturnsModel.js', () => ({ create: jest.fn() }));
const { parseCustomerReturns } = require('../../../../Services/Sp_API/GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA.js');
const { detectReturnReasonSpike } = require('../../../../Services/Calculations/kpi/Wave3Detectors.js');
const { isProductFaultReturn } = require('../../../../Services/Calculations/kpi/KpiRules.js');

const NOW = new Date('2026-10-26T12:00:00Z');
const line = (reason, returnDate = '2026-10-20', asin = 'A1') => ({ asin, reason, quantity: 1, returnDate });
const input = (lines, fetchedAt = '2026-10-25T00:00:00Z') => ({ fetchedAt, unreadable: false, lines });

describe('parseCustomerReturns', () => {
    it('reads the report and counts reasons', async () => {
        const tsv = 'return-date\torder-id\tsku\tasin\tfnsku\tproduct-name\tquantity\tfulfillment-center-id\tdetailed-disposition\treason\tstatus\n'
            + '2026-10-20T10:00:00+00:00\t111-1\tS1\tA1\tX1\tWidget\t2\tPHX7\tCUSTOMER_DAMAGED\tDEFECTIVE\tUnit returned to inventory\n'
            + '2026-10-21T10:00:00+00:00\t111-2\tS1\tA1\tX1\tWidget\t1\tPHX7\tSELLABLE\tUNWANTED_ITEM\tUnit returned to inventory\n';
        const parsed = await parseCustomerReturns(Buffer.from(tsv));
        expect(parsed.unreadable).toBe(false);
        expect(parsed.lineCount).toBe(2);
        expect(parsed.reasonCounts).toEqual({ DEFECTIVE: 2, UNWANTED_ITEM: 1 });
        expect(parsed.lines[0]).toMatchObject({ asin: 'A1', reason: 'UNWANTED_ITEM', quantity: 1 });
    });

    it('marks a file without a reason column unreadable', async () => {
        const parsed = await parseCustomerReturns(Buffer.from('return-date\tasin\n2026-10-20\tA1\n'));
        expect(parsed.unreadable).toBe(true);
    });
});

describe('detectReturnReasonSpike', () => {
    it('flags 30%+ product-fault returns on 10+ returns', () => {
        const lines = [...Array(3).fill('DEFECTIVE'), 'NOT_AS_DESCRIBED', ...Array(6).fill('UNWANTED_ITEM')].map(r => line(r));
        const { tasks, covered } = detectReturnReasonSpike({ returns: input(lines), now: NOW });
        expect(covered).toBe(true);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ errorType: 'return_reason_spike', renderData: { returns: 10, faultReturns: 4, sharePct: 40 } });
        expect(tasks[0].error).toContain('defective (3), not as described (1)');
    });

    it('ignores small counts, old returns and the buyer ordering the wrong item', () => {
        expect(detectReturnReasonSpike({ returns: input(Array(9).fill(line('DEFECTIVE'))), now: NOW }).tasks).toHaveLength(0);
        const old = Array(10).fill(line('DEFECTIVE', '2026-09-01'));
        expect(detectReturnReasonSpike({ returns: input(old), now: NOW }).tasks).toHaveLength(0);
        expect(isProductFaultReturn('ORDERED_WRONG_ITEM')).toBe(false);
        expect(isProductFaultReturn('wrong item')).toBe(true);
        expect(isProductFaultReturn('SWITCHEROO')).toBe(true);
        expect(isProductFaultReturn('QUALITY_UNACCEPTABLE')).toBe(false);
    });

    it('makes no verdict on a stale, missing or unreadable report', () => {
        expect(detectReturnReasonSpike({ returns: null, now: NOW }).covered).toBe(false);
        expect(detectReturnReasonSpike({ returns: input([], '2026-10-01T00:00:00Z'), now: NOW }).covered).toBe(false);
        expect(detectReturnReasonSpike({ returns: { ...input([]), unreadable: true }, now: NOW }).covered).toBe(false);
    });
});
