/**
 * Linking a SellerQI account to its Zoho Billing customer by hand.
 *
 * The nightly sync links clients automatically when their SellerQI login email (or a verified
 * extra email) is a Billing customer's email. When the two systems use different addresses —
 * common: SellerQI has a person, Billing a company alias — the client never gets their
 * invoices. Here an admin picks the customer instead.
 *
 * Same shape as ZohoProjectLinks: a cached list searched locally, the chosen id re-validated
 * with Zoho before it is stored, a refusal when another account already has that customer,
 * and a first sync fired straight away so the Billing page fills in seconds.
 */
const UserModel = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { EsfBillingProfile, EsfBillingInvoice } = require('../../models/system/EsfBillingModels.js');
const ZohoBillingService = require('./ZohoBillingService.js');
const { ApiError } = require('../../utils/ApiError.js');
const logger = require('../../utils/Logger.js');

const CACHE_KEY = 'sqi:zoho:billing:customers:all';
const CACHE_TTL_SECONDS = 300;
const SUGGESTION_COUNT = 6;
const SEARCH_RESULT_LIMIT = 40;

const tryGetRedis = () => {
    try {
        const { getRedisClient } = require('../../config/redisConn.js');
        return getRedisClient();
    } catch (_) {
        return null;
    }
};

/** Every Billing customer, cached 5 minutes so typing in the picker never pages Zoho per key. */
const getCustomers = async ({ refresh = false } = {}) => {
    const client = tryGetRedis();
    if (!refresh && client) {
        try {
            const cached = await client.get(CACHE_KEY);
            if (cached) return JSON.parse(cached);
        } catch (err) {
            logger.warn(`[ZohoBillingLinks] customer cache read failed (non-fatal): ${err.message}`);
        }
    }
    const customers = await ZohoBillingService.listCustomers();
    if (client) {
        try {
            await client.setEx(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(customers));
        } catch (err) {
            logger.warn(`[ZohoBillingLinks] customer cache write failed (non-fatal): ${err.message}`);
        }
    }
    return customers;
};

const normalise = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').trim();

/** Customers whose name, company or email contain every word of the search. */
const searchCustomers = (customers, term) => {
    const words = normalise(term).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return customers
        .filter((c) => {
            const hay = normalise(`${c.displayName} ${c.companyName} ${c.email}`);
            return words.every((w) => hay.includes(w));
        })
        .slice(0, SEARCH_RESULT_LIMIT);
};

/**
 * With nothing typed: the customers most likely to be this client — same email domain (unless
 * it is a public mailbox), or a name / brand word in common.
 */
const PUBLIC_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com', 'aol.com', 'proton.me', 'protonmail.com']);
const suggestCustomers = (customers, client) => {
    const domains = [client.email, ...(client.additionalEmails || []).map((e) => e.email)]
        .map((e) => String(e || '').split('@')[1]?.toLowerCase())
        .filter((d) => d && !PUBLIC_DOMAINS.has(d));
    const words = normalise(`${client.firstName} ${client.lastName} ${client.brand || ''} ${client.zohoProject?.projectName || ''}`)
        .split(/\s+/).filter((w) => w.length >= 3);
    const score = (c) => {
        const domain = String(c.email || '').split('@')[1]?.toLowerCase();
        const hay = normalise(`${c.displayName} ${c.companyName}`);
        return (domain && domains.includes(domain) ? 3 : 0) + words.filter((w) => hay.includes(w)).length;
    };
    return customers
        .map((c) => ({ c, s: score(c) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, SUGGESTION_COUNT)
        .map((x) => x.c);
};

/** Which accounts already use these customers, so the picker can say "already linked". */
const linkedOwners = async (customerIds, exceptUserId) => {
    if (!customerIds.length) return new Map();
    const owners = await UserModel.find({ 'zohoBilling.customerId': { $in: customerIds }, _id: { $ne: exceptUserId } })
        .select('firstName lastName email zohoBilling.customerId').lean();
    return new Map(owners.map((o) => [o.zohoBilling.customerId, {
        userId: String(o._id),
        name: `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email,
    }]));
};

const toOption = (c, owners) => ({
    customerId: c.customerId,
    displayName: c.displayName || c.companyName,
    companyName: c.companyName,
    email: c.email,
    currencyCode: c.currencyCode,
    status: c.status,
    linkedTo: owners.get(c.customerId) || null,
});

const loadClient = async (clientId) => {
    const client = await UserModel.findOne({ _id: clientId, isEsfClient: true })
        .select('firstName lastName email additionalEmails zohoBilling zohoProject.projectName isEsfClient')
        .lean();
    if (!client) throw new ApiError(404, 'Client not found');
    return client;
};

/** The current link (if any), plus suggestions or search results for the picker. */
const getBillingOptions = async (clientId, { search = '', refresh = false } = {}) => {
    const client = await loadClient(clientId);
    const customers = await getCustomers({ refresh });
    const term = String(search || '').trim();
    const brand = term ? null : (await Seller.findOne({ User: client._id }).select('brand').lean())?.brand;
    const picked = term ? searchCustomers(customers, term) : suggestCustomers(customers, { ...client, brand });
    const owners = await linkedOwners(picked.map((c) => c.customerId), client._id);

    const zb = client.zohoBilling || {};
    let linkedBy = null;
    if (zb.linkedBy) {
        const by = await UserModel.findById(zb.linkedBy).select('firstName lastName email').lean();
        linkedBy = by ? (`${by.firstName || ''} ${by.lastName || ''}`.trim() || by.email) : null;
    }

    return {
        linked: zb.customerId ? {
            customerId: zb.customerId,
            customerName: zb.customerName,
            email: zb.matchedEmail || null,
            linkSource: zb.linkSource || 'email',
            linkedAt: zb.linkedAt || null,
            linkedBy,
        } : null,
        autoMatchDisabled: Boolean(zb.autoMatchDisabled),
        query: term,
        results: picked.map((c) => toOption(c, owners)),
        totalCustomers: customers.length,
    };
};

/** Remove the client's stored billing rows (profile, card, invoices) — they belong to the old customer. */
const clearBillingRows = async (userId) => {
    await Promise.all([
        EsfBillingProfile.deleteMany({ userId }),
        EsfBillingInvoice.deleteMany({ userId }),
    ]);
};

/** First sync straight away (not awaited): the Billing page fills in seconds, not after 02:00 UTC. */
const syncSoon = (userId) => {
    setImmediate(async () => {
        try {
            const ZohoBillingSync = require('./ZohoBillingSync.js');
            const user = await UserModel.findById(userId).select('_id email additionalEmails zohoBilling').lean();
            if (user) await ZohoBillingSync.syncClient(user);
        } catch (err) {
            logger.warn(`[ZohoBillingLinks] first billing sync for ${userId} failed (the nightly sync will retry): ${err.message}`);
        }
    });
};

/**
 * Link a client to a Billing customer, replacing any earlier link.
 * @param {string} clientId
 * @param {string} customerId
 * @param {{ _id }} staff  who is linking (for the record)
 */
const linkBillingCustomer = async (clientId, customerId, staff) => {
    const id = String(customerId || '').trim();
    if (!/^\d{3,30}$/.test(id)) throw new ApiError(400, 'A valid Zoho Billing customer is required');
    const client = await loadClient(clientId);

    // Re-check with Zoho: never store an id the client sent without Zoho confirming it.
    const customer = await ZohoBillingService.getCustomer(id).catch((err) => {
        if (err?.status === 404 || err?.statusCode === 404) return null;
        throw err;
    });
    if (!customer) throw new ApiError(404, 'That customer was not found in Zoho Billing');

    const other = await UserModel.findOne({ _id: { $ne: client._id }, 'zohoBilling.customerId': id })
        .select('firstName lastName email').lean();
    if (other) {
        const name = `${other.firstName || ''} ${other.lastName || ''}`.trim() || other.email;
        throw new ApiError(409, `This Zoho Billing customer is already linked to ${name}. Unlink it there first.`);
    }

    const changed = client.zohoBilling?.customerId && client.zohoBilling.customerId !== id;
    if (changed) await clearBillingRows(client._id);

    await UserModel.updateOne({ _id: client._id }, {
        $set: {
            'zohoBilling.customerId': id,
            'zohoBilling.customerName': customer.companyName || customer.displayName,
            'zohoBilling.matchedEmail': customer.email || null,
            'zohoBilling.linkedAt': new Date(),
            'zohoBilling.linkSource': 'manual',
            'zohoBilling.linkedBy': staff?._id || null,
            'zohoBilling.autoMatchDisabled': false,
        },
    });
    logger.info(`[ZohoBillingLinks] ${staff?._id || 'unknown'} linked client ${client._id} to Billing customer ${id}${changed ? ` (was ${client.zohoBilling.customerId})` : ''}`);
    syncSoon(client._id);
    return getBillingOptions(client._id);
};

/** Unlink, clear what was shown, and stop the nightly email match re-linking it. */
const unlinkBillingCustomer = async (clientId, staff) => {
    const client = await loadClient(clientId);
    await clearBillingRows(client._id);
    await UserModel.updateOne({ _id: client._id }, {
        $set: {
            'zohoBilling.customerId': null,
            'zohoBilling.customerName': null,
            'zohoBilling.matchedEmail': null,
            'zohoBilling.linkedAt': null,
            'zohoBilling.linkSource': null,
            'zohoBilling.linkedBy': staff?._id || null,
            'zohoBilling.autoMatchDisabled': true,
        },
    });
    logger.info(`[ZohoBillingLinks] ${staff?._id || 'unknown'} unlinked Billing customer ${client.zohoBilling?.customerId || '-'} from client ${client._id}`);
    return getBillingOptions(client._id);
};

module.exports = {
    getBillingOptions,
    linkBillingCustomer,
    unlinkBillingCustomer,
    searchCustomers,
    suggestCustomers,
    getCustomers,
    CACHE_KEY,
};
