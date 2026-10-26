/**
 * Who is actually driving a seller session.
 *
 * Super admins, ESF staff and agency owners can all open a seller's account, and every one of
 * them ends up holding the SELLER's own access cookie. Their browsing must not count as the seller
 * being active, so each request is classified from what auth.js already established plus the ESF
 * cookie, which auth.js does not read:
 *
 *   super_admin  SuperAdminToken (portal "login as user"), or AdminToken carrying a superAdmin id
 *                (super admin signing in through the seller login page)
 *   esf_staff    a valid ESFToken cookie (ESF portal "login as client")
 *   agency       AdminToken for someone other than the account (agency owner on a client)
 *   member       a member of the seller's own account (token `mid`) — a real person on the
 *                account, so it counts as the account being active
 *   owner        the seller themself
 *
 * Most privileged first, so a super admin who also holds an ESF cookie is a super admin.
 */
const { verifyAccessToken } = require('../../utils/Tokens.js');
const User = require('../../models/user-auth/userModel.js');

const ACCOUNT_KINDS = ['owner', 'member'];

/** Staff id from the ESF portal cookie, or null. */
const esfStaffId = async (req) => {
    const token = req.cookies?.ESFToken;
    if (!token) return null;
    const decoded = await verifyAccessToken(token);
    return decoded && decoded.isvalid ? String(decoded.tokenData) : null;
};

/**
 * @returns {Promise<{ kind: 'owner'|'member'|'super_admin'|'esf_staff'|'agency', id: string|null }>}
 */
const classifyActor = async (req) => {
    if (req.isSuperAdminSession) return { kind: 'super_admin', id: req.superAdminId ? String(req.superAdminId) : null };

    const adminId = req.adminId ? String(req.adminId) : null;
    if (adminId) {
        const admin = await User.findById(adminId).select('accessType').lean();
        if (admin?.accessType === 'superAdmin') return { kind: 'super_admin', id: adminId };
    }

    const staffId = await esfStaffId(req);
    if (staffId) return { kind: 'esf_staff', id: staffId };

    if (adminId && adminId !== String(req.userId)) return { kind: 'agency', id: adminId };
    if (req.memberId) return { kind: 'member', id: String(req.memberId) };
    return { kind: 'owner', id: null };
};

/** True when the activity is the account's own (owner or member), i.e. it moves "last active". */
const isAccountActivity = (actor) => ACCOUNT_KINDS.includes(actor?.kind);

module.exports = { classifyActor, isAccountActivity, ACCOUNT_KINDS };
