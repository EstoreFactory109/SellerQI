/**
 * Role rules for the ESF staff portal.
 *
 * Kept in one module so the API, the guards and any script all agree on who is
 * allowed to do what — a permission check duplicated in three files is a
 * permission check that eventually disagrees with itself.
 *
 *   owner  — exactly one. Runs the portal. Can do everything, and is immutable:
 *            no one (including another owner-level actor) can change their role,
 *            remove them, or reset their password. They manage their own
 *            password through Settings.
 *   admin  — manages clients AND team members, but can never touch the owner.
 *   member — manages clients only. Sees the team list read-only.
 */

const ESF_ROLES = {
    OWNER: 'owner',
    ADMIN: 'admin',
    MEMBER: 'member',
};

/** Roles that can be handed out through the UI. `owner` is deliberately absent. */
const ASSIGNABLE_ESF_ROLES = [ESF_ROLES.ADMIN, ESF_ROLES.MEMBER];

/**
 * The portal owner's email.
 *
 * Overridable per environment, but defaulted so the protection holds even if the
 * env var is never set. Matched case-insensitively.
 */
const ESF_OWNER_EMAIL = (process.env.ESF_OWNER_EMAIL || 'estorefactory@portal.com').trim().toLowerCase();

/**
 * Is this user the portal owner?
 *
 * Checks the stored role OR the owner email. The email fallback means the
 * protection is already in force for an account whose `esfRole` has not been
 * backfilled yet — the guard can never be bypassed by an unset field.
 */
const isEsfOwner = (user) => {
    if (!user) return false;
    if (user.esfRole === ESF_ROLES.OWNER) return true;
    return typeof user.email === 'string' && user.email.trim().toLowerCase() === ESF_OWNER_EMAIL;
};

/** The effective role, treating the owner email as owner regardless of stored value. */
const resolveEsfRole = (user) => {
    if (!user) return ESF_ROLES.MEMBER;
    if (isEsfOwner(user)) return ESF_ROLES.OWNER;
    return ASSIGNABLE_ESF_ROLES.includes(user.esfRole) ? user.esfRole : ESF_ROLES.MEMBER;
};

/** Can this user add/remove team members and change their roles? */
const canManageTeam = (user) => {
    const role = resolveEsfRole(user);
    return role === ESF_ROLES.OWNER || role === ESF_ROLES.ADMIN;
};

/**
 * Every ESF staff member can manage clients — that is the portal's purpose.
 * Exists as a named function so tightening it later is a one-line change.
 */
const canManageClients = () => true;

module.exports = {
    ESF_ROLES,
    ASSIGNABLE_ESF_ROLES,
    ESF_OWNER_EMAIL,
    isEsfOwner,
    resolveEsfRole,
    canManageTeam,
    canManageClients,
};
