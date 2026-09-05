/**
 * eStore Factory (ESF) internal staff portal.
 *
 * Staff sign in here with their own ESFToken cookie, add and manage ESF clients,
 * and add other staff members. Client provisioning / listing / impersonation all
 * delegate to ManagedClientService, which the agency portal shares.
 */
const mongoose = require('mongoose');
const UserModel = require('../../models/user-auth/userModel.js');
const EsfInvite = require('../../models/user-auth/EsfInviteModel.js');
const { getUserByEmail } = require('../../Services/User/userServices.js');
const { deleteUserById } = require('../../Services/User/deleteUserService.js');
const {
    createManagedClient,
    listManagedClients,
    issueClientSession,
    ESF_CLIENT_QUERY,
} = require('../../Services/User/ManagedClientService.js');
const { createAccessToken, verifyAccessToken } = require('../../utils/Tokens.js');
const { hashPassword, verifyPassword } = require('../../utils/HashPassword.js');
const { getHttpsCookieOptions } = require('../../utils/cookieConfig.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { isStrongPassword, passwordPolicyMessage } = require('../../utils/passwordPolicy.js');
const {
    ESF_ROLES,
    ASSIGNABLE_ESF_ROLES,
    isEsfOwner,
    resolveEsfRole,
    canManageTeam,
} = require('../../Services/User/esfRoles.js');
const {
    ESF_CLIENT_PAGES,
    sanitizeDeniedPages,
} = require('../../Services/User/esfPages.js');

/** Shape a staff user for the client, never leaking the password hash. */
const toStaffResponse = (user, extra = {}) => ({
    _id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    accessType: user.accessType,
    esfRole: resolveEsfRole(user),
    isOwner: isEsfOwner(user),
    // Owner is never restricted, so their blocklist is always reported empty.
    esfDeniedPages: isEsfOwner(user) ? [] : sanitizeDeniedPages(user.esfDeniedPages),
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
    ...extra,
});

/**
 * Guard for team-management endpoints.
 * Returns true when the request may proceed; otherwise it has already responded.
 */
const requireTeamManager = (req, res) => {
    if (canManageTeam(req.esfUser)) return true;
    logger.warn(`ESF user ${req.esfUserId} (${req.esfRole}) attempted a team-management action`);
    res.status(403).json(new ApiResponse(403, '', 'Only the owner and admins can manage team members'));
    return false;
};

/**
 * Load a staff member for modification, refusing when the target is the owner.
 * The owner is immutable: no role change, no removal, no password reset by
 * anyone. They manage their own password through Settings.
 *
 * Returns the user, or null when it has already responded.
 */
const loadModifiableStaff = async (userId, res) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        res.status(400).json(new ApiResponse(400, '', 'Invalid user id'));
        return null;
    }

    const user = await UserModel.findOne({ _id: userId, accessType: 'esfUser' });
    if (!user) {
        res.status(404).json(new ApiResponse(404, '', 'Team member not found'));
        return null;
    }

    if (isEsfOwner(user)) {
        logger.warn(`Blocked an attempt to modify the ESF portal owner (${user.email})`);
        res.status(403).json(new ApiResponse(403, '', 'The portal owner account cannot be modified'));
        return null;
    }

    return user;
};

/* ------------------------------------------------------------------ auth -- */

/**
 * POST /app/esf/login
 * Sets the ESFToken cookie. Only accessType 'esfUser' / 'superAdmin' may pass.
 */
const esfLogin = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await getUserByEmail(email);
    if (!user) {
        logger.error(new ApiError(404, 'ESF user not found'));
        return res.status(404).json(new ApiResponse(404, '', 'No portal account found with this email'));
    }

    if (!['esfUser', 'superAdmin'].includes(user.accessType)) {
        logger.warn(`Non-ESF user ${user.email} attempted ESF portal login`);
        return res.status(403).json(new ApiResponse(403, '', 'This account does not have access to the eStore Factory portal'));
    }

    if (!user.password) {
        return res.status(401).json(new ApiResponse(401, '', 'Invalid credentials'));
    }

    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) {
        logger.error(new ApiError(401, 'Invalid ESF credentials'));
        return res.status(401).json(new ApiResponse(401, '', 'Invalid email or password'));
    }

    const esfToken = await createAccessToken(user._id);
    if (!esfToken) {
        logger.error(new ApiError(500, 'Failed to create ESF token'));
        return res.status(500).json(new ApiResponse(500, '', 'Failed to create session'));
    }

    await UserModel.findByIdAndUpdate(user._id, { lastLoginAt: new Date() });

    logger.info(`ESF user ${user._id} logged in`);

    return res
        .status(200)
        .cookie('ESFToken', esfToken, getHttpsCookieOptions())
        .json(new ApiResponse(200, toStaffResponse(user), 'Login successful'));
});

/** POST /app/esf/logout */
const esfLogout = asyncHandler(async (req, res) => {
    return res
        .status(200)
        .clearCookie('ESFToken', getHttpsCookieOptions())
        .json(new ApiResponse(200, '', 'Logged out successfully'));
});

/** GET /app/esf/me — session check used by the route guard. */
const getEsfProfile = asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.esfUserId).select('-password');
    if (!user) {
        return res.status(404).json(new ApiResponse(404, '', 'User not found'));
    }
    return res.status(200).json(new ApiResponse(200, toStaffResponse(user), 'Profile fetched'));
});

/** PUT /app/esf/profile — name and phone only; email is immutable. */
const updateEsfProfile = asyncHandler(async (req, res) => {
    const { firstName, lastName, phone } = req.body;

    const user = await UserModel.findById(req.esfUserId);
    if (!user) {
        return res.status(404).json(new ApiResponse(404, '', 'User not found'));
    }

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) {
        user.phone = phone;
        user.whatsapp = phone;
    }
    await user.save();

    return res.status(200).json(new ApiResponse(200, toStaffResponse(user), 'Profile updated successfully'));
});

/** PUT /app/esf/update-password */
const updateEsfPassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json(new ApiResponse(400, '', 'Current and new password are required'));
    }
    // Same strength as the signup page - otherwise this is a way straight past it.
    if (!isStrongPassword(newPassword)) {
        return res.status(400).json(new ApiResponse(400, '', passwordPolicyMessage(newPassword)));
    }

    const user = await UserModel.findById(req.esfUserId).select('+password');
    if (!user || !user.password) {
        return res.status(404).json(new ApiResponse(404, '', 'User not found'));
    }

    const isPasswordValid = await verifyPassword(currentPassword, user.password);
    if (!isPasswordValid) {
        return res.status(401).json(new ApiResponse(401, '', 'Current password is incorrect'));
    }

    user.password = await hashPassword(newPassword);
    await user.save();

    logger.info(`ESF user ${user._id} changed their password`);
    return res.status(200).json(new ApiResponse(200, '', 'Password updated successfully'));
});

/* --------------------------------------------------------------- clients -- */

/** GET /app/esf/clients — every client added through this portal. */
const getEsfClients = asyncHandler(async (req, res) => {
    const clients = await listManagedClients(ESF_CLIENT_QUERY);

    // Resolve "added by" names in one query rather than per client.
    const staffIds = [...new Set(clients.map((c) => c.esfAddedBy).filter(Boolean).map(String))];
    const staff = staffIds.length
        ? await UserModel.find({ _id: { $in: staffIds } }).select('firstName lastName').lean()
        : [];
    const staffById = new Map(staff.map((s) => [String(s._id), `${s.firstName} ${s.lastName}`.trim()]));

    const withAddedBy = clients.map((client) => ({
        ...client,
        addedByName: client.esfAddedBy ? staffById.get(String(client.esfAddedBy)) || null : null,
    }));

    return res.status(200).json(new ApiResponse(200, withAddedBy, 'ESF clients fetched successfully'));
});

/**
 * POST /app/esf/clients
 * Creates the client and switches the caller into its session so they can run
 * the Amazon connect flow — the same handoff the agency portal performs.
 */
const createEsfClient = asyncHandler(async (req, res) => {
    const { firstname, lastname, phone, email, password, allTermsAndConditionsAgreed } = req.body;

    const result = await createManagedClient({
        firstname,
        lastname,
        phone,
        email,
        password, // ESF clients sign in directly, so they are given credentials
        allTermsAndConditionsAgreed,
        ownership: {
            isEsfClient: true,
            esfAddedBy: req.esfUserId,
            // Intentionally NOT setting agencyId/adminId — those fields are what
            // agency owners query on, and ESF clients must stay invisible there.
        },
    });

    if (!result.ok) {
        logger.error(new ApiError(result.status, result.message));
        return res.status(result.status).json(new ApiResponse(result.status, '', result.message));
    }

    const { client, accessToken, refreshToken } = result;
    const options = getHttpsCookieOptions();

    logger.info(`ESF user ${req.esfUserId} created client ${client._id} (${client.email})`);

    return res
        .status(201)
        .cookie('IBEXAccessToken', accessToken, options)
        .cookie('IBEXRefreshToken', refreshToken, options)
        .json(new ApiResponse(201, {
            clientId: client._id,
            firstName: client.firstName,
            lastName: client.lastName,
            email: client.email,
            phone: client.phone,
        }, 'Client registered successfully'));
});

/**
 * DELETE /app/esf/clients/:clientId
 *
 * Detaches the client from the ESF portal — it does NOT delete their account.
 * The seller keeps their SellerQI account, their Amazon connection and all their
 * data; they simply stop being an ESF-managed client. Deleting a seller account
 * outright is the super admin's job, not this portal's.
 *
 * Clearing isEsfClient severs every ESF tie at once: they leave this list, staff
 * can no longer impersonate them or set their password, and the ESF-only pages
 * and page-permission guard stop applying to them.
 */
const removeEsfClient = asyncHandler(async (req, res) => {
    const { clientId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
        return res.status(400).json(new ApiResponse(400, '', 'Invalid client id'));
    }

    // Scope the lookup to ESF clients so this endpoint can never touch an
    // agency client or a self-serve seller.
    const client = await UserModel.findOne({ _id: clientId, ...ESF_CLIENT_QUERY });
    if (!client) {
        logger.error(new ApiError(404, 'Client not found in the ESF portal'));
        return res.status(404).json(new ApiResponse(404, '', 'Client not found'));
    }

    // Unlink only. Nothing is deleted — no account, no seller data, no history.
    await UserModel.updateOne(
        { _id: clientId },
        { $set: { isEsfClient: false, esfAddedBy: null } }
    );

    logger.info(`ESF user ${req.esfUserId} unlinked client ${clientId} (${client.email}) from the ESF portal`);
    return res.status(200).json(new ApiResponse(200, '', 'Client removed from the eStore Factory portal'));
});

/**
 * POST /app/esf/clients/switch
 * Swaps the IBEX* cookies to the client. The ESFToken cookie is untouched, so
 * the staff member stays signed in to the portal underneath.
 */
const switchToEsfClient = asyncHandler(async (req, res) => {
    const { clientId } = req.body;

    if (!clientId || !mongoose.Types.ObjectId.isValid(clientId)) {
        return res.status(400).json(new ApiResponse(400, '', 'A valid client ID is required'));
    }

    const client = await UserModel.findOne({ _id: clientId, ...ESF_CLIENT_QUERY });
    if (!client) {
        logger.error(new ApiError(404, 'Client not found in the ESF portal'));
        return res.status(404).json(new ApiResponse(404, '', 'Client not found'));
    }

    const result = await issueClientSession(clientId);
    if (!result.ok) {
        return res.status(result.status).json(new ApiResponse(result.status, '', result.message));
    }

    const options = getHttpsCookieOptions();

    logger.info(`ESF user ${req.esfUserId} switched to client ${client._id} (${client.email})`);

    return res
        .status(200)
        .cookie('IBEXAccessToken', result.accessToken, options)
        .cookie('IBEXRefreshToken', result.refreshToken, options)
        .cookie('IBEXLocationToken', result.locationToken, options)
        .json(new ApiResponse(200, {
            userId: client._id,
            firstName: client.firstName,
            lastName: client.lastName,
            email: client.email,
            packageType: client.packageType,
        }, 'Successfully switched to client'));
});

/**
 * POST /app/esf/clients/:clientId/set-password
 * Sets or resets a client's sign-in password. Also covers clients created
 * before passwords existed, which otherwise have no way to sign in.
 */
const setEsfClientPassword = asyncHandler(async (req, res) => {
    const { clientId } = req.params;
    const { newPassword } = req.body;

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
        return res.status(400).json(new ApiResponse(400, '', 'Invalid client id'));
    }
    if (!isStrongPassword(newPassword)) {
        return res.status(400).json(new ApiResponse(400, '', passwordPolicyMessage(newPassword)));
    }

    // Scoped to ESF clients so this can never reset an agency client or a seller.
    const client = await UserModel.findOne({ _id: clientId, ...ESF_CLIENT_QUERY });
    if (!client) {
        return res.status(404).json(new ApiResponse(404, '', 'Client not found'));
    }

    client.password = await hashPassword(newPassword);
    await client.save();

    logger.info(`ESF user ${req.esfUserId} set the password for client ${clientId}`);
    return res.status(200).json(new ApiResponse(200, '', 'Client password updated successfully'));
});

/* ----------------------------------------------------------------- staff -- */

/** GET /app/esf/users — the staff who can access this portal. */
const getEsfUsers = asyncHandler(async (req, res) => {
    const users = await UserModel.find({ accessType: 'esfUser' })
        .select('firstName lastName email phone esfRole esfDeniedPages createdAt lastLoginAt')
        .sort({ createdAt: -1 })
        .lean();

    // How many clients each member has added, in one aggregation.
    const counts = await UserModel.aggregate([
        { $match: { isEsfClient: true, esfAddedBy: { $ne: null } } },
        { $group: { _id: '$esfAddedBy', count: { $sum: 1 } } },
    ]);
    const countById = new Map(counts.map((c) => [String(c._id), c.count]));

    const withCounts = users.map((user) => ({
        ...user,
        esfRole: resolveEsfRole(user),
        isOwner: isEsfOwner(user),
        esfDeniedPages: isEsfOwner(user) ? [] : sanitizeDeniedPages(user.esfDeniedPages),
        clientsAdded: countById.get(String(user._id)) || 0,
    }));

    // Owner first, then admins, then members - the list reads as a hierarchy.
    const rank = { [ESF_ROLES.OWNER]: 0, [ESF_ROLES.ADMIN]: 1, [ESF_ROLES.MEMBER]: 2 };
    withCounts.sort((a, b) => rank[a.esfRole] - rank[b.esfRole]);

    return res.status(200).json(new ApiResponse(200, withCounts, 'ESF users fetched successfully'));
});

/** DELETE /app/esf/users/:userId — revoke a staff member's portal access. */
const removeEsfUser = asyncHandler(async (req, res) => {
    if (!requireTeamManager(req, res)) return;

    const { userId } = req.params;

    if (String(userId) === String(req.esfUserId)) {
        return res.status(400).json(new ApiResponse(400, '', 'You cannot remove your own access'));
    }

    // Refuses outright when the target is the portal owner.
    const user = await loadModifiableStaff(userId, res);
    if (!user) return;

    // Refuse to leave the portal with no way in.
    const remaining = await UserModel.countDocuments({ accessType: 'esfUser' });
    if (remaining <= 1) {
        return res.status(400).json(new ApiResponse(400, '', 'Cannot remove the last team member'));
    }

    // Hard delete: a soft delete left accessType 'esfUser' and the password
    // intact, so a "removed" member could still sign in at /esf-login.
    //
    // Deliberately does NOT go through the full-user-data-purge queue. A staff
    // account never connects Amazon and has no seller, finance or analysis rows —
    // its only related documents are its invitations, cleaned up right here.
    // Depending on the queue made this endpoint hang whenever Redis was
    // unreachable: BullMQ's add() retries rather than throwing, so the request
    // timed out instead of failing fast.
    await EsfInvite.deleteMany({ $or: [{ invitedBy: userId }, { acceptedUserId: userId }] });

    await deleteUserById(userId, { hardDelete: true });

    logger.info(`ESF user ${req.esfUserId} hard-deleted staff member ${userId}`);
    return res.status(200).json(new ApiResponse(200, '', 'Team member removed successfully'));
});

/** POST /app/esf/users/:userId/reset-password */
const resetEsfUserPassword = asyncHandler(async (req, res) => {
    if (!requireTeamManager(req, res)) return;

    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!isStrongPassword(newPassword)) {
        return res.status(400).json(new ApiResponse(400, '', passwordPolicyMessage(newPassword)));
    }

    // The owner's password is theirs alone - changed via Settings, not here.
    const user = await loadModifiableStaff(userId, res);
    if (!user) return;

    user.password = await hashPassword(newPassword);
    await user.save();

    logger.info(`ESF user ${req.esfUserId} reset the password for staff member ${userId}`);
    return res.status(200).json(new ApiResponse(200, '', 'Password reset successfully'));
});

/**
 * PATCH /app/esf/users/:userId/role
 * Change a team member's role. Cannot target the owner, and cannot grant
 * 'owner' — there is exactly one and it is seeded, not assigned.
 */
const updateEsfUserRole = asyncHandler(async (req, res) => {
    if (!requireTeamManager(req, res)) return;

    const { userId } = req.params;
    const { role } = req.body;

    if (!ASSIGNABLE_ESF_ROLES.includes(role)) {
        return res.status(400).json(new ApiResponse(400, '', `Role must be one of: ${ASSIGNABLE_ESF_ROLES.join(', ')}`));
    }

    if (String(userId) === String(req.esfUserId)) {
        return res.status(400).json(new ApiResponse(400, '', 'You cannot change your own role'));
    }

    const user = await loadModifiableStaff(userId, res);
    if (!user) return;

    user.esfRole = role;
    await user.save();

    logger.info(`ESF user ${req.esfUserId} set ${user.email} role to ${role}`);
    return res.status(200).json(new ApiResponse(200, toStaffResponse(user), 'Role updated successfully'));
});

/**
 * GET /app/esf/pages
 * The catalogue of restrictable pages, so the permissions UI never hard-codes
 * a second copy of the list.
 */
const getEsfPageCatalogue = asyncHandler(async (req, res) => {
    return res.status(200).json(new ApiResponse(200, ESF_CLIENT_PAGES, 'Page catalogue fetched'));
});

/**
 * PUT /app/esf/users/:userId/permissions
 * Body: { deniedPages: string[] }  — pages this member may NOT open for ESF clients.
 */
const updateEsfUserPermissions = asyncHandler(async (req, res) => {
    if (!requireTeamManager(req, res)) return;

    const { userId } = req.params;
    const { deniedPages } = req.body;

    if (!Array.isArray(deniedPages)) {
        return res.status(400).json(new ApiResponse(400, '', 'deniedPages must be an array of page keys'));
    }

    // Refuses when the target is the portal owner.
    const user = await loadModifiableStaff(userId, res);
    if (!user) return;

    user.esfDeniedPages = sanitizeDeniedPages(deniedPages);
    await user.save();

    logger.info(
        `ESF user ${req.esfUserId} set page access for ${user.email} ` +
            `(denied: ${user.esfDeniedPages.join(', ') || 'none'})`
    );

    return res.status(200).json(new ApiResponse(200, toStaffResponse(user), 'Page access updated successfully'));
});

/**
 * GET /app/esf/session-permissions
 *
 * Called from inside a client's account (not the portal) so the sidebar knows
 * what to hide. Deliberately tolerant: it answers 200 with isEsfSession:false
 * when no staff session is present, so the seller app can call it
 * unconditionally without treating a normal user as an error.
 */
const getEsfSessionPermissions = asyncHandler(async (req, res) => {
    const esfToken = req.cookies?.ESFToken;
    const empty = { isEsfSession: false, esfRole: null, isOwner: false, deniedPages: [] };

    if (!esfToken) return res.status(200).json(new ApiResponse(200, empty, 'No ESF session'));

    const decoded = await verifyAccessToken(esfToken);
    if (!decoded || !decoded.isvalid) return res.status(200).json(new ApiResponse(200, empty, 'No ESF session'));

    const staff = await UserModel.findById(decoded.tokenData).select('accessType esfRole esfDeniedPages email');
    if (!staff || staff.accessType !== 'esfUser') {
        return res.status(200).json(new ApiResponse(200, empty, 'No ESF session'));
    }

    const owner = isEsfOwner(staff);
    return res.status(200).json(new ApiResponse(200, {
        isEsfSession: true,
        esfRole: resolveEsfRole(staff),
        isOwner: owner,
        deniedPages: owner ? [] : sanitizeDeniedPages(staff.esfDeniedPages),
    }, 'ESF session permissions fetched'));
});

module.exports = {
    esfLogin,
    esfLogout,
    getEsfProfile,
    updateEsfProfile,
    updateEsfPassword,
    getEsfClients,
    createEsfClient,
    removeEsfClient,
    switchToEsfClient,
    setEsfClientPassword,
    getEsfUsers,
    removeEsfUser,
    resetEsfUserPassword,
    updateEsfUserRole,
    getEsfPageCatalogue,
    updateEsfUserPermissions,
    getEsfSessionPermissions,
};
