/**
 * Signing a member into the account they belong to.
 *
 * A member session is the owner's session — the same IBEX* cookies a normal login
 * sets for the owner, so every page and endpoint works unchanged — except that the
 * tokens also name the member (createAccessToken/createRefreshToken's memberId).
 * auth.js refuses a token whose member has been removed, and the member's refresh
 * tokens are kept on the member, not the owner (see utils/Tokens.js).
 */
const UserModel = require('../../models/user-auth/userModel.js');
const SellerCentralModel = require('../../models/user-auth/sellerCentralModel.js');
const AccountMember = require('../../models/user-auth/AccountMemberModel.js');
const { createAccessToken, createRefreshToken, createLocationToken } = require('../../utils/Tokens.js');
const { getHttpsCookieOptions } = require('../../utils/cookieConfig.js');
const logger = require('../../utils/Logger.js');

/** The owner's account name as a member would recognise it. */
const accountNameFor = async (ownerId) => {
    const [owner, seller] = await Promise.all([
        UserModel.findById(ownerId).select('firstName lastName email').lean(),
        SellerCentralModel.findOne({ User: ownerId }).select('brand').lean(),
    ]);
    if (!owner) return null;
    return seller?.brand || `${owner.firstName || ''} ${owner.lastName || ''}`.trim() || owner.email;
};

/**
 * Mint the owner's session for this member and set the cookies on `res`.
 * @returns {Promise<{ok: true} | {ok: false, status: number, message: string}>}
 */
const issueMemberSession = async (member, res) => {
    const owner = await UserModel.findById(member.owner).select('_id');
    if (!owner) {
        // The account they belonged to is gone, so the membership is meaningless.
        await AccountMember.deleteOne({ _id: member._id });
        return { ok: false, status: 404, message: 'The account you were a member of no longer exists' };
    }

    const sellerCentral = await SellerCentralModel.findOne({ User: owner._id }).select('sellerAccount').lean();
    const firstAccount = sellerCentral?.sellerAccount?.[0];

    const tokenOptions = { memberId: member._id };
    const accessToken = await createAccessToken(owner._id, tokenOptions);
    const refreshToken = await createRefreshToken(owner._id, tokenOptions);
    const locationToken = firstAccount
        ? await createLocationToken(firstAccount.country, firstAccount.region)
        : await createLocationToken('US', 'NA');

    if (!accessToken || !refreshToken || !locationToken) {
        logger.error(`Failed to create a member session for ${member.email}`);
        return { ok: false, status: 500, message: 'Could not sign you in. Please try again.' };
    }

    await AccountMember.updateOne({ _id: member._id }, { $set: { lastLoginAt: new Date() } });

    const options = getHttpsCookieOptions();
    res
        .cookie('IBEXAccessToken', accessToken, options)
        .cookie('IBEXRefreshToken', refreshToken, options)
        .cookie('IBEXLocationToken', locationToken, options);

    logger.info(`Member ${member.email} signed in to account ${owner._id}`);
    return { ok: true };
};

module.exports = { accountNameFor, issueMemberSession };
