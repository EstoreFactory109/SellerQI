/**
 * Tests for the long-run SP-API credential provider.
 *
 * The behaviours that actually prevent the 61-minute `Orders API failed: 403`:
 *  - proactive re-mint once a credential nears its ~60 min life
 *  - concurrent-refresh dedupe (the sender can see many auth failures at once)
 *  - hard guards around two upstream helpers that fail *quietly*: generateAccessToken
 *    returns `false` instead of throwing, and getTemporaryCredentials swallows its error and
 *    returns undefined. Either one, unchecked, yields a bogus signature and a 403 that looks
 *    exactly like a real authorization denial.
 */

jest.mock('../../Services/Sp_API/GenerateTokens.js', () => ({
  generateAccessToken: jest.fn(),
}));
jest.mock('../../utils/GenerateTemporaryCredentials.js', () => jest.fn());
jest.mock('../../utils/authCache.js', () => ({
  getToken: jest.fn(),
  setToken: jest.fn(),
  invalidateToken: jest.fn(),
  getCredentials: jest.fn(),
  setCredentials: jest.fn(),
  TOKEN_TTL_SECONDS: 3000,
  STS_TTL_MS: 50 * 60 * 1000,
}));

const { generateAccessToken } = require('../../Services/Sp_API/GenerateTokens.js');
const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');
const authCache = require('../../utils/authCache.js');
const { createSpApiCredentialProvider } = require('../../utils/spApiCredentials.js');
const { FAILURE } = require('../../utils/spApiErrors.js');

const STS = { AccessKey: 'AK1', SecretKey: 'SK1', SessionToken: 'ST1' };
const STS2 = { AccessKey: 'AK2', SecretKey: 'SK2', SessionToken: 'ST2' };

const baseArgs = () => ({
  userId: 'user-1',
  spiRefreshToken: 'refresh-abc',
  awsRegion: 'us-east-1',
});

beforeEach(() => {
  let n = 0;
  generateAccessToken.mockImplementation(async () => `token-${++n}`);
  getTemporaryCredentials.mockResolvedValue(STS);
  authCache.getToken.mockResolvedValue(null);
  authCache.getCredentials.mockReturnValue(null);
  authCache.invalidateToken.mockResolvedValue(undefined);
  authCache.setCredentials.mockReturnValue(undefined);
});

describe('construction', () => {
  test('requires a refresh token and a region', () => {
    expect(() => createSpApiCredentialProvider({ ...baseArgs(), spiRefreshToken: null }))
      .toThrow(/spiRefreshToken is required/);
    expect(() => createSpApiCredentialProvider({ ...baseArgs(), awsRegion: null }))
      .toThrow(/awsRegion is required/);
  });
});

describe('adopting already-minted credentials', () => {
  test('inherited credentials are used without an extra LWA/STS call', async () => {
    const provider = createSpApiCredentialProvider({
      ...baseArgs(),
      initialAccessToken: 'inherited-token',
      initialAwsCreds: STS,
    });

    const { accessToken, awsConfig } = await provider.getValid();

    expect(accessToken).toBe('inherited-token');
    expect(awsConfig).toEqual({
      awsAccessKeyId: 'AK1',
      awsSecretAccessKey: 'SK1',
      awsRegion: 'us-east-1',
      awsSessionToken: 'ST1',
    });
    // The whole point: the scheduled processors already minted these, so the happy path
    // must not pay for them twice.
    expect(generateAccessToken).not.toHaveBeenCalled();
    expect(getTemporaryCredentials).not.toHaveBeenCalled();
  });

  test('an incomplete STS object is rejected and re-minted', async () => {
    const provider = createSpApiCredentialProvider({
      ...baseArgs(),
      initialAccessToken: 'inherited-token',
      initialAwsCreds: { AccessKey: 'AK', SecretKey: 'SK' }, // no SessionToken
    });

    await provider.getValid();

    expect(getTemporaryCredentials).toHaveBeenCalledTimes(1);
  });

  test('with nothing inherited, both halves are minted', async () => {
    const provider = createSpApiCredentialProvider(baseArgs());

    const { accessToken } = await provider.getValid();

    expect(accessToken).toBe('token-1');
    expect(generateAccessToken).toHaveBeenCalledWith('user-1', 'refresh-abc', expect.any(Object));
    expect(getTemporaryCredentials).toHaveBeenCalledWith('us-east-1');
  });

  test('a token cached by an earlier phase is adopted instead of minting', async () => {
    authCache.getToken.mockResolvedValue('cached-token');
    const provider = createSpApiCredentialProvider(baseArgs());

    const { accessToken } = await provider.getValid();

    expect(accessToken).toBe('cached-token');
    expect(generateAccessToken).not.toHaveBeenCalled();
  });
});

describe('proactive staleness refresh (the 61-minute fix)', () => {
  test('an inherited token is re-minted shortly after adoption', async () => {
    jest.useFakeTimers();
    try {
      const provider = createSpApiCredentialProvider({
        ...baseArgs(),
        initialAccessToken: 'inherited-token',
        initialAwsCreds: STS,
      });

      // Inherited credentials are treated as having ~5 min of life left.
      expect((await provider.getValid()).accessToken).toBe('inherited-token');

      await jest.advanceTimersByTimeAsync(6 * 60 * 1000);
      expect((await provider.getValid()).accessToken).toBe('token-1');
      expect(generateAccessToken).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a freshly minted token is re-minted before Amazon 60-min expiry, not after', async () => {
    jest.useFakeTimers();
    try {
      const provider = createSpApiCredentialProvider(baseArgs());
      expect((await provider.getValid()).accessToken).toBe('token-1');

      // 49 min — still inside the 50 min staleness threshold.
      await jest.advanceTimersByTimeAsync(49 * 60 * 1000);
      expect((await provider.getValid()).accessToken).toBe('token-1');

      // Cross 50 min: re-minted while the old token is still valid to Amazon, so no request
      // is ever signed with an expired credential.
      await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect((await provider.getValid()).accessToken).toBe('token-2');
    } finally {
      jest.useRealTimers();
    }
  });

  test('STS is re-minted at its own (shorter) threshold', async () => {
    jest.useFakeTimers();
    try {
      getTemporaryCredentials.mockResolvedValueOnce(STS).mockResolvedValueOnce(STS2);
      const provider = createSpApiCredentialProvider(baseArgs());
      await provider.getValid();

      await jest.advanceTimersByTimeAsync(46 * 60 * 1000); // > STS_STALE_MS (45 min)
      const { awsConfig } = await provider.getValid();

      expect(awsConfig.awsAccessKeyId).toBe('AK2');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('hard guards on quietly-failing helpers', () => {
  test('generateAccessToken returning false throws with Amazon\'s reason', async () => {
    generateAccessToken.mockImplementation(async (_u, _r, errorRef) => {
      if (errorRef) errorRef.message = 'invalid_grant : refresh token revoked';
      return false;
    });
    const provider = createSpApiCredentialProvider(baseArgs());

    await expect(provider.getValid()).rejects.toThrow(/invalid_grant : refresh token revoked/);
  });

  test('generateAccessToken failing with no reason still throws', async () => {
    generateAccessToken.mockResolvedValue(false);
    const provider = createSpApiCredentialProvider(baseArgs());

    await expect(provider.getValid()).rejects.toThrow(/failed to mint SP-API access token/);
  });

  test('getTemporaryCredentials returning undefined throws instead of yielding bad keys', async () => {
    // This is the dangerous one: AssumeRole errors are swallowed upstream, so without this
    // guard we would sign with undefined keys and get a 403 indistinguishable from a denial.
    getTemporaryCredentials.mockResolvedValue(undefined);
    const provider = createSpApiCredentialProvider(baseArgs());

    await expect(provider.getValid()).rejects.toThrow(/failed to obtain AWS STS credentials/);
  });
});

describe('concurrent-refresh dedupe', () => {
  test('many simultaneous token refreshes collapse into one mint', async () => {
    const provider = createSpApiCredentialProvider(baseArgs());

    const results = await Promise.all([
      provider.refreshAccessToken('reactive'),
      provider.refreshAccessToken('reactive'),
      provider.refreshAccessToken('reactive'),
      provider.refreshAccessToken('reactive'),
      provider.refreshAccessToken('reactive'),
    ]);

    expect(generateAccessToken).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
  });

  test('many simultaneous STS refreshes collapse into one mint', async () => {
    const provider = createSpApiCredentialProvider(baseArgs());

    await Promise.all([
      provider.refreshAwsCreds('reactive'),
      provider.refreshAwsCreds('reactive'),
      provider.refreshAwsCreds('reactive'),
    ]);

    expect(getTemporaryCredentials).toHaveBeenCalledTimes(1);
  });

  test('a later refresh after the first settles does mint again', async () => {
    const provider = createSpApiCredentialProvider(baseArgs());

    await provider.refreshAccessToken('reactive');
    await provider.refreshAccessToken('reactive');

    expect(generateAccessToken).toHaveBeenCalledTimes(2);
  });
});

describe('refreshFor(classification)', () => {
  test('CREDS_EXPIRED re-mints STS only', async () => {
    const provider = createSpApiCredentialProvider({
      ...baseArgs(),
      initialAccessToken: 'tok',
      initialAwsCreds: STS,
    });

    const refreshed = await provider.refreshFor(FAILURE.CREDS_EXPIRED);

    expect(refreshed).toBe(true);
    expect(getTemporaryCredentials).toHaveBeenCalledTimes(1);
    expect(generateAccessToken).not.toHaveBeenCalled();
  });

  test('TOKEN_EXPIRED re-mints the access token', async () => {
    const provider = createSpApiCredentialProvider({
      ...baseArgs(),
      initialAccessToken: 'tok',
      initialAwsCreds: STS,
    });

    const refreshed = await provider.refreshFor(FAILURE.TOKEN_EXPIRED);

    expect(refreshed).toBe(true);
    expect(generateAccessToken).toHaveBeenCalledTimes(1);
  });

  test('AUTH_AMBIGUOUS re-mints the access token (most often really an expiry)', async () => {
    const provider = createSpApiCredentialProvider({
      ...baseArgs(),
      initialAccessToken: 'tok',
      initialAwsCreds: STS,
    });

    expect(await provider.refreshFor(FAILURE.AUTH_AMBIGUOUS)).toBe(true);
    expect(generateAccessToken).toHaveBeenCalledTimes(1);
  });

  test('non-auth classifications refresh nothing', async () => {
    const provider = createSpApiCredentialProvider({
      ...baseArgs(),
      initialAccessToken: 'tok',
      initialAwsCreds: STS,
    });

    expect(await provider.refreshFor(FAILURE.BUSINESS)).toBe(false);
    expect(await provider.refreshFor(FAILURE.THROTTLE)).toBe(false);
    expect(await provider.refreshFor(FAILURE.AUTH_DENIED)).toBe(false);
    expect(await provider.refreshFor(FAILURE.OTHER)).toBe(false);

    expect(generateAccessToken).not.toHaveBeenCalled();
    expect(getTemporaryCredentials).not.toHaveBeenCalled();
  });
});

describe('authCache interaction', () => {
  test('a reactive refresh drops the cached token before minting', async () => {
    const provider = createSpApiCredentialProvider({
      ...baseArgs(),
      initialAccessToken: 'tok',
      initialAwsCreds: STS,
    });

    await provider.refreshAccessToken('reactive');

    // Otherwise a concurrent phase could keep serving the token that just failed for the
    // remainder of its 50-min TTL.
    expect(authCache.invalidateToken).toHaveBeenCalledWith('sp', 'refresh-abc');
  });

  test('a proactive refresh does not invalidate (the old token is still good)', async () => {
    const provider = createSpApiCredentialProvider(baseArgs());

    await provider.getValid(); // proactive first mint

    expect(authCache.invalidateToken).not.toHaveBeenCalled();
  });

  test('fresh STS credentials are written through to the in-process cache', async () => {
    const provider = createSpApiCredentialProvider(baseArgs());

    await provider.getValid();

    expect(authCache.setCredentials).toHaveBeenCalledWith('us-east-1', STS);
  });
});
