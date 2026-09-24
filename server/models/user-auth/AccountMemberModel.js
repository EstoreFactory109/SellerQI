const mongoose = require('mongoose');

/**
 * A person the owner of a seller account has invited to help run it.
 *
 * A member is NOT a User. They have no password, no plan and no data of their own:
 * signing in as a member opens the owner's account (the owner's IBEX session) with
 * full access. Their tokens also name the member, so removing them - deleting this
 * row - ends their access on the next request (see utils/Tokens.js, auth.js).
 *
 * One address belongs to at most one account, and never to an existing SellerQI
 * user — hence the plain unique index on email. Revoking an invite or removing a
 * member deletes the row, so the address is free to be invited again.
 */
const accountMemberSchema = new mongoose.Schema(
    {
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        /** Optional display name set by whoever invited them. */
        name: {
            type: String,
            trim: true,
            maxlength: 50,
            default: null,
        },
        status: {
            type: String,
            enum: ['pending', 'active'],
            default: 'pending',
        },
        /** SHA-256 of the invitation token; cleared once accepted. */
        inviteTokenHash: {
            type: String,
            default: null,
            index: { unique: true, partialFilterExpression: { inviteTokenHash: { $type: 'string' } } },
        },
        inviteExpiresAt: {
            type: Date,
            default: null,
        },
        lastSentAt: {
            type: Date,
            default: null,
        },
        acceptedAt: {
            type: Date,
            default: null,
        },
        lastLoginAt: {
            type: Date,
            default: null,
        },
        /**
         * This member's signed-in sessions. Kept here rather than on the owner so
         * member sign-ins never push the owner's own devices out of their session
         * limit, and so deleting the row ends them all.
         */
        refreshTokens: {
            type: [String],
            default: [],
            select: false,
        },
    },
    { timestamps: true }
);

const AccountMember = mongoose.models.AccountMember || mongoose.model('AccountMember', accountMemberSchema);
module.exports = AccountMember;
