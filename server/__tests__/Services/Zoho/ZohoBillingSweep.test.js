/**
 * The nightly billing sweep's selection step.
 *
 * Specifically guards a bug that does not announce itself: the due rule reads
 * `subscription.hasEnded`, and the sweep loads profiles with a projection. Drop
 * `subscription` from that projection and nothing fails — the rule just quietly takes
 * the "renewal date unknown" branch and fetches every cancelled plan every night,
 * which is most of what this rule exists to prevent. 124 of 182 subscriptions on the
 * live account are cancelled.
 */

const mockUserFind = jest.fn();
const mockProfileFind = jest.fn();

jest.mock('../../../models/user-auth/userModel.js', () => ({ find: mockUserFind, updateOne: jest.fn() }));
jest.mock('../../../models/system/EsfBillingModels.js', () => ({
    EsfBillingProfile: { find: mockProfileFind, updateOne: jest.fn(), findOne: jest.fn() },
    EsfBillingInvoice: { find: jest.fn(), bulkWrite: jest.fn(), deleteMany: jest.fn() },
}));
jest.mock('../../../Services/Zoho/ZohoBillingService.js', () => ({
    findCustomerByEmail: jest.fn(), getCustomer: jest.fn(), getCustomerCards: jest.fn(),
    listInvoices: jest.fn(), getInvoice: jest.fn(), listSubscriptions: jest.fn(),
    governingSubscription: jest.fn(),
}));
jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const ZohoBillingService = require('../../../Services/Zoho/ZohoBillingService.js');
const { syncAllBilling } = require('../../../Services/Zoho/ZohoBillingSync.js');

const USER = { _id: 'u1', email: 'client@example.com', zohoBilling: { customerId: 'c1' } };

beforeEach(() => {
    jest.clearAllMocks();
    mockUserFind.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([USER]) }) });
});

const withProfile = (profile) => {
    mockProfileFind.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([profile]) }) });
};

test('a cancelled plan is skipped, which requires the projection to include subscription', async () => {
    withProfile({
        userId: 'u1',
        nextRenewalAt: null,
        lastCheckedAt: new Date(),
        subscription: { status: 'cancelled', hasEnded: true },
    });

    const out = await syncAllBilling();

    expect(out.notDue).toBe(1);
    expect(out.checked).toBe(0);
    // The real assertion: nothing was fetched from Zoho for a plan that has ended.
    expect(ZohoBillingService.listInvoices).not.toHaveBeenCalled();
    expect(out.results[0].reason).toMatch(/no invoice expected/);
});

test('a live plan whose billing date has passed IS fetched', async () => {
    withProfile({
        userId: 'u1',
        nextRenewalAt: new Date(Date.now() - 86400000),
        lastCheckedAt: new Date(),
        subscription: { status: 'live', hasEnded: false },
    });
    ZohoBillingService.getCustomer.mockResolvedValue({ companyName: 'Acme' });
    ZohoBillingService.getCustomerCards.mockResolvedValue([]);
    ZohoBillingService.listInvoices.mockResolvedValue([]);
    ZohoBillingService.listSubscriptions.mockResolvedValue([]);
    ZohoBillingService.governingSubscription.mockReturnValue(null);

    const out = await syncAllBilling();

    expect(out.checked).toBe(1);
    expect(ZohoBillingService.listInvoices).toHaveBeenCalled();
});

test('force bypasses the rule entirely, for a manual refresh', async () => {
    withProfile({
        userId: 'u1', nextRenewalAt: null, lastCheckedAt: new Date(),
        subscription: { status: 'cancelled', hasEnded: true },
    });
    ZohoBillingService.getCustomer.mockResolvedValue({ companyName: 'Acme' });
    ZohoBillingService.getCustomerCards.mockResolvedValue([]);
    ZohoBillingService.listInvoices.mockResolvedValue([]);
    ZohoBillingService.listSubscriptions.mockResolvedValue([]);
    ZohoBillingService.governingSubscription.mockReturnValue(null);

    const out = await syncAllBilling({ force: true });

    expect(out.checked).toBe(1);
    expect(out.results[0].reason).toBe('forced');
});
