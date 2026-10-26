/**
 * tasks-logics.xlsx account-health rules: every policy category, counts that rose
 * since the last report, ODR of the channel with orders, on-time delivery, and
 * A-to-z judged on new claims rather than any claim in Amazon's 60-day count.
 */
const { checkAccountHealth, deriveV2 } = require('../../../Services/Calculations/AccountHealth.js');

const report = (day, over = {}) => ({
    createdAt: new Date(`${day}T06:00:00Z`),
    accountStatuses: 'NORMAL',
    listingPolicyViolations: 'GOOD',
    validTrackingRateStatus: 'GOOD',
    orderWithDefectsStatus: 'GOOD',
    lateShipmentRateStatus: 'GOOD',
    CancellationRate: 'GOOD',
    ...over
});
const week = (overFor) => ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']
    .map((day, i) => report(day, overFor(i)));
const run = (history) => checkAccountHealth(history[history.length - 1], { x: 1 }, history);

describe('policy violations', () => {
    it('judges every category, naming the one that is not GOOD', () => {
        const ip = { policyMetrics: [{ key: 'receivedIntellectualPropertyComplaints', status: 'BAD', count: 1 }] };
        const r = run(week(() => ip));
        expect(r.PolicyViolations).toMatchObject({ status: 'Error', level: 'error' });
        expect(r.PolicyViolations.Message).toContain('intellectual property complaint issue');
    });

    it('flags a count that rose this week even while the status reads GOOD', () => {
        const r = run(week((i) => ({ policyMetrics: [{ key: 'productSafetyCustomerComplaints', status: 'GOOD', count: i < 4 ? 0 : 1 }] })));
        expect(r.PolicyViolations.status).toBe('Error');
        expect(r.PolicyViolations.Message).toBe('Amazon has raised a new product safety complaint issue on your account this week.');
    });

    it('is healthy when counts are flat and statuses GOOD', () => {
        const r = run(week(() => ({ policyMetrics: [{ key: 'documentRequests', status: 'GOOD', count: 2 }] })));
        expect(r.PolicyViolations.status).toBe('Success');
    });
});

describe('order defect rate', () => {
    it('reads the channel with orders, not always FBA', () => {
        expect(deriveV2(report('2026-10-25', { orderDefectRateStatus: 'BAD' })).odrStatus).toBe('BAD');
        expect(deriveV2(report('2026-10-25')).odrStatus).toBe('GOOD');
        const r = run(week(() => ({ orderDefectRateStatus: 'BAD' })));
        expect(r.orderWithDefectsStatus.status).toBe('Error');
    });
});

describe('on-time delivery rate', () => {
    it('is a task when not GOOD', () => {
        const r = run(week(() => ({ onTimeDeliveryRateStatus: 'BAD' })));
        expect(r.onTimeDeliveryRateStatus).toMatchObject({ status: 'Error' });
    });

    it('is no data when nothing shipped seller-fulfilled', () => {
        const r = run(week(() => ({ onTimeDeliveryRateStatus: 'BAD', rateDetails: { onTimeDeliveryRate: { basis: 0 } } })));
        expect(r.onTimeDeliveryRateStatus).toBeUndefined();
    });
});

describe('A-to-z claims', () => {
    it('fires when the claim count rose this week', () => {
        const r = checkAccountHealth(null, { a_z_claims: { count: 0 } }, week((i) => ({ claimsCount: i < 5 ? 2 : 3 })));
        expect(r.a_z_claims.status).toBe('Error');
        expect(r.a_z_claims.Message).toContain('opened an A-to-z claim this week');
    });

    it('does not fire for old claims still in the 60-day count', () => {
        const r = checkAccountHealth(null, { a_z_claims: { count: 2 } }, week(() => ({ claimsCount: 2 })));
        expect(r.a_z_claims).toEqual({});
    });

    it('falls back to the V1 count without V2 claim history', () => {
        const r = checkAccountHealth(report('2026-10-25'), { a_z_claims: { count: 1 } }, null);
        expect(r.a_z_claims.status).toBe('Error');
    });
});
