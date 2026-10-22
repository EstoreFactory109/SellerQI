/**
 * Tests for TokenManager's token-Map eviction.
 *
 * WHY THIS EXISTS
 * `tokens` is a Map on a module singleton, keyed by userId, and nothing ever deleted from it — no
 * TTL, no cap, no eviction anywhere in the file. In a worker process that stays up for days while
 * the daily rotation walks the whole user base, it grew monotonically for the life of the process.
 *
 * A systematic sweep of the worker's 191-module require graph found it to be the ONE unambiguously
 * unbounded structure in there — everything else (authCache, the queue/Redis singletons, the
 * lock-extension timer) turned out to be correctly bounded. A few KB per user means it was never
 * going to be the headline number by itself, but an unbounded Map is also how a much larger object
 * graph accidentally gets pinned later.
 *
 * The two directions both matter: stale entries must go, and a live entry must NOT be evicted —
 * dropping a valid token just forces an avoidable Amazon round-trip.
 */

jest.mock('../../Services/Sp_API/GenerateTokens.js', () => ({ generateAccessToken: jest.fn() }));
jest.mock('../../Services/AmazonAds/GenerateToken.js', () => ({ generateAdsAccessToken: jest.fn() }));
jest.mock('../../utils/Logger.js', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const tokenManager = require('../../utils/TokenManager.js');

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Entries are keyed by user AND credentials; every test entry here uses spR/adsR. */
const key = (userId) => tokenManager.keyFor(userId, 'spR', 'adsR');

/** Backdate an entry so it looks untouched, without waiting. */
function backdate(userId, ageMs) {
    const entry = tokenManager.tokens.get(key(userId));
    entry.lastRefresh = Date.now() - ageMs;
    entry.spApiTokenTime = Date.now() - ageMs;
    entry.adsTokenTime = Date.now() - ageMs;
}

beforeEach(() => {
    tokenManager.tokens.clear();
    tokenManager.refreshPromises.clear();
});

describe('stale entries are evicted', () => {
    test('an entry untouched past the TTL is dropped on the next write', async () => {
        tokenManager.setTokens('old-user', 'sp', 'ads', 'spR', 'adsR');
        backdate('old-user', SIX_HOURS + 60 * 1000);

        // Any subsequent write sweeps.
        tokenManager.setTokens('new-user', 'sp', 'ads', 'spR', 'adsR');

        expect(tokenManager.tokens.has(key('old-user'))).toBe(false);
        expect(tokenManager.tokens.has(key('new-user'))).toBe(true);
    });

    test('many stale entries are all dropped, so the Map cannot grow without bound', () => {
        // Write them all FIRST, then backdate. Backdating inside the loop would let each write
        // sweep the previous entry, so the Map would never actually reach 50 and the test would
        // prove nothing about bulk eviction.
        for (let i = 0; i < 50; i++) tokenManager.setTokens(`u${i}`, 'sp', 'ads', 'spR', 'adsR');
        for (let i = 0; i < 50; i++) backdate(`u${i}`, SIX_HOURS + 60 * 1000);
        expect(tokenManager.tokens.size).toBe(50);

        tokenManager.setTokens('fresh', 'sp', 'ads', 'spR', 'adsR');

        expect(tokenManager.tokens.size).toBe(1);
        expect(tokenManager.tokens.has(key('fresh'))).toBe(true);
    });
});

describe('live entries survive', () => {
    // THE OTHER DIRECTION. Evicting a valid token is not free — it forces an Amazon round-trip
    // that was not needed. The TTL is deliberately far longer than the 55-minute refresh cycle.
    test('a recently written entry is not evicted', () => {
        tokenManager.setTokens('warm-user', 'sp', 'ads', 'spR', 'adsR');
        tokenManager.setTokens('other-user', 'sp', 'ads', 'spR', 'adsR');

        expect(tokenManager.tokens.has(key('warm-user'))).toBe(true);
        expect(tokenManager.tokens.has(key('other-user'))).toBe(true);
    });

    test('an entry just inside the TTL survives', () => {
        tokenManager.setTokens('edge-user', 'sp', 'ads', 'spR', 'adsR');
        backdate('edge-user', SIX_HOURS - 60 * 1000);

        tokenManager.setTokens('trigger', 'sp', 'ads', 'spR', 'adsR');

        expect(tokenManager.tokens.has(key('edge-user'))).toBe(true);
    });

    // The TTL must comfortably exceed the 55-minute refresh threshold, or an account in normal
    // rotation would lose its token between uses.
    test('the TTL is longer than the refresh cycle it has to outlive', () => {
        tokenManager.setTokens('u', 'sp', 'ads', 'spR', 'adsR');
        backdate('u', 2 * 60 * 60 * 1000); // 2h — past refresh age, well inside the TTL
        tokenManager.setTokens('trigger', 'sp', 'ads', 'spR', 'adsR');
        expect(tokenManager.tokens.has(key('u'))).toBe(true);
    });
});

describe('eviction does not disturb behaviour', () => {
    test('setTokens still stores everything it did before', () => {
        tokenManager.setTokens('u1', 'spTok', 'adsTok', 'spRef', 'adsRef');
        const entry = tokenManager.getTokens('u1', 'spRef', 'adsRef');

        expect(entry).toEqual(expect.objectContaining({
            spApiToken: 'spTok', adsToken: 'adsTok',
            spRefreshToken: 'spRef', adsRefreshToken: 'adsRef',
        }));
        expect(typeof entry.lastRefresh).toBe('number');
    });

    test('an entry with no timestamps at all is treated as stale rather than throwing', () => {
        tokenManager.tokens.set('malformed', {});
        tokenManager.setTokens('trigger', 'sp', 'ads', 'spR', 'adsR');
        expect(tokenManager.tokens.has('malformed')).toBe(false);
    });
});

describe('one user with marketplaces in two regions', () => {
    // Each Amazon region has its own refresh tokens. Keyed by userId alone, the second region's
    // write replaced the first's, and the first region's next call went out with the wrong
    // region's access token.
    test('each region keeps its own access tokens', () => {
        tokenManager.setTokens('u1', 'na-sp', 'na-ads', 'naSpRef', 'naAdsRef');
        tokenManager.setTokens('u1', 'eu-sp', 'eu-ads', 'euSpRef', 'euAdsRef');

        expect(tokenManager.getTokens('u1', 'naSpRef', 'naAdsRef').spApiToken).toBe('na-sp');
        expect(tokenManager.getTokens('u1', 'euSpRef', 'euAdsRef').spApiToken).toBe('eu-sp');
    });

    test('countries in one region share credentials, so they share one entry', () => {
        tokenManager.setTokens('u1', 'old', 'old', 'euSpRef', 'euAdsRef');
        tokenManager.setTokens('u1', 'new', 'new', 'euSpRef', 'euAdsRef');
        expect(tokenManager.tokens.size).toBe(1);
        expect(tokenManager.getTokens('u1', 'euSpRef', 'euAdsRef').spApiToken).toBe('new');
    });

    test('a refresh for one region does not wait on, or reuse, the other region\'s refresh', async () => {
        const { generateAccessToken } = require('../../Services/Sp_API/GenerateTokens.js');
        const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
        generateAccessToken.mockImplementation(async (_u, refresh) => `access-for-${refresh}`);
        generateAdsAccessToken.mockImplementation(async (refresh) => `ads-for-${refresh}`);

        const [na, eu] = await Promise.all([
            tokenManager.getValidTokens('u1', 'naSpRef', 'naAdsRef'),
            tokenManager.getValidTokens('u1', 'euSpRef', 'euAdsRef'),
        ]);

        expect(na).toEqual({ spApiToken: 'access-for-naSpRef', adsToken: 'ads-for-naAdsRef' });
        expect(eu).toEqual({ spApiToken: 'access-for-euSpRef', adsToken: 'ads-for-euAdsRef' });
    });

    test('the key does not contain the raw refresh token', () => {
        expect(tokenManager.keyFor('u1', 'secret-refresh', 'other')).not.toContain('secret-refresh');
        expect(tokenManager.keyFor('u1')).toBe('u1');
    });
});
