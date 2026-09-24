const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * A single-use "sign in with an emailed link" token.
 *
 * Used where an account has no password by design:
 *   'esf'    - ESF staff who joined from an invitation
 *   'member' - members of a seller account (see AccountMemberModel)
 *
 * Only the SHA-256 of the token is stored, so a database read does not hand out
 * working sign-in links. Rows delete themselves once expired (TTL index).
 */
const LOGIN_LINK_TTL_MINUTES = 15;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const loginLinkSchema = new mongoose.Schema(
    {
        purpose: {
            type: String,
            enum: ['esf', 'member'],
            required: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        tokenHash: {
            type: String,
            required: true,
            unique: true,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
        usedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

loginLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Create a link for this address. Earlier unused links for the same address and
 * purpose are dropped, so only the newest email works.
 * @returns {Promise<string>} the raw token, for the emailed URL
 */
loginLinkSchema.statics.issue = async function issue(purpose, email) {
    const token = crypto.randomBytes(32).toString('hex');
    await this.deleteMany({ purpose, email, usedAt: null });
    await this.create({
        purpose,
        email,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + LOGIN_LINK_TTL_MINUTES * 60 * 1000),
    });
    return token;
};

/**
 * Spend a token. Atomic, so the same link clicked twice (or prefetched and then
 * clicked) signs in at most once.
 * @returns {Promise<string|null>} the email it was issued to, or null
 */
loginLinkSchema.statics.consume = async function consume(purpose, token) {
    if (!token || typeof token !== 'string') return null;
    const link = await this.findOneAndUpdate(
        { purpose, tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { new: true }
    );
    return link ? link.email : null;
};

const LoginLink = mongoose.models.LoginLink || mongoose.model('LoginLink', loginLinkSchema);
module.exports = LoginLink;
module.exports.LOGIN_LINK_TTL_MINUTES = LOGIN_LINK_TTL_MINUTES;
module.exports.hashToken = hashToken;
