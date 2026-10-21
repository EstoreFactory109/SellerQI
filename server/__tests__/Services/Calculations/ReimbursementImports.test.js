/**
 * Lost / damaged / disposed reimbursements were always $0.
 *
 * Commit ddfe038 moved the FBA reimbursements and ledger detail reports behind
 * services and deleted the old model imports from Reimbursement.js, but never
 * required the new service functions. Each calculator then threw a
 * ReferenceError inside its own try/catch and returned totalExpectedAmount 0,
 * and the damaged/disposed summary fallbacks never ran either.
 *
 * These tests feed each calculator a small fixture that must produce a
 * positive amount, and guard the file against undefined identifiers.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../../models/inventory/ShipmentModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/MCP/EconomicsMetricsModel.js', () => ({ findOne: jest.fn(), findLatest: jest.fn() }));
jest.mock('../../../models/MCP/AsinWiseSalesForBigAccountsModel.js', () => ({ find: jest.fn() }));
jest.mock('../../../Services/Calculations/ActualFeesCalculations.js', () => ({ calculateFees: jest.fn() }));
jest.mock('../../../Services/Finance/LedgerSummaryViewService.js', () => ({ getLedgerSummaryViewData: jest.fn() }));
jest.mock('../../../Services/inventory/ProductWiseFBADataService.js', () => ({ getProductWiseFBAData: jest.fn() }));
jest.mock('../../../Services/Finance/FBAReimbursementsService.js', () => ({ getFBAReimbursementsData: jest.fn() }));
jest.mock('../../../Services/Finance/LedgerDetailViewService.js', () => ({ getLedgerDetailViewData: jest.fn() }));

const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const { getLedgerSummaryViewData } = require('../../../Services/Finance/LedgerSummaryViewService.js');
const { getProductWiseFBAData } = require('../../../Services/inventory/ProductWiseFBADataService.js');
const { getFBAReimbursementsData } = require('../../../Services/Finance/FBAReimbursementsService.js');
const { getLedgerDetailViewData } = require('../../../Services/Finance/LedgerDetailViewService.js');
const logger = require('../../../utils/Logger.js');

const {
    calculateLostInventoryReimbursement,
    calculateDamagedInventoryReimbursement,
    calculateDisposedInventoryReimbursement,
} = require('../../../Services/Calculations/Reimbursement.js');

const USER = '6a40e42712ce56d674f734a0';
const COUNTRY = 'US';
const REGION = 'NA';

// One product at $25 with $5 of FBA fees => $20 reimbursable per unit.
const sellerDoc = {
    User: USER,
    sellerAccount: [{
        country: COUNTRY,
        region: REGION,
        products: [{ asin: 'B0TESTASIN', sku: 'SKU-1', price: '25.00' }],
    }],
};
const fbaData = {
    fbaData: [{ asin: 'B0TESTASIN', fnsku: 'X00TESTFN', sku: 'SKU-1', 'estimated-fee-total': '5.00' }],
};

beforeEach(() => {
    Seller.findOne.mockResolvedValue(sellerDoc);
    getProductWiseFBAData.mockResolvedValue(fbaData);
});

describe('Reimbursement calculators read their reports through the finance services', () => {
    test('lost: (lost - found - already reimbursed) x (price - fees)', async () => {
        getLedgerSummaryViewData.mockResolvedValue({
            data: [{ date: '09/2026', asin: 'B0TESTASIN', fnsku: 'X00TESTFN', title: 'Widget', lost: '-5', found: '1' }],
        });
        getFBAReimbursementsData.mockResolvedValue({
            data: [
                { asin: 'B0TESTASIN', reason: 'Lost_Warehouse', quantity_reimbursed_total: '1' },
                // Other reasons must not reduce the lost discrepancy.
                { asin: 'B0TESTASIN', reason: 'Damaged_Warehouse', quantity_reimbursed_total: '2' },
            ],
        });

        const result = await calculateLostInventoryReimbursement(USER, COUNTRY, REGION);

        expect(getFBAReimbursementsData).toHaveBeenCalledWith(USER, COUNTRY, REGION);
        expect(result.success).toBe(true);
        expect(result.totalExpectedAmount).toBeGreaterThan(0);
        // 5 lost - 1 found - 1 reimbursed = 3 units x $20
        expect(result.totalLostUnits).toBe(3);
        expect(result.totalExpectedAmount).toBe(60);
        expect(logger.error).not.toHaveBeenCalled();
    });

    test('damaged: unreconciled quantity on reason codes 6/7/E/H/K/U only', async () => {
        getLedgerDetailViewData.mockResolvedValue({
            data: [
                { date_and_time: '2026-09-01', asin: 'B0TESTASIN', fnsku: 'X00TESTFN', reason: 'E', reference_id: 'R1', unreconciled_quantity: '2', quantity: '-2' },
                { date_and_time: '2026-09-02', asin: 'B0TESTASIN', fnsku: 'X00TESTFN', reason: '6', reference_id: 'R2', unreconciled_quantity: '1', quantity: '-1' },
                // Duplicate incident: same reference id, asin and fnsku is counted once.
                { date_and_time: '2026-09-02', asin: 'B0TESTASIN', fnsku: 'X00TESTFN', reason: '6', reference_id: 'R2', unreconciled_quantity: '1', quantity: '-1' },
                // Not a damaged reason code.
                { date_and_time: '2026-09-03', asin: 'B0TESTASIN', fnsku: 'X00TESTFN', reason: 'D', reference_id: 'R3', unreconciled_quantity: '9', quantity: '-9' },
            ],
        });

        const result = await calculateDamagedInventoryReimbursement(USER, COUNTRY, REGION);

        expect(getLedgerDetailViewData).toHaveBeenCalledWith(USER, COUNTRY, REGION);
        expect(result.success).toBe(true);
        expect(result.totalExpectedAmount).toBeGreaterThan(0);
        expect(result.totalDamagedUnits).toBe(3);
        expect(result.totalExpectedAmount).toBe(60);
        expect(logger.error).not.toHaveBeenCalled();
    });

    test('damaged: falls back to the ledger summary when there is no detail data', async () => {
        getLedgerDetailViewData.mockResolvedValue({ data: [] });
        getLedgerSummaryViewData.mockResolvedValue({
            data: [{ asin: 'B0TESTASIN', fnsku: 'X00TESTFN', damaged: '2' }],
        });

        const result = await calculateDamagedInventoryReimbursement(USER, COUNTRY, REGION);

        expect(result.success).toBe(true);
        expect(result.totalExpectedAmount).toBe(40);
    });

    test('disposed: |quantity| on reason D with an eligible disposition', async () => {
        getLedgerDetailViewData.mockResolvedValue({
            data: [
                { date_and_time: '2026-09-01', asin: 'B0TESTASIN', fnsku: 'X00TESTFN', reason: 'D', disposition: 'SELLABLE', reference_id: 'D1', quantity: '-3' },
                { date_and_time: '2026-09-02', asin: 'B0TESTASIN', fnsku: 'X00TESTFN', reason: 'D', disposition: 'EXPIRED', reference_id: 'D2', quantity: '-1' },
                // Ineligible disposition.
                { date_and_time: '2026-09-03', asin: 'B0TESTASIN', fnsku: 'X00TESTFN', reason: 'D', disposition: 'CUSTOMER_DAMAGED', reference_id: 'D3', quantity: '-7' },
                // Not a disposal.
                { date_and_time: '2026-09-04', asin: 'B0TESTASIN', fnsku: 'X00TESTFN', reason: 'E', disposition: 'SELLABLE', reference_id: 'D4', quantity: '-7' },
            ],
        });

        const result = await calculateDisposedInventoryReimbursement(USER, COUNTRY, REGION);

        expect(getLedgerDetailViewData).toHaveBeenCalledWith(USER, COUNTRY, REGION);
        expect(result.success).toBe(true);
        expect(result.totalExpectedAmount).toBeGreaterThan(0);
        expect(result.totalDisposedUnits).toBe(4);
        expect(result.totalExpectedAmount).toBe(80);
        expect(logger.error).not.toHaveBeenCalled();
    });

    test('disposed: falls back to the ledger summary when there is no detail data', async () => {
        getLedgerDetailViewData.mockResolvedValue(null);
        getLedgerSummaryViewData.mockResolvedValue({
            data: [{ asin: 'B0TESTASIN', fnsku: 'X00TESTFN', disposed: '2' }],
        });

        const result = await calculateDisposedInventoryReimbursement(USER, COUNTRY, REGION);

        expect(result.success).toBe(true);
        expect(result.totalExpectedAmount).toBe(40);
    });

    test('a failure is logged with the function name and the stack', async () => {
        getLedgerDetailViewData.mockRejectedValue(new Error('boom'));

        const result = await calculateDamagedInventoryReimbursement(USER, COUNTRY, REGION);

        expect(result).toEqual(expect.objectContaining({ success: false, totalExpectedAmount: 0, totalDamagedUnits: 0, data: [] }));
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('calculateDamagedInventoryReimbursement failed'),
            expect.objectContaining({ stack: expect.stringContaining('boom') }),
        );
    });
});

/**
 * Static no-undef guard. ESLint is not installed for the server, so this uses
 * Babel's scope analysis (already present via Jest) to find every identifier
 * reference that is neither bound in the file nor a Node global.
 */
function findUndefinedIdentifiers(file) {
    const { parse } = require('@babel/parser');
    const traverse = require('@babel/traverse').default;

    const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'script', errorRecovery: false });
    const nodeGlobals = new Set([
        ...Object.getOwnPropertyNames(globalThis),
        'require', 'module', 'exports', '__dirname', '__filename',
    ]);
    const undefinedRefs = [];
    traverse(ast, {
        ReferencedIdentifier(p) {
            if (p.isJSXIdentifier()) return;
            const { name } = p.node;
            if (p.scope.hasBinding(name, true)) return;
            if (nodeGlobals.has(name)) return;
            if (p.parentPath.isUnaryExpression({ operator: 'typeof' })) return;
            undefinedRefs.push(`${name}:${p.node.loc.start.line}`);
        },
    });
    return undefinedRefs;
}

describe('Reimbursement.js has no undefined identifiers', () => {
    const file = path.join(__dirname, '../../../Services/Calculations/Reimbursement.js');

    test('every referenced identifier is declared, required or a Node global', () => {
        expect(findUndefinedIdentifiers(file)).toEqual([]);
    });

    test('the guard itself catches a missing import', () => {
        const tmp = path.join(require('os').tmpdir(), `reimb-undef-${process.pid}.js`);
        fs.writeFileSync(tmp, 'const a = async () => { try { await getLedgerDetailViewData(1); } catch (e) { return 0; } };\nmodule.exports = { a };\n');
        try {
            expect(findUndefinedIdentifiers(tmp)).toEqual(['getLedgerDetailViewData:1']);
        } finally {
            fs.unlinkSync(tmp);
        }
    });
});
