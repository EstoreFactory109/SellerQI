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

/**
 * Whether this staff member may see WHO a client is — their name, email and phone.
 *
 * Managing a client and knowing who they are became two different permissions when the
 * Messages page shipped. That page labels every conversation by Zoho project or brand
 * and redacts contact details out of the message bodies, on the stated basis that staff
 * are not shown who they are writing to.
 *
 * That claim is only true if it holds everywhere. A member who reads "Morgan's
 * Repellent" in the inbox and then opens the Clients list to find the name and phone
 * number beside it has not been stopped by anything — the redaction was theatre, and
 * expensive theatre at that. So the same owner/admin line that governs team management
 * governs identity, rather than inventing a fourth role for it.
 *
 * Owners and admins keep full visibility deliberately: someone has to be able to call a
 * client back.
 */
const canSeeClientIdentity = (user) => {
    // Platform superAdmins are admitted by esfAuth precisely so they can service the
    // portal, and resolveEsfRole would otherwise demote them to 'member'.
    if (user?.accessType === 'superAdmin') return true;
    return canManageTeam(user);
};

module.exports = {
    ESF_ROLES,
    ASSIGNABLE_ESF_ROLES,
    ESF_OWNER_EMAIL,
    isEsfOwner,
    resolveEsfRole,
    canManageTeam,
    canManageClients,
    canSeeClientIdentity,
};
