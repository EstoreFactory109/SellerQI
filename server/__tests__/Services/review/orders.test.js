/**
 * Tests for the Orders API auth-refresh behaviour added to Services/review/orders.js.
 *
 * The single most important property here is the FIRST describe block: with no credential
 * provider supplied, every code path must behave exactly as it did before credential refresh
 * existed. That is what guarantees the accounts already ingesting successfully are untouched.
 */

const {
  fetchOrdersPageWithRetry,
  computeOrdersBackoffMs,
} = require('../../../Services/review/orders.js');
const { SpApiAuthDeniedError } = require('../../../utils/spApiErrors.js');

// Minimal stand-in for a fetch Response. Named spResponse so it does not collide with the
// global Express `mockResponse` helper installed by __tests__/setup.js.
function spResponse({ status = 200, body = null, headers = {}, unparsable = false } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() in lower ? lower[k.toLowerCase()] : null) },
    json: async () => {
      if (unparsable) throw new Error('invalid json');
      return body;
    },
  };
}

// Bodies mirroring what Amazon actually returns (verified against production payloads).
const BODY_TOKEN_EXPIRED = {
  errors: [
    {
      code: 'Unauthorized',
      message: 'Access to requested resource is denied.',
      details: 'Access token is expired or invalid',
    },
  ],
};
const BODY_AUTH_DENIED = {
  errors: [
    {
      code: 'Unauthorized',
      message: 'You do not have permission to access the Restricted Data associated with this request.',
    },
  ],
};
// The generic shape Amazon uses for BOTH an expired token and a revoked grant.
const BODY_AMBIGUOUS = {
  errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }],
};
const BODY_OK = { payload: { Orders: [{ AmazonOrderId: '111-1' }], NextToken: null } };

function makeProvider() {
  const provider = {
    getValid: jest.fn(async () => ({
      accessToken: `tok-${provider.getValid.mock.calls.length}`,
      awsConfig: {
        awsAccessKeyId: 'AK',
        awsSecretAccessKey: 'SK',
        awsRegion: 'us-east-1',
        awsSessionToken: 'ST',
      },
    })),
    refreshFor: jest.fn(async () => true),
    refreshAccessToken: jest.fn(async () => 'tok-new'),
    refreshAwsCreds: jest.fn(async () => ({})),
    refreshCount: 0,
  };
  return provider;
}

const buildHeaders = (creds) => ({ 'x-amz-access-token': creds ? creds.accessToken : 'legacy' });

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete global.fetch;
});

describe('no credential provider — behaviour must be unchanged (regression guard)', () => {
  test('403 throws the original "Orders API failed: 403" and does not retry', async () => {
    global.fetch.mockResolvedValue(spResponse({ status: 403, body: BODY_TOKEN_EXPIRED }));

    await expect(fetchOrdersPageWithRetry('https://x/orders/v0/orders', buildHeaders))
      .rejects.toThrow('Orders API failed: 403');

    // Critically: exactly one call. No refresh, no retry — same as before this change.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a denial-shaped 403 also throws the plain Error, not SpApiAuthDeniedError', async () => {
    global.fetch.mockResolvedValue(spResponse({ status: 403, body: BODY_AUTH_DENIED }));

    const err = await fetchOrdersPageWithRetry('https://x', buildHeaders).catch((e) => e);
    expect(err).not.toBeInstanceOf(SpApiAuthDeniedError);
    expect(err.message).toBe('Orders API failed: 403');
  });

  test('buildHeaders receives null so callers sign with their own token', async () => {
    global.fetch.mockResolvedValue(spResponse({ status: 200, body: BODY_OK }));
    const spy = jest.fn(buildHeaders);

    await fetchOrdersPageWithRetry('https://x', spy);

    expect(spy).toHaveBeenCalledWith(null);
  });

  test('success returns data plus the rate-limit-derived delay', async () => {
    global.fetch.mockResolvedValue(
      spResponse({ status: 200, body: BODY_OK, headers: { 'x-amzn-RateLimit-Limit': '0.5' } })
    );

    const { data, recommendedNextDelayMs } = await fetchOrdersPageWithRetry('https://x', buildHeaders);

    expect(data).toEqual(BODY_OK);
    expect(recommendedNextDelayMs).toBe(2500); // (1000/0.5) * 1.25
  });
});

describe('with a credential provider', () => {
  test('an expired token is refreshed and the SAME page retried, then succeeds', async () => {
    const provider = makeProvider();
    global.fetch
      .mockResolvedValueOnce(spResponse({ status: 403, body: BODY_TOKEN_EXPIRED }))
      .mockResolvedValueOnce(spResponse({ status: 200, body: BODY_OK }));

    const { data } = await fetchOrdersPageWithRetry('https://x', buildHeaders, provider);

    expect(data).toEqual(BODY_OK);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(provider.refreshFor).toHaveBeenCalledTimes(1);
    expect(provider.refreshFor).toHaveBeenCalledWith('token_expired');
  });

  test('a genuine denial fails fast with SpApiAuthDeniedError and never refreshes', async () => {
    const provider = makeProvider();
    global.fetch.mockResolvedValue(spResponse({ status: 403, body: BODY_AUTH_DENIED }));

    await expect(fetchOrdersPageWithRetry('https://x', buildHeaders, provider))
      .rejects.toBeInstanceOf(SpApiAuthDeniedError);

    // This is the whole point of classification: no refresh storm on a doomed account.
    expect(provider.refreshFor).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a persistently ambiguous 403 escalates to a denial after its retry budget', async () => {
    jest.useFakeTimers();
    try {
      const provider = makeProvider();
      global.fetch.mockResolvedValue(spResponse({ status: 403, body: BODY_AMBIGUOUS }));

      const promise = fetchOrdersPageWithRetry('https://x', buildHeaders, provider);
      const assertion = expect(promise).rejects.toBeInstanceOf(SpApiAuthDeniedError);
      // Two ambiguous retries, each preceded by a 5s backoff.
      await jest.advanceTimersByTimeAsync(20000);
      await assertion;

      // Bounded: ~10s wasted on a de-authorized account, not an hour.
      expect(provider.refreshFor).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  test('an ambiguous 403 that clears after refresh succeeds (the 61-minute case)', async () => {
    jest.useFakeTimers();
    try {
      const provider = makeProvider();
      global.fetch
        .mockResolvedValueOnce(spResponse({ status: 403, body: BODY_AMBIGUOUS }))
        .mockResolvedValueOnce(spResponse({ status: 200, body: BODY_OK }));

      const promise = fetchOrdersPageWithRetry('https://x', buildHeaders, provider);
      await jest.advanceTimersByTimeAsync(6000);
      const { data } = await promise;

      expect(data).toEqual(BODY_OK);
      expect(provider.refreshFor).toHaveBeenCalledWith('auth_ambiguous');
    } finally {
      jest.useRealTimers();
    }
  });

  test('a transient ambiguous 403 that clears on the SECOND retry still succeeds', async () => {
    // Two unlucky back-to-back transient 403s must not be misread as a revoked grant.
    jest.useFakeTimers();
    try {
      const provider = makeProvider();
      global.fetch
        .mockResolvedValueOnce(spResponse({ status: 403, body: BODY_AMBIGUOUS }))
        .mockResolvedValueOnce(spResponse({ status: 403, body: BODY_AMBIGUOUS }))
        .mockResolvedValueOnce(spResponse({ status: 200, body: BODY_OK }));

      const promise = fetchOrdersPageWithRetry('https://x', buildHeaders, provider);
      await jest.advanceTimersByTimeAsync(15000);
      const { data } = await promise;

      expect(data).toEqual(BODY_OK);
      expect(provider.refreshFor).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a bare 403 with an unparsable body is treated as ambiguous, not fatal', async () => {
    jest.useFakeTimers();
    try {
      const provider = makeProvider();
      global.fetch
        .mockResolvedValueOnce(spResponse({ status: 403, unparsable: true }))
        .mockResolvedValueOnce(spResponse({ status: 200, body: BODY_OK }));

      const promise = fetchOrdersPageWithRetry('https://x', buildHeaders, provider);
      await jest.advanceTimersByTimeAsync(6000);
      const { data } = await promise;

      expect(data).toEqual(BODY_OK);
      expect(provider.refreshFor).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('definitive token expiry allows 2 refreshes, then surfaces the original error', async () => {
    const provider = makeProvider();
    global.fetch.mockResolvedValue(spResponse({ status: 403, body: BODY_TOKEN_EXPIRED }));

    await expect(fetchOrdersPageWithRetry('https://x', buildHeaders, provider))
      .rejects.toThrow('Orders API failed: 403');

    expect(provider.refreshFor).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('credentials are re-read before every attempt, so headers use the fresh token', async () => {
    const provider = makeProvider();
    global.fetch
      .mockResolvedValueOnce(spResponse({ status: 403, body: BODY_TOKEN_EXPIRED }))
      .mockResolvedValueOnce(spResponse({ status: 200, body: BODY_OK }));

    await fetchOrdersPageWithRetry('https://x', buildHeaders, provider);

    expect(provider.getValid).toHaveBeenCalledTimes(2);
    const [first, second] = global.fetch.mock.calls;
    expect(first[1].headers['x-amz-access-token']).toBe('tok-1');
    expect(second[1].headers['x-amz-access-token']).toBe('tok-2');
  });

  test('a 4xx that is not auth-related is not retried', async () => {
    const provider = makeProvider();
    global.fetch.mockResolvedValue(
      spResponse({ status: 400, body: { errors: [{ code: 'InvalidInput', message: 'bad date' }] } })
    );

    await expect(fetchOrdersPageWithRetry('https://x', buildHeaders, provider))
      .rejects.toThrow('Orders API failed: 400');

    expect(provider.refreshFor).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('throttle handling is unaffected by the auth changes', () => {
  test('429 backs off and retries, and an auth refresh does not consume that budget', async () => {
    jest.useFakeTimers();
    try {
      const provider = makeProvider();
      // token expiry (auth retry) → 429 (throttle retry) → success.
      global.fetch
        .mockResolvedValueOnce(spResponse({ status: 403, body: BODY_TOKEN_EXPIRED }))
        .mockResolvedValueOnce(spResponse({ status: 429, headers: { 'retry-after': '1' } }))
        .mockResolvedValueOnce(spResponse({ status: 200, body: BODY_OK }));

      const promise = fetchOrdersPageWithRetry('https://x', buildHeaders, provider);
      // Let the auth retry (no timer) and then the 60s throttle floor elapse.
      await jest.advanceTimersByTimeAsync(70000);
      const { data } = await promise;

      expect(data).toEqual(BODY_OK);
      expect(provider.refreshFor).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  test('computeOrdersBackoffMs honours retry-after but floors 429 at the refill rate', () => {
    const withRetryAfter = spResponse({ status: 429, headers: { 'retry-after': '120' } });
    expect(computeOrdersBackoffMs(withRetryAfter, 0)).toBe(120000);

    // No retry-after → never less than the 60s sustained-rate floor on a 429.
    const bare429 = spResponse({ status: 429 });
    expect(computeOrdersBackoffMs(bare429, 0)).toBeGreaterThanOrEqual(60000);

    // 503 is not rate-limited, so it may back off faster than the 429 floor.
    const bare503 = spResponse({ status: 503 });
    expect(computeOrdersBackoffMs(bare503, 0)).toBeLessThan(60000);
  });
});
