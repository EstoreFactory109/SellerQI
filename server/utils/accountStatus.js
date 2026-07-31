/**
 * ACCOUNT STATUS - single source of truth for the admin Manage Accounts "Status" column.
 *
 * Six mutually exclusive states, resolved in a fixed precedence order. The order is the whole point:
 * cancelling a subscription resets packageType to LITE (StripeWebhookService.handleSubscriptionDeleted
 * -> downgradeUserToLite), so the terminal states have to be tested BEFORE any plan-based branch.
 * Test the plan first and a customer who cancelled reads identically to a brand-new free signup -
 * which is exactly the bug this module replaces.
 *
 * resolveAccountStatus (JS, one row at a time) and refundedMatchClause/subscriptionRefundQuery
 * (Mongo, for the stat card counts and filters) are deliberately kept side by side in this one file.
 * The row label, the stat card count and the rows you get when clicking that card all have to agree,
 * and they only stay in agreement if they are edited together. Same reasoning as the
 * trialExpiredClause/trialActiveClause pair in controllers/admin/admin.js.
 */

const ACCOUNT_STATUS = Object.freeze({
    SIGNED_UP: 'signed_up',
    TRIAL: 'trial',
    PAID: 'paid',
    CANCELLED: 'cancelled',
    REFUNDED: 'refunded',
    EXPIRED: 'expired'
});

// Plans that can carry a paid subscription. AGENCY belongs here - agency owners pay just like Pro
// users, and omitting them is why they used to render as "Signed Up".
const PAID_CAPABLE_PLANS = Object.freeze(['PRO', 'AGENCY']);

/**
 * A full refund is recorded by either of two existing writers:
 *   - Subscription.paymentStatus === 'refunded'      <- StripeWebhookService.handleChargeRefunded
 *     (fires for refunds issued from the Stripe Dashboard too)
 *   - a paymentHistory entry with status 'refunded'  <- StripeService.refundLastPayment (admin button)
 * Partial refunds are intentionally excluded: handleChargeRefunded only writes the subscription when
 * the refund is full, so a partial refund never reaches either field.
 */
const hasFullRefund = (account) => {
    const sub = account && account.subscriptionInfo;
    if (!sub) return false;
    return sub.paymentStatus === 'refunded' || sub.hasRefundedPayment === true;
};

// A trial counts as expired once trialEndsDate has passed. A missing/null trialEndsDate means
// "not expired", matching the isTrialExpired computed field and trialExpiredClause in admin.js.
const isTrialExpired = (account, now) => Boolean(
    account && account.isInTrialPeriod && account.trialEndsDate && new Date(account.trialEndsDate) < now
);

/**
 * Resolve the single display status for one account row.
 *
 * Expects a row that has already been through mapAccountFields AND had its live cardConnected
 * resolved (attachCardConnectedStatus / getProCardConnectedMap) - cardConnected is a Stripe fact
 * Mongo cannot answer, and without it a paying customer looks unauthorized.
 *
 * @param {Object} account - account row (packageType, subscriptionStatus, isInTrialPeriod,
 *                           trialEndsDate, isAgencyClient, cardConnected, subscriptionInfo)
 * @param {Date}   [now]   - injectable clock, for tests
 * @returns {string} one of ACCOUNT_STATUS
 */
const resolveAccountStatus = (account, now = new Date()) => {
    if (!account) return ACCOUNT_STATUS.SIGNED_UP;

    // 1 & 2. Terminal states first: by this point packageType has already been reset to LITE, so
    // nothing below could tell a cancellation apart from a free signup.
    if (account.subscriptionStatus === 'cancelled') {
        return hasFullRefund(account) ? ACCOUNT_STATUS.REFUNDED : ACCOUNT_STATUS.CANCELLED;
    }

    // 3. Lapsed rather than cancelled - the card failed, or a trial ran out without converting.
    // Kept distinct because it calls for a different follow-up than someone who chose to leave.
    if (account.subscriptionStatus === 'past_due' || isTrialExpired(account, now)) {
        return ACCOUNT_STATUS.EXPIRED;
    }

    // Agency clients are provisioned and paid for by their agency, so they never authorize a card of
    // their own. Checked after the terminal states so an explicit cancellation still wins.
    if (account.isAgencyClient === true) return ACCOUNT_STATUS.PAID;

    // 4 & 5. A paid plan only counts once a real payment method is on file.
    if (PAID_CAPABLE_PLANS.includes(account.packageType) && account.cardConnected === true) {
        return account.isInTrialPeriod === true ? ACCOUNT_STATUS.TRIAL : ACCOUNT_STATUS.PAID;
    }

    // 6. Signed up but not yet authorized, or simply on the free LITE tier.
    return ACCOUNT_STATUS.SIGNED_UP;
};

/**
 * Mongo $match fragment for "a full refund is on record", for use AFTER the subscriptions $lookup
 * (it reads the joined subscriptionInfo). Mirrors hasFullRefund - edit both together.
 */
const refundedMatchClause = () => ({
    $or: [
        { 'subscriptionInfo.paymentStatus': 'refunded' },
        { 'subscriptionInfo.hasRefundedPayment': true }
    ]
});

/**
 * The same refund signal expressed against the Subscription collection itself, for counting.
 * Mirrors hasFullRefund - edit both together.
 */
const subscriptionRefundQuery = () => ({
    $or: [
        { paymentStatus: 'refunded' },
        { 'paymentHistory.status': 'refunded' }
    ]
});

module.exports = {
    ACCOUNT_STATUS,
    PAID_CAPABLE_PLANS,
    resolveAccountStatus,
    refundedMatchClause,
    subscriptionRefundQuery,
    hasFullRefund
};
