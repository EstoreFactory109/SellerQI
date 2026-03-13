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
    isUserConnectedToSpApiOrAds,
    hasActiveSubscription,
    addMonths,
} = require('../../Services/BackgroundJobs/SixMonthUserMaintenanceService.js');

const { deleteUserById } = require('../../Services/User/deleteUserService.js');
const { enqueueFullUserDataPurge } = require('../../Services/BackgroundJobs/deleteUserQueue.js');

/**
 * Test endpoint: evaluate and optionally send the 6‑month warning email
 * for a single user.
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

    const user = await User.findById(userId).select(
        'firstName lastName email createdAt packageType subscriptionStatus isVerified'
    );

    if (!user) {
        return res.status(404).json(new ApiResponse(404, null, 'User not found'));
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const createdAt = new Date(user.createdAt);
    const sixMonthsFromCreated = addMonths(createdAt, 6);
    sixMonthsFromCreated.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil(
        (sixMonthsFromCreated.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
    );

    const [connected, activeSub] = await Promise.all([
        isUserConnectedToSpApiOrAds(user._id),
        hasActiveSubscription(user._id),
    ]);

    const matchesServiceCriteria = diffDays === 2 && (!connected || !activeSub);

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
    }

    logger.info('[SixMonthUserMaintenanceTest] Six-month warning evaluation for user', {
        userId: user._id.toString(),
        email: user.email,
        diffDays,
        connected,
        activeSub,
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
                },
                sixMonthDate: sixMonthsFromCreated,
                daysUntilSixMonths: diffDays,
                isConnectedToSpApiOrAds: connected,
                hasActiveSubscription: activeSub,
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
 * Test endpoint: evaluate and optionally delete a single user using
 * the same rules as the 6+ month LITE cleanup service.
 *
 * Route: POST /api/test/six-month-maintenance/user/:userId/delete
 *
 * Body (optional):
 * {
 *   "force": true | false   // default false; if true, delete even if criteria don't fully match
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

    const user = await User.findById(userId).select(
        'firstName lastName email createdAt packageType subscriptionStatus isVerified'
    );

    if (!user) {
        return res.status(404).json(new ApiResponse(404, null, 'User not found'));
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sixMonthsAgo = addMonths(today, -6);

    const isLite = user.packageType === 'LITE';
    const isSixMonthsOrOlder = user.createdAt && user.createdAt <= sixMonthsAgo;
    const connected = await isUserConnectedToSpApiOrAds(user._id);

    const matchesServiceCriteria = isLite && isSixMonthsOrOlder && !connected;

    let deleted = false;
    let purgeEnqueued = false;
    let suspensionEmailSent = false;
    let suspensionEmailError = null;

    if (matchesServiceCriteria || force) {
        // Resolve agency email before deletion (user must still exist in DB)
        const userEmail = await resolveRecipientEmail(user.email, user._id);
        const userFirstName = user.firstName;
        const userLastName = user.lastName;
        const userIdStr = user._id.toString();

        // Suspend first (delete user + enqueue purge) — no waiting
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

        // Send suspension email after account is suspended (using captured data)
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
            logger.warn('[SixMonthUserMaintenanceTest] Suspension email failed (user already suspended):', emailErr);
        }
    }

    logger.info('[SixMonthUserMaintenanceTest] Delete evaluation for user', {
        userId: user._id.toString(),
        email: user.email,
        isLite,
        isSixMonthsOrOlder,
        isConnectedToSpApiOrAds: connected,
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
                },
                today,
                sixMonthsAgo,
                isLite,
                isSixMonthsOrOlder,
                isConnectedToSpApiOrAds: connected,
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

