/**
 * When a client's billing is actually fetched from Zoho.
 *
 * Billing barely moves — a monthly client gets one new invoice every ~30 days — so
 * the sweep calls Zoho only for clients whose paid-for period has run out. The risk
 * of that optimisation is a client who silently stops being checked, so every
 * "unknown" case below must resolve to DUE rather than to done.
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../../models/user-auth/userModel.js', () => ({ find: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../../models/system/EsfBillingModels.js', () => ({
    EsfBillingProfile: { find: jest.fn(), updateOne: jest.fn() },
    EsfBillingInvoice: { find: jest.fn(), bulkWrite: jest.fn(), deleteMany: jest.fn() },
}));
jest.mock('../../../Services/Zoho/ZohoBillingService.js', () => ({}));

const { isDueForSync, MAX_DAYS_BETWEEN_CHECKS } = require('../../../Services/Zoho/ZohoBillingSync.js');

const NOW = new Date('2026-09-17T00:00:00.000Z');
const daysFromNow = (n) => new Date(NOW.getTime() + n * 86400000);

describe('unknown always means check, never means done', () => {
    test('no profile at all is due', () => {
        expect(isDueForSync(null, NOW).due).toBe(true);
    });

    test('a profile with no renewal date is due', () => {
        // Nothing parsed a service period — treating that as "not due" would mean a
        // client whose invoice wording changed silently stops updating forever.
        expect(isDueForSync({ nextRenewalAt: null, lastCheckedAt: NOW }, NOW).due).toBe(true);
    });
});

describe('renewal drives the fetch', () => {
    test('a renewal in the past is due', () => {
        const out = isDueForSync({ nextRenewalAt: daysFromNow(-1), lastCheckedAt: NOW }, NOW);

        expect(out.due).toBe(true);
        expect(out.reason).toMatch(/renewal passed/);
    });

    test('a renewal exactly now is due, not a day late', () => {
        expect(isDueForSync({ nextRenewalAt: NOW, lastCheckedAt: NOW }, NOW).due).toBe(true);
    });

    test('a renewal still in the future is NOT fetched — this is the saving', () => {
        const out = isDueForSync({ nextRenewalAt: daysFromNow(20), lastCheckedAt: NOW }, NOW);

        expect(out.due).toBe(false);
        expect(out.reason).toMatch(/next renewal/);
    });
});

describe('the staleness backstop', () => {
    test('a week without a look is due even with the renewal far off', () => {
        // Cards expire, get replaced and get declined mid-cycle, and billing addresses
        // change — none of which follow the renewal date. On an annual plan this is the
        // only thing standing between the client and an 11-month-stale card.
        const out = isDueForSync({
            nextRenewalAt: daysFromNow(300),
            lastCheckedAt: daysFromNow(-MAX_DAYS_BETWEEN_CHECKS),
        }, NOW);

        expect(out.due).toBe(true);
        expect(out.reason).toMatch(/since last check/);
    });

    test('six days is not yet stale', () => {
        expect(isDueForSync({
            nextRenewalAt: daysFromNow(300), lastCheckedAt: daysFromNow(-6),
        }, NOW).due).toBe(false);
    });

    test('falls back to syncedAt when nothing has recorded a check yet', () => {
        // lastCheckedAt only exists on profiles written since this rule shipped; older
        // rows must not read as "never looked at" forever, nor as permanently fresh.
        expect(isDueForSync({
            nextRenewalAt: daysFromNow(300), lastCheckedAt: null, syncedAt: daysFromNow(-1),
        }, NOW).due).toBe(false);

        expect(isDueForSync({
            nextRenewalAt: daysFromNow(300), lastCheckedAt: null, syncedAt: daysFromNow(-30),
        }, NOW).due).toBe(true);
    });
});

describe('clients with no Zoho Billing record', () => {
    test('a client never looked at is due', () => {
        expect(isDueForSync(null, NOW, { zohoBilling: {} }).due).toBe(true);
    });

    test('one we already looked up and found nothing for is NOT re-asked nightly', () => {
        // Most ESF clients will never have a Billing record. Without this they would
        // each cost a Zoho lookup every night, forever — the exact waste the due rule
        // exists to remove, just moved somewhere less visible.
        const out = isDueForSync(null, NOW, { zohoBilling: { lastLookupAt: daysFromNow(-1) } });

        expect(out.due).toBe(false);
        expect(out.reason).toMatch(/no billing record/);
    });

    test('but it IS rechecked after the backstop, so onboarding later is picked up', () => {
        const out = isDueForSync(null, NOW, {
            zohoBilling: { lastLookupAt: daysFromNow(-MAX_DAYS_BETWEEN_CHECKS) },
        });

        expect(out.due).toBe(true);
        expect(out.reason).toMatch(/rechecking/);
    });
});

describe('a plan that has ended', () => {
    test('is NOT chased nightly for an invoice that will never come', () => {
        // The live account has 124 cancelled subscriptions against 26 live ones. A
        // cancelled plan has no next_billing_at, so without this branch every one of
        // them reads as "renewal date unknown" and gets fetched every single night.
        const out = isDueForSync({
            nextRenewalAt: null,
            subscription: { status: 'cancelled', hasEnded: true },
            lastCheckedAt: daysFromNow(-1),
        }, NOW);

        expect(out.due).toBe(false);
        expect(out.reason).toMatch(/no invoice expected/);
    });

    test('is still rechecked weekly, so resubscribing is picked up', () => {
        const out = isDueForSync({
            nextRenewalAt: null,
            subscription: { status: 'cancelled', hasEnded: true },
            lastCheckedAt: daysFromNow(-MAX_DAYS_BETWEEN_CHECKS),
        }, NOW);

        expect(out.due).toBe(true);
        expect(out.reason).toMatch(/rechecking a cancelled plan/);
    });

    test('a live plan with a future billing date is still skipped on its own terms', () => {
        expect(isDueForSync({
            nextRenewalAt: daysFromNow(30),
            subscription: { status: 'live', hasEnded: false },
            lastCheckedAt: NOW,
        }, NOW).due).toBe(false);
    });

    test('an ended plan that somehow still has a renewal date falls through to the date', () => {
        // Defensive: if both are set, the date wins rather than the status silently
        // suppressing a fetch that is genuinely due.
        expect(isDueForSync({
            nextRenewalAt: daysFromNow(-1),
            subscription: { status: 'expired', hasEnded: true },
            lastCheckedAt: NOW,
        }, NOW).due).toBe(true);
    });
});
