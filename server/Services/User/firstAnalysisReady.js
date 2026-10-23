/**
 * What happens when a user's data fetch finishes successfully: unlock the dashboard, and send
 * the "your analysis is ready" email the first time.
 *
 * WHY THIS EXISTS. Integration.handleSuccess and ScheduledIntegration.handleSuccess carried
 * identical copies that set FirstAnalysisDone ONLY after the email was sent. A failed send (mail
 * provider down, bounced address) or a user without an email or first name on record left the
 * seller on the "analysing your account" screen with their data already there. The flag now
 * follows the data; the email is best-effort.
 *
 * analyseAccountSuccess === 1 still means "the ready email is owed". It is cleared only once the
 * email actually goes out, so a failed send is retried after the next successful fetch — and the
 * dashboard no longer waits for it.
 */
const userModel = require('../../models/user-auth/userModel.js');
const { sendAnalysisReadyEmail } = require('../Email/SendAnalysisReadyEmail.js');
const { markFirstAnalysisDone } = require('./userServices.js');
const logger = require('../../utils/Logger.js');

const completeFirstAnalysis = async (userId) => {
    const userInfo = await userModel.findById(userId).select('analyseAccountSuccess email firstName');
    if (!userInfo || userInfo.analyseAccountSuccess !== 1) return { marked: false, emailSent: false };

    // The data is ready whether or not the email goes out.
    const marked = await markFirstAnalysisDone(userId);

    let emailSent = false;
    if (userInfo.email && userInfo.firstName) {
        try {
            const dashboardUrl = process.env.DASHBOARD_URL || `${process.env.CLIENT_BASE_URL}/dashboard`;
            emailSent = Boolean(await sendAnalysisReadyEmail(userInfo.email, userInfo.firstName, dashboardUrl));
        } catch (error) {
            logger.error('Error sending analysis ready email', { error: error.message, userId });
        }
    }

    if (emailSent) {
        userInfo.analyseAccountSuccess = 0;
        await userInfo.save();
    } else {
        logger.warn(`Analysis ready email not sent for user ${userId}; dashboard unlocked anyway, email retried after the next successful fetch`);
    }

    return { marked, emailSent };
};

module.exports = { completeFirstAnalysis };
