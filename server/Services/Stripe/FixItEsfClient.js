/**
 * A Fix it buyer is an ESF client while the team works on their tasks.
 *
 *   enroll   — on a paid Fix it period: an account that is not an ESF client becomes one
 *              (esfViaFixIt marks that the purchase did it); every buyer gets fixItHistory.
 *   release  — when no Fix it engagement of theirs is still running (a Trial finished, a
 *              subscription ended): an account the PURCHASE made an ESF client goes back to
 *              a normal seller. One a staff member added stays an ESF client.
 *
 * Their history stays either way: the Zoho project link, purchases, the subtasks and the
 * "Done by ESF team" marks — and fixItHistory keeps the Status page open to them.
 */
const UserModel = require('../../models/user-auth/userModel.js');
const FixItWorkOrder = require('../../models/system/FixItWorkOrderModel.js');
const logger = require('../../utils/Logger.js');

const enroll = async (userId) => {
    await UserModel.updateOne({ _id: userId, fixItHistory: { $ne: true } }, { $set: { fixItHistory: true } });
    const made = await UserModel.updateOne(
        { _id: userId, isEsfClient: { $ne: true } },
        { $set: { isEsfClient: true, esfViaFixIt: true, esfAddedBy: null } }
    );
    if (made.modifiedCount) logger.info(`[FixItEsfClient] ${userId} is now an ESF client (Fix it purchase)`);
    return Boolean(made.modifiedCount);
};

const release = async (userId) => {
    const running = await FixItWorkOrder.exists({ userId, status: { $in: ['active', 'ending'] } });
    if (running) return false;
    const dropped = await UserModel.updateOne(
        { _id: userId, isEsfClient: true, esfViaFixIt: true },
        { $set: { isEsfClient: false, esfViaFixIt: false } }
    );
    if (dropped.modifiedCount) logger.info(`[FixItEsfClient] ${userId} is a normal seller again (Fix it ended; history kept)`);
    return Boolean(dropped.modifiedCount);
};

module.exports = { enroll, release };
