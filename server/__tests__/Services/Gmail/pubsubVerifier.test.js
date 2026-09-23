/**
 * Proving a push came from OUR Pub/Sub subscription.
 *
 * The test that earns its place is "a validly-signed token from a stranger is refused".
 * A Google-signed OIDC token proves only that SOME Google service account minted it for
 * our audience — anyone with a Cloud account can create one, point their own push
 * subscription at our URL, and send us perfectly valid tokens. Stopping at
 * verifyIdToken is the mistake, and it reads as completely correct in review.
 */

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
    // A plain class, not jest.fn().mockImplementation(): this project sets
    // `resetMocks`, which strips the implementation before each test, so the
    // constructor would return undefined and every case would fail as 'invalid-token'
    // — masking what is actually being asserted. The method delegates per call, so the
    // memoized client instance still sees each test's stub.
    OAuth2Client: class {
        // eslint-disable-next-line class-methods-use-this
        verifyIdToken(...args) { return mockVerifyIdToken(...args); }
    },
}));

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { verifyPush, decodeNotification, bearerToken } = require('../../../Services/Gmail/pubsubVerifier.js');

const INBOX = 'hello@estorefactory.com';
const SERVICE_ACCOUNT = 'gmail-push@sellerqi.iam.gserviceaccount.com';

const pushBody = (notification = { emailAddress: INBOX, historyId: '4242' }) => ({
    message: { data: Buffer.from(JSON.stringify(notification), 'utf8').toString('base64') },
});

const pushRequest = (over = {}) => ({
    headers: { authorization: 'Bearer a.valid.jwt' },
    body: pushBody(),
    ...over,
});

const signedBy = (email, extra = {}) => ({
    getPayload: () => ({ email, email_verified: true, ...extra }),
});

beforeEach(() => {
    jest.clearAllMocks();
    process.env.GMAIL_INBOX_ADDRESS = INBOX;
    process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT = SERVICE_ACCOUNT;
    process.env.GMAIL_PUBSUB_AUDIENCE = 'https://members.sellerqi.com/api/gmail/pubsub/push';
    mockVerifyIdToken.mockResolvedValue(signedBy(SERVICE_ACCOUNT));
});

describe('a signature alone proves nothing', () => {
    test('a validly-signed token from a stranger is refused', async () => {
        // The whole reason this file exists. This token verifies perfectly.
        mockVerifyIdToken.mockResolvedValue(signedBy('attacker@evil.iam.gserviceaccount.com'));

        const result = await verifyPush(pushRequest());

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('unexpected-service-account');
    });

    test('our own service account is accepted', async () => {
        expect((await verifyPush(pushRequest())).ok).toBe(true);
    });

    test('the comparison ignores case', async () => {
        mockVerifyIdToken.mockResolvedValue(signedBy(SERVICE_ACCOUNT.toUpperCase()));

        expect((await verifyPush(pushRequest())).ok).toBe(true);
    });

    test('an unverified service account email is refused', async () => {
        mockVerifyIdToken.mockResolvedValue(signedBy(SERVICE_ACCOUNT, { email_verified: false }));

        expect((await verifyPush(pushRequest())).reason).toBe('unverified-service-account');
    });
});

describe('configuration', () => {
    test('with no expected account configured, everything is refused', async () => {
        // Defaulting to "accept" would make the endpoint accept any Google service
        // account in the world — the failure mode is silent and total.
        delete process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT;

        expect((await verifyPush(pushRequest())).reason).toBe('push-not-configured');
        expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    test('the audience is pinned when one is configured', async () => {
        await verifyPush(pushRequest());

        expect(mockVerifyIdToken.mock.calls[0][0].audience)
            .toBe('https://members.sellerqi.com/api/gmail/pubsub/push');
    });
});

describe('the notification', () => {
    test('must concern the mailbox we connected', async () => {
        // A push for another address means the subscription is misconfigured, and
        // acting on it would sync a mailbox nobody consented to.
        const result = await verifyPush(pushRequest({ body: pushBody({ emailAddress: 'someone@else.com' }) }));

        expect(result.reason).toBe('wrong-mailbox');
    });

    test('is decoded from base64 inside message.data', async () => {
        expect(decodeNotification(pushBody())).toEqual({ emailAddress: INBOX, historyId: '4242' });
    });

    test('an undecodable body is refused, not guessed at', async () => {
        const result = await verifyPush(pushRequest({ body: { message: { data: 'not base64 json' } } }));

        expect(result.reason).toBe('undecodable-notification');
    });

    test('a body with no message at all is refused', async () => {
        expect((await verifyPush(pushRequest({ body: {} }))).reason).toBe('undecodable-notification');
    });
});

describe('the token', () => {
    test('a missing Authorization header is refused', async () => {
        expect((await verifyPush(pushRequest({ headers: {} }))).reason).toBe('missing-token');
    });

    test('a token that fails verification is refused', async () => {
        mockVerifyIdToken.mockRejectedValue(new Error('Invalid token signature'));

        expect((await verifyPush(pushRequest())).reason).toBe('invalid-token');
    });

    test.each([
        ['Bearer abc.def.ghi', 'abc.def.ghi'],
        ['bearer abc', 'abc'],
        ['Basic abc', null],
        ['', null],
    ])('%s parses to %s', async (header, expected) => {
        expect(bearerToken(header)).toBe(expected);
    });
});
