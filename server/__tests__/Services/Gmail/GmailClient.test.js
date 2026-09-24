/**
 * The Gmail request path.
 *
 * The valuable test here is the 403 split. Gmail reports throttling as 403 at least as
 * often as 429, with the real cause buried in `error.errors[0].reason`. Treat 403 as a
 * permissions failure and a sync stops on a transient limit while reading, in the logs,
 * exactly like a missing scope — so the next hour goes into re-checking OAuth scopes
 * that were never wrong.
 */

jest.mock('axios', () => {
    // An explicit factory, not the automock: `axios` is a callable with properties, and
    // under this project's `resetMocks`/`restoreMocks` the automock does not survive as
    // a callable jest.fn — the suite then fails with "axios.mockRejectedValue is not a
    // function" only when run via the real config.
    const axiosFn = jest.fn();
    axiosFn.get = jest.fn();
    axiosFn.post = jest.fn();
    axiosFn.default = axiosFn;
    return axiosFn;
});
const axios = require('axios');

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockGetAccessToken = jest.fn();
const mockInvalidate = jest.fn();
jest.mock('../../../Services/Gmail/GmailAuth.js', () => ({
    getAccessToken: (...a) => mockGetAccessToken(...a),
    invalidateAccessToken: (...a) => mockInvalidate(...a),
}));

const GmailClient = require('../../../Services/Gmail/GmailClient.js');

/** An axios rejection shaped like Google's error envelope. */
const googleFailure = (status, reason, message = 'failed') => Object.assign(new Error(message), {
    response: { status, headers: {}, data: { error: { code: status, message, errors: [{ reason, message }] } } },
});

/**
 * Drive a request that sleeps between retries.
 *
 * The backoff is real — 2s, 4s, 8s — so a suite that waited on it would add fifteen
 * seconds per throttling test. Fake timers plus a microtask flush between advances lets
 * the retry loop run at full speed without weakening what is asserted.
 */
const settle = async (promise) => {
    const guarded = promise.then((v) => ({ value: v }), (error) => ({ error }));
    for (let i = 0; i < 25; i += 1) {
        await Promise.resolve();
        jest.advanceTimersByTime(60000);
    }
    const outcome = await guarded;
    if (outcome.error) throw outcome.error;
    return outcome.value;
};

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetAccessToken.mockResolvedValue('token-1');
});

afterEach(() => jest.useRealTimers());

describe('403 means two completely different things', () => {
    test('rateLimitExceeded is retried, not surfaced as a permissions error', async () => {
        axios
            .mockRejectedValueOnce(googleFailure(403, 'rateLimitExceeded'))
            .mockResolvedValueOnce({ data: { ok: true } });

        const result = await settle(GmailClient.gmailRequest({ path: '/x' }));

        expect(result).toEqual({ ok: true });
        expect(axios).toHaveBeenCalledTimes(2);
    });

    test.each(['userRateLimitExceeded', 'backendError', 'quotaExceeded'])(
        '%s is also throttling',
        async (reason) => {
            expect(GmailClient.isThrottled({ response: { status: 403, data: { error: { errors: [{ reason }] } } } }))
                .toBe(true);
        }
    );

    test('a real permissions failure is surfaced immediately, not retried', async () => {
        // Retrying this would turn a config error into a slow config error.
        axios.mockRejectedValue(googleFailure(403, 'insufficientPermissions', 'Insufficient Permission'));

        await expect(settle(GmailClient.gmailRequest({ path: '/x', context: 'Gmail watch' })))
            .rejects.toThrow(/Insufficient Permission/);
        expect(axios).toHaveBeenCalledTimes(1);
    });

    test('the reason is carried into the message, since the status alone is ambiguous', async () => {
        axios.mockRejectedValue(googleFailure(403, 'insufficientPermissions', 'Insufficient Permission'));

        await expect(settle(GmailClient.gmailRequest({ path: '/x' }))).rejects.toThrow(/insufficientPermissions/);
    });
});

describe('401', () => {
    test('is replayed once with a freshly minted token', async () => {
        axios
            .mockRejectedValueOnce(googleFailure(401, 'authError'))
            .mockResolvedValueOnce({ data: { ok: true } });

        expect(await settle(GmailClient.gmailRequest({ path: '/x' }))).toEqual({ ok: true });
        expect(mockInvalidate).toHaveBeenCalledTimes(1);
        expect(mockGetAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
    });

    test('is not replayed forever', async () => {
        axios.mockRejectedValue(googleFailure(401, 'authError'));

        await expect(settle(GmailClient.gmailRequest({ path: '/x' }))).rejects.toThrow();
        expect(axios).toHaveBeenCalledTimes(2);
    });
});

describe('backoff', () => {
    test('gives up after a bounded number of attempts', async () => {
        // Unbounded retry on a quota that resets daily would hold a worker for hours.
        axios.mockRejectedValue(googleFailure(429, 'rateLimitExceeded'));

        await expect(settle(GmailClient.gmailRequest({ path: '/x' }))).rejects.toThrow();
        expect(axios).toHaveBeenCalledTimes(4); // initial + 3
    });

    test('5xx is retried — Gmail returns them transiently', async () => {
        axios
            .mockRejectedValueOnce(googleFailure(503, 'backendError'))
            .mockResolvedValueOnce({ data: { ok: true } });

        expect(await settle(GmailClient.gmailRequest({ path: '/x' }))).toEqual({ ok: true });
    });

    test('404 is not retried', async () => {
        axios.mockRejectedValue(googleFailure(404, 'notFound'));

        await expect(settle(GmailClient.gmailRequest({ path: '/x' }))).rejects.toThrow(/not found in Gmail/);
        expect(axios).toHaveBeenCalledTimes(1);
    });
});

describe('request shape', () => {
    test('authenticates with Bearer and always sets a timeout', async () => {
        // Bearer, unlike Zoho's Zoho-oauthtoken. And axios has no default timeout — a
        // socket that connects but never answers would hang a worker forever.
        axios.mockResolvedValue({ data: {} });

        await GmailClient.gmailRequest({ path: '/x' });

        const [config] = axios.mock.calls[0];
        expect(config.headers.Authorization).toBe('Bearer token-1');
        expect(config.timeout).toBeGreaterThan(0);
    });

    test('history is asked for without a label filter', async () => {
        // The watch filters; history must not. Filtering here would hide the admin's own
        // SENT replies from a poll-triggered run — the exact message we are trying to
        // stop losing.
        axios.mockResolvedValue({ data: {} });

        await GmailClient.listHistory({ startHistoryId: '100' });

        const [config] = axios.mock.calls[0];
        expect(config.params).not.toHaveProperty('labelId');
        expect(config.params.startHistoryId).toBe('100');
    });

    test('the history cursor is sent as a string', async () => {
        // uint64. Number loses precision above 2^53, which does not fail — it silently
        // starts skipping mail.
        axios.mockResolvedValue({ data: {} });

        await GmailClient.listHistory({ startHistoryId: 9007199254740993n.toString() });

        expect(axios.mock.calls[0][0].params.startHistoryId).toBe('9007199254740993');
    });

    test('watch subscribes to SENT as well as INBOX', async () => {
        // Without SENT, a reply the admin sends from Gmail fires no notification at all.
        axios.mockResolvedValue({ data: {} });
        const { WATCH_LABEL_IDS } = require('../../../Services/Gmail/config.js');

        await GmailClient.watch({ topicName: 'projects/p/topics/t', labelIds: WATCH_LABEL_IDS });

        expect(axios.mock.calls[0][0].data.labelIds).toEqual(['INBOX', 'SENT']);
        expect(axios.mock.calls[0][0].data.labelFilterBehavior).toBe('include');
    });

    test('insert files a message without transmitting it', async () => {
        // send would mail our own inbox from itself, making the client's words look like
        // ours and creating real deliverability surface.
        axios.mockResolvedValue({ data: {} });

        await GmailClient.insertMessage({ raw: 'cmF3', threadId: 't1' });

        const [config] = axios.mock.calls[0];
        expect(config.url).toMatch(/\/users\/me\/messages$/);
        expect(config.url).not.toMatch(/\/send$/);
        expect(config.data.threadId).toBe('t1');
    });

    test('getProfileWithToken bypasses the connection, for the connect-time check', async () => {
        // The identity guard has to run before anything is persisted, so there is no
        // stored connection for getAccessToken to read yet.
        axios.get.mockResolvedValue({ data: { emailAddress: 'hello@estorefactory.com' } });

        await GmailClient.getProfileWithToken('raw-token');

        expect(axios.get.mock.calls[0][1].headers.Authorization).toBe('Bearer raw-token');
        expect(mockGetAccessToken).not.toHaveBeenCalled();
    });
});
