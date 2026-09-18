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

describe('invoice download', () => {
    const mockFindOne = jest.fn();
    const mockGetPdf = jest.fn();

    beforeAll(() => {
        jest.resetModules();
        jest.doMock('../../models/system/EsfBillingModels.js', () => ({
            EsfBillingInvoice: { findOne: mockFindOne },
            EsfBillingProfile: {},
        }));
        jest.doMock('../../Services/Zoho/ZohoBillingService.js', () => ({ getInvoicePdf: mockGetPdf }));
        jest.doMock('../../Services/Zoho/ZohoBillingSync.js', () => ({ getBillingView: jest.fn() }));
        jest.doMock('../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    });

    const load = () => require('../../controllers/analytics/EsfBillingController.js').downloadEsfInvoice;

    const chain = (result) => ({ select: () => ({ lean: () => Promise.resolve(result) }) });

    const runDownload = async (req) => {
        const res = mockRes();
        res.setHeader = jest.fn();
        res.send = jest.fn().mockReturnValue(res);
        load()(req, res, jest.fn());
        await new Promise((r) => setImmediate(r));
        return res;
    };

    beforeEach(() => {
        mockFindOne.mockReset();
        mockGetPdf.mockReset();
    });

    test('refuses an invoice that is not the caller\'s', async () => {
        // Scoped by userId, so another client's invoice number resolves to nothing —
        // the number being guessable is fine because the query is not.
        mockFindOne.mockReturnValue(chain(null));

        const res = await runDownload({ userId: 'u1', params: { invoiceNumber: 'ESFI9999' } });

        expect(res.status).toHaveBeenCalledWith(404);
        expect(mockGetPdf).not.toHaveBeenCalled();
    });

    test('looks the invoice up by caller AND number, never number alone', async () => {
        mockFindOne.mockReturnValue(chain({ invoiceId: 'z1', invoiceNumber: 'ESFI3635' }));
        mockGetPdf.mockResolvedValue(Buffer.from('%PDF-1.4 test'));

        await runDownload({ userId: 'u1', params: { invoiceNumber: 'ESFI3635' } });

        expect(mockFindOne).toHaveBeenCalledWith({ userId: 'u1', invoiceNumber: 'ESFI3635' });
    });

    test('sends the PDF with a filename the client recognises', async () => {
        mockFindOne.mockReturnValue(chain({ invoiceId: 'z1', invoiceNumber: 'ESFI3635' }));
        mockGetPdf.mockResolvedValue(Buffer.from('%PDF-1.4 test'));

        const res = await runDownload({ userId: 'u1', params: { invoiceNumber: 'ESFI3635' } });

        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
        expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="ESFI3635.pdf"');
    });

    test('strips anything header-unsafe out of the filename', async () => {
        // The number reaches a response header, so a crafted one must not be able to
        // inject into it.
        mockFindOne.mockReturnValue(chain({ invoiceId: 'z1', invoiceNumber: 'ES"I\r\n-evil' }));
        mockGetPdf.mockResolvedValue(Buffer.from('%PDF-1.4 test'));

        const res = await runDownload({ userId: 'u1', params: { invoiceNumber: 'x' } });

        const disposition = res.setHeader.mock.calls.find((c) => c[0] === 'Content-Disposition')[1];
        expect(disposition).toBe('attachment; filename="ESI-evil.pdf"');
        expect(disposition).not.toMatch(/[\r\n"]evil/);
    });

    test('a Zoho failure is a clean 502, not a broken file', async () => {
        mockFindOne.mockReturnValue(chain({ invoiceId: 'z1', invoiceNumber: 'ESFI3635' }));
        mockGetPdf.mockRejectedValue(new Error('Zoho did not return a PDF for this invoice'));

        const res = await runDownload({ userId: 'u1', params: { invoiceNumber: 'ESFI3635' } });

        expect(res.status).toHaveBeenCalledWith(502);
    });
});

describe('the plan block', () => {
    const base = { companyName: 'Acme', card: { lastFour: '2718' }, currencyCode: 'USD', syncedAt: new Date() };

    test('a live plan sends its next charge date', async () => {
        mockGetBillingView.mockResolvedValue({
            profile: {
                ...base,
                subscription: {
                    planName: 'Walmart Account Management', status: 'live', hasEnded: false,
                    nextBillingAt: new Date('2026-12-16'), currentTermEndsAt: new Date('2026-12-16'),
                },
            },
            invoices: [],
        });

        const { body } = await run({ userId: 'u1' });

        expect(body.data.plan).toMatchObject({ status: 'live', ended: false });
        expect(body.data.plan.renewsOn).toEqual(new Date('2026-12-16'));
    });

    test('a cancelled plan says so, and still says what it is paid up to', async () => {
        // "Cancelled" on its own leaves a client wondering whether they still have
        // cover; the covered-until date is the half that answers it.
        mockGetBillingView.mockResolvedValue({
            profile: {
                ...base,
                subscription: {
                    planName: 'Walmart Account Management', status: 'cancelled', hasEnded: true,
                    nextBillingAt: null,
                    currentTermEndsAt: new Date('2026-07-22'),
                    cancelledAt: new Date('2026-07-03'),
                },
            },
            invoices: [],
        });

        const { body } = await run({ userId: 'u1' });

        expect(body.data.plan).toMatchObject({ status: 'cancelled', ended: true, renewsOn: null });
        expect(body.data.plan.cancelledOn).toEqual(new Date('2026-07-03'));
        expect(body.data.plan.coveredUntil).toEqual(new Date('2026-07-22'));
    });

    test('sends no pricing or subscription id with the plan', async () => {
        mockGetBillingView.mockResolvedValue({
            profile: {
                ...base,
                subscription: {
                    planName: 'X', status: 'live', hasEnded: false, nextBillingAt: new Date(),
                    // fields the sync stores but a client has no use for
                    amount: 399, subscriptionId: '3921939000005968085',
                },
            },
            invoices: [],
        });

        const { body } = await run({ userId: 'u1' });

        expect(Object.keys(body.data.plan).sort())
            .toEqual(['cancelledOn', 'coveredUntil', 'ended', 'name', 'renewsOn', 'status']);
        expect(JSON.stringify(body.data)).not.toContain('3921939000005968085');
    });

    test('no subscription at all is null, not an empty plan card', async () => {
        mockGetBillingView.mockResolvedValue({ profile: { ...base, subscription: {} }, invoices: [] });

        expect((await run({ userId: 'u1' })).body.data.plan).toBeNull();
    });
});
