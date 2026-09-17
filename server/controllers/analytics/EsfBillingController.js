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
 *
 * Sends the plan's renewal state (next charge date, or cancelled and what it is paid
 * up to) but nothing else about the subscription — no pricing, no term history, no
 * subscription id. The subscriptions scope is read for scheduling; this is the narrow
 * slice of it a client has a right to see.
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const ZohoBillingSync = require('../../Services/Zoho/ZohoBillingSync.js');
const ZohoBillingService = require('../../Services/Zoho/ZohoBillingService.js');
const { EsfBillingInvoice } = require('../../models/system/EsfBillingModels.js');

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
            /**
             * The plan's renewal state. Shown to the client on request — a client is
             * entitled to know when they next get charged, and a cancelled plan is
             * something they should see plainly rather than infer from invoices
             * quietly stopping.
             *
             * Only the renewal-relevant fields are sent: no pricing, no term history,
             * no subscription id.
             */
            plan: profile.subscription?.status
                ? {
                    name: profile.subscription.planName || null,
                    status: profile.subscription.status,
                    ended: Boolean(profile.subscription.hasEnded),
                    // Only meaningful on a live plan; Zoho omits it once cancelled.
                    renewsOn: profile.subscription.nextBillingAt || null,
                    // What the client actually paid up to, which stays true after
                    // cancellation and is the honest "covered until" date.
                    coveredUntil: profile.subscription.currentTermEndsAt || null,
                    cancelledOn: profile.subscription.cancelledAt || null,
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

/**
 * GET /api/pagewise/esf/billing/invoices/:invoiceNumber/pdf
 *
 * Streams the invoice PDF Zoho renders.
 *
 * ADDRESSED BY INVOICE NUMBER, NOT ZOHO'S INVOICE ID — deliberately. The id is never
 * sent to the client (see toClientInvoice), so the number is the only handle they
 * have, and the lookup below is scoped by the caller's own userId: another client's
 * invoice simply is not found. That scoping, not the obscurity of the identifier, is
 * what makes this safe.
 *
 * Not cached: it is binary, fetched on a click, and the JSON cache in front of the
 * other route would corrupt it.
 */
const downloadEsfInvoice = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { invoiceNumber } = req.params;

    try {
        const invoice = await EsfBillingInvoice
            .findOne({ userId, invoiceNumber })
            .select('invoiceId invoiceNumber')
            .lean();

        if (!invoice) {
            return res.status(404).json(new ApiResponse(404, '', 'That invoice is not on your account'));
        }

        const pdf = await ZohoBillingService.getInvoicePdf(invoice.invoiceId);

        res.setHeader('Content-Type', 'application/pdf');
        // The invoice number is what the client sees on the page, so it is what the
        // saved file should be called. Sanitised because it lands in a header.
        const safeName = String(invoice.invoiceNumber || 'invoice').replace(/[^A-Za-z0-9._-]/g, '');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
        res.setHeader('Content-Length', pdf.length);
        return res.status(200).send(pdf);
    } catch (error) {
        logger.error(new ApiError(502, `[EsfBilling] PDF for ${invoiceNumber} failed: ${error.message}`));
        return res.status(502).json(new ApiResponse(502, '', 'Could not download that invoice'));
    }
});

module.exports = { getEsfBilling, downloadEsfInvoice, toClientInvoice };
