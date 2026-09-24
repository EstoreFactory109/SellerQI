/**
 * Which portal, if any, this browser is already signed in to.
 *
 * Every portal keeps its own cookie (SuperAdminToken, ESFToken, AdminToken for
 * agencies, IBEX* for sellers), and cookies are shared by every tab. Without a
 * check, signing in to a second portal in another tab stacks a second session on
 * top of the first — the admin's impersonated IBEX cookies get overwritten by an
 * ESF login, and so on. The login pages ask this before rendering, and the login
 * endpoints ask it again before issuing anything, so one browser holds one session.
 *
 * Only VALID tokens count: an expired or revoked cookie is not a session and must
 * never lock someone out of the login page.
 */
const UserModel = require('../../models/user-auth/userModel.js');
const AccountMember = require('../../models/user-auth/AccountMemberModel.js');
const { verifyAccessToken, getActiveRefreshTokenUser } = require('../../utils/Tokens.js');

const SESSION_KINDS = {
    ADMIN: 'admin',
    ESF: 'esf',
    AGENCY: 'agency',
    USER: 'user',
};

const SESSION_LABELS = {
    [SESSION_KINDS.ADMIN]: 'Admin portal',
    [SESSION_KINDS.ESF]: 'eStore Factory portal',
    [SESSION_KINDS.AGENCY]: 'Agency portal',
    [SESSION_KINDS.USER]: 'SellerQI account',
};

/** Resolve a cookie's access token to its user's accessType, or null. */
const accessTypeFor = async (token) => {
    if (!token) return null;
    const decoded = await verifyAccessToken(token);
    if (!decoded || !decoded.isvalid) return null;
    // A removed member's token is not a session, or their browser would be sent to
    // an account that refuses them, then back to the login page, forever.
    if (decoded.memberId && !(await AccountMember.exists({ _id: decoded.memberId, owner: decoded.tokenData, status: 'active' }))) {
        return null;
    }
    const user = await UserModel.findById(decoded.tokenData).select('accessType').lean();
    return user ? user.accessType : null;
};

/**
 * @param {object} cookies req.cookies
 * @returns {Promise<{kind: string, label: string, home: string, inAccount: boolean} | null>}
 *
 * Checked most-privileged first: a super admin impersonating a seller also holds
 * IBEX cookies, and that browser belongs to the admin portal, not the seller.
 *
 * inAccount: a seller account is open in this browser (IBEX session) — for an
 * admin or ESF session that means they are inside a client's account, so the
 * page to send them back to may be a /seller-central-checker page.
 */
const resolveActiveSession = async (cookies = {}) => {
    // Independent lookups, so they run together; each is null for a missing cookie.
    const [adminType, esfType, agencyType, sellerType, refreshUser] = await Promise.all([
        accessTypeFor(cookies.SuperAdminToken),
        accessTypeFor(cookies.ESFToken),
        accessTypeFor(cookies.AdminToken),
        accessTypeFor(cookies.IBEXAccessToken),
        getActiveRefreshTokenUser(cookies.IBEXRefreshToken),
    ]);
    const inAccount = sellerType !== null || refreshUser !== null;
    const make = (kind, home) => ({ kind, label: SESSION_LABELS[kind], home, inAccount });

    if (adminType === 'superAdmin') {
        return make(SESSION_KINDS.ADMIN, '/manage-accounts');
    }

    if (['esfUser', 'superAdmin'].includes(esfType)) {
        return make(SESSION_KINDS.ESF, '/esf/clients');
    }

    // AdminToken is also written by a super admin's ordinary login, so only an
    // agency owner's token makes this an agency session. (That super admin holds a
    // seller session: /manage-accounts needs SuperAdminToken, which only
    // /admin-login issues, so their home is the seller app like anyone's.)
    if (agencyType === 'enterpriseAdmin') {
        return make(SESSION_KINDS.AGENCY, '/manage-agency-users');
    }

    if (inAccount) {
        return make(SESSION_KINDS.USER, '/analyse-account');
    }

    return null;
};

module.exports = { SESSION_KINDS, SESSION_LABELS, resolveActiveSession };
