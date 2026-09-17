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
 * Longest a client may go unchecked, however far off their renewal is.
 *
 * Renewal is the PRIMARY trigger, but not everything billing-related follows it: a
 * card can be replaced, expire or be declined, and a billing address can change,
 * mid-cycle and with no renewal anywhere near. Without this backstop a client on an
 * annual plan would show a stale card for eleven months.
 */
const MAX_DAYS_BETWEEN_CHECKS = 7;

/**
 * Should this client be called out to Zoho for tonight?
 *
 * The rule, in priority order:
 *   never synced / no profile        -> yes, we know nothing
 *   renewal date unknown             -> yes, treat unknown as due rather than done
 *   renewal has passed               -> yes, a new invoice is expected
 *   not looked at in a week          -> yes, catches card/address changes
 *   otherwise                        -> no, and that is the saving
 */
const isDueForSync = (profile, now = new Date(), user = null) => {
    if (!profile) {
        /*
         * No profile can mean two different things, and conflating them is expensive:
         * a client we have never looked at, or one we HAVE looked at and who simply
         * has no Zoho Billing record. The second is permanent for most clients, so
         * re-asking every night is a wasted call per client per night, forever.
         */
        const lookedAt = user?.zohoBilling?.lastLookupAt;
        if (lookedAt) {
            const days = (now - new Date(lookedAt)) / 86400000;
            if (days < MAX_DAYS_BETWEEN_CHECKS) {
                return { due: false, reason: `no billing record (rechecked in ${Math.ceil(MAX_DAYS_BETWEEN_CHECKS - days)}d)` };
            }
            return { due: true, reason: 'rechecking for a billing record' };
        }
        return { due: true, reason: 'never synced' };
    }
    if (!profile.nextRenewalAt) return { due: true, reason: 'renewal date unknown' };

    if (new Date(profile.nextRenewalAt) <= now) {
        return { due: true, reason: `renewal passed (${new Date(profile.nextRenewalAt).toISOString().slice(0, 10)})` };
    }

    const lastLooked = profile.lastCheckedAt || profile.syncedAt;
    const staleDays = lastLooked ? (now - new Date(lastLooked)) / 86400000 : Infinity;
    if (staleDays >= MAX_DAYS_BETWEEN_CHECKS) {
        return { due: true, reason: `${Math.floor(staleDays)}d since last check` };
    }

    return {
        due: false,
        reason: `next renewal ${new Date(profile.nextRenewalAt).toISOString().slice(0, 10)}`,
    };
};

/**
 * Resolve which Billing customer a client is, preferring the pinned id.
 * Returns null when the client simply has no Billing record — a normal state.
 */
const resolveCustomerId = async (user) => {
    if (user.zohoBilling?.customerId) {
        return { customerId: user.zohoBilling.customerId, newlyLinked: false };
    }

    const customer = await ZohoBillingService.findCustomerByEmail(user.email);

    if (!customer) {
        // Stamp the failed lookup so the sweep can back off rather than asking again
        // tomorrow. A client who is onboarded to Billing later is picked up at the
        // next recheck.
        await UserModel.updateOne({ _id: user._id }, { $set: { 'zohoBilling.lastLookupAt': new Date() } });
        return null;
    }

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
                return {
                    ...invoice,
                    description: full?.description || null,
                    coversUntil: full?.coversUntil || null,
                };
            } catch (error) {
                // Keep the invoice; lose only its description.
                logger.warn(`[ZohoBillingSync] Could not read invoice ${invoice.invoiceNumber}: ${error.message}`);
                return { ...invoice, description: null, coversUntil: null };
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
                                coversUntil: invoice.coversUntil,
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

        /*
         * When to look again. The furthest-out period any invoice has paid for is the
         * point a new one is expected; the day AFTER it is the first day worth asking.
         * Null when nothing parsed, which isDueForSync reads as "check again", not as
         * "nothing due".
         */
        const covered = detailed.map((i) => i.coversUntil).filter(Boolean).sort((a, b) => b - a)[0] || null;
        const nextRenewalAt = covered ? new Date(new Date(covered).getTime() + 86400000) : null;

        await EsfBillingProfile.updateOne(
            { userId: user._id },
            { $set: { nextRenewalAt, lastCheckedAt: new Date() } }
        );

        return {
            nextRenewalAt,
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

/**
 * Sweep every ESF client, but only CALL ZOHO for the ones actually due.
 *
 * Billing barely moves: a monthly client gets one new invoice every ~30 days, so
 * fetching all of them every night is ~29 wasted round trips per client per month
 * against an API that rate-limits. The due check is a single Mongo read; a skip costs
 * nothing.
 *
 * `force` bypasses the rule, for a manual "refresh everything now".
 */
const syncAllBilling = async ({ force = false, now = new Date() } = {}) => {
    const clients = await UserModel.find({ isEsfClient: true })
        .select('_id email zohoBilling')
        .lean();

    const profiles = await EsfBillingProfile
        .find({ userId: { $in: clients.map((c) => c._id) } })
        .select('userId nextRenewalAt lastCheckedAt syncedAt')
        .lean();
    const profileByUser = new Map(profiles.map((p) => [String(p.userId), p]));

    const results = [];
    for (const client of clients) {
        const verdict = isDueForSync(profileByUser.get(String(client._id)), now, client);

        if (!force && !verdict.due) {
            results.push({
                userId: String(client._id), email: client.email, notDue: true, reason: verdict.reason,
            });
            continue;
        }

        results.push({ ...(await syncClient(client)), reason: force ? 'forced' : verdict.reason });
    }

    const checked = results.filter((r) => !r.notDue).length;
    logger.info(`[ZohoBillingSync] ${checked}/${clients.length} client(s) were due; ${clients.length - checked} skipped`);

    return {
        clients: clients.length,
        checked,
        notDue: results.filter((r) => r.notDue).length,
        linked: results.filter((r) => r.customerId).length,
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

module.exports = {
    syncClient, syncAllBilling, getBillingView, resolveCustomerId,
    isDueForSync, MAX_DAYS_BETWEEN_CHECKS,
};
