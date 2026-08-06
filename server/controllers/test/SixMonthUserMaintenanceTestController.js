const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');

const User = require('../../models/user-auth/userModel.js');

const {
    sendSixMonthAccountWarning,
} = require('../../Services/Email/SendSixMonthAccountWarning.js');
const { sendAccountSuspendedEmail } = require('../../Services/Email/SendAccountSuspendedEmail.js');
const { resolveRecipientEmail } = require('../../Services/Email/resolveRecipientEmail.js');

const {
    isEligibleForWarning,
    isEligibleForDeletion,
    isUserConnectedToSpApiOrAds,
    resolveEffectiveLiteSince,
    getDaysUntilSixMonthMark,
} = require('../../Services/BackgroundJobs/SixMonthUserMaintenanceService.js');

const { deleteUserById } = require('../../Services/User/deleteUserService.js');
const { enqueueFullUserDataPurge } = require('../../Services/BackgroundJobs/deleteUserQueue.js');

const USER_SELECT_FIELDS =
    'firstName lastName email createdAt packageType subscriptionStatus isVerified isAgencyClient agencyId purgedAt sixMonthWarningSentAt';

/**
 * Test endpoint: evaluate and optionally send the 6‑month warning email
 * for a single user. Uses the exact same isEligibleForWarning predicate as
 * the production cron job, so this can never drift from real behavior.
 *
 * Route: POST /api/test/six-month-maintenance/user/:userId/warning
 *
 * Body (optional):
 * {
 *   "send": true | false   // default true; if false, only returns evaluation (dry run)
 * }
 */
const testSixMonthWarningForUser = asyncHandler(async (req, res) => {
    const userId = req.params.userId || req.body.userId;
    const { send = true } = req.body || {};

    if (!userId) {
        return res
            .status(400)
            .json(new ApiResponse(400, null, 'userId is required (path param or body)'));
    }

    const user = await User.findById(userId).select(USER_SELECT_FIELDS).lean();

    if (!user) {
        return res.status(404).json(new ApiResponse(404, null, 'User not found'));
    }

    const now = new Date();
    const effectiveLiteSince = await resolveEffectiveLiteSince(user);
    const decoratedUser = { ...user, effectiveLiteSince };
    const daysUntilSixMonths = getDaysUntilSixMonthMark(effectiveLiteSince, now);
    const connected = await isUserConnectedToSpApiOrAds(user._id);
    const matchesServiceCriteria = isEligibleForWarning(decoratedUser, now);

    let emailMessageId = null;
    let emailSent = false;
    let emailError = null;

    if (send && matchesServiceCriteria) {
        const result = await sendSixMonthAccountWarning({
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            userId: user._id.toString(),
            registeredAt: user.createdAt,
        });
        emailSent = !!result?.success;
        emailMessageId = result?.messageId || null;
        if (result && !result.success && result.error) {
            emailError = result.error;
        }

        // Mirror production behavior: only mark as warned on a confirmed send
        if (emailSent) {
            await User.updateOne({ _id: user._id }, { $set: { sixMonthWarningSentAt: now } });
        }
    }

    logger.info('[SixMonthUserMaintenanceTest] Six-month warning evaluation for user', {
        userId: user._id.toString(),
        email: user.email,
        daysUntilSixMonths,
        matchesServiceCriteria,
        sendRequested: !!send,
        emailSent,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                user: {
                    id: user._id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    createdAt: user.createdAt,
                    packageType: user.packageType,
                    subscriptionStatus: user.subscriptionStatus,
                    isVerified: user.isVerified,
                    isAgencyClient: user.isAgencyClient,
                    agencyId: user.agencyId,
                    purgedAt: user.purgedAt,
                    sixMonthWarningSentAt: user.sixMonthWarningSentAt,
                },
                effectiveLiteSince,
                daysUntilSixMonths,
                isConnectedToSpApiOrAds: connected,
                matchesServiceCriteria,
                sendRequested: !!send,
                emailSent,
                emailMessageId,
                ...(emailError && { emailError }),
            },
            'Six-month warning evaluation completed'
        )
    );
});

/**
 * Test endpoint: evaluate and optionally purge a single user using the
 * exact same isEligibleForDeletion predicate as the production cron job.
 *
 * Route: POST /api/test/six-month-maintenance/user/:userId/delete
 *
 * Body (optional):
 * {
 *   "force": true | false   // default false; if true, purge even if criteria don't fully match
 * }
 */
const testDeleteStaleLiteUser = asyncHandler(async (req, res) => {
    const userId = req.params.userId || req.body.userId;
    const { force = false } = req.body || {};

    if (!userId) {
        return res
            .status(400)
            .json(new ApiResponse(400, null, 'userId is required (path param or body)'));
    }

    const user = await User.findById(userId).select(USER_SELECT_FIELDS).lean();

    if (!user) {
        return res.status(404).json(new ApiResponse(404, null, 'User not found'));
    }

    const now = new Date();
    const matchesServiceCriteria = isEligibleForDeletion(user, now);

    let deleted = false;
    let purgeEnqueued = false;
    let suspensionEmailSent = false;
    let suspensionEmailError = null;

    if (matchesServiceCriteria || force) {
        const userEmail = await resolveRecipientEmail(user.email, user._id);
        const userFirstName = user.firstName;
        const userLastName = user.lastName;
        const userIdStr = user._id.toString();

        // Soft-delete: Seller removed, User document retained
        try {
            await deleteUserById(userIdStr);
            deleted = true;
        } catch (err) {
            logger.error(
                '[SixMonthUserMaintenanceTest] Error deleting user via deleteUserById',
                err
            );
        }

        if (deleted) {
            try {
                await enqueueFullUserDataPurge(userIdStr);
                purgeEnqueued = true;
            } catch (enqueueErr) {
                logger.error(
                    '[SixMonthUserMaintenanceTest] Failed to enqueue full user data purge for user',
                    { userId: userIdStr, error: enqueueErr?.message }
                );
            }
        }

        try {
            const emailResult = await sendAccountSuspendedEmail({
                email: userEmail,
                firstName: userFirstName,
                lastName: userLastName,
            });
            suspensionEmailSent = !!emailResult?.success;
            if (emailResult && !emailResult.success && emailResult.error) {
                suspensionEmailError = emailResult.error;
            }
        } catch (emailErr) {
            suspensionEmailError = emailErr?.message || String(emailErr);
            logger.warn('[SixMonthUserMaintenanceTest] Suspension email failed:', emailErr);
        }
    }

    logger.info('[SixMonthUserMaintenanceTest] Delete evaluation for user', {
        userId: user._id.toString(),
        email: user.email,
        matchesServiceCriteria,
        force: !!force,
        deleted,
        purgeEnqueued,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                user: {
                    id: user._id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    createdAt: user.createdAt,
                    packageType: user.packageType,
                    subscriptionStatus: user.subscriptionStatus,
                    isVerified: user.isVerified,
                    isAgencyClient: user.isAgencyClient,
                    agencyId: user.agencyId,
                    purgedAt: user.purgedAt,
                    sixMonthWarningSentAt: user.sixMonthWarningSentAt,
                },
                matchesServiceCriteria,
                force: !!force,
                deleted,
                purgeEnqueued,
                suspensionEmailSent,
                ...(suspensionEmailError && { suspensionEmailError }),
            },
            'Six-month LITE cleanup evaluation completed'
        )
    );
});

module.exports = {
    testSixMonthWarningForUser,
    testDeleteStaleLiteUser,
};
