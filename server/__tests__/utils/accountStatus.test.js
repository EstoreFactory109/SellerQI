/**
 * Tests for accountStatus — the single source of truth for the admin Manage Accounts Status column.
 *
 * These lock the properties that the previous three-way (packageType + cardConnected) model got
 * wrong, which is how a customer who was charged and then cancelled ended up displayed as
 * "Signed Up" — identical to a brand-new free signup:
 *   - PRECEDENCE: terminal states (refunded/cancelled) win over any plan-based branch, because
 *     cancelling resets packageType to LITE before this ever runs
 *   - a paid plan only counts once a real card is on file ("authorized")
 *   - AGENCY is paid-capable, not just PRO
 *   - the Mongo refund clause and the JS resolver agree on the same fixtures, so the stat card
 *     filter can never drift away from the row label
 */

const {
    ACCOUNT_STATUS,
    PAID_CAPABLE_PLANS,
    resolveAccountStatus,
    refundedMatchClause,
    subscriptionRefundQuery,
    hasFullRefund
} = require('../../utils/accountStatus.js');

const NOW = new Date('2026-07-29T12:00:00Z');
const PAST = new Date('2026-07-20T12:00:00Z');
const FUTURE = new Date('2026-08-20T12:00:00Z');

/** A plain paying Pro customer, used as the base for each variation. */
const account = (overrides = {}) => ({
    packageType: 'PRO',
    subscriptionStatus: 'active',
    isInTrialPeriod: false,
    trialEndsDate: null,
    cardConnected: true,
    subscriptionInfo: { paymentStatus: 'paid' },
    ...overrides
});

describe('resolveAccountStatus — one case per state', () => {
    it('signed up: on the free tier, nothing authorized', () => {
        expect(resolveAccountStatus(account({ packageType: 'LITE', cardConnected: false, subscriptionInfo: null }), NOW))
            .toBe(ACCOUNT_STATUS.SIGNED_UP);
    });

    it('trial: card authorized and inside the trial window', () => {
        expect(resolveAccountStatus(account({ isInTrialPeriod: true, trialEndsDate: FUTURE, subscriptionStatus: 'trialing' }), NOW))
            .toBe(ACCOUNT_STATUS.TRIAL);
    });

    it('paid: card authorized, trial over and converted', () => {
        expect(resolveAccountStatus(account(), NOW)).toBe(ACCOUNT_STATUS.PAID);
    });

    it('cancelled: subscription cancelled, no refund on record', () => {
        expect(resolveAccountStatus(account({ subscriptionStatus: 'cancelled', packageType: 'LITE' }), NOW))
            .toBe(ACCOUNT_STATUS.CANCELLED);
    });

    it('refunded: cancelled and fully refunded', () => {
        expect(resolveAccountStatus(account({
            subscriptionStatus: 'cancelled',
            packageType: 'LITE',
            subscriptionInfo: { paymentStatus: 'refunded' }
        }), NOW)).toBe(ACCOUNT_STATUS.REFUNDED);
    });

    it('expired: payment lapsed into past_due', () => {
        expect(resolveAccountStatus(account({ subscriptionStatus: 'past_due' }), NOW))
            .toBe(ACCOUNT_STATUS.EXPIRED);
    });

    it('expired: trial ran out without converting', () => {
        expect(resolveAccountStatus(account({ isInTrialPeriod: true, trialEndsDate: PAST }), NOW))
            .toBe(ACCOUNT_STATUS.EXPIRED);
    });
});

describe('precedence — the ordering the old model got wrong', () => {
    it('a cancellation outranks the LITE packageType it leaves behind (was: Signed Up)', () => {
        // This is the real shape of the ticket that prompted the change: cancelling runs
        // downgradeUserToLite, so by the time we look, the plan says LITE and the card is still on file.
        const cancelledCustomer = account({
            packageType: 'LITE',
            subscriptionStatus: 'cancelled',
            cardConnected: true,
            subscriptionInfo: { paymentStatus: 'paid' }
        });
        expect(resolveAccountStatus(cancelledCustomer, NOW)).toBe(ACCOUNT_STATUS.CANCELLED);
        expect(resolveAccountStatus(cancelledCustomer, NOW)).not.toBe(ACCOUNT_STATUS.SIGNED_UP);
    });

    it('a refund outranks a plain cancellation', () => {
        expect(resolveAccountStatus(account({
            subscriptionStatus: 'cancelled',
            subscriptionInfo: { paymentStatus: 'paid', hasRefundedPayment: true }
        }), NOW)).toBe(ACCOUNT_STATUS.REFUNDED);
    });

    it('a cancellation outranks past_due', () => {
        expect(resolveAccountStatus(account({ subscriptionStatus: 'cancelled' }), NOW))
            .toBe(ACCOUNT_STATUS.CANCELLED);
    });

    it('a cancellation outranks a stale expired-trial flag', () => {
        expect(resolveAccountStatus(account({
            subscriptionStatus: 'cancelled',
            isInTrialPeriod: true,
            trialEndsDate: PAST
        }), NOW)).toBe(ACCOUNT_STATUS.CANCELLED);
    });

    it('an expired trial outranks the Trial label', () => {
        expect(resolveAccountStatus(account({ isInTrialPeriod: true, trialEndsDate: PAST }), NOW))
            .not.toBe(ACCOUNT_STATUS.TRIAL);
    });
});

describe('authorization — a paid plan needs a real card on file', () => {
    it('Pro without a card is still just signed up', () => {
        expect(resolveAccountStatus(account({ cardConnected: false }), NOW)).toBe(ACCOUNT_STATUS.SIGNED_UP);
    });

    it('Pro in trial without a card is still just signed up', () => {
        expect(resolveAccountStatus(account({ cardConnected: false, isInTrialPeriod: true, trialEndsDate: FUTURE }), NOW))
            .toBe(ACCOUNT_STATUS.SIGNED_UP);
    });

    it('AGENCY with a card is Paid, not Signed Up (the old check was packageType === PRO)', () => {
        expect(resolveAccountStatus(account({ packageType: 'AGENCY' }), NOW)).toBe(ACCOUNT_STATUS.PAID);
    });

    it('AGENCY is paid-capable', () => {
        expect(PAID_CAPABLE_PLANS).toEqual(expect.arrayContaining(['PRO', 'AGENCY']));
    });

    it('agency clients count as Paid without a card of their own', () => {
        expect(resolveAccountStatus(account({ isAgencyClient: true, packageType: 'LITE', cardConnected: false }), NOW))
            .toBe(ACCOUNT_STATUS.PAID);
    });

    it('LITE with a card left over from a past subscription is not Paid', () => {
        expect(resolveAccountStatus(account({ packageType: 'LITE', cardConnected: true }), NOW))
            .toBe(ACCOUNT_STATUS.SIGNED_UP);
    });
});

describe('trial expiry boundary', () => {
    it('a trial ending in the future is still active', () => {
        expect(resolveAccountStatus(account({ isInTrialPeriod: true, trialEndsDate: FUTURE }), NOW))
            .toBe(ACCOUNT_STATUS.TRIAL);
    });

    it('a null trialEndsDate is treated as not expired, matching admin.js trialExpiredClause', () => {
        expect(resolveAccountStatus(account({ isInTrialPeriod: true, trialEndsDate: null }), NOW))
            .toBe(ACCOUNT_STATUS.TRIAL);
    });
});

describe('refund signal — both writers are honoured', () => {
    it('paymentStatus refunded (charge.refunded webhook, incl. Stripe Dashboard refunds)', () => {
        expect(hasFullRefund({ subscriptionInfo: { paymentStatus: 'refunded' } })).toBe(true);
    });

    it('a refunded paymentHistory entry (admin Refund button)', () => {
        expect(hasFullRefund({ subscriptionInfo: { hasRefundedPayment: true } })).toBe(true);
    });

    it('a paid subscription is not a refund', () => {
        expect(hasFullRefund({ subscriptionInfo: { paymentStatus: 'paid' } })).toBe(false);
    });

    it('a missing subscription record is not a refund', () => {
        expect(hasFullRefund({})).toBe(false);
        expect(hasFullRefund({ subscriptionInfo: null })).toBe(false);
    });

    it('a refund on a still-active subscription keeps the account Paid', () => {
        expect(resolveAccountStatus(account({ subscriptionInfo: { paymentStatus: 'refunded' } }), NOW))
            .toBe(ACCOUNT_STATUS.PAID);
    });
});

describe('Mongo clauses stay in lockstep with the resolver', () => {
    // Minimal $or evaluator, enough for the two-field clauses these builders produce. Guards the
    // real risk: the filter behind the Refunded/Cancelled cards silently drifting from the label.
    const matches = (clause, doc) => clause.$or.some(cond => {
        const [path, expected] = Object.entries(cond)[0];
        const actual = path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), doc);
        return actual === expected;
    });

    const fixtures = [
        { name: 'webhook-written refund', doc: { subscriptionInfo: { paymentStatus: 'refunded' } } },
        { name: 'admin-button refund', doc: { subscriptionInfo: { hasRefundedPayment: true } } },
        { name: 'paid, no refund', doc: { subscriptionInfo: { paymentStatus: 'paid' } } },
        { name: 'pending, no refund', doc: { subscriptionInfo: { paymentStatus: 'pending', hasRefundedPayment: false } } },
    ];

    fixtures.forEach(({ name, doc }) => {
        it(`refundedMatchClause agrees with hasFullRefund: ${name}`, () => {
            expect(matches(refundedMatchClause(), doc)).toBe(hasFullRefund(doc));
        });
    });

    it('subscriptionRefundQuery covers both writers', () => {
        const paths = subscriptionRefundQuery().$or.map(cond => Object.keys(cond)[0]);
        expect(paths).toEqual(expect.arrayContaining(['paymentStatus', 'paymentHistory.status']));
    });
});

describe('defensive', () => {
    it('a missing account does not throw', () => {
        expect(resolveAccountStatus(null, NOW)).toBe(ACCOUNT_STATUS.SIGNED_UP);
        expect(resolveAccountStatus(undefined, NOW)).toBe(ACCOUNT_STATUS.SIGNED_UP);
    });

    it('every state is a distinct string', () => {
        const values = Object.values(ACCOUNT_STATUS);
        expect(new Set(values).size).toBe(values.length);
    });
});
