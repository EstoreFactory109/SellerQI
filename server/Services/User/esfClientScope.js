/**
 * Which ESF clients a staff member is allowed to see.
 *
 * The portal's original rule was stated outright in ManagedClientService: "Every ESF
 * staff member sees every ESF client." An admin can now allocate specific clients to a
 * member, and that member sees only those.
 *
 * ── ROLE DECIDES WHETHER THE LIST APPLIES; THE LIST NEVER DECIDES BY ITSELF ──
 * Owner and admin are exempt, so their allocation is never consulted. An admin is the
 * one who hands clients out — restricting them would mean allocating a client they
 * cannot see. Everyone else is held to their list, and an EMPTY list means empty.
 *
 * That is why there is no "unrestricted" sentinel in storage. `null` appears below as a
 * return value meaning "no filter needed", but it is produced from the ROLE and never
 * read from or written to the database, where `[]` always means nothing.
 *
 * ── THE FAILURE MODE THIS FILE IS SHAPED AROUND ──
 * Every mistake available here fails OPEN and fails SILENTLY:
 *
 *   - `{ _id: { $in: [] } }` built wrong, or dropped when the array is empty, returns
 *     every client instead of none.
 *   - The staff document arriving without `esfAllowedClients` selected (see the note in
 *     middlewares/Auth/esfAuth.js) reads as `undefined`, which a careless `if` treats as
 *     "no restriction" rather than "no access".
 *
 * Neither throws and neither logs. So the rule here is: anything that is not positively
 * recognised as exempt is restricted, and an unreadable or absent list restricts to
 * nothing rather than to everything.
 */

const { canManageTeam } = require('./esfRoles.js');

/**
 * Does this staff member see every client, ignoring allocations entirely?
 *
 * superAdmin is included for the same reason esfAuth admits them at all — platform
 * admins service the portal — and is checked explicitly here because resolveEsfRole
 * would otherwise demote them to 'member' and lock them out of a portal they are meant
 * to be able to operate.
 */
const seesAllClients = (staff) => {
    if (!staff) return false;
    if (staff.accessType === 'superAdmin') return true;
    return canManageTeam(staff);
};

/**
 * The ids this staff member may see.
 *
 * @returns {string[]|null} `null` when they see everything; otherwise the allocated ids,
 *   which may legitimately be an EMPTY array meaning they see nothing.
 */
const allowedClientIds = (staff) => {
    if (seesAllClients(staff)) return null;

    const raw = staff?.esfAllowedClients;
    // Absent or the wrong type restricts to nothing. It must never widen access — an
    // unselected field looks exactly like this, and treating it as "unrestricted" is
    // the silent leak described in the header.
    if (!Array.isArray(raw)) return [];

    return [...new Set(raw.map((id) => String(id)).filter(Boolean))];
};

/**
 * Narrow a client query to what this staff member may see.
 *
 * Returns a NEW object rather than mutating, because callers pass the shared
 * ESF_CLIENT_QUERY constant and mutating it would scope every later request in the
 * process to whoever happened to call first.
 */
const scopeClientQuery = (query = {}, staff) => {
    const ids = allowedClientIds(staff);
    if (ids === null) return { ...query };

    /**
     * `$in: []` matches nothing, which is exactly right for a member with no allocation
     * and is the single most important line in this file. The tempting "optimisation" —
     * skipping the filter when the array is empty — inverts it into "sees everything".
     */
    return { ...query, _id: { $in: ids } };
};

/** May this staff member act on this one client? The by-id counterpart to the filter. */
const canAccessClient = (staff, clientId) => {
    const ids = allowedClientIds(staff);
    if (ids === null) return true;
    if (!clientId) return false;
    return ids.includes(String(clientId));
};

/**
 * Keep only ids that are real ESF clients, so a hand-posted or stale id cannot be stored.
 *
 * Mirrors sanitizeDeniedPages in esfPages.js: validate on the way IN, so every read
 * afterwards can trust the stored list. Async because, unlike a fixed page catalogue,
 * the set of clients lives in the database.
 */
const sanitizeClientIds = async (ids, UserModel) => {
    if (!Array.isArray(ids) || ids.length === 0) return [];

    const mongoose = require('mongoose');
    const candidates = [...new Set(ids.map((id) => String(id)))]
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (candidates.length === 0) return [];

    const found = await UserModel
        .find({ _id: { $in: candidates }, isEsfClient: true })
        .select('_id')
        .lean();

    return found.map((doc) => doc._id);
};

module.exports = {
    seesAllClients,
    allowedClientIds,
    scopeClientQuery,
    canAccessClient,
    sanitizeClientIds,
};
