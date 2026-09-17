/**
 * ZohoBillingService.js — the business operations for Zoho Billing.
 *
 *   findCustomerByEmail()   resolve a SellerQI account to a Billing customer
 *   getCustomer()           company, billing address, outstanding balance
 *   getCustomerCards()      the card on file (its own sub-resource, see below)
 *   listInvoices()          every invoice for one customer
 *   getInvoice()            one invoice INCLUDING line items
 *
 * Goes through ZohoProjectsClient.zohoRequest with a baseUrl override rather than a
 * second HTTP client: Billing sits on a different host, but the token minting, the
 * 401 refresh-and-replay, the 429 backoff and the error normalisation are all
 * identical and worth having in exactly one place.
 *
 * FIELD NAMES ARE VERIFIED AGAINST THE LIVE ACCOUNT, not taken from the docs. Three
 * differ from what you would reasonably guess, and each returned undefined silently
 * before it was checked:
 *   - the invoice date is `invoice_date` (not `date`)
 *   - the customer record has NO card fields at all; cards are /customers/{id}/cards
 *   - no card BRAND is exposed anywhere (`funding` comes back empty), so nothing
 *     downstream may claim one
 */

const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const { zohoRequest } = require('./ZohoProjectsClient.js');
const { BILLING_PATHS, getBillingBaseUrl } = require('./config.js');

const PAGE_SIZE = 200;
// One client's invoice history is small (the live account's busiest has 3), but a
// runaway customer must not walk forever.
const MAX_INVOICE_PAGES = 10;

/** Every Billing call shares this. */
const billingRequest = (options) => zohoRequest({
    ...options,
    baseUrl: getBillingBaseUrl(),
});

const asNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

/** Zoho dates here are plain 'YYYY-MM-DD' strings; keep them as Dates for sorting. */
const asDate = (value) => {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
};

const normaliseCustomer = (customer = {}) => ({
    customerId: customer.customer_id ? String(customer.customer_id) : null,
    companyName: customer.company_name || customer.display_name || null,
    displayName: customer.display_name || null,
    email: customer.email || null,
    status: customer.status || null,
    currencyCode: customer.currency_code || 'USD',
    currencySymbol: customer.currency_symbol || null,
    outstanding: asNumber(customer.outstanding_receivable_amount) ?? 0,
    unusedCredits: asNumber(customer.unused_credits) ?? 0,
    billingAddress: customer.billing_address
        ? {
            street: customer.billing_address.street || customer.billing_address.address || null,
            street2: customer.billing_address.street2 || null,
            city: customer.billing_address.city || null,
            state: customer.billing_address.state || null,
            zip: customer.billing_address.zip || null,
            country: customer.billing_address.country || null,
        }
        : null,
});

/**
 * The saved card.
 *
 * Deliberately does NOT invent a brand. Zoho returns `funding: ""` and no card-type
 * field on this account, so "VISA" (which the page mock showed) has no source — a
 * guessed network on a real payment method is a lie the client would have no way to
 * check.
 */
const normaliseCard = (card = {}) => ({
    cardId: card.card_id ? String(card.card_id) : null,
    lastFour: card.last_four_digits || null,
    expiryMonth: asNumber(card.expiry_month),
    expiryYear: asNumber(card.expiry_year),
    status: card.status || null,
    gateway: card.payment_gateway || null,
    isPrimary: Boolean(card.is_primary),
});

const normaliseInvoice = (invoice = {}) => ({
    invoiceId: invoice.invoice_id ? String(invoice.invoice_id) : null,
    invoiceNumber: invoice.invoice_number || invoice.number || null,
    customerId: invoice.customer_id ? String(invoice.customer_id) : null,
    // `invoice_date`, NOT `date` — `date` is undefined on every row.
    invoiceDate: asDate(invoice.invoice_date),
    dueDate: asDate(invoice.due_date),
    currencyCode: invoice.currency_code || 'USD',
    currencySymbol: invoice.currency_symbol || null,
    total: asNumber(invoice.total) ?? 0,
    balance: asNumber(invoice.balance) ?? 0,
    // Zoho's own lowercase vocabulary: paid | sent | overdue | draft | void ...
    status: invoice.status || null,
    referenceNumber: invoice.reference_number || null,
    updatedAt: asDate(invoice.updated_time),
});

/**
 * Find the Billing customer for an email address.
 *
 * Returns null rather than throwing when there is no match: plenty of ESF clients
 * legitimately have no Billing record, and that is an empty page, not an error.
 */
const findCustomerByEmail = async (email) => {
    if (!email) return null;

    const response = await billingRequest({
        path: BILLING_PATHS.customers(),
        params: { email_contains: email },
        context: `Finding the Zoho Billing customer for ${email}`,
    });

    const customers = response.customers || [];
    // email_contains is a substring match, so confirm it really is this address
    // before binding a client's invoices to it.
    const exact = customers.find((c) => String(c.email || '').toLowerCase() === String(email).toLowerCase());

    return exact ? normaliseCustomer(exact) : null;
};

const getCustomer = async (customerId) => {
    if (!customerId) throw new ApiError(400, 'A Zoho Billing customer id is required');

    const response = await billingRequest({
        path: BILLING_PATHS.customer(customerId),
        context: `Fetching Zoho Billing customer ${customerId}`,
    });

    return response.customer ? normaliseCustomer(response.customer) : null;
};

/** The card on file. Empty list is normal — not every customer has one saved. */
const getCustomerCards = async (customerId) => {
    if (!customerId) throw new ApiError(400, 'A Zoho Billing customer id is required');

    try {
        const response = await billingRequest({
            path: BILLING_PATHS.customerCards(customerId),
            context: `Fetching cards for Zoho Billing customer ${customerId}`,
        });
        return (response.cards || []).map(normaliseCard);
    } catch (error) {
        // A missing card must not cost us the invoice history, which is the more
        // useful half of the page.
        logger.warn(`[ZohoBilling] Could not read cards for customer ${customerId}: ${error.message}`);
        return [];
    }
};

/** Every invoice for one customer, newest first. */
const listInvoices = async (customerId) => {
    if (!customerId) throw new ApiError(400, 'A Zoho Billing customer id is required');

    const all = [];
    for (let page = 1; page <= MAX_INVOICE_PAGES; page += 1) {
        const response = await billingRequest({
            path: BILLING_PATHS.invoices(),
            params: { customer_id: customerId, per_page: PAGE_SIZE, page },
            context: `Listing Zoho Billing invoices for customer ${customerId}`,
        });

        const rows = response.invoices || [];
        all.push(...rows.map(normaliseInvoice));

        if (!response.page_context?.has_more_page || rows.length === 0) break;
    }

    return all.sort((a, b) => new Date(b.invoiceDate || 0) - new Date(a.invoiceDate || 0));
};

/**
 * One invoice with its line items.
 *
 * Needed because the LIST payload carries no description at all — what a client
 * recognises ("Walmart Account Management") lives on the line items, which only the
 * detail call returns.
 */
const getInvoice = async (invoiceId) => {
    if (!invoiceId) throw new ApiError(400, 'A Zoho Billing invoice id is required');

    const response = await billingRequest({
        path: BILLING_PATHS.invoice(invoiceId),
        context: `Fetching Zoho Billing invoice ${invoiceId}`,
    });

    const invoice = response.invoice;
    if (!invoice) return null;

    const items = invoice.invoice_items || invoice.line_items || [];

    return {
        ...normaliseInvoice(invoice),
        lineItems: items.map((item) => ({
            name: item.name || null,
            description: item.description || null,
            quantity: asNumber(item.quantity),
            price: asNumber(item.price),
            total: asNumber(item.item_total),
        })),
        // What the page's DESCRIPTION column shows: the line item names, which read
        // as the service purchased. Falls back to the reference number rather than
        // an empty cell.
        description: items.map((i) => i.name).filter(Boolean).join(', ')
            || invoice.reference_number
            || null,
        billingAddress: invoice.billing_address
            ? {
                street: invoice.billing_address.street || invoice.billing_address.address || null,
                city: invoice.billing_address.city || null,
                state: invoice.billing_address.state || null,
                zip: invoice.billing_address.zip || null,
                country: invoice.billing_address.country || null,
            }
            : null,
    };
};

module.exports = {
    findCustomerByEmail,
    getCustomer,
    getCustomerCards,
    listInvoices,
    getInvoice,
    normaliseCustomer,
    normaliseCard,
    normaliseInvoice,
};
