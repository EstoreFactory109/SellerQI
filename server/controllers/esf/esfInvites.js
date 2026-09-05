/**
 * Invitations to the ESF staff portal.
 *
 * Replaces the old "type in their password for them" flow. An owner/admin sends
 * an invite to an address; the recipient follows the emailed link and sets their
 * own name, phone and password. The email is fixed by the invitation; the role
 * is a starting value the owner/admin can change afterwards.
 *
 * Two of these endpoints are PUBLIC by necessity — the recipient has no account
 * yet. They are protected by the invite token instead of a session.
 */
const mongoose = require('mongoose');
const UserModel = require('../../models/user-auth/userModel.js');
const EsfInvite = require('../../models/user-auth/EsfInviteModel.js');
const { getUserByEmail } = require('../../Services/User/userServices.js');
const { sendEsfInviteEmail } = require('../../Services/Email/SendEsfInviteEmail.js');
const { createAccessToken } = require('../../utils/Tokens.js');
const { hashPassword } = require('../../utils/HashPassword.js');
const { getHttpsCookieOptions } = require('../../utils/cookieConfig.js');
const { isStrongPassword, passwordPolicyMessage } = require('../../utils/passwordPolicy.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { ASSIGNABLE_ESF_ROLES, ESF_ROLES, canManageTeam } = require('../../Services/User/esfRoles.js');

/** How long an invitation stays valid. */
const INVITE_TTL_DAYS = 7;

const normalize = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

/**
 * Where the recipient lands. Derived from RESET_LINK_BASE_URI so it points at
 * the same app the reset link does, without needing another env var configured.
 */
const buildInviteLink = (token) => {
    const explicit = process.env.ESF_INVITE_BASE_URI;
    if (explicit) return `${explicit.replace(/\/$/, '')}/${token}`;

    const resetBase = process.env.RESET_LINK_BASE_URI || '';
    const appBase = resetBase.replace(/\/reset-password\/?$/, '').replace(/\/$/, '');
    const base = appBase || (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    return `${base}/esf-invite/${token}`;
};

const expiryDate = () => new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

/** Only owner/admin may invite. Mirrors the team-management guard. */
const requireTeamManager = (req, res) => {
    if (canManageTeam(req.esfUser)) return true;
    logger.warn(`ESF user ${req.esfUserId} (${req.esfRole}) attempted to manage invitations`);
    res.status(403).json(new ApiResponse(403, '', 'Only the owner and admins can invite team members'));
    return false;
};

const toInviteResponse = (invite, inviterName = null) => ({
    _id: invite._id,
    email: invite.email,
    role: invite.role,
    status: invite.status,
    expiresAt: invite.expiresAt,
    lastSentAt: invite.lastSentAt,
    createdAt: invite.createdAt,
    invitedByName: inviterName,
});

/* ------------------------------------------------------- portal side ---- */

/** GET /app/esf/invites — outstanding invitations. */
const listInvites = asyncHandler(async (req, res) => {
    const invites = await EsfInvite.find({ status: 'pending' })
        .sort({ createdAt: -1 })
        .populate('invitedBy', 'firstName lastName')
        .lean();

    const shaped = invites.map((invite) => {
        const inviter = invite.invitedBy;
        const name = inviter ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() : null;
        return { ...toInviteResponse(invite, name), isExpired: new Date(invite.expiresAt) < new Date() };
    });

    return res.status(200).json(new ApiResponse(200, shaped, 'Invitations fetched successfully'));
});

/** POST /app/esf/invites — body: { email, role } */
const createInvite = asyncHandler(async (req, res) => {
    if (!requireTeamManager(req, res)) return;

    const email = normalize(req.body?.email);
    const role = ASSIGNABLE_ESF_ROLES.includes(req.body?.role) ? req.body.role : ESF_ROLES.MEMBER;

    // Already has an account? Nothing to invite them to.
    const existing = await getUserByEmail(email);
    if (existing) {
        const already = existing.accessType === 'esfUser'
            ? 'That person is already a team member'
            : 'That email already belongs to an account on this application';
        return res.status(409).json(new ApiResponse(409, '', already));
    }

    // Replace any outstanding invite rather than rejecting — re-inviting is the
    // natural thing to do when the first one was never opened.
    await EsfInvite.updateMany({ email, status: 'pending' }, { $set: { status: 'revoked' } });

    const invite = await EsfInvite.create({
        email,
        role,
        token: EsfInvite.generateToken(),
        invitedBy: req.esfUserId,
        status: 'pending',
        expiresAt: expiryDate(),
        lastSentAt: new Date(),
    });

    const inviter = req.esfUser;
    const inviterName = `${inviter?.firstName || ''} ${inviter?.lastName || ''}`.trim() || 'A team member';

    const sent = await sendEsfInviteEmail({
        email,
        role,
        inviterName,
        inviteLink: buildInviteLink(invite.token),
        expiresAt: invite.expiresAt,
        invitedById: req.esfUserId,
    });

    if (!sent) {
        // Do not leave a pending invite nobody received.
        await EsfInvite.deleteOne({ _id: invite._id });
        logger.error(new ApiError(500, `Failed to send ESF invitation to ${email}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not send the invitation. Please check the address and try again.'));
    }

    logger.info(`ESF user ${req.esfUserId} invited ${email} as ${role}`);
    return res.status(201).json(new ApiResponse(201, toInviteResponse(invite, inviterName), 'Invitation sent'));
});

/** POST /app/esf/invites/:inviteId/resend — new token, fresh expiry. */
const resendInvite = asyncHandler(async (req, res) => {
    if (!requireTeamManager(req, res)) return;

    const { inviteId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(inviteId)) {
        return res.status(400).json(new ApiResponse(400, '', 'Invalid invitation id'));
    }

    const invite = await EsfInvite.findOne({ _id: inviteId, status: 'pending' });
    if (!invite) return res.status(404).json(new ApiResponse(404, '', 'Invitation not found'));

    // Rotate the token so a previously shared link stops working.
    invite.token = EsfInvite.generateToken();
    invite.expiresAt = expiryDate();
    invite.lastSentAt = new Date();
    await invite.save();

    const inviter = req.esfUser;
    const inviterName = `${inviter?.firstName || ''} ${inviter?.lastName || ''}`.trim() || 'A team member';

    const sent = await sendEsfInviteEmail({
        email: invite.email,
        role: invite.role,
        inviterName,
        inviteLink: buildInviteLink(invite.token),
        expiresAt: invite.expiresAt,
        invitedById: req.esfUserId,
    });

    if (!sent) {
        return res.status(500).json(new ApiResponse(500, '', 'Could not resend the invitation. Please try again.'));
    }

    logger.info(`ESF user ${req.esfUserId} resent the invitation to ${invite.email}`);
    return res.status(200).json(new ApiResponse(200, toInviteResponse(invite, inviterName), 'Invitation resent'));
});

/** DELETE /app/esf/invites/:inviteId — revoke, invalidating the link. */
const revokeInvite = asyncHandler(async (req, res) => {
    if (!requireTeamManager(req, res)) return;

    const { inviteId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(inviteId)) {
        return res.status(400).json(new ApiResponse(400, '', 'Invalid invitation id'));
    }

    const invite = await EsfInvite.findOne({ _id: inviteId, status: 'pending' });
    if (!invite) return res.status(404).json(new ApiResponse(404, '', 'Invitation not found'));

    invite.status = 'revoked';
    await invite.save();

    logger.info(`ESF user ${req.esfUserId} revoked the invitation to ${invite.email}`);
    return res.status(200).json(new ApiResponse(200, '', 'Invitation revoked'));
});

/* ------------------------------------------------------ recipient side -- */

/**
 * GET /app/esf/invites/token/:token — PUBLIC.
 * Returns just enough to prefill the acceptance form. The token is the
 * credential; nothing sensitive is exposed beyond the invited address itself.
 */
const getInviteByToken = asyncHandler(async (req, res) => {
    const invite = await EsfInvite.findOne({ token: req.params.token })
        .populate('invitedBy', 'firstName lastName');

    if (!invite) {
        return res.status(404).json(new ApiResponse(404, '', 'This invitation link is not valid'));
    }
    if (invite.status === 'accepted') {
        return res.status(410).json(new ApiResponse(410, '', 'This invitation has already been used. Try signing in instead.'));
    }
    if (invite.status === 'revoked') {
        return res.status(410).json(new ApiResponse(410, '', 'This invitation has been revoked'));
    }
    if (invite.expiresAt < new Date()) {
        return res.status(410).json(new ApiResponse(410, '', 'This invitation has expired. Ask for a new one.'));
    }

    const inviter = invite.invitedBy;
    return res.status(200).json(new ApiResponse(200, {
        email: invite.email,
        role: invite.role,
        invitedByName: inviter ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() : null,
        expiresAt: invite.expiresAt,
    }, 'Invitation is valid'));
});

/**
 * POST /app/esf/invites/token/:token/accept — PUBLIC.
 * Body: { firstname, lastname, phone, password }
 *
 * Email and role come from the invitation, never from the request body — the
 * recipient cannot promote themselves or claim a different address.
 */
const acceptInvite = asyncHandler(async (req, res) => {
    const { firstname, lastname, phone, password } = req.body || {};

    const invite = await EsfInvite.findOne({ token: req.params.token });
    if (!invite || !invite.isUsable()) {
        return res.status(410).json(new ApiResponse(410, '', 'This invitation is no longer valid'));
    }

    if (!firstname || !lastname || !phone) {
        return res.status(400).json(new ApiResponse(400, '', 'First name, last name and phone are required'));
    }
    if (!isStrongPassword(password)) {
        return res.status(400).json(new ApiResponse(400, '', passwordPolicyMessage(password)));
    }

    // Someone may have registered with this address between invite and accept.
    const existing = await getUserByEmail(invite.email);
    if (existing) {
        invite.status = 'revoked';
        await invite.save();
        return res.status(409).json(new ApiResponse(409, '', 'An account already exists for this email'));
    }

    const newUser = await UserModel.create({
        firstName: firstname,
        lastName: lastname,
        phone,
        whatsapp: phone,
        email: invite.email, // fixed by the invitation
        password: await hashPassword(password),
        accessType: 'esfUser',
        esfRole: invite.role,
        isVerified: true, // proved by receiving the invitation
        allTermsAndConditionsAgreed: true,
        packageType: 'LITE',
        subscriptionStatus: 'active',
        OTP: null,
    });

    invite.status = 'accepted';
    invite.acceptedAt = new Date();
    invite.acceptedUserId = newUser._id;
    await invite.save();

    // Sign them straight in — they have just proved control of the address.
    const esfToken = await createAccessToken(newUser._id);
    await UserModel.findByIdAndUpdate(newUser._id, { lastLoginAt: new Date() });

    logger.info(`ESF invitation accepted by ${invite.email} — created ${newUser._id} as ${invite.role}`);

    return res
        .status(201)
        .cookie('ESFToken', esfToken, getHttpsCookieOptions())
        .json(new ApiResponse(201, {
            _id: newUser._id,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            email: newUser.email,
            esfRole: newUser.esfRole,
        }, 'Welcome to the team'));
});

module.exports = {
    INVITE_TTL_DAYS,
    buildInviteLink,
    listInvites,
    createInvite,
    resendInvite,
    revokeInvite,
    getInviteByToken,
    acceptInvite,
};
