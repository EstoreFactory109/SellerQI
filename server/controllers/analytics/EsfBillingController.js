/**
 * EsfBillingController.js
 *
 * The client-facing Billing page: their invoices and the card we bill, read from the
 * nightly Zoho Billing sync (Services/Zoho/ZohoBillingSync.js) rather than from Zoho
 * directly.
 *
 * Access is gated by esfClientOnly on the route, and the query is scoped to req.userId
 * — a client can only ever read their own billing, and there is no id in the URL to
 * tamper with.
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const ZohoBillingSync = require('../../Services/Zoho/ZohoBillingSync.js');

/**
 * Only what the page renders.
 *
 * Deliberately omits the Zoho customerId and invoiceId: the client has no use for
 * either, and they are the ids an attacker would want if a future endpoint ever took
 * one as a parameter.
 */
const toClientInvoice = (invoice) => ({
    number: invoice.invoiceNumber,
    description: invoice.description,
    date: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    total: invoice.total,
    balance: invoice.balance,
    currencyCode: invoice.currencyCode,
    // Derived rather than passed through: Zoho's `status` can read "sent" for
    // something the client owes money on, which means nothing to them. Balance is
    // the fact that matters.
    paid: invoice.balance === 0,
    status: invoice.status,
});

/**
 * GET /api/pagewise/esf/billing
 *
 * A client with no Zoho Billing record gets an explicit `linked: false` rather than
 * empty arrays, so the page can say why it is empty instead of implying there are no
 * invoices.
 */
const getEsfBilling = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        const { profile, invoices } = await ZohoBillingSync.getBillingView(userId);

        if (!profile) {
            return res.status(200).json(new ApiResponse(200, {
                linked: false,
                billedTo: null,
                card: null,
                invoices: [],
                syncedAt: null,
            }, 'No billing account is linked to this account'));
        }

        return res.status(200).json(new ApiResponse(200, {
            linked: true,
            billedTo: {
                companyName: profile.companyName,
                address: profile.billingAddress || null,
            },
            // Null when nothing is on file — the page must show that honestly rather
            // than a placeholder card. Note there is no brand/network here: Zoho does
            // not expose one (see EsfBillingModels), so the page cannot show one.
            card: profile.card?.lastFour
                ? {
                    lastFour: profile.card.lastFour,
                    expiryMonth: profile.card.expiryMonth,
                    expiryYear: profile.card.expiryYear,
                    gateway: profile.card.gateway,
                }
                : null,
            outstanding: profile.outstanding ?? 0,
            currencyCode: profile.currencyCode || 'USD',
            invoices: invoices.map(toClientInvoice),
            // Said out loud because this is a nightly sync, same as the Status page.
            syncedAt: profile.syncedAt,
        }, 'Billing fetched successfully'));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfBilling] ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not load your billing'));
    }
});

module.exports = { getEsfBilling, toClientInvoice };
