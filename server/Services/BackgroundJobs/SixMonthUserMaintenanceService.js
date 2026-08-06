const logger = require('../../utils/Logger.js');
const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const Subscription = require('../../models/user-auth/SubscriptionModel.js');
const { sendSixMonthAccountWarning } = require('../Email/SendSixMonthAccountWarning.js');
const { sendAccountSuspendedEmail } = require('../Email/SendAccountSuspendedEmail.js');
const { resolveRecipientEmail } = require('../Email/resolveRecipientEmail.js');
const { deleteUserById } = require('../User/deleteUserService.js');
const { enqueueFullUserDataPurge } = require('./deleteUserQueue.js');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Warn once the account is within this many days of (or past) its 6-month mark.
const WARNING_WINDOW_DAYS = 3;
// Delete this many days after the warning was actually sent (not from createdAt),
// so the promised grace period is always honored regardless of cron timing.
const GRACE_PERIOD_DAYS = 3;

/**
 * Add months to a date, preserving day-of-month when possible.
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
function addMonths(date, months) {
    const d = new Date(date.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    // Handle month overflow (e.g. Feb 30 -> Mar 2)
    if (d.getDate() < day) {
        d.setDate(0);
    }
    return d;
}

/**
 * Check if a user has any connected SP-API or Ads account.
 * Informational only — no longer gates warning/deletion eligibility (see
 * isEligibleForWarning/isEligibleForDeletion for why: packageType alone is
 * the reliable "never paid" signal, since a paying user's package is never
 * LITE and a lapsed trial is downgraded back to LITE elsewhere in the app).
 *
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isUserConnectedToSpApiOrAds(userId) {
    const seller = await Seller.findOne({ User: userId }).lean();
    if (!seller || !Array.isArray(seller.sellerAccount) || seller.sellerAccount.length === 0) {
        return false;
    }

    return seller.sellerAccount.some((account) => {
        const spi = typeof account.spiRefreshToken === 'string' ? account.spiRefreshToken.trim() : '';
        const ads = typeof account.adsRefreshToken === 'string' ? account.adsRefreshToken.trim() : '';
        return !!spi || !!ads;
    });
}

/**
 * A user counts as an agency admin or agency client if either applies —
 * purging one could orphan the other side of the relationship, so both are
 * excluded from the auto-cleanup flow entirely.
 * @param {object} user
 * @returns {boolean}
 */
function isNotAgency(user) {
    return user.packageType !== 'AGENCY' && user.isAgencyClient !== true && !user.agencyId;
}

/**
 * Days remaining until six months after the given anchor date.
 * Negative means the six-month mark has already passed.
 * @param {Date|string} anchorDate
 * @param {Date} [now]
 * @returns {number}
 */
function getDaysUntilSixMonthMark(anchorDate, now = new Date()) {
    const sixMonthMark = addMonths(new Date(anchorDate), 6);
    return Math.ceil((sixMonthMark.getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * Resolve the date this user most recently became a non-paying LITE user —
 * i.e. the anchor for their 6-month inactivity window. A long-time paying
 * customer who cancels gets the SAME fair 6-month window as a brand-new
 * signup, measured from their cancellation, not from their (possibly
 * years-old) registration date.
 *
 * - If a Subscription record exists and has a currentPeriodEnd (the date
 *   paid access actually ends after cancelling), use that — it's the most
 *   precise "stopped being a paying customer" date available.
 * - Else if a Subscription record exists, fall back to its updatedAt.
 * - Else (never subscribed at all) fall back to the user's createdAt.
 *
 * Deliberately does NOT touch any Stripe/Razorpay webhook code — this is a
 * read-only lookup against the existing Subscription collection.
 *
 * @param {object} user - plain object with _id and createdAt
 * @returns {Promise<Date>}
 */
async function resolveEffectiveLiteSince(user) {
    const sub = await Subscription.findOne({ userId: user._id })
        .select('currentPeriodEnd updatedAt')
        .lean();

    if (sub?.currentPeriodEnd) return new Date(sub.currentPeriodEnd);
    if (sub?.updatedAt) return new Date(sub.updatedAt);
    return new Date(user.createdAt);
}

/**
 * Single source of truth for "should this user receive the six-month warning
 * email right now". Shared by the bulk cron scan and the single-user test
 * endpoint so the two can never drift apart.
 *
 * Expects `user.effectiveLiteSince` to already be resolved (via
 * resolveEffectiveLiteSince) and attached by the caller; falls back to
 * `user.createdAt` defensively if it isn't.
 *
 * @param {object} user - plain object with firstName/lastName/email/createdAt/
 *   effectiveLiteSince/packageType/isAgencyClient/agencyId/purgedAt/sixMonthWarningSentAt
 * @param {Date} [now]
 * @returns {boolean}
 */
function isEligibleForWarning(user, now = new Date()) {
    if (!user) return false;
    const anchor = user.effectiveLiteSince || user.createdAt;
    if (!anchor) return false;
    if (user.packageType !== 'LITE') return false; // already paid/upgraded
    if (!isNotAgency(user)) return false;
    if (user.purgedAt) return false; // already cleaned up
    if (user.sixMonthWarningSentAt) return false; // already warned once

    return getDaysUntilSixMonthMark(anchor, now) <= WARNING_WINDOW_DAYS;
}

/**
 * Single source of truth for "should this user be deleted right now" —
 * i.e. the warning was sent and the grace period has elapsed with no
 * upgrade. Shared by the bulk cron scan and the single-user test endpoint.
 *
 * @param {object} user - plain object with packageType/isAgencyClient/agencyId/
 *   purgedAt/sixMonthWarningSentAt
 * @param {Date} [now]
 * @returns {boolean}
 */
function isEligibleForDeletion(user, now = new Date()) {
    if (!user) return false;
    if (user.packageType !== 'LITE') return false; // already paid/upgraded
    if (!isNotAgency(user)) return false;
    if (user.purgedAt) return false; // already cleaned up
    if (!user.sixMonthWarningSentAt) return false; // never warned yet

    const graceCutoff = now.getTime() - GRACE_PERIOD_DAYS * MS_PER_DAY;
    return new Date(user.sixMonthWarningSentAt).getTime() <= graceCutoff;
}

/**
 * Find users due for the six-month warning email.
 * Narrows at the DB level (verified, still LITE, not agency, never warned,
 * never purged) — NOT by createdAt age, since a long-time paying customer
 * who just cancelled can be old-by-registration but only just became LITE.
 * Resolves each candidate's effective "became LITE" anchor (registration
 * date, or a more recent cancellation date from Subscription — see
 * resolveEffectiveLiteSince) before applying the exact date-math predicate.
 *
 * @returns {Promise<Array>}
 */
async function findUsersDueForSixMonthWarning() {
    const now = new Date();

    const candidates = await User.find({
        isVerified: true,
        packageType: 'LITE',
        isAgencyClient: { $ne: true },
        agencyId: null,
        purgedAt: null,
        sixMonthWarningSentAt: null,
    })
        .select('firstName lastName email createdAt packageType isAgencyClient agencyId purgedAt sixMonthWarningSentAt')
        .lean();

    const eligible = [];
    for (const user of candidates) {
        const effectiveLiteSince = await resolveEffectiveLiteSince(user);
        const decorated = { ...user, effectiveLiteSince };
        if (isEligibleForWarning(decorated, now)) {
            eligible.push(decorated);
        }
    }
    return eligible;
}

/**
 * Find users due for deletion: already warned, grace period elapsed, still
 * on LITE (never upgraded/paid in the meantime).
 *
 * @returns {Promise<Array>}
 */
async function findUsersDueForDeletion() {
    const now = new Date();
    const graceCutoff = new Date(now.getTime() - GRACE_PERIOD_DAYS * MS_PER_DAY);

    const candidates = await User.find({
        isVerified: true,
        packageType: 'LITE',
        isAgencyClient: { $ne: true },
        agencyId: null,
        purgedAt: null,
        sixMonthWarningSentAt: { $ne: null, $lte: graceCutoff },
    })
        .select('firstName lastName email createdAt packageType isAgencyClient agencyId purgedAt sixMonthWarningSentAt')
        .lean();

    return candidates.filter((user) => isEligibleForDeletion(user, now));
}

/**
 * Service 1:
 * Send the six-month inactivity warning email to every eligible user
 * (LITE package, not agency, never warned, never purged, within 3 days of
 * or past their 6-month mark). Marks sixMonthWarningSentAt ONLY when the
 * email is confirmed sent — a failed send is retried on the next run
 * instead of being silently skipped forever.
 *
 * @returns {Promise<{ processed: number, emailed: number, failed: number }>}
 */
async function sendSixMonthAccountWarnings() {
    logger.info('[SixMonthUserMaintenanceService] Starting six-month warning email process');

    const users = await findUsersDueForSixMonthWarning();
    logger.info(`[SixMonthUserMaintenanceService] Found ${users.length} users due for six-month warning`);

    let emailed = 0;
    let failed = 0;

    for (const user of users) {
        try {
            const result = await sendSixMonthAccountWarning({
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                userId: user._id,
                registeredAt: user.createdAt,
            });

            if (result?.success) {
                await User.updateOne(
                    { _id: user._id },
                    { $set: { sixMonthWarningSentAt: new Date() } }
                );
                emailed++;
            } else {
                failed++;
                logger.warn(`[SixMonthUserMaintenanceService] Warning email failed for ${user.email}: ${result?.error}`);
            }
        } catch (err) {
            failed++;
            logger.error(
                `[SixMonthUserMaintenanceService] Error processing six-month warning for user ${user.email} (${user._id}):`,
                err
            );
        }
    }

    const summary = { processed: users.length, emailed, failed };
    logger.info('[SixMonthUserMaintenanceService] Six-month warning email process completed', summary);
    return summary;
}

/**
 * Service 2:
 * Delete (soft-delete) every user whose grace period has elapsed since
 * their warning email was sent, and who is still on LITE (never
 * connected, connected-then-disconnected, and connected-but-never-paid
 * all collapse to "still LITE" — see isEligibleForDeletion).
 *
 * "Delete" here means: remove Seller document(s), enqueue the full
 * operational-data purge, and keep the User document (email/password/
 * name intact) so the person can still log back in after reconnecting
 * their Amazon accounts. This is the same deleteUserById used by the
 * admin manual-delete route — one behavior, no hard/soft distinction.
 *
 * @returns {Promise<{ eligible: number, deleted: number, purgeEnqueued: number, suspensionEmailSent: number }>}
 */
async function deleteStaleLiteUsersWithoutIntegration() {
    logger.info('[SixMonthUserMaintenanceService] Starting cleanup of LITE users past their grace period');

    const candidates = await findUsersDueForDeletion();
    logger.info(`[SixMonthUserMaintenanceService] Found ${candidates.length} users past grace period`);

    let deleted = 0;
    let purgeEnqueued = 0;
    let suspensionEmailSent = 0;

    for (const user of candidates) {
        try {
            const userIdStr = user._id.toString();
            const userFirstName = user.firstName;
            const userLastName = user.lastName;
            // Resolve agency email before deletion (defensive — these users are
            // already filtered to non-agency, but resolveRecipientEmail is a
            // cheap no-op in that case).
            const userEmail = await resolveRecipientEmail(user.email, user._id);

            // Soft-delete: Seller removed, User document retained.
            await deleteUserById(userIdStr);
            deleted++;

            try {
                await enqueueFullUserDataPurge(userIdStr);
                purgeEnqueued++;
            } catch (enqueueErr) {
                logger.error(
                    `[SixMonthUserMaintenanceService] Failed to enqueue full user data purge for user ${userIdStr}:`,
                    enqueueErr
                );
            }

            try {
                const emailResult = await sendAccountSuspendedEmail({
                    email: userEmail,
                    firstName: userFirstName,
                    lastName: userLastName,
                });
                if (emailResult?.success) suspensionEmailSent++;
            } catch (emailErr) {
                logger.warn(`[SixMonthUserMaintenanceService] Failed to send suspension email to ${userEmail}:`, emailErr?.message);
            }
        } catch (err) {
            logger.error(
                `[SixMonthUserMaintenanceService] Error deleting stale LITE user ${user.email} (${user._id}):`,
                err
            );
        }
    }

    const summary = { eligible: candidates.length, deleted, purgeEnqueued, suspensionEmailSent };

    logger.info(
        '[SixMonthUserMaintenanceService] Cleanup of LITE users past grace period completed',
        summary
    );

    return summary;
}

module.exports = {
    sendSixMonthAccountWarnings,
    deleteStaleLiteUsersWithoutIntegration,
    // Exported for the single-user test controller and for tests, so
    // eligibility logic can never drift between the bulk job and manual checks.
    isEligibleForWarning,
    isEligibleForDeletion,
    isUserConnectedToSpApiOrAds,
    resolveEffectiveLiteSince,
    addMonths,
    getDaysUntilSixMonthMark,
    WARNING_WINDOW_DAYS,
    GRACE_PERIOD_DAYS,
};
