/**
 * Eligibility check: a throttled / 5xx answer is NOT an answer about the order.
 * It used to come back as an error body with no `actions`, which the sender recorded as
 * "still ineligible" and deferred 24h.
 */
jest.mock('../../../Services/review/orders', () => ({
  signRequest: jest.fn(() => ({})),
  normalizeEndpoint: (e) => e,
}));

const {
  checkReviewEligibility,
  hasReviewSolicitationAction,
  isPermanentRefusal,
} = require('../../../Services/review/reviewRequestEligibility.js');
const { SpApiTransientError } = require('../../../utils/spApiErrors.js');

const cfg = {
  endpoint: 'https://sellingpartnerapi-na.amazon.com',
  marketplaceId: 'ATVPDKIKX0DER',
  awsAccessKeyId: 'k',
  awsSecretAccessKey: 's',
  awsRegion: 'us-east-1',
};

const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  json: async () => body,
});

describe('checkReviewEligibility transient handling', () => {
  beforeEach(() => {
    process.env.REVIEW_ELIGIBILITY_RETRY_BASE_MS = '0';
    global.fetch = jest.fn();
  });
  afterEach(() => {
    delete process.env.REVIEW_ELIGIBILITY_RETRY_BASE_MS;
    delete global.fetch;
  });

  test('retries a 429 and returns the real answer', async () => {
    const ok = { _embedded: { actions: [{ name: 'productReviewAndSellerFeedback' }] } };
    global.fetch
      .mockResolvedValueOnce(reply(429, { errors: [{ code: 'QuotaExceeded' }] }))
      .mockResolvedValueOnce(reply(200, ok));

    await expect(checkReviewEligibility('tok', 'O-1', cfg)).resolves.toEqual(ok);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('throws SpApiTransientError when throttling never clears (never returns an error body)', async () => {
    global.fetch.mockResolvedValue(reply(429, { errors: [{ code: 'QuotaExceeded', message: 'slow' }] }));

    await expect(checkReviewEligibility('tok', 'O-1', cfg)).rejects.toBeInstanceOf(SpApiTransientError);
    expect(global.fetch).toHaveBeenCalledTimes(4); // first try + 3 retries
  });

  test('a 5xx is treated like throttling', async () => {
    global.fetch.mockResolvedValue(reply(500, {}));
    await expect(checkReviewEligibility('tok', 'O-1', cfg)).rejects.toBeInstanceOf(SpApiTransientError);
  });

  test('a 4xx business answer is still returned as the answer', async () => {
    const body = { errors: [{ code: 'InvalidInput', message: 'multi-channel fulfillment order' }] };
    global.fetch.mockResolvedValue(reply(400, body));

    await expect(checkReviewEligibility('tok', 'O-1', cfg)).resolves.toEqual(body);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('hasReviewSolicitationAction', () => {
  test('true only when the review + seller feedback action is offered', () => {
    expect(hasReviewSolicitationAction({
      _embedded: { actions: [{ _links: { self: { name: 'productReviewAndSellerFeedback' } } }] },
    })).toBe(true);
    expect(hasReviewSolicitationAction({ payload: { actions: [{ name: 'productReviewAndSellerFeedback' }] } })).toBe(true);
  });

  test('false for no actions, errors, or an unrelated action', () => {
    expect(hasReviewSolicitationAction({ _embedded: { actions: [] } })).toBe(false);
    expect(hasReviewSolicitationAction({ errors: [{ message: 'x' }] })).toBe(false);
    expect(hasReviewSolicitationAction({ _embedded: { actions: [{ name: 'amazonMotors' }] } })).toBe(false);
    expect(hasReviewSolicitationAction(null)).toBe(false);
  });
});

describe('isPermanentRefusal', () => {
  test('multi-channel orders are permanent; other answers are not', () => {
    expect(isPermanentRefusal({ errors: [{ message: 'Attempted to access a multi-channel fulfillment order' }] })).toBe(true);
    expect(isPermanentRefusal({ _embedded: { actions: [] } })).toBe(false);
    expect(isPermanentRefusal({ errors: [{ message: 'Access denied' }] })).toBe(false);
  });
});
