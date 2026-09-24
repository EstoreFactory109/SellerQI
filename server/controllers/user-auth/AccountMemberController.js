/**
 * Members of a seller account — "Add member" in the seller app's sidebar.
 *
 * The owner (or anyone already signed in to the account — members have full
 * access, including this page) invites an address. Following the emailed link
 * signs the member straight in to the account; no name, phone or password is
 * asked for. After that they use "Log in as a member" on the sign-in page, which
 * emails a one-time link. See models/user-auth/AccountMemberModel.js for the rules.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const AccountMember = require('../../models/user-auth/AccountMemberModel.js');
const LoginLink = require('../../models/user-auth/LoginLinkModel.js');
const EsfInvite = require('../../models/user-auth/EsfInviteModel.js');
const { getUserByEmail } = require('../../Services/User/userServices.js');
const { sendAuthLinkEmail } = require('../../Services/Email/SendAuthLinkEmail.js');
const { accountNameFor, issueMemberSession } = require('../../Services/User/memberSession.js');
const { appLink } = require('../../utils/appBaseUrl.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');

const INVITE_TTL_DAYS = 7;
const LINK_SENT_MESSAGE = 'If that email belongs to a member, a sign-in link is on its way. It expires in 15 minutes.';

const normalize = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
const cleanName = (name) => (typeof name === 'string' && name.trim() ? name.trim().slice(0, 50) : null);
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newInviteToken = () => crypto.randomBytes(32).toString('hex');
const inviteExpiry = () => new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** `viewerMemberId`: the member making the request, if any, so their own row is marked. */
const toMemberResponse = (member, viewerMemberId = null) => ({
    _id: member._id,
    isYou: Boolean(viewerMemberId) && String(member._id) === String(viewerMemberId),
    email: member.email,
    name: member.name || null,
    status: member.status,
    isExpired: member.status === 'pending' && member.inviteExpiresAt < new Date(),
    inviteExpiresAt: member.inviteExpiresAt,
    lastSentAt: member.lastSentAt,
    acceptedAt: member.acceptedAt,
    lastLoginAt: member.lastLoginAt,
    createdAt: member.createdAt,
});

/** Who is doing the inviting, for the email. */
const inviterNameFor = async (req) => (await accountNameFor(req.userId)) || 'A SellerQI user';

const sendInviteEmail = async (req, member, token) => {
    const accountName = await inviterNameFor(req);
    return sendAuthLinkEmail({
        email: member.email,
        subject: `You have been invited to manage ${accountName} on SellerQI`,
        title: 'You have been invited',
        subtitle: `Help manage ${accountName} on SellerQI`,
        intro: `You have been added as a member of the ${accountName} account on SellerQI. Accept the invitation to open the account — there is nothing to fill in.`,
        buttonLabel: 'Accept invitation',
        link: appLink('/member-invite', token),
        note: `This invitation expires in ${INVITE_TTL_DAYS} days. Next time, choose "Log in as a member" on the SellerQI sign-in page and we will email you a sign-in link. If you were not expecting this, you can safely ignore this email.`,
        logLabel: `Member invitation to ${accountName}`,
    });
};

/** Load one of THIS account's members, or answer 400/404 and return null. */
const loadOwnMember = async (req, res) => {
    const { memberId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
        res.status(400).json(new ApiResponse(400, '', 'Invalid member id'));
        return null;
    }
    const member = await AccountMember.findOne({ _id: memberId, owner: req.userId });
    if (!member) {
        res.status(404).json(new ApiResponse(404, '', 'Member not found'));
        return null;
    }
    return member;
};

/* ------------------------------------------------------- account side --- */

/** GET /app/members */
const listMembers = asyncHandler(async (req, res) => {
    const members = await AccountMember.find({ owner: req.userId }).sort({ createdAt: -1 }).lean();
    return res.status(200).json(new ApiResponse(200, members.map((m) => toMemberResponse(m, req.memberId)), 'Members fetched successfully'));
});

/** POST /app/members/invite — body: { email, name? } */
const inviteMember = asyncHandler(async (req, res) => {
    const email = normalize(req.body?.email);
    if (!isValidEmail(email)) {
        return res.status(400).json(new ApiResponse(400, '', 'Enter a valid email address'));
    }

    // One address, one role: never an existing SellerQI user, never a member twice.
    if (await getUserByEmail(email)) {
        return res.status(409).json(new ApiResponse(409, '', 'That email already has its own SellerQI account, so it cannot be added as a member'));
    }
    const existing = await AccountMember.findOne({ email }).select('owner').lean();
    if (existing) {
        const message = String(existing.owner) === String(req.userId)
            ? 'That person has already been invited to this account'
            : 'That email is already a member of another SellerQI account';
        return res.status(409).json(new ApiResponse(409, '', message));
    }
    if (await EsfInvite.exists({ email, status: 'pending' })) {
        return res.status(409).json(new ApiResponse(409, '', 'That email has a pending invitation to another SellerQI portal'));
    }

    const token = newInviteToken();
    const member = await AccountMember.create({
        owner: req.userId,
        email,
        name: cleanName(req.body?.name),
        status: 'pending',
        inviteTokenHash: hashToken(token),
        inviteExpiresAt: inviteExpiry(),
        lastSentAt: new Date(),
    });

    if (!(await sendInviteEmail(req, member, token))) {
        // Do not leave a pending invite nobody received.
        await AccountMember.deleteOne({ _id: member._id });
        return res.status(500).json(new ApiResponse(500, '', 'Could not send the invitation. Please check the address and try again.'));
    }

    logger.info(`Account ${req.userId} invited member ${email}`);
    return res.status(201).json(new ApiResponse(201, toMemberResponse(member), 'Invitation sent'));
});

/** POST /app/members/:memberId/resend — new token, fresh expiry. */
const resendMemberInvite = asyncHandler(async (req, res) => {
    const member = await loadOwnMember(req, res);
    if (!member) return;
    if (member.status !== 'pending') {
        return res.status(400).json(new ApiResponse(400, '', 'This member has already joined'));
    }

    // Rotate the token so a previously shared link stops working.
    const token = newInviteToken();
    member.inviteTokenHash = hashToken(token);
    member.inviteExpiresAt = inviteExpiry();
    member.lastSentAt = new Date();
    await member.save();

    if (!(await sendInviteEmail(req, member, token))) {
        return res.status(500).json(new ApiResponse(500, '', 'Could not resend the invitation. Please try again.'));
    }
    return res.status(200).json(new ApiResponse(200, toMemberResponse(member), 'Invitation resent'));
});

/** PATCH /app/members/:memberId — body: { name } */
const renameMember = asyncHandler(async (req, res) => {
    const member = await loadOwnMember(req, res);
    if (!member) return;
    member.name = cleanName(req.body?.name);
    await member.save();
    return res.status(200).json(new ApiResponse(200, toMemberResponse(member, req.memberId), 'Name updated'));
});

/**
 * DELETE /app/members/:memberId
 * Revokes a pending invite, or removes a member and ends their sessions.
 */
const removeMember = asyncHandler(async (req, res) => {
    const member = await loadOwnMember(req, res);
    if (!member) return;

    // A member can edit their own name but not remove themselves - leaving an
    // account is the owner's call (or another member's).
    if (req.memberId && String(req.memberId) === String(member._id)) {
        return res.status(403).json(new ApiResponse(403, '', 'You cannot remove yourself from this account'));
    }

    // Their sessions live on this row (see createRefreshToken), and every token they
    // hold names them, so deleting the row ends their access on the next request.
    await AccountMember.deleteOne({ _id: member._id });

    logger.info(`Account ${req.userId} removed member ${member.email}`);
    return res.status(200).json(new ApiResponse(200, '', member.status === 'pending' ? 'Invitation revoked' : 'Member removed'));
});

/* ----------------------------------------------------- recipient side --- */

/** GET /app/members/invite/:token — PUBLIC. What the accept page shows. */
const getMemberInvite = asyncHandler(async (req, res) => {
    const member = await AccountMember.findOne({ inviteTokenHash: hashToken(req.params.token) }).lean();
    if (!member) {
        return res.status(404).json(new ApiResponse(404, '', 'This invitation link is not valid. It may have been revoked or already used.'));
    }
    if (member.inviteExpiresAt < new Date()) {
        return res.status(410).json(new ApiResponse(410, '', 'This invitation has expired. Ask for a new one.'));
    }
    return res.status(200).json(new ApiResponse(200, {
        email: member.email,
        accountName: await accountNameFor(member.owner),
    }, 'Invitation is valid'));
});

/**
 * POST /app/members/invite/:token/accept — PUBLIC.
 * Following the emailed link is the acceptance; the member is signed straight in.
 */
const acceptMemberInvite = asyncHandler(async (req, res) => {
    const member = await AccountMember.findOne({ inviteTokenHash: hashToken(req.params.token), status: 'pending' });
    if (!member || member.inviteExpiresAt < new Date()) {
        return res.status(410).json(new ApiResponse(410, '', 'This invitation is no longer valid'));
    }

    // Someone may have registered with this address between invite and accept.
    if (await getUserByEmail(member.email)) {
        await AccountMember.deleteOne({ _id: member._id });
        return res.status(409).json(new ApiResponse(409, '', 'This email now has its own SellerQI account. Sign in normally instead.'));
    }

    member.status = 'active';
    member.acceptedAt = new Date();
    member.inviteTokenHash = null;
    member.inviteExpiresAt = null;
    await member.save();

    const session = await issueMemberSession(member, res);
    if (!session.ok) return res.status(session.status).json(new ApiResponse(session.status, '', session.message));

    logger.info(`Member invitation accepted by ${member.email} for account ${member.owner}`);
    return res.status(200).json(new ApiResponse(200, { accountName: await accountNameFor(member.owner) }, 'Welcome'));
});

/**
 * POST /app/members/login-link — PUBLIC. Body: { email }
 * Same answer whether or not the address is a member, so it cannot be probed.
 */
const requestMemberLoginLink = asyncHandler(async (req, res) => {
    const email = normalize(req.body?.email);
    if (!isValidEmail(email)) {
        return res.status(400).json(new ApiResponse(400, '', 'Enter a valid email address'));
    }

    const member = await AccountMember.findOne({ email, status: 'active' }).lean();
    if (!member) {
        logger.info(`Member sign-in link requested for a non-member address: ${email}`);
        return res.status(200).json(new ApiResponse(200, '', LINK_SENT_MESSAGE));
    }

    const accountName = (await accountNameFor(member.owner)) || 'your SellerQI account';
    const token = await LoginLink.issue('member', email);
    const sent = await sendAuthLinkEmail({
        email,
        subject: `Your sign-in link for ${accountName} on SellerQI`,
        title: 'Sign in to SellerQI',
        subtitle: `Member of ${accountName}`,
        intro: 'Use the button below to sign in. The link works once and expires in 15 minutes.',
        buttonLabel: 'Sign in',
        link: appLink('/member-login/verify', token),
        note: 'If you did not ask to sign in, you can safely ignore this email — nobody can sign in without this link.',
        logLabel: `Member sign-in link for ${accountName}`,
    });

    if (!sent) {
        return res.status(500).json(new ApiResponse(500, '', 'Could not send the sign-in link. Please try again.'));
    }
    return res.status(200).json(new ApiResponse(200, '', LINK_SENT_MESSAGE));
});

/** POST /app/members/login-link/verify — PUBLIC. Body: { token } */
const verifyMemberLoginLink = asyncHandler(async (req, res) => {
    const email = await LoginLink.consume('member', req.body?.token);
    if (!email) {
        return res.status(410).json(new ApiResponse(410, '', 'This sign-in link is invalid, expired or already used. Request a new one.'));
    }

    const member = await AccountMember.findOne({ email, status: 'active' });
    if (!member) {
        return res.status(403).json(new ApiResponse(403, '', 'You are no longer a member of this account'));
    }

    const session = await issueMemberSession(member, res);
    if (!session.ok) return res.status(session.status).json(new ApiResponse(session.status, '', session.message));

    return res.status(200).json(new ApiResponse(200, { accountName: await accountNameFor(member.owner) }, 'Login successful'));
});

module.exports = {
    listMembers,
    inviteMember,
    resendMemberInvite,
    renameMember,
    removeMember,
    getMemberInvite,
    acceptMemberInvite,
    requestMemberLoginLink,
    verifyMemberLoginLink,
};
