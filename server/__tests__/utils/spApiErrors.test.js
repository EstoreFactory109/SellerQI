/**
 * Truth table for the SP-API failure classifier.
 *
 * Every payload below is a real shape observed from Amazon. The cases that matter most:
 *  - "already sent" (403 + "not available for this") must classify as BUSINESS, because
 *    Services/review/requests.js maps it to reviewRequestStatus:"sent". Misclassifying it
 *    would either refresh credentials pointlessly or mark healthy orders as failed.
 *  - The generic code:"Unauthorized" + "Access to requested resource is denied" shape must
 *    be AUTH_AMBIGUOUS, never TOKEN_EXPIRED — Amazon uses it for BOTH an expired token and a
 *    revoked grant, so only the caller's retry budget can tell them apart.
 */

const {
  classifySpApiFailure,
  isRefreshable,
  FAILURE,
  SpApiAuthDeniedError,
} = require('../../utils/spApiErrors.js');

describe('classifySpApiFailure', () => {
  const cases = [
    // [name, input, expected]
    ['429 throttle', { status: 429, body: { errors: [{ code: 'QuotaExceeded' }] } }, FAILURE.THROTTLE],
    ['503 transient', { status: 503, body: null }, FAILURE.THROTTLE],
    [
      'QuotaExceeded code without 429 status',
      { status: 400, body: { errors: [{ code: 'QuotaExceeded', message: 'slow down' }] } },
      FAILURE.THROTTLE,
    ],

    [
      'solicitation already sent',
      {
        status: 403,
        body: { errors: [{ code: 'InvalidInput', message: 'Solicitation type is not available for this amazonOrderId' }] },
      },
      FAILURE.BUSINESS,
    ],

    [
      'expired access token (details say so)',
      {
        status: 403,
        body: {
          errors: [
            { code: 'Unauthorized', message: 'Access to requested resource is denied.', details: 'Access token is expired or invalid' },
          ],
        },
      },
      FAILURE.TOKEN_EXPIRED,
    ],
    ['401 is always token expiry', { status: 401, body: null }, FAILURE.TOKEN_EXPIRED],
    [
      'InvalidAccessToken code',
      { status: 403, body: { errors: [{ code: 'InvalidAccessToken', message: 'nope' }] } },
      FAILURE.TOKEN_EXPIRED,
    ],

    [
      'STS session expired',
      { status: 403, body: { message: 'The security token included in the request is expired' } },
      FAILURE.CREDS_EXPIRED,
    ],
    [
      'SigV4 signature mismatch',
      { status: 403, body: { message: 'The request signature we calculated does not match the signature you provided.' } },
      FAILURE.CREDS_EXPIRED,
    ],
    [
      'AWS __type ExpiredTokenException',
      { status: 403, body: { __type: 'com.amazon.coral.service#ExpiredTokenException' } },
      FAILURE.CREDS_EXPIRED,
    ],

    [
      'restricted-data role not granted',
      {
        status: 403,
        body: { errors: [{ code: 'Unauthorized', message: 'You do not have permission to access the Restricted Data associated with this request.' }] },
      },
      FAILURE.AUTH_DENIED,
    ],
    [
      'access_denied',
      { status: 403, body: { errors: [{ code: 'Unauthorized', message: 'access_denied' }] } },
      FAILURE.AUTH_DENIED,
    ],

    [
      'generic Unauthorized/denied is AMBIGUOUS, not expiry',
      { status: 403, body: { errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }] } },
      FAILURE.AUTH_AMBIGUOUS,
    ],
    ['bare 403, null body', { status: 403, body: null }, FAILURE.AUTH_AMBIGUOUS],
    ['bare 403, HTML body', { status: 403, body: '<html>403 Forbidden</html>' }, FAILURE.AUTH_AMBIGUOUS],

    ['500', { status: 500, body: { errors: [{ code: 'InternalFailure' }] } }, FAILURE.OTHER],
    ['400 bad input', { status: 400, body: { errors: [{ code: 'InvalidInput', message: 'bad date' }] } }, FAILURE.OTHER],
    ['no args', undefined, FAILURE.OTHER],
  ];

  test.each(cases)('%s', (_name, input, expected) => {
    expect(classifySpApiFailure(input)).toBe(expected);
  });

  test('business 403 is checked before every other 403 rule', () => {
    // Even carrying denial-ish wording, "not available for this" wins — it is the
    // Solicitations API's normal "already sent" answer.
    const result = classifySpApiFailure({
      status: 403,
      body: {
        errors: [{ code: 'Unauthorized', message: 'Access denied — not available for this amazonOrderId' }],
      },
    });
    expect(result).toBe(FAILURE.BUSINESS);
  });

  test('a throttle carrying auth-ish wording is still a throttle', () => {
    const result = classifySpApiFailure({
      status: 429,
      body: { errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }] },
    });
    expect(result).toBe(FAILURE.THROTTLE);
  });
});

describe('isRefreshable', () => {
  test('only definitive expiry classifications are refreshable', () => {
    expect(isRefreshable(FAILURE.TOKEN_EXPIRED)).toBe(true);
    expect(isRefreshable(FAILURE.CREDS_EXPIRED)).toBe(true);

    expect(isRefreshable(FAILURE.AUTH_DENIED)).toBe(false);
    expect(isRefreshable(FAILURE.BUSINESS)).toBe(false);
    expect(isRefreshable(FAILURE.THROTTLE)).toBe(false);
    expect(isRefreshable(FAILURE.OTHER)).toBe(false);
    // Ambiguous is handled by the caller's occurrence budget, not this helper.
    expect(isRefreshable(FAILURE.AUTH_AMBIGUOUS)).toBe(false);
  });
});

describe('SpApiAuthDeniedError', () => {
  test('carries a stable code and the Amazon message for surfacing', () => {
    const err = new SpApiAuthDeniedError('denied', {
      amazonMessage: 'Access to requested resource is denied.',
      country: 'US',
      region: 'NA',
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SpApiAuthDeniedError');
    expect(err.code).toBe('SP_API_AUTH_DENIED');
    expect(err.amazonMessage).toBe('Access to requested resource is denied.');
    expect(err.country).toBe('US');
    expect(err.region).toBe('NA');
    expect(err.status).toBe(403);
  });
});
