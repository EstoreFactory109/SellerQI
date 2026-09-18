/**
 * Zoho Billing field mapping.
 *
 * Every assertion here exists because the live payload disagreed with what the docs
 * or ordinary naming would suggest, and each one failed SILENTLY — an undefined field
 * renders as an empty cell, not an error, so none of these would have been caught by
 * the page looking broken.
 */

jest.mock('../../../Services/Zoho/ZohoProjectsClient.js', () => ({ zohoRequest: jest.fn() }));
jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { zohoRequest } = require('../../../Services/Zoho/ZohoProjectsClient.js');
const Billing = require('../../../Services/Zoho/ZohoBillingService.js');

beforeEach(() => jest.clearAllMocks());

describe('normaliseInvoice', () => {
    test('reads the date from invoice_date, not date', () => {
        // `date` does not exist on any row — reading it returned undefined for every
        // invoice, which the table would have shown as an empty Date column.
        const out = Billing.normaliseInvoice({ invoice_id: '1', invoice_date: '2026-06-22', date: undefined });

        expect(out.invoiceDate).toEqual(new Date('2026-06-22'));
    });

    test('keeps balance and total as numbers, not Zoho strings', () => {
        const out = Billing.normaliseInvoice({ invoice_id: '1', total: '399', balance: '0' });

        expect(out.total).toBe(399);
        expect(out.balance).toBe(0);
    });

    test('a missing total is 0, never null, so arithmetic on it is safe', () => {
        expect(Billing.normaliseInvoice({ invoice_id: '1' }).total).toBe(0);
    });
});

describe('normaliseCard', () => {
    test('exposes no brand, because Zoho does not provide one', () => {
        // The page mock showed "VISA". Zoho returns funding:"" and no card-type field,
        // so any brand shown would be invented.
        const out = Billing.normaliseCard({
            card_id: 'c1', last_four_digits: '2718', expiry_month: 11, expiry_year: 2030,
            funding: '', payment_gateway: 'stripe', is_primary: true,
        });

        expect(out).not.toHaveProperty('brand');
        expect(out.lastFour).toBe('2718');
        expect(out.expiryMonth).toBe(11);
        expect(out.isPrimary).toBe(true);
    });
});

describe('findCustomerByEmail', () => {
    test('requires an exact email match, not the substring Zoho searched on', async () => {
        // email_contains is a SUBSTRING filter: searching "sam@acme.com" also returns
        // "notsam@acme.com.au". Binding a client's invoices to that would show them
        // another company's billing.
        zohoRequest.mockResolvedValue({
            customers: [{ customer_id: '9', email: 'notsam@acme.com.au', company_name: 'Other Co' }],
        });

        expect(await Billing.findCustomerByEmail('sam@acme.com')).toBeNull();
    });

    test('matches case-insensitively', async () => {
        zohoRequest.mockResolvedValue({
            customers: [{ customer_id: '9', email: 'Sam@Acme.com', company_name: 'Acme' }],
        });

        const out = await Billing.findCustomerByEmail('sam@acme.com');
        expect(out.customerId).toBe('9');
    });

    test('no match is null, not an error — plenty of clients have no billing record', async () => {
        zohoRequest.mockResolvedValue({ customers: [] });

        expect(await Billing.findCustomerByEmail('nobody@example.com')).toBeNull();
        expect(await Billing.findCustomerByEmail('')).toBeNull();
    });
});

describe('getCustomerCards', () => {
    test('a card failure returns [] rather than losing the invoice history', async () => {
        zohoRequest.mockRejectedValue(new Error('403 forbidden'));

        // The invoices are the more useful half of the page; a missing card must not
        // take them down with it.
        expect(await Billing.getCustomerCards('c1')).toEqual([]);
    });
});

describe('listInvoices', () => {
    test('pages until Zoho says there are no more', async () => {
        zohoRequest
            .mockResolvedValueOnce({ invoices: [{ invoice_id: '1', invoice_date: '2026-01-01' }], page_context: { has_more_page: true } })
            .mockResolvedValueOnce({ invoices: [{ invoice_id: '2', invoice_date: '2026-02-01' }], page_context: { has_more_page: false } });

        const out = await Billing.listInvoices('c1');

        expect(out).toHaveLength(2);
        expect(zohoRequest).toHaveBeenCalledTimes(2);
    });

    test('returns newest first, which is the order the page renders', async () => {
        zohoRequest.mockResolvedValue({
            invoices: [
                { invoice_id: '1', invoice_date: '2026-03-26' },
                { invoice_id: '2', invoice_date: '2026-06-22' },
            ],
            page_context: { has_more_page: false },
        });

        const out = await Billing.listInvoices('c1');
        expect(out.map((i) => i.invoiceId)).toEqual(['2', '1']);
    });
});

describe('getInvoice', () => {
    test('builds the description from line items, which the list has none of', async () => {
        // The list endpoint carries no description field at all; what a client
        // recognises lives on the line items, so this is why the sync pays for a
        // detail call per invoice.
        zohoRequest.mockResolvedValue({
            invoice: {
                invoice_id: '1', invoice_number: 'ESFI3556', total: '1049',
                invoice_items: [{ name: 'Setup Cost' }, { name: 'Walmart Account Management' }],
            },
        });

        const out = await Billing.getInvoice('1');
        expect(out.description).toBe('Setup Cost, Walmart Account Management');
    });

    test('falls back to the reference number rather than an empty description', async () => {
        zohoRequest.mockResolvedValue({
            invoice: { invoice_id: '1', invoice_items: [], reference_number: 'PO-4471' },
        });

        expect((await Billing.getInvoice('1')).description).toBe('PO-4471');
    });
});
