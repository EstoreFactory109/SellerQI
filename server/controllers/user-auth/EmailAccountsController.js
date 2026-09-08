/**
 * Manage the email addresses on a user account.
 *
 * A user keeps one primary (login) address and can add more from their profile.
 * Each added address is verified by a code before it is used, after which it
 * receives mail and can also be used to sign in.
 */
const UserModel = require('../../models/user-auth/userModel.js');
const { sendEmail } = require('../../Services/Email/SendOtp.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const {
    MAX_ADDITIONAL_EMAILS,
    VERIFICATION_TTL_MINUTES,
    normalizeEmail,
    assertEmailAvailable,
    generateVerificationCode,
    verificationExpiry,
    toEmailListResponse,
    countRecipientsWithout,
} = require('../../Services/User/emailAccounts.js');

/** Codes must go to the address being verified — never fanned out or redirected. */
const PIN_TO_ADDRESS = { fanOut: false, agencyRedirect: false };

/** GET /app/emails — every address on the account, primary first. */
const listEmails = asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.userId).select('email additionalEmails primaryReceivesMail createdAt');
    if (!user) return res.status(404).json(new ApiResponse(404, '', 'User not found'));

    return res.status(200).json(new ApiResponse(200, {
        emails: toEmailListResponse(user),
        maxAdditional: MAX_ADDITIONAL_EMAILS,
    }, 'Emails fetched successfully'));
});

/**
 * POST /app/emails — add an address and send it a verification code.
 * The address receives nothing until the code is confirmed.
 */
const addEmail = asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    const user = await UserModel.findById(req.userId).select('email firstName additionalEmails primaryReceivesMail createdAt');
    if (!user) return res.status(404).json(new ApiResponse(404, '', 'User not found'));

    if ((user.additionalEmails || []).length >= MAX_ADDITIONAL_EMAILS) {
        return res.status(400).json(new ApiResponse(400, '', `You can add up to ${MAX_ADDITIONAL_EMAILS} extra email addresses`));
    }

    const available = await assertEmailAvailable(email, req.userId);
    if (!available.ok) {
        return res.status(available.status).json(new ApiResponse(available.status, '', available.message));
    }

    const code = generateVerificationCode();
    user.additionalEmails.push({
        email,
        isVerified: false,
        receivesMail: true, // default on, so it works as soon as it is verified
        verificationCode: code,
        verificationExpiresAt: verificationExpiry(),
        addedAt: new Date(),
    });
    await user.save();

    const sent = await sendEmail(email, user.firstName, code, req.userId, PIN_TO_ADDRESS);
    if (!sent) {
        // Do not keep an address we could not reach — it would sit unverifiable.
        user.additionalEmails = user.additionalEmails.filter((e) => normalizeEmail(e.email) !== email);
        await user.save();
        logger.error(new ApiError(500, `Failed to send verification code to ${email}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not send the verification code. Please check the address and try again.'));
    }

    logger.info(`User ${req.userId} added email ${email} (pending verification)`);
    return res.status(201).json(new ApiResponse(201, {
        emails: toEmailListResponse(user),
        pendingEmail: email,
        expiresInMinutes: VERIFICATION_TTL_MINUTES,
    }, 'Verification code sent'));
});

/** POST /app/emails/verify — confirm ownership with the emailed code. */
const verifyEmail = asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();

    if (!email || !code) {
        return res.status(400).json(new ApiResponse(400, '', 'Email and verification code are required'));
    }

    // verificationCode is select:false — ask for it explicitly.
    // Only the normally-excluded code is added; the rest of the document comes
    // back as usual. Combining this with an inclusive projection would clash.
    const user = await UserModel.findById(req.userId).select('+additionalEmails.verificationCode');
    if (!user) return res.status(404).json(new ApiResponse(404, '', 'User not found'));

    const entry = (user.additionalEmails || []).find((e) => normalizeEmail(e.email) === email);
    if (!entry) return res.status(404).json(new ApiResponse(404, '', 'That email is not on your account'));
    if (entry.isVerified) {
        return res.status(400).json(new ApiResponse(400, '', 'This email is already verified'));
    }

    if (!entry.verificationExpiresAt || entry.verificationExpiresAt < new Date()) {
        return res.status(400).json(new ApiResponse(400, '', 'That code has expired. Please request a new one.'));
    }

    if (String(entry.verificationCode) !== code) {
        logger.warn(`User ${req.userId} submitted an incorrect verification code for ${email}`);
        return res.status(400).json(new ApiResponse(400, '', 'That code is not correct'));
    }

    entry.isVerified = true;
    entry.verificationCode = null;
    entry.verificationExpiresAt = null;
    await user.save();

    logger.info(`User ${req.userId} verified email ${email}`);
    return res.status(200).json(new ApiResponse(200, { emails: toEmailListResponse(user) }, 'Email verified successfully'));
});

/** POST /app/emails/resend — issue a fresh code for a pending address. */
const resendVerification = asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    const user = await UserModel.findById(req.userId).select('+additionalEmails.verificationCode');
    if (!user) return res.status(404).json(new ApiResponse(404, '', 'User not found'));

    const entry = (user.additionalEmails || []).find((e) => normalizeEmail(e.email) === email);
    if (!entry) return res.status(404).json(new ApiResponse(404, '', 'That email is not on your account'));
    if (entry.isVerified) {
        return res.status(400).json(new ApiResponse(400, '', 'This email is already verified'));
    }

    const code = generateVerificationCode();
    entry.verificationCode = code;
    entry.verificationExpiresAt = verificationExpiry();
    await user.save();

    const sent = await sendEmail(email, user.firstName, code, req.userId, PIN_TO_ADDRESS);
    if (!sent) {
        return res.status(500).json(new ApiResponse(500, '', 'Could not send the verification code. Please try again.'));
    }

    return res.status(200).json(new ApiResponse(200, { expiresInMinutes: VERIFICATION_TTL_MINUTES }, 'Verification code resent'));
});

/**
 * PATCH /app/emails/preferences — switch an address on or off for mail.
 * Works for the primary address too. Body: { email, receivesMail }
 */
const updateEmailPreference = asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const { receivesMail } = req.body;

    if (typeof receivesMail !== 'boolean') {
        return res.status(400).json(new ApiResponse(400, '', 'receivesMail must be true or false'));
    }

    const user = await UserModel.findById(req.userId).select('email additionalEmails primaryReceivesMail createdAt');
    if (!user) return res.status(404).json(new ApiResponse(404, '', 'User not found'));

    const isPrimary = normalizeEmail(user.email) === email;
    const entry = isPrimary ? null : (user.additionalEmails || []).find((e) => normalizeEmail(e.email) === email);

    if (!isPrimary && !entry) {
        return res.status(404).json(new ApiResponse(404, '', 'That email is not on your account'));
    }
    if (entry && !entry.isVerified) {
        return res.status(400).json(new ApiResponse(400, '', 'Verify this email before choosing whether it receives mail'));
    }

    // Refuse to leave the account with nowhere to send. A user with every
    // address muted stops receiving alerts with nothing on screen to explain it.
    if (receivesMail === false && countRecipientsWithout(user, email) === 0) {
        return res.status(400).json(new ApiResponse(400, '', 'At least one email must keep receiving mail'));
    }

    if (isPrimary) user.primaryReceivesMail = receivesMail;
    else entry.receivesMail = receivesMail;
    await user.save();

    logger.info(`User ${req.userId} set ${email} receivesMail=${receivesMail}`);
    return res.status(200).json(new ApiResponse(200, { emails: toEmailListResponse(user) }, 'Email preferences updated'));
});

/** DELETE /app/emails — remove an additional address. Body: { email } */
const removeEmail = asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email || req.query?.email);

    const user = await UserModel.findById(req.userId).select('email additionalEmails primaryReceivesMail createdAt');
    if (!user) return res.status(404).json(new ApiResponse(404, '', 'User not found'));

    if (normalizeEmail(user.email) === email) {
        return res.status(400).json(new ApiResponse(400, '', 'Your primary email cannot be removed'));
    }

    const before = (user.additionalEmails || []).length;
    user.additionalEmails = (user.additionalEmails || []).filter((e) => normalizeEmail(e.email) !== email);
    if (user.additionalEmails.length === before) {
        return res.status(404).json(new ApiResponse(404, '', 'That email is not on your account'));
    }

    // Removing the last enabled recipient would mute the account entirely.
    if (user.primaryReceivesMail === false && countRecipientsWithout(user, null) === 0) {
        user.primaryReceivesMail = true;
        logger.info(`User ${req.userId} removed their last active recipient — primary re-enabled`);
    }

    await user.save();

    logger.info(`User ${req.userId} removed email ${email}`);
    return res.status(200).json(new ApiResponse(200, { emails: toEmailListResponse(user) }, 'Email removed successfully'));
});

module.exports = {
    listEmails,
    addEmail,
    verifyEmail,
    resendVerification,
    updateEmailPreference,
    removeEmail,
};
