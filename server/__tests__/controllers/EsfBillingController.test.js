/**
 * The client Billing endpoint.
 *
 * Two properties matter: a client sees only their own billing, and the "Paid" badge
 * tells the truth about whether money is still owed.
 */

const mockGetBillingView = jest.fn();
jest.mock('../../Services/Zoho/ZohoBillingSync.js', () => ({ getBillingView: mockGetBillingView }));
jest.mock('../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { getEsfBilling, toClientInvoice } = require('../../controllers/analytics/EsfBillingController.js');

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

/** AsyncHandler here does not return its promise — flush instead of awaiting. */
const run = async (req) => {
    const res = mockRes();
    getEsfBilling(req, res, jest.fn());
    await new Promise((r) => setImmediate(r));
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
};

beforeEach(() => jest.clearAllMocks());

describe('scoping', () => {
    test('reads billing for the caller only, never an id from the request', async () => {
        mockGetBillingView.mockResolvedValue({ profile: null, invoices: [] });

        await run({ userId: 'u1', params: { userId: 'someone-else' }, query: { userId: 'someone-else' } });

        // The only argument is req.userId — there is no id in the URL to tamper with.
        expect(mockGetBillingView).toHaveBeenCalledWith('u1');
    });

    test('a client with no billing record gets linked:false, not empty arrays', async () => {
        mockGetBillingView.mockResolvedValue({ profile: null, invoices: [] });

        const { status, body } = await run({ userId: 'u1' });

        // Empty arrays would render as "no invoices", implying they have been billed
        // nothing — different from having no billing account at all.
        expect(status).toBe(200);
        expect(body.data.linked).toBe(false);
    });
});

describe('what reaches the client', () => {
    const profile = {
        companyName: 'Natural Environmental Solutions, Inc',
        billingAddress: { street: '501 PARMA WAY', city: 'gardner' },
        card: { lastFour: '2718', expiryMonth: 11, expiryYear: 2030, gateway: 'stripe' },
        currencyCode: 'USD',
        outstanding: 0,
        syncedAt: new Date(),
    };

    test('never ships Zoho ids', async () => {
        mockGetBillingView.mockResolvedValue({
            profile: { ...profile, customerId: '3921939000005968087' },
            invoices: [{ invoiceId: '999', invoiceNumber: 'ESFI3635', total: 399, balance: 0 }],
        });

        const { body } = await run({ userId: 'u1' });
        const payload = JSON.stringify(body.data);

        expect(payload).not.toContain('3921939000005968087');
        expect(payload).not.toContain('999');
        expect(payload).toContain('ESFI3635');
    });

    test('no card on file is null, not a blank card', async () => {
        mockGetBillingView.mockResolvedValue({
            profile: { ...profile, card: { lastFour: null } }, invoices: [],
        });

        expect((await run({ userId: 'u1' })).body.data.card).toBeNull();
    });
});

describe('paid status comes from the balance', () => {
    test('a zero balance is paid', () => {
        expect(toClientInvoice({ balance: 0, total: 399 }).paid).toBe(true);
    });

    test('an outstanding balance is NOT paid, whatever Zoho calls the status', () => {
        // Zoho reports "sent" for an unpaid invoice — a word that tells a client
        // nothing about whether they owe money.
        const out = toClientInvoice({ balance: 399, total: 399, status: 'sent' });

        expect(out.paid).toBe(false);
        expect(out.status).toBe('sent');
    });
});
