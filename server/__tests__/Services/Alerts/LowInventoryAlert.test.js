/**
 * The low-inventory email uses the replenishment tasks' rule (tasks-logics.xlsx
 * "Products to Replenish") and sends each running-out product at most once a week.
 */
const mockDocs = [];
const mockRecent = [];
const mockCreated = [];
jest.mock('../../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js', () => ({
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => mockDocs }) }) })
}));
jest.mock('../../../models/alerts/Alert.js', () => ({
    LowInventoryAlert: {
        find: () => ({ select: () => ({ lean: () => Promise.resolve(mockRecent) }) }),
        create: async (doc) => { mockCreated.push(doc); return { _id: { toString: () => 'id' }, ...doc }; }
    }
}));
let mockLeadTime;
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
    findOne: () => ({ select: () => ({ lean: () => Promise.resolve({ sellerAccount: [{ country: 'US', region: 'NA', replenishLeadTimeDays: mockLeadTime }] }) }) })
}));
const { detectAndStoreLowInventoryAlerts } = require('../../../Services/Alerts/Other-Alerts/LowInventoryAlertService.js');

const row = (over) => ({ asin: 'A1', merchantSku: 'S1', currencyCode: 'USD', available: '30', inbound: '0', unitsSoldLast30Days: '60', alert: '', recommendedReplenishmentQty: '100', ...over });
const doc = (products) => ({ _id: 'd', createdAt: new Date(), Products: products });

beforeEach(() => { mockDocs.length = 0; mockRecent.length = 0; mockCreated.length = 0; mockLeadTime = undefined; });

it('emails products running out, with days left and Amazon\'s quantity', async () => {
    mockDocs.push(doc([row(), row({ asin: 'A2', merchantSku: 'S2', inbound: '200' })]));
    const r = await detectAndStoreLowInventoryAlerts('U', 'NA', 'US');
    expect(r.created).toBe(true);
    expect(mockCreated[0].products.map(p => p.asin)).toEqual(['A1']);
    expect(mockCreated[0].products[0].message).toBe('Runs out in about 15 days at the current sales rate (30 available, 0 inbound). Amazon recommends sending 100 units.');
});

it('no longer uses Amazon\'s quantity alone (old rule: over 30 units)', async () => {
    // Slow seller: 10 a month, plenty of stock, Amazon still suggests 50.
    mockDocs.push(doc([row({ unitsSoldLast30Days: '10', recommendedReplenishmentQty: '50' })]));
    expect((await detectAndStoreLowInventoryAlerts('U', 'NA', 'US')).created).toBe(false);
});

it('sends a product at most once a week', async () => {
    mockDocs.push(doc([row()]));
    mockRecent.push({ products: [{ asin: 'A1', alert: 'low_stock' }] });
    expect((await detectAndStoreLowInventoryAlerts('U', 'NA', 'US')).created).toBe(false);
});

it('uses the seller\'s own lead time when set', async () => {
    // 2/day, 30 + 100 inbound = 65 days: fine at 45 + 14, running out at 60 + 14.
    mockDocs.push(doc([row({ inbound: '100' })]));
    expect((await detectAndStoreLowInventoryAlerts('U', 'NA', 'US')).created).toBe(false);
    mockLeadTime = 60;
    expect((await detectAndStoreLowInventoryAlerts('U', 'NA', 'US')).created).toBe(true);
});
