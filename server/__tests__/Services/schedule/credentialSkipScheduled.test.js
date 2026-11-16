/**
 * CREDENTIAL_SKIP_MODE inside the scheduled pipeline: the finalize gate's treatment of `skipped`
 * results, and the persistence of a revoked grant.
 *
 * The shape that matters is the REAL one production produces for an account with no Ads
 * connection: every ads key present with `success:false`. The older "no ads service ran" test
 * passes no ads keys at all, which is why the never-stamped-complete loop went unnoticed.
 */

// Same import-time workaround as adsAsyncPhase.test.js.
jest.mock('axios-retry', () => {
    const fn = () => {};
    fn.exponentialDelay = () => 0;
    fn.isNetworkError = () => false;
    fn.isRetryableError = () => false;
    fn.isIdempotentRequestError = () => false;
    fn.isNetworkOrIdempotentRequestError = () => false;
    fn.default = fn;
    return fn;
});

const mockUpdateOne = jest.fn();
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
    updateOne: (...a) => mockUpdateOne(...a),
    findOne: jest.fn(),
    find: jest.fn(),
}));

const { ScheduledIntegration: SI } = require('../../../Services/schedule/ScheduledIntegration.js');

const USER = '507f1f77bcf86cd799439011';
const ok = { success: true };
const ADS_KEYS = ['ppcSpendsBySKU', 'adsKeywordsPerformanceData', 'ppcSpendsDateWise', 'ppcMetricsAggregated'];

const adsAll = (result) => Object.fromEntries(ADS_KEYS.map((k) => [k, { ...result }]));
const legacyNoAds = adsAll({ success: false, data: null, error: 'Ads token not available' });
const skippedNoAds = adsAll({ success: false, skipped: true, reason: 'ads_not_connected', error: 'Ads token not available' });

describe('_canMarkDailyComplete with not-connected services', () => {
    test('legacy shape (off): no Ads connection is never stamped complete — the loop being fixed', () => {
        const res = SI._canMarkDailyComplete({ financeSync: ok, ...legacyNoAds });
        expect(res.adsRan).toBe(true);
        expect(res.canMarkComplete).toBe(false);
    });

    test('on: skipped ads services do not count as ran, so finance alone stamps the day', () => {
        const res = SI._canMarkDailyComplete({ financeSync: ok, ...skippedNoAds });
        expect(res.adsRan).toBe(false);
        expect(res.canMarkComplete).toBe(true);
    });

    test('on: a skipped financeSync (no SP-API connection) does not block an Ads-only account', () => {
        const res = SI._canMarkDailyComplete({
            financeSync: { success: false, skipped: true, reason: 'sp_not_connected' },
            ppcSpendsBySKU: ok,
            ppcMetricsAggregated: ok,
        });
        expect(res.financeOk).toBe(true);
        expect(res.canMarkComplete).toBe(true);
    });

    test('on: a skipped financeSync still needs the Ads side to succeed', () => {
        expect(SI._canMarkDailyComplete({
            financeSync: { success: false, skipped: true },
            ppcSpendsBySKU: { success: false },
            ppcMetricsAggregated: { success: false },
        }).canMarkComplete).toBe(false);
    });

    test('a genuine finance failure still blocks — skipped is not a blanket pass', () => {
        expect(SI._canMarkDailyComplete({ financeSync: { success: false }, ...skippedNoAds }).canMarkComplete).toBe(false);
    });

    test('dry_run tagging (wouldSkip) changes nothing by itself', () => {
        const tagged = adsAll({ success: false, wouldSkip: true, error: 'Ads token not available' });
        expect(SI._canMarkDailyComplete({ financeSync: ok, ...tagged }).canMarkComplete).toBe(false);
    });
});

describe('_recordCredentialRevocation', () => {
    beforeEach(() => {
        mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    });

    test('records an SP-API revocation on the matching marketplace entry', async () => {
        await SI._recordCredentialRevocation(USER, 'US', 'NA', { spOk: false, adsOk: true, spRevoked: 'invalid grant', adsRevoked: null });

        const setCall = mockUpdateOne.mock.calls.find(([, update]) => update.$set);
        expect(setCall).toBeTruthy();
        const [filter, update, opts] = setCall;
        expect(filter).toEqual({ User: USER });
        expect(update.$set['sellerAccount.$[acct].spiAuthRevokedAt']).toBeInstanceOf(Date);
        expect(update.$set['sellerAccount.$[acct].spiAuthRevokedReason']).toBe('invalid grant');
        expect(opts.arrayFilters).toEqual([{ 'acct.country': 'US', 'acct.region': 'NA' }]);
    });

    test('clears a recorded revocation once a token is obtained, filtered to entries that carry it', async () => {
        await SI._recordCredentialRevocation(USER, 'US', 'NA', { spOk: true, adsOk: false, spRevoked: null, adsRevoked: null });

        expect(mockUpdateOne).toHaveBeenCalledTimes(1);
        const [filter, update, opts] = mockUpdateOne.mock.calls[0];
        expect(filter.sellerAccount.$elemMatch).toEqual({ country: 'US', region: 'NA', spiAuthRevokedAt: { $exists: true } });
        expect(update.$unset).toEqual({ 'sellerAccount.$[acct].spiAuthRevokedAt': '', 'sellerAccount.$[acct].spiAuthRevokedReason': '' });
        expect(opts.arrayFilters[0]).toEqual({ 'acct.country': 'US', 'acct.region': 'NA', 'acct.spiAuthRevokedAt': { $exists: true } });
    });

    test('a transient failure (no token, not invalid_grant) writes nothing', async () => {
        await SI._recordCredentialRevocation(USER, 'US', 'NA', { spOk: false, adsOk: false, spRevoked: null, adsRevoked: null });
        expect(mockUpdateOne).not.toHaveBeenCalled();
    });

    test('records an Ads revocation and clears SP in the same run', async () => {
        await SI._recordCredentialRevocation(USER, 'UK', 'EU', { spOk: true, adsOk: false, spRevoked: null, adsRevoked: 'Amazon Ads refresh token is invalid or expired.' });
        expect(mockUpdateOne).toHaveBeenCalledTimes(2);
        const fields = mockUpdateOne.mock.calls.flatMap(([, u]) => Object.keys(u.$set || u.$unset));
        expect(fields).toEqual(expect.arrayContaining(['sellerAccount.$[acct].adsAuthRevokedAt', 'sellerAccount.$[acct].spiAuthRevokedAt']));
    });

    test('a failed write is non-fatal', async () => {
        mockUpdateOne.mockRejectedValue(new Error('mongo down'));
        await expect(SI._recordCredentialRevocation(USER, 'US', 'NA', { spOk: false, adsOk: false, spRevoked: 'x', adsRevoked: null })).resolves.toBeUndefined();
    });

    test('no revocation object is a no-op', async () => {
        await SI._recordCredentialRevocation(USER, 'US', 'NA', undefined);
        expect(mockUpdateOne).not.toHaveBeenCalled();
    });
});
