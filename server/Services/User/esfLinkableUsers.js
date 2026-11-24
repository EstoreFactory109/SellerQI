/**
 * Finding existing SellerQI sellers that can be adopted into the ESF portal.
 *
 * Deliberately NOT reusing the super-admin's getAllAccounts: that pipeline also
 * resolves live Stripe/Razorpay card status and subscription stat cards, none of
 * which matter when you are picking someone to manage. This is one aggregation
 * that returns the page AND the capsule counts together.
 */
const mongoose = require('mongoose');
const UserModel = require('../../models/user-auth/userModel.js');

/** Capsule filters offered in the picker. */
const LINKABLE_FILTERS = ['all', 'PRO', 'LITE', 'connected', 'notConnected'];

/** Account types that are never sellers: platform staff, agency owners, ESF staff. */
const NON_SELLER_ACCESS_TYPES = ['superAdmin', 'enterpriseAdmin', 'esfUser'];

/**
 * Who may be adopted.
 *
 * Excludes, in order: platform staff and agency owners (accessType, and the AGENCY
 * plan the admin portal uses to tell agencies apart), our own clients, anyone already
 * owned by an agency, purged accounts, and accounts that never finished signing up
 * (unverified: they cannot log in and no data is ever fetched for them). What is left
 * is a self-serve seller with nobody else managing them.
 *
 * accessType is matched as "not staff" rather than equal to 'user': accounts created
 * before the field existed have none stored (the schema default only applies to new
 * documents), and an exact match silently hid those sellers from the picker.
 */
const linkableBaseMatch = () => ({
    accessType: { $nin: NON_SELLER_ACCESS_TYPES },
    packageType: { $ne: 'AGENCY' },
    isEsfClient: { $ne: true },
    isAgencyClient: { $ne: true },
    agencyId: null,
    purgedAt: null,
    isVerified: true,
});

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A search word as a regex; a straight or curly apostrophe matches either, as brands use both. */
const wordRegex = (word) => new RegExp(escapeRegex(word).replace(/['\u2018\u2019]/g, "['\u2018\u2019]"), 'i');

/**
 * Fields a single search word may match. additionalEmails covers sellers who are known by
 * an address other than their login one. sellerBrands (every brand on the user's seller
 * documents) is joined in, so the search runs after the lookup.
 */
const SEARCH_FIELDS = ['firstName', 'lastName', 'email', 'additionalEmails.email', 'phone', 'sellerBrands'];

/** What splits a search into words: whitespace and the punctuation commonly typed between words. */
const SEARCH_WORD_SEPARATORS = /[\s,/_-]+/;

/**
 * A phone number typed with spaces, dashes or brackets ("+1 (555) 123-4567") against one stored in
 * another layout. Matches the same digits in order with anything but digits in between.
 */
const phoneRegex = (term) => {
    const digits = term.replace(/\D/g, '');
    if (digits.length < 3 || !/^[+\d\s().-]+$/.test(term)) return null;
    return new RegExp(digits.split('').join('\\D*'));
};

/**
 * Case-insensitive search across what is shown in each row: name, email, phone and brand.
 *
 * The words are matched separately, each against any field, so "john smith" finds John Smith
 * (first and last name are separate fields) and "acme john" finds John at Acme. A term that
 * looks like a phone number also matches regardless of how the stored number is spaced.
 */
const searchMatch = (search) => {
    const term = (search || '').trim();
    if (!term) return null;

    // Punctuation people type between words ("Acme-Home", "Smith, John") splits too, so it
    // does not have to match the stored text character for character. An email still works:
    // each piece of it is found in the email field.
    const words = term.split(SEARCH_WORD_SEPARATORS).filter(Boolean);
    const everyWord = {
        $and: words.map((word) => {
            const rx = wordRegex(word);
            return { $or: SEARCH_FIELDS.map((field) => ({ [field]: rx })) };
        }),
    };

    const phoneRx = phoneRegex(term);
    return phoneRx ? { $or: [everyWord, { phone: phoneRx }] } : everyWord;
};

/** Translate a capsule into a match stage against the computed connection fields. */
const filterMatch = (filter) => {
    switch (filter) {
        case 'PRO': return { packageType: 'PRO' };
        case 'LITE': return { packageType: 'LITE' };
        case 'connected': return { hasSpApi: true, hasAdsApi: true };
        case 'notConnected': return { $or: [{ hasSpApi: false }, { hasAdsApi: false }] };
        default: return null;
    }
};

const SELLER_PROJECTION = { brand: 1, sellerAccount: { $slice: ['$sellerAccount', 1] } };

/** True when a seller document's brand is a real value, not missing or blank. */
const hasBrand = (path) => ({
    $gt: [{ $strLenCP: { $trim: { input: { $ifNull: [path, ''] } } } }, 0],
});

/**
 * Joins the seller document(s) behind each user and derives the brand.
 *
 * The user's own `sellerCentral` reference is the link the rest of the app trusts (the
 * admin portal's accounts list and the ESF inbox both use it), so that document comes
 * first. Seller documents pointing back at the user through `User` are joined too: older
 * accounts lack the reference, and some users have more than one seller document. Every
 * brand found is searchable; the one shown is the referenced document's brand when it has
 * one, otherwise the first brand on any of them.
 *
 * Joining on `User` alone (as before) missed brands the admin portal shows, so searching
 * by brand did not find those accounts.
 */
const sellerLookupStages = () => ([
    {
        $lookup: {
            from: 'sellers',
            localField: 'sellerCentral',
            foreignField: '_id',
            as: 'sellerByRef',
            pipeline: [{ $project: SELLER_PROJECTION }],
        },
    },
    {
        $lookup: {
            from: 'sellers',
            localField: '_id',
            foreignField: 'User',
            as: 'sellerByUser',
            pipeline: [{ $project: SELLER_PROJECTION }],
        },
    },
    { $addFields: { seller: { $concatArrays: ['$sellerByRef', '$sellerByUser'] } } },
    {
        $addFields: {
            sellerBrands: {
                $map: {
                    input: { $filter: { input: '$seller', as: 's', cond: hasBrand('$$s.brand') } },
                    as: 's',
                    in: { $trim: { input: '$$s.brand' } },
                },
            },
            firstAccount: { $arrayElemAt: [{ $arrayElemAt: ['$seller.sellerAccount', 0] }, 0] },
        },
    },
    {
        $addFields: {
            brandName: { $ifNull: [{ $arrayElemAt: ['$sellerBrands', 0] }, null] },
        },
    },
]);

/**
 * Why an account that matched a search cannot be added, in the order shown.
 *
 * One reason per exclusion in linkableBaseMatch(); the tests hold the two together, so an
 * account the picker leaves out is never left out without saying why. Staff (superAdmin,
 * esfUser) are not given a reason because they are never shown at all.
 */
const BLOCKED_REASONS = ['purged', 'agencyOwner', 'esfClient', 'agencyClient', 'unverified'];

const blockedReasonExpr = () => ({
    $switch: {
        branches: [
            { case: { $ne: [{ $ifNull: ['$purgedAt', null] }, null] }, then: 'purged' },
            {
                case: {
                    $or: [
                        { $eq: ['$packageType', 'AGENCY'] },
                        { $in: [{ $ifNull: ['$accessType', null] }, NON_SELLER_ACCESS_TYPES] },
                    ],
                },
                then: 'agencyOwner',
            },
            { case: { $eq: ['$isEsfClient', true] }, then: 'esfClient' },
            {
                case: {
                    $or: [
                        { $eq: ['$isAgencyClient', true] },
                        { $ne: [{ $ifNull: ['$agencyId', null] }, null] },
                    ],
                },
                then: 'agencyClient',
            },
            { case: { $ne: ['$isVerified', true] }, then: 'unverified' },
        ],
        default: null,
    },
});

/** Staff accounts are never shown to the picker, not even as "can't be added". */
const HIDDEN_ACCESS_TYPES = ['superAdmin', 'esfUser'];

/**
 * Accounts matching the search that cannot be adopted, each with the reason.
 * Shown greyed out under the selectable list so a seller who exists is never just "not found".
 */
const getBlockedMatches = async (search, limit = 10) => {
    const search$ = searchMatch(search);
    if (!search$) return [];

    const rows = await UserModel.aggregate([
        {
            $match: {
                accessType: { $nin: HIDDEN_ACCESS_TYPES },
                $nor: [linkableBaseMatch()],
            },
        },
        ...sellerLookupStages(),
        { $match: search$ },
        { $addFields: { blockedReason: blockedReasonExpr() } },
        { $match: { blockedReason: { $ne: null } } },
        { $sort: { createdAt: -1 } },
        { $limit: limit },
        {
            $lookup: {
                from: 'users',
                localField: 'agencyId',
                foreignField: '_id',
                as: 'agency',
                pipeline: [{ $project: { agencyName: 1, firstName: 1, lastName: 1 } }],
            },
        },
        {
            $project: {
                firstName: 1, lastName: 1, email: 1, packageType: 1, brandName: 1, blockedReason: 1,
                agency: { $arrayElemAt: ['$agency', 0] },
            },
        },
    ]);

    return rows.map(({ agency, ...row }) => {
        const agencyName = agency
            ? (agency.agencyName || [agency.firstName, agency.lastName].filter(Boolean).join(' ') || null)
            : null;
        return { ...row, agencyName };
    });
};

/**
 * One page of linkable users plus the count behind every capsule.
 *
 * @param {object} params
 * @param {string} [params.search]
 * @param {string} [params.filter] one of LINKABLE_FILTERS
 * @param {number} [params.page]
 * @param {number} [params.limit]
 */
const getLinkableUsers = async ({ search = '', filter = 'all', page = 1, limit = 10 } = {}) => {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const activeFilter = LINKABLE_FILTERS.includes(filter) ? filter : 'all';

    // Connection state and brand come from the seller document, so it has to be joined
    // before they can be searched, filtered or counted on.
    const pre = [{ $match: linkableBaseMatch() }, ...sellerLookupStages()];
    pre.push(
        {
            $addFields: {
                hasSpApi: { $gt: [{ $strLenCP: { $ifNull: ['$firstAccount.spiRefreshToken', ''] } }, 0] },
                hasAdsApi: { $gt: [{ $strLenCP: { $ifNull: ['$firstAccount.adsRefreshToken', ''] } }, 0] },
                marketplace: '$firstAccount.country',
            },
        }
    );
    const search$ = searchMatch(search);
    if (search$) pre.push({ $match: search$ });

    const filter$ = filterMatch(activeFilter);

    // Rows and counts share the pipeline above, so the base set is scanned once. Accounts
    // that match the search but cannot be added are fetched alongside, only while searching.
    const [[result], blocked] = await Promise.all([UserModel.aggregate([
        ...pre,
        {
            $facet: {
                rows: [
                    ...(filter$ ? [{ $match: filter$ }] : []),
                    { $sort: { createdAt: -1 } },
                    { $skip: (pageNum - 1) * limitNum },
                    { $limit: limitNum },
                    {
                        $project: {
                            firstName: 1, lastName: 1, email: 1, phone: 1, packageType: 1,
                            createdAt: 1, brandName: 1, hasSpApi: 1, hasAdsApi: 1, marketplace: 1,
                        },
                    },
                ],
                total: [...(filter$ ? [{ $match: filter$ }] : []), { $count: 'n' }],
                counts: [
                    {
                        $group: {
                            _id: null,
                            all: { $sum: 1 },
                            PRO: { $sum: { $cond: [{ $eq: ['$packageType', 'PRO'] }, 1, 0] } },
                            LITE: { $sum: { $cond: [{ $eq: ['$packageType', 'LITE'] }, 1, 0] } },
                            connected: { $sum: { $cond: [{ $and: ['$hasSpApi', '$hasAdsApi'] }, 1, 0] } },
                        },
                    },
                ],
            },
        },
    ]), getBlockedMatches(search)]);

    const counts = result?.counts?.[0] || { all: 0, PRO: 0, LITE: 0, connected: 0 };
    const totalCount = result?.total?.[0]?.n || 0;

    return {
        users: result?.rows || [],
        blocked,
        counts: {
            all: counts.all,
            PRO: counts.PRO,
            LITE: counts.LITE,
            connected: counts.connected,
            notConnected: counts.all - counts.connected,
        },
        pagination: {
            page: pageNum,
            limit: limitNum,
            totalCount,
            totalPages: Math.ceil(totalCount / limitNum) || 1,
        },
    };
};

/**
 * Adopt sellers into the ESF portal.
 *
 * Re-checks eligibility in the same update rather than trusting the ids the
 * client sent — a stale picker (or a crafted request) must not be able to claim
 * an agency's client or another staff account.
 *
 * @returns {Promise<{linked: number, requested: number}>}
 */
const linkUsersToEsf = async (userIds, esfUserId) => {
    const ids = (Array.isArray(userIds) ? userIds : [])
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

    if (!ids.length) return { linked: 0, requested: 0 };

    const result = await UserModel.updateMany(
        { _id: { $in: ids }, ...linkableBaseMatch() },
        { $set: { isEsfClient: true, esfAddedBy: esfUserId } }
    );

    return { linked: result.modifiedCount || 0, requested: ids.length };
};

module.exports = {
    LINKABLE_FILTERS,
    NON_SELLER_ACCESS_TYPES,
    linkableBaseMatch,
    searchMatch,
    filterMatch,
    BLOCKED_REASONS,
    blockedReasonExpr,
    getBlockedMatches,
    sellerLookupStages,
    getLinkableUsers,
    linkUsersToEsf,
};
