/**
 * Tests for authCache — cross-phase token / STS-credential cache (P1b).
 *
 * These lock the "same data" safety properties of the cache:
 *   - correct keying (by kind + refresh token) so no cross-account/stale hits
 *   - write→read roundtrip and explicit invalidation
 *   - TTL strictly below Amazon's 60min token expiry
 *   - FAIL-OPEN: any Redis problem (not initialised / op throws) degrades to a
 *     cache miss and never throws, so behaviour falls back to the uncached path
 *   - STS credentials cached in-process with TTL expiry
 */

// Controllable fake cache-Redis client. Implementations are (re)installed in
// beforeEach because the repo's jest config sets resetMocks: true.
const store = new Map();
let redisMode = 'ok'; // 'ok' | 'not-initialized' | 'throw-op'

const fakeClient = {
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
};

jest.mock('../../config/redisConn.js', () => ({
    connectRedis: jest.fn(),
    getRedisClient: jest.fn(),
}));

const { getRedisClient } = require('../../config/redisConn.js');
const authCache = require('../../utils/authCache.js');

beforeEach(() => {
    redisMode = 'ok';
    store.clear();

    fakeClient.get.mockImplementation(async (k) => {
        if (redisMode === 'throw-op') throw new Error('redis get failed');
        return store.has(k) ? store.get(k) : null;
    });
    fakeClient.setEx.mockImplementation(async (k, ttl, v) => {
        if (redisMode === 'throw-op') throw new Error('redis setEx failed');
        store.set(k, v);
    });
    fakeClient.del.mockImplementation(async (k) => {
        if (redisMode === 'throw-op') throw new Error('redis del failed');
        store.delete(k);
    });

    getRedisClient.mockImplementation(() => {
        if (redisMode === 'not-initialized') throw new Error('Redis client not initialized. Call connectRedis() first.');
        return fakeClient;
    });
});

describe('authCache token cache', () => {
    it('roundtrips a token by kind + refresh token', async () => {
        await authCache.setToken('sp', 'refresh-A', 'access-A');
        expect(await authCache.getToken('sp', 'refresh-A')).toBe('access-A');
    });

    it('writes with a TTL below Amazon token expiry (3600s)', async () => {
        await authCache.setToken('ads', 'refresh-A', 'tok');
        expect(fakeClient.setEx).toHaveBeenCalledWith(expect.any(String), authCache.TOKEN_TTL_SECONDS, 'tok');
        expect(authCache.TOKEN_TTL_SECONDS).toBeLessThan(3600);
    });

    it('is keyed by refresh token — a different refresh token misses', async () => {
        await authCache.setToken('sp', 'refresh-A', 'access-A');
        expect(await authCache.getToken('sp', 'refresh-B')).toBeNull();
    });

    it('is keyed by kind — sp and ads do not collide', async () => {
        await authCache.setToken('sp', 'refresh-A', 'sp-token');
        await authCache.setToken('ads', 'refresh-A', 'ads-token');
        expect(await authCache.getToken('sp', 'refresh-A')).toBe('sp-token');
        expect(await authCache.getToken('ads', 'refresh-A')).toBe('ads-token');
    });

    it('invalidateToken drops the entry so the next read misses (forces regeneration)', async () => {
        await authCache.setToken('sp', 'refresh-A', 'access-A');
        await authCache.invalidateToken('sp', 'refresh-A');
        expect(await authCache.getToken('sp', 'refresh-A')).toBeNull();
    });

    it('handles a missing refresh token without throwing', async () => {
        expect(await authCache.getToken('sp', null)).toBeNull();
        await expect(authCache.setToken('sp', null, 'x')).resolves.toBeUndefined();
        expect(fakeClient.setEx).not.toHaveBeenCalled();
    });

    it('does not cache a null/empty token', async () => {
        await authCache.setToken('sp', 'refresh-A', null);
        expect(fakeClient.setEx).not.toHaveBeenCalled();
    });
});

describe('authCache fail-open (data-safety)', () => {
    it('getToken returns null when Redis is not initialised', async () => {
        redisMode = 'not-initialized';
        expect(await authCache.getToken('sp', 'refresh-A')).toBeNull();
    });

    it('setToken / invalidateToken do not throw when Redis is not initialised', async () => {
        redisMode = 'not-initialized';
        await expect(authCache.setToken('sp', 'refresh-A', 'x')).resolves.toBeUndefined();
        await expect(authCache.invalidateToken('sp', 'refresh-A')).resolves.toBeUndefined();
    });

    it('getToken returns null (miss) when a Redis op throws', async () => {
        redisMode = 'throw-op';
        expect(await authCache.getToken('sp', 'refresh-A')).toBeNull();
    });

    it('setToken swallows Redis op errors', async () => {
        redisMode = 'throw-op';
        await expect(authCache.setToken('sp', 'refresh-A', 'x')).resolves.toBeUndefined();
    });
});

describe('authCache STS in-process cache', () => {
    it('roundtrips credentials by region config', () => {
        expect(authCache.getCredentials({ region: 'sts-r1' })).toBeNull();
        const creds = { AccessKey: 'a', SecretKey: 's', SessionToken: 't' };
        authCache.setCredentials({ region: 'sts-r1' }, creds);
        expect(authCache.getCredentials({ region: 'sts-r1' })).toEqual(creds);
    });

    it('different region configs do not collide', () => {
        authCache.setCredentials({ region: 'sts-na' }, { AccessKey: 'na' });
        authCache.setCredentials({ region: 'sts-eu' }, { AccessKey: 'eu' });
        expect(authCache.getCredentials({ region: 'sts-na' }).AccessKey).toBe('na');
        expect(authCache.getCredentials({ region: 'sts-eu' }).AccessKey).toBe('eu');
    });

    it('expires credentials after the TTL window', () => {
        const t0 = 1_000_000;
        const spy = jest.spyOn(Date, 'now').mockReturnValue(t0);
        authCache.setCredentials({ region: 'sts-ttl' }, { AccessKey: 'a' });
        expect(authCache.getCredentials({ region: 'sts-ttl' })).not.toBeNull();
        spy.mockReturnValue(t0 + authCache.STS_TTL_MS + 1);
        expect(authCache.getCredentials({ region: 'sts-ttl' })).toBeNull();
        spy.mockRestore();
    });
});
