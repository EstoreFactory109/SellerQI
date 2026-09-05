/**
 * Multiple email addresses per user.
 *
 * A user keeps ONE primary address (`email`) — it stays the unique login key and
 * everything that already reads `user.email` keeps working. On top of that they
 * can add extra addresses, each verified by a code before it is used.
 *
 * Two independent switches per address:
 *   - verified      : has the owner proved they control it?
 *   - receivesMail  : should broadcast mail go there?
 *
 * The primary address has its own `primaryReceivesMail` flag so it can be muted
 * like any other, while remaining the login identity.
 *
 * Deliberate exception: a password-reset link always goes to the exact address
 * the user typed, muted or not — otherwise muting an address would lock you out
 * of recovering the account through it.
 */
const UserModel = require('../../models/user-auth/userModel.js');
const logger = require('../../utils/Logger.js');

/** Guard-rail so one account cannot fan a mailing out to dozens of addresses. */
const MAX_ADDITIONAL_EMAILS = 5;

/** Minutes a verification code stays valid. */
const VERIFICATION_TTL_MINUTES = 15;

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

/**
 * Find a user by ANY of their addresses — primary, or a verified additional one.
 *
 * Unverified additional addresses are excluded on purpose: until ownership is
 * proven, an address must not be usable to sign in or to recover the account.
 *
 * @param {string} email
 * @param {object} [options]
 * @param {boolean} [options.withPassword] include the password hash (login paths)
 */
const findUserByAnyEmail = async (email, { withPassword = false } = {}) => {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;

    const query = UserModel.findOne({
        $or: [
            { email: normalized },
            { additionalEmails: { $elemMatch: { email: normalized, isVerified: true } } },
        ],
    });

    if (withPassword) query.select('+password');
    return query;
};

/**
 * Every address that should receive broadcast mail for this user.
 * Returns [] only if the caller has muted everything, which the API prevents.
 */
const getMailRecipients = (user) => {
    if (!user) return [];

    const recipients = [];
    if (user.primaryReceivesMail !== false && user.email) {
        recipients.push(normalizeEmail(user.email));
    }

    (user.additionalEmails || []).forEach((entry) => {
        if (entry?.isVerified && entry?.receivesMail !== false && entry.email) {
            recipients.push(normalizeEmail(entry.email));
        }
    });

    return [...new Set(recipients)];
};

/**
 * Is this address free to attach to `userId`?
 *
 * Checks against every OTHER user's primary and additional addresses, and
 * against this user's own list. Enforced here rather than with a unique index:
 * a multikey unique index across a live collection where most documents have an
 * empty array is a migration risk that buys little over an explicit check.
 */
const assertEmailAvailable = async (email, userId) => {
    const normalized = normalizeEmail(email);

    if (!isValidEmail(normalized)) {
        return { ok: false, status: 400, message: 'Please enter a valid email address' };
    }

    const owner = await UserModel.findOne({
        $or: [{ email: normalized }, { 'additionalEmails.email': normalized }],
    }).select('_id email additionalEmails').lean();

    if (owner) {
        if (String(owner._id) === String(userId)) {
            return {
                ok: false,
                status: 409,
                message: normalized === normalizeEmail(owner.email)
                    ? 'This is already your primary email'
                    : 'You have already added this email',
            };
        }
        return { ok: false, status: 409, message: 'This email is already in use on another account' };
    }

    return { ok: true };
};

/** Six-digit code, matching the format used elsewhere in the app. */
const generateVerificationCode = () => String(Math.floor(100000 + Math.random() * 900000));

const verificationExpiry = () => new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60 * 1000);

/**
 * Shape the address list for the profile page. Codes are never included.
 * The primary is returned first and flagged, so the UI renders one list.
 */
const toEmailListResponse = (user) => {
    const primary = {
        email: normalizeEmail(user.email),
        isPrimary: true,
        isVerified: true, // the login address is verified by definition
        receivesMail: user.primaryReceivesMail !== false,
        addedAt: user.createdAt || null,
    };

    const additional = (user.additionalEmails || []).map((entry) => ({
        email: normalizeEmail(entry.email),
        isPrimary: false,
        isVerified: !!entry.isVerified,
        receivesMail: entry.receivesMail !== false,
        addedAt: entry.addedAt || null,
    }));

    return [primary, ...additional];
};

/**
 * How many addresses would still receive mail if `email` were muted?
 * Used to refuse muting the last one — a user with zero recipients silently
 * stops receiving alerts with nothing on screen to explain why.
 */
const countRecipientsWithout = (user, email) => {
    const normalized = normalizeEmail(email);
    return getMailRecipients(user).filter((addr) => addr !== normalized).length;
};

module.exports = {
    MAX_ADDITIONAL_EMAILS,
    VERIFICATION_TTL_MINUTES,
    normalizeEmail,
    isValidEmail,
    findUserByAnyEmail,
    getMailRecipients,
    assertEmailAvailable,
    generateVerificationCode,
    verificationExpiry,
    toEmailListResponse,
    countRecipientsWithout,
    logger,
};
