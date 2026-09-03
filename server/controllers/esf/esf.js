/**
 * eStore Factory (ESF) internal staff portal.
 *
 * Staff sign in here with their own ESFToken cookie, add and manage ESF clients,
 * and add other staff members. Client provisioning / listing / impersonation all
 * delegate to ManagedClientService, which the agency portal shares.
 */
const mongoose = require('mongoose');
const UserModel = require('../../models/user-auth/userModel.js');
const { getUserByEmail } = require('../../Services/User/userServices.js');
const { deleteUserById } = require('../../Services/User/deleteUserService.js');
const {
    createManagedClient,
    listManagedClients,
    issueClientSession,
    ESF_CLIENT_QUERY,
} = require('../../Services/User/ManagedClientService.js');
const { createAccessToken } = require('../../utils/Tokens.js');
const { hashPassword, verifyPassword } = require('../../utils/HashPassword.js');
const { getHttpsCookieOptions } = require('../../utils/cookieConfig.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');

/** Shape a staff user for the client, never leaking the password hash. */
const toStaffResponse = (user, extra = {}) => ({
    _id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    accessType: user.accessType,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
    ...extra,
});

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
    if (newPassword.length < 8) {
        return res.status(400).json(new ApiResponse(400, '', 'New password must be at least 8 characters long'));
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
    const { firstname, lastname, phone, email, allTermsAndConditionsAgreed } = req.body;

    const result = await createManagedClient({
        firstname,
        lastname,
        phone,
        email,
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

/** DELETE /app/esf/clients/:clientId */
const removeEsfClient = asyncHandler(async (req, res) => {
    const { clientId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
        return res.status(400).json(new ApiResponse(400, '', 'Invalid client id'));
    }

    // Scope the lookup to ESF clients so this endpoint can never delete an
    // agency client or a self-serve seller.
    const client = await UserModel.findOne({ _id: clientId, ...ESF_CLIENT_QUERY });
    if (!client) {
        logger.error(new ApiError(404, 'Client not found in the ESF portal'));
        return res.status(404).json(new ApiResponse(404, '', 'Client not found'));
    }

    await deleteUserById(clientId);

    logger.info(`ESF user ${req.esfUserId} removed client ${clientId}`);
    return res.status(200).json(new ApiResponse(200, '', 'Client removed successfully'));
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

/* ----------------------------------------------------------------- staff -- */

/** GET /app/esf/users — the staff who can access this portal. */
const getEsfUsers = asyncHandler(async (req, res) => {
    const users = await UserModel.find({ accessType: 'esfUser' })
        .select('firstName lastName email phone createdAt lastLoginAt')
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
        clientsAdded: countById.get(String(user._id)) || 0,
    }));

    return res.status(200).json(new ApiResponse(200, withCounts, 'ESF users fetched successfully'));
});

/** POST /app/esf/users — add another staff member. */
const createEsfUser = asyncHandler(async (req, res) => {
    const { firstname, lastname, phone, email, password } = req.body;

    const existing = await getUserByEmail(email);
    if (existing) {
        logger.error(new ApiError(409, 'User already exists'));
        return res.status(409).json(new ApiResponse(409, '', 'A user with this email already exists'));
    }

    const newUser = new UserModel({
        firstName: firstname,
        lastName: lastname,
        phone: phone,
        whatsapp: phone,
        email: email,
        password: await hashPassword(password),
        accessType: 'esfUser',
        isVerified: true,
        allTermsAndConditionsAgreed: true,
        // Staff accounts are internal tooling, not billable seller accounts.
        packageType: 'LITE',
        subscriptionStatus: 'active',
        OTP: null,
    });

    const savedUser = await newUser.save();

    logger.info(`ESF user ${req.esfUserId} added staff member ${savedUser._id} (${savedUser.email})`);

    return res
        .status(201)
        .json(new ApiResponse(201, toStaffResponse(savedUser, { clientsAdded: 0 }), 'Team member added successfully'));
});

/** DELETE /app/esf/users/:userId — revoke a staff member's portal access. */
const removeEsfUser = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json(new ApiResponse(400, '', 'Invalid user id'));
    }

    if (String(userId) === String(req.esfUserId)) {
        return res.status(400).json(new ApiResponse(400, '', 'You cannot remove your own access'));
    }

    const user = await UserModel.findOne({ _id: userId, accessType: 'esfUser' });
    if (!user) {
        return res.status(404).json(new ApiResponse(404, '', 'Team member not found'));
    }

    // Refuse to leave the portal with no way in.
    const remaining = await UserModel.countDocuments({ accessType: 'esfUser' });
    if (remaining <= 1) {
        return res.status(400).json(new ApiResponse(400, '', 'Cannot remove the last team member'));
    }

    await deleteUserById(userId);

    logger.info(`ESF user ${req.esfUserId} removed staff member ${userId}`);
    return res.status(200).json(new ApiResponse(200, '', 'Team member removed successfully'));
});

/** POST /app/esf/users/:userId/reset-password */
const resetEsfUserPassword = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json(new ApiResponse(400, '', 'Invalid user id'));
    }
    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json(new ApiResponse(400, '', 'New password must be at least 8 characters long'));
    }

    const user = await UserModel.findOne({ _id: userId, accessType: 'esfUser' });
    if (!user) {
        return res.status(404).json(new ApiResponse(404, '', 'Team member not found'));
    }

    user.password = await hashPassword(newPassword);
    await user.save();

    logger.info(`ESF user ${req.esfUserId} reset the password for staff member ${userId}`);
    return res.status(200).json(new ApiResponse(200, '', 'Password reset successfully'));
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
    getEsfUsers,
    createEsfUser,
    removeEsfUser,
    resetEsfUserPassword,
};
