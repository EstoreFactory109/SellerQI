/**
 * ZohoBillingSync.js — pull each ESF client's invoices and card on file into Mongo.
 *
 * Runs nightly alongside the task sync (BackgroundJobs/zohoTaskSyncStandalone.js),
 * for the same reason: the Billing page must be a database read, not three Zoho calls
 * per page view, and it has to keep working when Zoho is slow.
 *
 * IDENTITY IS THE HARD PART HERE, not the fetching.
 * A client's SellerQI login is a person's email; their Zoho Billing record is often a
 * company or channel alias (the live example bills to walmart@<brand>.com while the
 * portal login is a personal Gmail). So the customer is resolved by email ONCE and
 * then pinned by customerId on the user document. After that first match, either
 * address can change freely without silently emptying the client's invoice history —
 * which is exactly what re-matching on email every night would do.
 */

const UserModel = require('../../models/user-auth/userModel.js');
const { EsfBillingProfile, EsfBillingInvoice } = require('../../models/system/EsfBillingModels.js');
const ZohoBillingService = require('./ZohoBillingService.js');
const ZohoProjectsService = require('./ZohoProjectsService.js');
const { mapWithConcurrency } = ZohoProjectsService;
const logger = require('../../utils/Logger.js');

/** Invoice detail calls are one per invoice; keep a few in flight, not all. */
const DETAIL_CONCURRENCY = 4;

/**
 * Resolve which Billing customer a client is, preferring the pinned id.
 * Returns null when the client simply has no Billing record — a normal state.
 */
const resolveCustomerId = async (user) => {
    if (user.zohoBilling?.customerId) {
        return { customerId: user.zohoBilling.customerId, newlyLinked: false };
    }

    const customer = await ZohoBillingService.findCustomerByEmail(user.email);
    if (!customer) return null;

    await UserModel.updateOne(
        { _id: user._id },
        {
            $set: {
                'zohoBilling.customerId': customer.customerId,
                'zohoBilling.customerName': customer.companyName,
                'zohoBilling.matchedEmail': user.email,
                'zohoBilling.linkedAt': new Date(),
            },
        }
    );

    logger.info(`[ZohoBillingSync] Linked ${user.email} to Billing customer ${customer.customerId} (${customer.companyName})`);
    return { customerId: customer.customerId, newlyLinked: true };
};

/**
 * Sync one client. Never throws — a failure for one client must not stop the rest,
 * and must not wipe what is already stored for them.
 */
const syncClient = async (user) => {
    try {
        const resolved = await resolveCustomerId(user);
        if (!resolved) {
            return { userId: String(user._id), email: user.email, skipped: 'no Billing customer' };
        }

        const { customerId } = resolved;

        const [customer, cards, invoices] = await Promise.all([
            ZohoBillingService.getCustomer(customerId),
            ZohoBillingService.getCustomerCards(customerId),
            ZohoBillingService.listInvoices(customerId),
        ]);

        // The primary card if one is flagged, else whichever is active. Zoho exposes
        // no brand at all, so nothing here can claim one.
        const card = cards.find((c) => c.isPrimary) || cards.find((c) => c.status === 'active') || cards[0] || null;

        await EsfBillingProfile.updateOne(
            { userId: user._id },
            {
                $set: {
                    userId: user._id,
                    customerId,
                    companyName: customer?.companyName || null,
                    email: customer?.email || null,
                    status: customer?.status || null,
                    currencyCode: customer?.currencyCode || 'USD',
                    currencySymbol: customer?.currencySymbol || null,
                    outstanding: customer?.outstanding ?? 0,
                    billingAddress: customer?.billingAddress || null,
                    card: card
                        ? {
                            lastFour: card.lastFour,
                            expiryMonth: card.expiryMonth,
                            expiryYear: card.expiryYear,
                            gateway: card.gateway,
                            status: card.status,
                        }
                        : { lastFour: null, expiryMonth: null, expiryYear: null, gateway: null, status: null },
                    syncedAt: new Date(),
                },
            },
            { upsert: true }
        );

        /*
         * The list endpoint returns no description of any kind, so each invoice needs
         * its detail call to get the line-item names a client would recognise. That is
         * an N+1, bounded by how few invoices a client has (3 on the live account) and
         * by running nightly rather than per page view.
         */
        const detailed = await mapWithConcurrency(invoices, DETAIL_CONCURRENCY, async (invoice) => {
            try {
                const full = await ZohoBillingService.getInvoice(invoice.invoiceId);
                return { ...invoice, description: full?.description || null };
            } catch (error) {
                // Keep the invoice; lose only its description.
                logger.warn(`[ZohoBillingSync] Could not read invoice ${invoice.invoiceNumber}: ${error.message}`);
                return { ...invoice, description: null };
            }
        });

        if (detailed.length) {
            await EsfBillingInvoice.bulkWrite(
                detailed.map((invoice) => ({
                    updateOne: {
                        filter: { invoiceId: invoice.invoiceId },
                        update: {
                            $set: {
                                userId: user._id,
                                customerId,
                                invoiceId: invoice.invoiceId,
                                invoiceNumber: invoice.invoiceNumber,
                                description: invoice.description,
                                invoiceDate: invoice.invoiceDate,
                                dueDate: invoice.dueDate,
                                currencyCode: invoice.currencyCode,
                                currencySymbol: invoice.currencySymbol,
                                total: invoice.total,
                                balance: invoice.balance,
                                status: invoice.status,
                                syncedAt: new Date(),
                            },
                        },
                        upsert: true,
                    },
                })),
                { ordered: false }
            );
        }

        // Drop invoices deleted or voided away in Zoho, scoped to this client only, so
        // the page cannot show a record that no longer exists.
        const liveIds = detailed.map((i) => i.invoiceId);
        const removed = await EsfBillingInvoice.deleteMany({
            userId: user._id,
            ...(liveIds.length ? { invoiceId: { $nin: liveIds } } : {}),
        });

        return {
            userId: String(user._id),
            email: user.email,
            customerId,
            invoices: detailed.length,
            hasCard: Boolean(card),
            removed: removed.deletedCount || 0,
            newlyLinked: resolved.newlyLinked,
        };
    } catch (error) {
        logger.error(`[ZohoBillingSync] Failed for ${user.email}: ${error.message}`);
        return { userId: String(user._id), email: user.email, error: error.message };
    }
};

/** Every ESF client. Billing is per-client, unlike projects which several may share. */
const syncAllBilling = async () => {
    const clients = await UserModel.find({ isEsfClient: true })
        .select('_id email zohoBilling')
        .lean();

    const results = [];
    for (const client of clients) {
        results.push(await syncClient(client));
    }

    const linked = results.filter((r) => r.customerId).length;
    return {
        clients: clients.length,
        linked,
        skipped: results.filter((r) => r.skipped).length,
        failed: results.filter((r) => r.error).length,
        invoices: results.reduce((sum, r) => sum + (r.invoices || 0), 0),
        results,
    };
};

/** What the Billing page reads. Pure database, no Zoho call. */
const getBillingView = async (userId) => {
    const [profile, invoices] = await Promise.all([
        EsfBillingProfile.findOne({ userId }).lean(),
        EsfBillingInvoice.find({ userId }).sort({ invoiceDate: -1 }).lean(),
    ]);

    return { profile: profile || null, invoices };
};

module.exports = { syncClient, syncAllBilling, getBillingView, resolveCustomerId };
