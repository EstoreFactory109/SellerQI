/**
 * cronProducer.enqueueUsersForDailyUpdate under CREDENTIAL_SKIP_MODE.
 *
 * An account with no usable credential used to be enqueued every hourly tick (and re-run up to
 * the daily attempt cap) only to fail every service. Under `on` it is not enqueued and no
 * attempt is recorded; `dry_run` and `off` enqueue exactly as before.
 */

const mockEnqueue = jest.fn();
const mockQueueStats = jest.fn();
jest.mock('../../../Services/BackgroundJobs/producer.js', () => ({
    enqueueScheduledAccountJob: (...a) => mockEnqueue(...a),
    getQueueStats: (...a) => mockQueueStats(...a),
}));

const mockGetUsers = jest.fn();
const mockShouldAttempt = jest.fn();
const mockRecordAttempt = jest.fn();
jest.mock('../../../Services/BackgroundJobs/UserSchedulingService.js', () => ({
    UserSchedulingService: {
        getUsersNeedingDailyUpdate: (...a) => mockGetUsers(...a),
        shouldAttemptAccountUpdate: (...a) => mockShouldAttempt(...a),
        recordAccountAttempt: (...a) => mockRecordAttempt(...a),
    },
}));

const mockSellerFindOne = jest.fn();
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
    findOne: (...a) => mockSellerFindOne(...a),
}));

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

const { enqueueUsersForDailyUpdate } = require('../../../Services/BackgroundJobs/cronProducer.js');

const USER = '6a57b823571ceb9266953c30';
const HEALTHY = { country: 'US', region: 'NA', spiRefreshToken: 'Atzr|sp', adsRefreshToken: 'Atzr|ads', ProfileId: '1' };
const ADS_ONLY = { country: 'CA', region: 'NA', adsRefreshToken: 'Atzr|ads', ProfileId: '2' };
const NOTHING = { country: 'UK', region: 'EU' };
const REVOKED = { country: 'DE', region: 'EU', spiRefreshToken: 'Atzr|sp', spiAuthRevokedAt: new Date() };

const ORIGINAL_ENV = { ...process.env };

function setup(accounts) {
    mockGetUsers.mockResolvedValue([{ userId: USER }]);
    mockSellerFindOne.mockResolvedValue({ sellerAccount: accounts });
    mockShouldAttempt.mockResolvedValue({ eligible: true, attempts: 0 });
    mockRecordAttempt.mockResolvedValue();
    mockEnqueue.mockResolvedValue({ success: true, jobId: 'j' });
    mockQueueStats.mockResolvedValue({});
}

const enqueuedCountries = () => mockEnqueue.mock.calls.map(([, country]) => country);
const attemptedCountries = () => mockRecordAttempt.mock.calls.map(([, country]) => country);

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
});

describe('enqueueUsersForDailyUpdate — credential gating', () => {
    test('off (default): every account is enqueued, as before', async () => {
        delete process.env.CREDENTIAL_SKIP_MODE;
        setup([HEALTHY, ADS_ONLY, NOTHING, REVOKED]);

        const res = await enqueueUsersForDailyUpdate();

        expect(enqueuedCountries()).toEqual(['US', 'CA', 'UK', 'DE']);
        expect(res.accountsNoCredentials).toBe(0);
    });

    test('dry_run: counts the accounts it would skip but still enqueues them', async () => {
        process.env.CREDENTIAL_SKIP_MODE = 'dry_run';
        setup([HEALTHY, ADS_ONLY, NOTHING, REVOKED]);

        const res = await enqueueUsersForDailyUpdate();

        expect(enqueuedCountries()).toEqual(['US', 'CA', 'UK', 'DE']);
        expect(res.accountsNoCredentials).toBe(2);
    });

    test('on: accounts with no usable credential are not enqueued and no attempt is recorded', async () => {
        process.env.CREDENTIAL_SKIP_MODE = 'on';
        setup([HEALTHY, ADS_ONLY, NOTHING, REVOKED]);

        const res = await enqueueUsersForDailyUpdate();

        // Ads-only still has work to do.
        expect(enqueuedCountries()).toEqual(['US', 'CA']);
        expect(attemptedCountries()).toEqual(['US', 'CA']);
        expect(res.accountsNoCredentials).toBe(2);
        expect(res.accountsEnqueued).toBe(2);
    });

    test('on: an account already done today is counted as done, not as missing credentials', async () => {
        process.env.CREDENTIAL_SKIP_MODE = 'on';
        setup([NOTHING]);
        mockShouldAttempt.mockResolvedValue({ eligible: false, reason: 'done' });

        const res = await enqueueUsersForDailyUpdate();

        expect(res.accountsAlreadyDone).toBe(1);
        expect(res.accountsNoCredentials).toBe(0);
        expect(mockEnqueue).not.toHaveBeenCalled();
    });

    test('on, scoped by allowlist: other users keep the legacy behaviour', async () => {
        process.env.CREDENTIAL_SKIP_MODE = 'on';
        process.env.CREDENTIAL_SKIP_USER_IDS = '6a57b823571ceb9266953c31';
        setup([NOTHING]);

        const res = await enqueueUsersForDailyUpdate();

        expect(enqueuedCountries()).toEqual(['UK']);
        expect(res.accountsNoCredentials).toBe(0);
    });
});
