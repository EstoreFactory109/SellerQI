/**
 * Tests for the Zoho Projects OAuth layer.
 *
 * These pin the three things that silently break a Zoho integration and are invisible
 * until production:
 *   1. access_type=offline + prompt=consent on the consent URL. Without them Zoho returns
 *      an access token and NO refresh token — everything looks fine until the first
 *      expiry an hour later.
 *   2. the data center carried through the callback. A token minted on the EU DC is
 *      rejected by the US API host, producing 401s that look like a bad secret.
 *   3. cache-then-mint on getAccessToken, and cache invalidation on a dead refresh token.
 */

jest.mock('axios');

jest.mock('../../../utils/authCache.js', () => ({
    getToken: jest.fn().mockResolvedValue(null),
    setToken: jest.fn().mockResolvedValue(undefined),
    invalidateToken: jest.fn().mockResolvedValue(undefined)
}));

// The model is a real Mongoose model; stub it so nothing buffers against an absent
// connection. `SINGLETON_KEY` is read off the module in ZohoAuth, so it must be present.
jest.mock('../../../models/system/ZohoConnectionModel.js', () => {
    const model = {
        SINGLETON_KEY: 'zoho_projects',
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
        updateOne: jest.fn(),
        deleteOne: jest.fn()
    };
    return model;
});

const ORIGINAL_ENV = { ...process.env };

process.env.ZOHO_CLIENT_ID = 'mock_zoho_client_id';
process.env.ZOHO_CLIENT_SECRET = 'mock_zoho_client_secret';
process.env.ZOHO_REDIRECT_URI = 'http://localhost:4000/api/zoho/auth/callback';

const axios = require('axios');
const authCache = require('../../../utils/authCache.js');
const ZohoConnection = require('../../../models/system/ZohoConnectionModel.js');
const ZohoAuth = require('../../../Services/Zoho/ZohoAuth.js');

/** ZohoAuth reads the connection via findOne(...).select(...).exec() or findOne(...).exec(). */
const mockConnection = (doc) => {
    const chain = {
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(doc)
    };
    ZohoConnection.findOne.mockReturnValue(chain);
    return chain;
};

afterAll(() => {
    process.env = ORIGINAL_ENV;
});

beforeEach(() => {
    ZohoConnection.updateOne.mockReturnValue({ catch: jest.fn().mockResolvedValue(undefined) });
    authCache.getToken.mockResolvedValue(null);
});

describe('buildAuthorizationUrl', () => {
    test('requests offline access and forces a consent prompt', () => {
        const url = new URL(ZohoAuth.buildAuthorizationUrl('state-123'));

        // Both are mandatory to receive a refresh token at all.
        expect(url.searchParams.get('access_type')).toBe('offline');
        expect(url.searchParams.get('prompt')).toBe('consent');

        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('client_id')).toBe('mock_zoho_client_id');
        expect(url.searchParams.get('state')).toBe('state-123');
        expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4000/api/zoho/auth/callback');
    });

    test('requests the project scopes needed to read and create', () => {
        const url = new URL(ZohoAuth.buildAuthorizationUrl('state-123'));
        const scopes = url.searchParams.get('scope').split(',');

        expect(scopes).toEqual(
            expect.arrayContaining([
                'ZohoProjects.portals.READ',
                'ZohoProjects.projects.ALL',
                'ZohoProjects.tasks.READ'
            ])
        );
    });

    test('refuses to build a URL without a CSRF state', () => {
        expect(() => ZohoAuth.buildAuthorizationUrl()).toThrow(/state is required/i);
    });
});

describe('exchangeAuthorizationCode', () => {
    test('persists the refresh token and pins the data center from `location`', async () => {
        axios.post.mockResolvedValue({
            data: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }
        });
        ZohoConnection.findOneAndUpdate.mockResolvedValue({ apiDomain: 'https://projectsapi.zoho.eu' });

        await ZohoAuth.exchangeAuthorizationCode({ code: 'code-1', location: 'eu' });

        // The token exchange must go to the EU accounts host, not the .com default.
        expect(axios.post.mock.calls[0][0]).toBe('https://accounts.zoho.eu/oauth/v2/token');

        const saved = ZohoConnection.findOneAndUpdate.mock.calls[0][1].$set;
        expect(saved.refreshToken).toBe('refresh-1');
        expect(saved.apiDomain).toBe('https://projectsapi.zoho.eu');
        expect(saved.accountsDomain).toBe('https://accounts.zoho.eu');
    });

    test('clears any portal left over from a previous connection', async () => {
        axios.post.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'r' } });
        ZohoConnection.findOneAndUpdate.mockResolvedValue({});

        await ZohoAuth.exchangeAuthorizationCode({ code: 'code-1' });

        // A stale portalId would silently point operations at the previous account's portal.
        expect(ZohoConnection.findOneAndUpdate.mock.calls[0][1].$unset).toEqual({ portalId: '', portalName: '' });
    });

    test('fails loudly when Zoho returns no refresh token', async () => {
        // What you get when access_type/prompt are dropped, or the account already consented.
        axios.post.mockResolvedValue({ data: { access_token: 'access-only' } });

        await expect(ZohoAuth.exchangeAuthorizationCode({ code: 'code-1' })).rejects.toMatchObject({
            statusCode: 502,
            message: expect.stringMatching(/did not return a refresh token/i)
        });
    });

    test('maps a reused authorization code to 400', async () => {
        axios.post.mockResolvedValue({ data: { error: 'invalid_code' } });

        await expect(ZohoAuth.exchangeAuthorizationCode({ code: 'used' })).rejects.toMatchObject({
            statusCode: 400
        });
    });
});

describe('getAccessToken', () => {
    test('serves a cached token without calling Zoho', async () => {
        mockConnection({ refreshToken: 'refresh-1', accountsDomain: 'https://accounts.zoho.com' });
        authCache.getToken.mockResolvedValue('cached-token');

        await expect(ZohoAuth.getAccessToken()).resolves.toBe('cached-token');
        expect(axios.post).not.toHaveBeenCalled();
    });

    test('mints and caches a token on a cold cache', async () => {
        mockConnection({ refreshToken: 'refresh-1', accountsDomain: 'https://accounts.zoho.com' });
        axios.post.mockResolvedValue({ data: { access_token: 'fresh-token', expires_in: 3600 } });

        await expect(ZohoAuth.getAccessToken()).resolves.toBe('fresh-token');
        expect(authCache.setToken).toHaveBeenCalledWith('zoho', 'refresh-1', 'fresh-token');
    });

    test('forceRefresh bypasses the cache', async () => {
        mockConnection({ refreshToken: 'refresh-1', accountsDomain: 'https://accounts.zoho.com' });
        authCache.getToken.mockResolvedValue('cached-token');
        axios.post.mockResolvedValue({ data: { access_token: 'fresh-token' } });

        await expect(ZohoAuth.getAccessToken({ forceRefresh: true })).resolves.toBe('fresh-token');
        expect(authCache.getToken).not.toHaveBeenCalled();
    });

    test('drops the cached token when the refresh token has been revoked', async () => {
        mockConnection({ refreshToken: 'refresh-1', accountsDomain: 'https://accounts.zoho.com' });
        axios.post.mockResolvedValue({ data: { error: 'invalid_grant' } });

        await expect(ZohoAuth.getAccessToken()).rejects.toMatchObject({ statusCode: 401 });

        // A dead refresh token must not leave a usable-looking cache entry behind.
        expect(authCache.invalidateToken).toHaveBeenCalledWith('zoho', 'refresh-1');
    });

    test('returns 428 when Zoho was never connected', async () => {
        mockConnection(null);

        await expect(ZohoAuth.getAccessToken()).rejects.toMatchObject({
            statusCode: 428,
            message: expect.stringMatching(/not connected/i)
        });
    });
});
