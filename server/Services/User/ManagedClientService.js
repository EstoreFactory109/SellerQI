/**
 * Shared logic for "managed client" accounts — client Users that are created and
 * operated by someone else (an agency owner, or ESF internal staff) rather than
 * signing up themselves.
 *
 * Both the agency portal (/app/admin/*) and the ESF staff portal (/app/esf/*)
 * go through here, so the provisioning rules, the Amazon-connection summary and
 * the impersonation handshake exist in exactly one place.
 */
const mongoose = require('mongoose');
const UserModel = require('../../models/user-auth/userModel.js');
const SellerCentralModel = require('../../models/user-auth/sellerCentralModel.js');
const { getUserByEmail } = require('./userServices.js');
const { createAccessToken, createRefreshToken, createLocationToken } = require('../../utils/Tokens.js');
const { UserSchedulingService } = require('../BackgroundJobs/UserSchedulingService.js');
const logger = require('../../utils/Logger.js');

/**
 * Create a managed client account.
 *
 * Managed clients have no password — they are reachable only by impersonation
 * from the portal that owns them (see issueClientSession).
 *
 * @param {object} params
 * @param {string} params.firstname
 * @param {string} params.lastname
 * @param {string} params.phone
 * @param {string} params.email
 * @param {boolean} [params.allTermsAndConditionsAgreed]
 * @param {object} params.ownership Ownership fields written onto the client doc.
 *   Agency: { agencyId, adminId, isAgencyClient: true }
 *   ESF:    { isEsfClient: true, esfAddedBy }
 * @returns {Promise<{ok: boolean, status: number, message: string, client?: object, accessToken?: string, refreshToken?: string}>}
 */
const createManagedClient = async ({
    firstname,
    lastname,
    phone,
    email,
    allTermsAndConditionsAgreed,
    ownership = {},
}) => {
    if (!firstname || !lastname || !phone || !email) {
        return { ok: false, status: 400, message: 'Details are missing (firstname, lastname, phone, email)' };
    }

    const existing = await getUserByEmail(email);
    if (existing) {
        return { ok: false, status: 409, message: 'User already exists' };
    }

    try {
        const newClient = new UserModel({
            firstName: firstname,
            lastName: lastname,
            phone: phone,
            whatsapp: phone, // managed clients are not asked for a separate WhatsApp number
            email: email,
            // No password stored — managed clients cannot log in directly.
            isVerified: true,
            allTermsAndConditionsAgreed: allTermsAndConditionsAgreed || true,
            packageType: 'PRO', // managed clients get PRO access by default
            OTP: null,
            ...ownership,
        });

        const savedClient = await newClient.save();
        if (!savedClient) {
            return { ok: false, status: 500, message: 'Internal server error in creating client' };
        }

        const accessToken = await createAccessToken(savedClient._id);
        const refreshToken = await createRefreshToken(savedClient._id);
        if (!accessToken || !refreshToken) {
            return { ok: false, status: 500, message: 'Internal server error in creating tokens' };
        }

        await UserModel.findByIdAndUpdate(savedClient._id, { $set: { appRefreshToken: refreshToken } });

        // Non-blocking: a scheduling failure must not fail client creation.
        try {
            await UserSchedulingService.initializeUserSchedule(savedClient._id);
            logger.info(`Background job scheduling initialized for client ${savedClient._id}`);
        } catch (error) {
            logger.error(`Failed to initialize scheduling for client ${savedClient._id}:`, error);
        }

        return { ok: true, status: 201, message: 'Client registered successfully', client: savedClient, accessToken, refreshToken };
    } catch (error) {
        logger.error(`Error creating managed client: ${error.message}`);
        return { ok: false, status: 500, message: 'Internal server error in creating client' };
    }
};

/**
 * List managed clients matching `matchQuery`, each annotated with its Amazon
 * connection state (SP-API / Ads) pulled from its SellerCentral document.
 *
 * @param {object} matchQuery Mongo filter selecting the clients to return.
 * @param {object} [options]
 * @param {string} [options.select] Field projection for the User query.
 * @returns {Promise<Array<object>>}
 */
const listManagedClients = async (matchQuery, options = {}) => {
    const select = options.select
        || 'firstName lastName email phone createdAt subscriptionStatus packageType agencyId isAgencyClient isEsfClient esfAddedBy';

    const clients = await UserModel.find(matchQuery).select(select).sort({ createdAt: -1 }).lean();
    if (!clients.length) return [];

    // One query for every client's seller document instead of one per client.
    const sellerDocs = await SellerCentralModel.find({
        User: { $in: clients.map((c) => c._id) },
    }).lean();

    const sellerByUser = new Map(sellerDocs.map((doc) => [String(doc.User), doc]));

    return clients.map((client) => {
        const sellerDocument = sellerByUser.get(String(client._id));
        const sellerAccount = sellerDocument?.sellerAccount?.[0];

        const hasSpApi = !!(sellerAccount?.spiRefreshToken && sellerAccount.spiRefreshToken.trim() !== '');
        const hasAdsApi = !!(sellerAccount?.adsRefreshToken && sellerAccount.adsRefreshToken.trim() !== '');
        const amazonConnected = hasSpApi || hasAdsApi;

        let amazonStatus = 'Not Connected';
        if (hasSpApi && hasAdsApi) amazonStatus = 'Connected';
        else if (hasSpApi) amazonStatus = 'Seller Central';
        else if (hasAdsApi) amazonStatus = 'Amazon Ads';

        return {
            ...client,
            amazonStatus,
            amazonConnected,
            hasSpApi,
            hasAdsApi,
            brandName: sellerDocument?.brand || null,
            marketplace: amazonConnected ? (sellerAccount?.country || null) : null,
            region: amazonConnected ? (sellerAccount?.region || null) : null,
            connectedDate: amazonConnected ? sellerDocument?.createdAt || null : null,
        };
    });
};

/**
 * Mint the cookie set that puts the caller into a client's session.
 * The caller's own portal token (AdminToken / ESFToken) is a different cookie
 * and survives this swap, which is what allows "back to portal" to work.
 *
 * @param {string} clientId
 * @returns {Promise<{ok: boolean, status: number, message: string, client?: object, accessToken?: string, refreshToken?: string, locationToken?: string}>}
 */
const issueClientSession = async (clientId) => {
    const client = await UserModel.findById(clientId);
    if (!client) {
        return { ok: false, status: 404, message: 'Client not found' };
    }

    const accessToken = await createAccessToken(client._id);
    const refreshToken = await createRefreshToken(client._id);
    if (!accessToken || !refreshToken) {
        return { ok: false, status: 500, message: 'Failed to create tokens' };
    }

    await UserModel.findByIdAndUpdate(client._id, { appRefreshToken: refreshToken });

    const sellerCentral = await SellerCentralModel.findOne({ User: client._id });
    const account = sellerCentral?.sellerAccount?.[0];
    const locationToken = await createLocationToken(account?.country || 'US', account?.region || 'NA');

    return { ok: true, status: 200, message: 'Successfully switched to client', client, accessToken, refreshToken, locationToken };
};

/**
 * Ownership filter for clients created through the ESF staff portal.
 * Every ESF staff member sees every ESF client.
 */
const ESF_CLIENT_QUERY = { isEsfClient: true };

/**
 * Ownership filter for an agency owner's clients.
 * Matches the legacy `adminId` field as well as the current `agencyId`.
 */
const agencyClientQuery = (ownerId) => ({
    $or: [
        { agencyId: new mongoose.Types.ObjectId(ownerId) },
        { adminId: new mongoose.Types.ObjectId(ownerId) },
    ],
});

module.exports = {
    createManagedClient,
    listManagedClients,
    issueClientSession,
    ESF_CLIENT_QUERY,
    agencyClientQuery,
};
