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

/**
 * Who may be adopted.
 *
 * Excludes, in order: platform staff and agency owners (accessType), our own
 * clients, anyone already owned by an agency, and purged accounts. What is left
 * is a self-serve seller with nobody else managing them.
 */
const linkableBaseMatch = () => ({
    accessType: 'user',
    isEsfClient: { $ne: true },
    isAgencyClient: { $ne: true },
    agencyId: null,
    purgedAt: null,
    isVerified: true,
});

/** Case-insensitive match across the fields someone would actually search by. */
const searchMatch = (search) => {
    const term = (search || '').trim();
    if (!term) return null;
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return { $or: [{ firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }] };
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

    const pre = [{ $match: linkableBaseMatch() }];
    const search$ = searchMatch(search);
    if (search$) pre.push({ $match: search$ });

    // Connection state comes from the seller document, so it has to be joined
    // before it can be filtered or counted on.
    pre.push(
        {
            $lookup: {
                from: 'sellers',
                localField: '_id',
                foreignField: 'User',
                as: 'seller',
                pipeline: [{ $project: { brand: 1, sellerAccount: { $slice: ['$sellerAccount', 1] } } }],
            },
        },
        {
            $addFields: {
                brandName: { $ifNull: [{ $arrayElemAt: ['$seller.brand', 0] }, null] },
                firstAccount: { $arrayElemAt: [{ $arrayElemAt: ['$seller.sellerAccount', 0] }, 0] },
            },
        },
        {
            $addFields: {
                hasSpApi: { $gt: [{ $strLenCP: { $ifNull: ['$firstAccount.spiRefreshToken', ''] } }, 0] },
                hasAdsApi: { $gt: [{ $strLenCP: { $ifNull: ['$firstAccount.adsRefreshToken', ''] } }, 0] },
                marketplace: '$firstAccount.country',
            },
        }
    );

    const filter$ = filterMatch(activeFilter);

    // Rows and counts share the pipeline above, so the base set is scanned once.
    const [result] = await UserModel.aggregate([
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
    ]);

    const counts = result?.counts?.[0] || { all: 0, PRO: 0, LITE: 0, connected: 0 };
    const totalCount = result?.total?.[0]?.n || 0;

    return {
        users: result?.rows || [],
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
    linkableBaseMatch,
    searchMatch,
    filterMatch,
    getLinkableUsers,
    linkUsersToEsf,
};
