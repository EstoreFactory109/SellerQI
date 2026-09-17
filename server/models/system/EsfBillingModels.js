/**
 * EsfBillingModels.js — the synced Zoho Billing data behind the client Billing page.
 *
 * Two collections, for the same reason the task sync has two:
 *
 *   EsfBillingProfile   one document per client — company, billing address, the card
 *                       on file. Bounded and overwritten each sync.
 *   EsfBillingInvoice   ONE DOCUMENT PER INVOICE. Invoices accumulate for the life of
 *                       the account, so an array on the profile would grow without
 *                       bound — the shape this repo has already been bitten by
 *                       (ERR_OUT_OF_RANGE at 16MB).
 *
 * Neither is a source of truth. Zoho holds the real records; this exists so the page
 * is a fast database read instead of three API calls per view, and so it keeps
 * working when Zoho is slow. A wipe-and-resync is always safe.
 */

const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
    street: { type: String, default: null },
    street2: { type: String, default: null },
    city: { type: String, default: null },
    state: { type: String, default: null },
    zip: { type: String, default: null },
    country: { type: String, default: null },
}, { _id: false });

const EsfBillingProfileSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    customerId: { type: String, required: true, index: true },

    companyName: { type: String, default: null },
    email: { type: String, default: null },
    status: { type: String, default: null },
    currencyCode: { type: String, default: 'USD' },
    currencySymbol: { type: String, default: null },
    outstanding: { type: Number, default: 0 },
    billingAddress: { type: AddressSchema, default: null },

    /**
     * The card Zoho bills. NOTE there is no brand/network field: Zoho returns
     * `funding: ""` and nothing else identifying Visa/Mastercard on this account, so
     * the page must not display one. Storing what does not exist would invite a
     * later "just show the brand" change that silently invents it.
     */
    card: {
        lastFour: { type: String, default: null },
        expiryMonth: { type: Number, default: null },
        expiryYear: { type: Number, default: null },
        gateway: { type: String, default: null },
        status: { type: String, default: null },
    },

    syncedAt: { type: Date, default: Date.now },
}, { timestamps: true });

const EsfBillingInvoiceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerId: { type: String, required: true, index: true },
    invoiceId: { type: String, required: true, unique: true },

    invoiceNumber: { type: String, default: null },
    // Human-readable, built from the invoice's LINE ITEM names — the list endpoint
    // carries no description of any kind, so this costs one detail call per invoice.
    description: { type: String, default: null },
    invoiceDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    currencyCode: { type: String, default: 'USD' },
    currencySymbol: { type: String, default: null },
    total: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    // Zoho's own lowercase vocabulary (paid | sent | overdue | draft | void).
    // Never matched on for meaning beyond display; `balance` is the reliable signal.
    status: { type: String, default: null },

    syncedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// The page's read: one client's invoices, newest first.
EsfBillingInvoiceSchema.index({ userId: 1, invoiceDate: -1 });

const EsfBillingProfile = mongoose.models.EsfBillingProfile
    || mongoose.model('EsfBillingProfile', EsfBillingProfileSchema);
const EsfBillingInvoice = mongoose.models.EsfBillingInvoice
    || mongoose.model('EsfBillingInvoice', EsfBillingInvoiceSchema);

module.exports = { EsfBillingProfile, EsfBillingInvoice };
