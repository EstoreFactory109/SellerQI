const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * A pending invitation to join the ESF staff portal.
 *
 * Staff are no longer created directly with a password set by whoever added
 * them. Instead the owner/admin sends an invite to an email address; the
 * recipient follows the link and fills in their own name, phone and password.
 *
 * The email is fixed at invite time and can never be changed by the recipient —
 * it is the whole point of the invitation. The role is a starting value and the
 * owner/admin can change it afterwards from the members page.
 *
 * Kept in its own collection rather than on the User document because an invite
 * has no user yet, and because a revoked or expired invite should leave nothing
 * behind on an account.
 */
const esfInviteSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            // Indexed by the partial-unique index below, not here — declaring
            // both makes Mongoose warn about a duplicate index.
        },
        /** Starting role. 'owner' is never invitable — there is exactly one, seeded. */
        role: {
            type: String,
            enum: ['admin', 'member'],
            default: 'member',
        },
        /** Random secret in the invite URL. Unique so a lookup can never be ambiguous. */
        token: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        invitedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'revoked'],
            default: 'pending',
            index: true,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
        lastSentAt: {
            type: Date,
            default: Date.now,
        },
        acceptedAt: {
            type: Date,
            default: null,
        },
        /** The staff account created when the invite was accepted. */
        acceptedUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

// Only ONE outstanding invite per address. Accepted and revoked rows are kept
// for history, so the constraint is scoped to pending ones.
esfInviteSchema.index(
    { email: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } }
);

/** 128 bits of randomness, URL-safe. */
esfInviteSchema.statics.generateToken = function generateToken() {
    return crypto.randomBytes(32).toString('hex');
};

esfInviteSchema.methods.isUsable = function isUsable() {
    return this.status === 'pending' && this.expiresAt > new Date();
};

const EsfInvite = mongoose.models.EsfInvite || mongoose.model('EsfInvite', esfInviteSchema);
module.exports = EsfInvite;
