/**
 * tasks-logics.xlsx: high traffic / low conversion, low traffic / high conversion,
 * lost or damaged not reimbursed, inbound shipment shortage.
 */
const W1 = require('../../../../Services/Calculations/kpi/Wave1Detectors.js');
const W2 = require('../../../../Services/Calculations/kpi/Wave2Detectors.js');
const { buildInboundShortage } = require('../../../../Services/Calculations/kpi/KpiInputs.js');

const NOW = new Date('2026-10-26T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

describe('detectTrafficMix', () => {
    // Median CVR across A..F is 5%. A: top traffic at 1% CVR. F: bottom traffic at 10% on 10 orders.
    const traffic = (over = {}) => ({
        newestDate: '2026-10-24',
        recent30Days: 30,
        byAsin: {
            A: { s30: 2000, u30: 20, o30: 20 },
            B: { s30: 1000, u30: 50, o30: 50 },
            C: { s30: 800, u30: 40, o30: 40 },
            D: { s30: 600, u30: 30, o30: 30 },
            E: { s30: 400, u30: 24, o30: 24 },
            F: { s30: 100, u30: 10, o30: 10 },
            ...over
        }
    });

    it('flags top-30% traffic converting under half the median', () => {
        const { high } = W2.detectTrafficMix({ traffic: traffic(), now: NOW });
        expect(high.covered).toBe(true);
        expect(high.tasks.map(t => t.asin)).toEqual(['A']);
        expect(high.tasks[0].errorType).toBe('high_traffic_low_conversion');
        expect(high.tasks[0].error).toContain('converts at only 1%');
    });

    it('flags bottom-30% traffic converting 1.5x+ the median on 10+ orders', () => {
        const { low } = W2.detectTrafficMix({ traffic: traffic(), now: NOW });
        expect(low.tasks.map(t => t.asin)).toEqual(['F']);
        const fewOrders = W2.detectTrafficMix({ traffic: traffic({ F: { s30: 100, u30: 10, o30: 9 } }), now: NOW });
        expect(fewOrders.low.tasks).toHaveLength(0);
    });

    it('needs 300+ sessions for the high-traffic task, and skips explained products', () => {
        const small = traffic();
        for (const t of Object.values(small.byAsin)) { t.s30 /= 10; t.u30 /= 10; }
        expect(W2.detectTrafficMix({ traffic: small, now: NOW }).high.tasks).toHaveLength(0);
        expect(W2.detectTrafficMix({ traffic: traffic(), skipAsins: new Map([['A', 'out of stock']]), now: NOW }).high.tasks).toHaveLength(0);
    });

    it('makes no verdict on stale data or a short window', () => {
        expect(W2.detectTrafficMix({ traffic: { ...traffic(), newestDate: '2026-10-01' }, now: NOW }).high.covered).toBe(false);
        expect(W2.detectTrafficMix({ traffic: { ...traffic(), recent30Days: 10 }, now: NOW }).low.covered).toBe(false);
    });
});

describe('detectLostDamagedUnreimbursed', () => {
    const products = new Map([['A1', { asin: 'A1', price: 20, itemName: 'Widget' }]]);
    const input = (events) => ({ fetchedAt: daysAgo(1), events });

    it('flags unreconciled lost/damaged units 30+ days after the event', () => {
        const { tasks, covered } = W1.detectLostDamagedUnreimbursed({
            lostDamaged: input([
                { at: daysAgo(40), asin: 'A1', kind: 'lost', units: 2 },
                { at: daysAgo(35), asin: 'A1', kind: 'damaged', units: 1 },
                { at: daysAgo(10), asin: 'A1', kind: 'lost', units: 5 } // Amazon still has time
            ]),
            productsByAsin: products, now: NOW
        });
        expect(covered).toBe(true);
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ errorType: 'lost_damaged_unreimbursed', amount: 60 });
        expect(tasks[0].renderData).toMatchObject({ lostUnits: 2, damagedUnits: 1 });
        // Oldest event 40 days ago -> window closes in 20 days.
        expect(tasks[0].error).toContain('Nov 15');
    });

    it('holds its tasks when the ledger fetch is stale or missing', () => {
        expect(W1.detectLostDamagedUnreimbursed({ lostDamaged: null, now: NOW }).covered).toBe(false);
        expect(W1.detectLostDamagedUnreimbursed({ lostDamaged: { fetchedAt: daysAgo(20), events: [] }, now: NOW }).covered).toBe(false);
    });
});

describe('detectInboundShortage', () => {
    const shipmentDoc = {
        createdAt: new Date(daysAgo(1)),
        shipmentData: [
            { shipmentId: 'FBA1', shipmentName: 'Oct batch', shipmentDate: daysAgo(20), itemDetails: [
                { SellerSKU: 'S1', FulfillmentNetworkSKU: 'X1', QuantityShipped: '10', QuantityReceived: '7' },
                { SellerSKU: 'S2', FulfillmentNetworkSKU: 'X2', QuantityShipped: '5', QuantityReceived: '5' }
            ] },
            { shipmentId: 'FBA2', shipmentName: 'Later', shipmentDate: daysAgo(10), itemDetails: [
                { SellerSKU: 'S1', FulfillmentNetworkSKU: 'X1', QuantityShipped: '4', QuantityReceived: '2' }
            ] }
        ]
    };
    const products = [{ asin: 'A1', sku: 'S1', price: 15 }];

    it('flags short shipments, net of inbound reimbursements matched oldest first', () => {
        const reimb = { data: [{ reason: 'Lost_Inbound', fnsku: 'X1', quantity_reimbursed_total: '3' }, { reason: 'Lost_Warehouse', fnsku: 'X1', quantity_reimbursed_total: '9' }] };
        const { tasks, covered } = W1.detectInboundShortage({ inboundShortage: buildInboundShortage(shipmentDoc, reimb), products, now: NOW });
        expect(covered).toBe(true);
        // FBA1's 3 short units are covered by the 3 Lost_Inbound units; FBA2's 2 are not.
        expect(tasks.map(t => t.asin)).toEqual(['SHIPMENT:FBA2']);
        expect(tasks[0]).toMatchObject({ errorType: 'inbound_shortage', amount: 30 });
        expect(tasks[0].error).toContain('2 fewer units than you sent in shipment FBA2');
    });

    it('makes no verdict without the reimbursement report', () => {
        const r = W1.detectInboundShortage({ inboundShortage: buildInboundShortage(shipmentDoc, null), products, now: NOW });
        expect(r.covered).toBe(false);
    });
});
