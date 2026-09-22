/**
 * OAuth for the shared ESF inbox.
 *
 * The identity guard is the test that earns its place. Without it, an admin already
 * signed into a personal Google account in the same browser connects their own mailbox
 * with one click — the flow succeeds, ingestion starts, and their private mail begins
 * appearing on a page other staff can read. Nothing about that failure looks like a
 * failure, which is why it is asserted from three angles.
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

const mockSetToken = jest.fn();
const mockGetToken = jest.fn();
const mockInvalidateToken = jest.fn();
jest.mock('../../../utils/authCache.js', () => ({
    setToken: (...args) => mockSetToken(...args),
    getToken: (...args) => mockGetToken(...args),
    invalidateToken: (...args) => mockInvalidateToken(...args),
}));

const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockUpdateOne = jest.fn();
const mockDeleteOne = jest.fn();
jest.mock('../../../models/system/GmailConnectionModel.js', () => {
    const model = {
        findOne: (...a) => mockFindOne(...a),
        findOneAndUpdate: (...a) => mockFindOneAndUpdate(...a),
        updateOne: (...a) => mockUpdateOne(...a),
        deleteOne: (...a) => mockDeleteOne(...a),
    };
    model.SINGLETON_KEY = 'gmail_inbox';
    return model;
});

const INBOX = 'hello@estorefactory.com';

const GmailAuth = require('../../../Services/Gmail/GmailAuth.js');

/** A connection document as findOne(...).select(...).exec() would return it. */
const connectionQuery = (doc) => ({ select: jest.fn().mockReturnThis(), exec: () => Promise.resolve(doc) });

beforeEach(() => {
    jest.clearAllMocks();
    process.env.GMAIL_CLIENT_ID = 'client-id';
    process.env.GMAIL_CLIENT_SECRET = 'client-secret';
    process.env.GMAIL_REDIRECT_URI = 'https://members.sellerqi.com/api/gmail/auth/callback';
    process.env.GMAIL_INBOX_ADDRESS = INBOX;

    mockFindOne.mockReturnValue(connectionQuery(null));
    mockFindOneAndUpdate.mockResolvedValue({ key: 'gmail_inbox', emailAddress: INBOX });
    mockUpdateOne.mockResolvedValue({});
    mockGetToken.mockResolvedValue(null);
});

describe('the consent URL', () => {
    test('asks for offline access and forces re-consent', async () => {
        // Both are mandatory. Without them Google returns an access token and NO refresh
        // token, which looks like a successful connect until it stops working an hour
        // later with nothing in the logs.
        const url = new URL(GmailAuth.buildAuthorizationUrl('state-123'));

        expect(url.searchParams.get('access_type')).toBe('offline');
        expect(url.searchParams.get('prompt')).toBe('consent');
    });

    test('requests gmail.modify, which is what insert needs', async () => {
        const url = new URL(GmailAuth.buildAuthorizationUrl('state-123'));

        expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.modify');
    });

    test('hints the shared inbox so the account chooser does not default elsewhere', async () => {
        expect(new URL(GmailAuth.buildAuthorizationUrl('s')).searchParams.get('login_hint')).toBe(INBOX);
    });

    test('refuses to build one without CSRF state', async () => {
        expect(() => GmailAuth.buildAuthorizationUrl('')).toThrow(/state is required/);
    });

    test('names the missing variable rather than sending Google undefined', async () => {
        delete process.env.GMAIL_CLIENT_SECRET;

        expect(() => GmailAuth.buildAuthorizationUrl('s')).toThrow(/GMAIL_CLIENT_SECRET/);
    });
});

describe('the identity guard', () => {
    const tokenResponse = { data: { refresh_token: 'refresh-1', access_token: 'access-1' } };

    test('refuses a mailbox that is not the configured inbox', async () => {
        axios.post.mockResolvedValue(tokenResponse);
        const fetchProfile = jest.fn().mockResolvedValue({ emailAddress: 'admin@gmail.com', historyId: '99' });

        await expect(GmailAuth.exchangeAuthorizationCode({ code: 'c', fetchProfile }))
            .rejects.toThrow(/not the shared ESF inbox/);
    });

    test('persists NOTHING when the mailbox is wrong', async () => {
        // The token is real and usable at this point. Writing it and validating later
        // would leave a working credential for someone's personal mail in our database.
        axios.post.mockResolvedValue(tokenResponse);
        const fetchProfile = jest.fn().mockResolvedValue({ emailAddress: 'admin@gmail.com' });

        await GmailAuth.exchangeAuthorizationCode({ code: 'c', fetchProfile }).catch(() => {});

        expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
        expect(mockSetToken).not.toHaveBeenCalled();
    });

    test('accepts the right mailbox regardless of case or padding', async () => {
        axios.post.mockResolvedValue(tokenResponse);
        const fetchProfile = jest.fn().mockResolvedValue({ emailAddress: '  Hello@EstoreFactory.com ', historyId: '42' });

        const { connection } = await GmailAuth.exchangeAuthorizationCode({ code: 'c', fetchProfile });

        expect(connection).toBeTruthy();
        expect(mockFindOneAndUpdate).toHaveBeenCalled();
    });

    test('an unidentifiable mailbox is refused, not assumed correct', async () => {
        axios.post.mockResolvedValue(tokenResponse);
        const fetchProfile = jest.fn().mockRejectedValue(new Error('network down'));

        await expect(GmailAuth.exchangeAuthorizationCode({ code: 'c', fetchProfile }))
            .rejects.toThrow(/could not be identified/);
        expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });
});

describe('exchanging the code', () => {
    test('refuses a grant with no refresh token, rather than half-connecting', async () => {
        // Google issues one only on first consent. An access-token-only connect works
        // for an hour and then dies.
        axios.post.mockResolvedValue({ data: { access_token: 'access-1' } });

        await expect(GmailAuth.exchangeAuthorizationCode({ code: 'c', fetchProfile: jest.fn() }))
            .rejects.toThrow(/did not return a refresh token/);
    });

    test('baselines the cursor at the mailbox current historyId', async () => {
        // Not zero. Zero asks Gmail to replay the mailbox's entire history — every
        // message ever received, each one redacted through the AI, filling the client
        // pages with archaeology.
        axios.post.mockResolvedValue({ data: { refresh_token: 'r', access_token: 'a' } });
        const fetchProfile = jest.fn().mockResolvedValue({ emailAddress: INBOX, historyId: 987654321 });

        await GmailAuth.exchangeAuthorizationCode({ code: 'c', fetchProfile });

        const [, update] = mockFindOneAndUpdate.mock.calls[0];
        expect(update.$set.historyId).toBe('987654321');
        expect(typeof update.$set.historyId).toBe('string');
    });

    test('clears any watch belonging to a previous mailbox', async () => {
        axios.post.mockResolvedValue({ data: { refresh_token: 'r', access_token: 'a' } });

        await GmailAuth.exchangeAuthorizationCode({
            code: 'c',
            fetchProfile: jest.fn().mockResolvedValue({ emailAddress: INBOX, historyId: '1' }),
        });

        expect(mockFindOneAndUpdate.mock.calls[0][1].$unset).toHaveProperty('watchExpiration');
    });

    test('explains the 7-day Testing-mode expiry on invalid_grant', async () => {
        // The single most likely way this integration dies a week after it starts
        // working, and the error Google returns says only "invalid_grant".
        axios.post.mockRejectedValue({
            response: { status: 400, data: { error: 'invalid_grant', error_description: 'Bad Request' } },
        });

        await expect(GmailAuth.exchangeAuthorizationCode({ code: 'c', fetchProfile: jest.fn() }))
            .rejects.toThrow(/Testing.*publishing status|In production/s);
    });
});

describe('access tokens', () => {
    test('serves a cached token without calling Google', async () => {
        mockFindOne.mockReturnValue(connectionQuery({ refreshToken: 'r' }));
        mockGetToken.mockResolvedValue('cached-token');

        expect(await GmailAuth.getAccessToken()).toBe('cached-token');
        expect(axios.post).not.toHaveBeenCalled();
    });

    test('mints one when the cache is cold and writes it through', async () => {
        mockFindOne.mockReturnValue(connectionQuery({ refreshToken: 'r' }));
        axios.post.mockResolvedValue({ data: { access_token: 'fresh' } });

        expect(await GmailAuth.getAccessToken()).toBe('fresh');
        expect(mockSetToken).toHaveBeenCalledWith('gmail', 'r', 'fresh');
    });

    test('a dead refresh token leaves no usable-looking cache entry', async () => {
        mockFindOne.mockReturnValue(connectionQuery({ refreshToken: 'r' }));
        axios.post.mockRejectedValue({ response: { status: 400, data: { error: 'invalid_grant' } } });

        await GmailAuth.getAccessToken().catch(() => {});

        expect(mockInvalidateToken).toHaveBeenCalledWith('gmail', 'r');
        // …and /status must be able to explain it without a log dive.
        expect(mockUpdateOne.mock.calls.at(-1)[1].$set.lastError).toMatch(/invalid|expired|revoked/i);
    });

    test('says so plainly when the inbox was never connected', async () => {
        mockFindOne.mockReturnValue(connectionQuery(null));

        await expect(GmailAuth.getAccessToken()).rejects.toThrow(/not connected/);
    });
});

describe('disconnecting', () => {
    test('removes the local credential even if revoking at Google fails', async () => {
        // Otherwise a "disconnect" that hit a network error silently leaves a working
        // token in our database.
        mockFindOne.mockReturnValue(connectionQuery({ refreshToken: 'r' }));
        axios.post.mockRejectedValue(new Error('unreachable'));
        mockDeleteOne.mockResolvedValue({});

        expect(await GmailAuth.disconnect()).toBe(true);
        expect(mockDeleteOne).toHaveBeenCalled();
    });
});
