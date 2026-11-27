/**
 * processReviewRequests: what gets written for each Amazon answer.
 * The behaviours that matter: a transient Amazon failure never marks an order failed or
 * ineligible; check-only mode never sends; a wrong action is not "eligible".
 */
const mockFind = jest.fn();
const mockUpdateOne = jest.fn().mockResolvedValue({});
jest.mock('../../../models/review/ReviewOrderModel', () => ({
  find: (...a) => mockFind(...a),
  updateOne: (...a) => mockUpdateOne(...a),
}));

const mockSend = jest.fn();
jest.mock('../../../Services/review/requests', () => ({
  sendReviewRequest: (...a) => mockSend(...a),
}));

const mockCheck = jest.fn();
jest.mock('../../../Services/review/reviewRequestEligibility', () => ({
  ...jest.requireActual('../../../Services/review/reviewRequestEligibility'),
  checkReviewEligibility: (...a) => mockCheck(...a),
}));

jest.mock('../../../Services/review/orders', () => ({
  ORDER_CONFIG: { minOrderAgeDays: 5, firstCheckAgeDays: 6, maxOrderAgeDays: 45 },
  signRequest: jest.fn(),
  normalizeEndpoint: (e) => e,
}));

const { processReviewRequests, createPacer, recheckHoursForIneligible } = require('../../../Services/review/reviewRequestSenderService.js');
const { SpApiAuthDeniedError, SpApiTransientError } = require('../../../utils/spApiErrors.js');

const DAY = 24 * 60 * 60 * 1000;
const order = (id, extra = {}) => ({
  _id: id,
  amazonOrderId: id,
  canRequestReview: null,
  purchaseDate: new Date(Date.now() - 10 * DAY),
  ...extra,
});
const ELIGIBLE = { _embedded: { actions: [{ name: 'productReviewAndSellerFeedback' }] } };

const limits = [];
const sorts = [];
const run = (orders, opts = {}) => {
  limits.length = 0;
  sorts.length = 0;
  const chain = (rows) => ({
    sort: (s) => ({ limit: (n) => { limits.push(n); sorts.push(s); return { select: () => ({ lean: async () => rows }) }; } }),
  });
  // First call = likely-live ages, second call (leftover capacity) = the older tail.
  mockFind.mockReset();
  mockFind.mockReturnValueOnce(chain(orders)).mockReturnValue(chain([]));
  return processReviewRequests({
    userId: 'u1', country: 'US', region: 'NA', accessToken: 't', awsConfig: {}, ...opts,
  });
};
const writesFor = (id) => mockUpdateOne.mock.calls.filter(([f]) => f._id === id).map(([, u]) => u);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// The loop sleeps 5s between calls; fake timers keep the tests instant.
const finish = async (p) => {
  for (let i = 0; i < 200; i++) {
    await jest.advanceTimersByTimeAsync(5000);
  }
  return p;
};

test('eligible order is checked then sent', async () => {
  mockCheck.mockResolvedValue(ELIGIBLE);
  mockSend.mockResolvedValue({ success: true });

  const summary = await finish(run([order('A')]));

  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(summary).toMatchObject({ sent: 1, stillIneligible: 0 });
  expect(writesFor('A').some((u) => u.$set.reviewRequestStatus === 'sent')).toBe(true);
});

test('a response with only an unrelated action is NOT eligible', async () => {
  mockCheck.mockResolvedValue({ _embedded: { actions: [{ name: 'amazonMotors' }] } });

  const summary = await finish(run([order('A')]));

  expect(mockSend).not.toHaveBeenCalled();
  expect(summary.stillIneligible).toBe(1);
});

test('a transient Amazon failure leaves the order untouched (no failed, no 24h deferral)', async () => {
  mockCheck.mockRejectedValue(new SpApiTransientError('throttled', { status: 429 }));

  const summary = await finish(run([order('A')]));

  expect(summary).toMatchObject({ checkErrors: 1, failed: 0, stillIneligible: 0 });
  expect(writesFor('A')).toHaveLength(0);
});

test('stops the run after repeated no-answer results', async () => {
  mockCheck.mockRejectedValue(new SpApiTransientError('throttled', { status: 429 }));
  const many = Array.from({ length: 12 }, (_, i) => order(`O${i}`));

  const summary = await finish(run(many));

  expect(summary.stoppedEarly).toBe('throttled');
  expect(summary.processed).toBeLessThan(12);
  expect(mockUpdateOne).not.toHaveBeenCalled();
});

test('a throttled send is not recorded as failed', async () => {
  mockSend.mockResolvedValue({ success: false, alreadySent: false, status: 429, error: 'QuotaExceeded' });

  const summary = await finish(run([order('A', { canRequestReview: true })]));

  expect(summary).toMatchObject({ checkErrors: 1, failed: 0 });
  expect(writesFor('A')).toHaveLength(0);
});

test('a real send error is still recorded as failed', async () => {
  mockSend.mockResolvedValue({ success: false, alreadySent: false, status: 400, error: 'bad' });

  const summary = await finish(run([order('A', { canRequestReview: true })]));

  expect(summary.failed).toBe(1);
  expect(writesFor('A')[0].$set.reviewRequestStatus).toBe('failed');
  // Its own timestamp, so the weekly report counts it once (updatedAt moves on ingestion).
  expect(writesFor('A')[0].$set.reviewRequestFailedAt).toBeInstanceOf(Date);
});

test('multi-channel refusal stops re-checking (deferred past the window)', async () => {
  mockCheck.mockResolvedValue({ errors: [{ message: 'Attempted to access a multi-channel fulfillment order' }] });
  const o = order('A');

  await finish(run([o]));

  const next = writesFor('A')[0].$set.nextEligibilityCheckAt.getTime();
  expect(next).toBeGreaterThan(Date.now() + 30 * DAY - 1000 * 60 * 60 * 24 * 20); // far in the future
  expect(next).toBe(new Date(o.purchaseDate).getTime() + 46 * DAY);
});

test('ordinary "not yet" answers are re-checked in 24h, old orders in 72h', async () => {
  mockCheck.mockResolvedValue({ _embedded: { actions: [] } });
  const young = order('Y');
  const old = order('O', { purchaseDate: new Date(Date.now() - 40 * DAY) });

  await finish(run([old, young]));

  const hours = (id) =>
    Math.round((writesFor(id)[0].$set.nextEligibilityCheckAt.getTime() - Date.now()) / 3600000);
  expect(hours('Y')).toBeGreaterThanOrEqual(23);
  expect(hours('Y')).toBeLessThanOrEqual(25);
  expect(hours('O')).toBeGreaterThanOrEqual(71);
});

describe('checkOnly (auto-send off)', () => {
  test('records eligibility but never sends', async () => {
    mockCheck.mockResolvedValue(ELIGIBLE);

    const summary = await finish(run([order('A')], { checkOnly: true }));

    expect(mockSend).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ eligibleFound: 1, sent: 0, checkOnly: true });
    const set = writesFor('A')[0].$set;
    expect(set.canRequestReview).toBe(true);
    expect(set.nextEligibilityCheckAt.getTime()).toBeGreaterThan(Date.now() + 70 * 3600000);
    expect(set.reviewRequestStatus).toBeUndefined();
  });

  test('re-checks an already-eligible order instead of sending it', async () => {
    mockCheck.mockResolvedValue(ELIGIBLE);

    await finish(run([order('A', { canRequestReview: true })], { checkOnly: true }));

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  test('does not pull already-eligible orders into every run', async () => {
    mockCheck.mockResolvedValue(ELIGIBLE);
    await finish(run([], { checkOnly: true }));
    const filter = mockFind.mock.calls[0][0];
    expect(JSON.stringify(filter.$or)).not.toContain('canRequestReview');
  });
});

test('with sending on, orders already found eligible are due immediately', async () => {
  await finish(run([]));
  const filter = mockFind.mock.calls[0][0];
  expect(filter.$or).toContainEqual({ canRequestReview: true });
});

test('an authorization denial aborts without marking the order failed', async () => {
  mockCheck.mockRejectedValue(new SpApiAuthDeniedError('denied'));

  const p = run([order('A'), order('B')]);
  p.catch(() => {});
  await finish(p.catch(() => {}));

  await expect(p).rejects.toBeInstanceOf(SpApiAuthDeniedError);
  expect(mockUpdateOne).not.toHaveBeenCalled();
});

test('likely-live ages are fetched first; the old tail only gets leftover capacity', async () => {
  await finish(run([order('A')]));

  expect(mockFind).toHaveBeenCalledTimes(2);
  const [live, tail] = mockFind.mock.calls.map(([f]) => f.purchaseDate);
  const ageOf = (d) => Math.round((Date.now() - d.getTime()) / DAY);
  expect(ageOf(live.$gte)).toBe(32);
  expect(ageOf(live.$lte)).toBe(6);
  expect(ageOf(tail.$gte)).toBe(45);
  expect(tail.$lt.getTime()).toBe(live.$gte.getTime());
});

test('the old tail is skipped when the likely-live pass already fills the cap', async () => {
  // The cap is read at import time, so load a copy of the module with a tiny one.
  process.env.REVIEW_SENDER_MAX_ORDERS_PER_RUN = '2';
  let small;
  jest.isolateModules(() => {
    small = require('../../../Services/review/reviewRequestSenderService.js').processReviewRequests;
  });
  delete process.env.REVIEW_SENDER_MAX_ORDERS_PER_RUN;

  mockCheck.mockResolvedValue({ _embedded: { actions: [] } });
  const chain = (rows) => ({
    sort: () => ({ limit: () => ({ select: () => ({ lean: async () => rows }) }) }),
  });
  mockFind.mockReset();
  mockFind.mockReturnValueOnce(chain([order('A'), order('B')])).mockReturnValue(chain([]));

  await finish(small({ userId: 'u1', country: 'US', region: 'NA', accessToken: 't', awsConfig: {} }));

  expect(mockFind).toHaveBeenCalledTimes(1);
});

describe('pacing', () => {
  test('keeps calls at least spacingMs apart and does not sleep when the gap already passed', async () => {
    const pacer = createPacer({ spacingMs: 1000 });
    const times = [];
    const p = (async () => {
      for (let i = 0; i < 3; i++) { await pacer.wait(); times.push(Date.now()); }
    })();
    await jest.advanceTimersByTimeAsync(5000);
    await p;
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(1000);

    await jest.advanceTimersByTimeAsync(5000); // long idle: next call goes straight through
    const before = Date.now();
    await pacer.wait();
    expect(Date.now() - before).toBe(0);
  });

  test('slows down when Amazon pushes back (capped) and eases back to the base pace', () => {
    const pacer = createPacer({ spacingMs: 1000, maxSpacingMs: 4000 });
    pacer.slowDown(); expect(pacer.spacingMs).toBe(2000);
    pacer.slowDown(); pacer.slowDown(); expect(pacer.spacingMs).toBe(4000);
    for (let i = 0; i < 20; i++) pacer.speedUp();
    expect(pacer.spacingMs).toBe(1000);
  });
});

describe('limits', () => {
  test('auto-send accounts use the big cap; check-only accounts the small one', async () => {
    await finish(run([]));
    expect(limits[0]).toBe(60000);
    await finish(run([], { checkOnly: true }));
    expect(limits[0]).toBe(300);
  });

  test('stops starting new orders at the worker deadline, before its own budget', async () => {
    mockCheck.mockResolvedValue({ _embedded: { actions: [] } });
    const orders = Array.from({ length: 6 }, (_, i) => order(`D${i}`));

    // Each order is paced ~1.2s apart; a deadline 2s out allows only the first couple.
    const summary = await finish(run(orders, { deadline: new Date(Date.now() + 2000) }));

    expect(summary.stoppedEarly).toBe('deadline');
    expect(summary.processed).toBeLessThan(6);
    expect(summary.processed).toBeGreaterThan(0);
  });

  test('sending accounts go oldest first; check-only accounts newest first', async () => {
    await finish(run([]));
    expect(sorts[0]).toEqual({ purchaseDate: 1 });
    await finish(run([], { checkOnly: true }));
    expect(sorts[0]).toEqual({ purchaseDate: -1 });
  });

  test('stops starting new orders once the run budget is used up', async () => {
    process.env.REVIEW_SENDER_RUN_BUDGET_MS = '1000';
    let small;
    jest.isolateModules(() => {
      small = require('../../../Services/review/reviewRequestSenderService.js').processReviewRequests;
    });
    delete process.env.REVIEW_SENDER_RUN_BUDGET_MS;

    mockCheck.mockResolvedValue({ _embedded: { actions: [] } });
    const chain = (rows) => ({
      sort: () => ({ limit: () => ({ select: () => ({ lean: async () => rows }) }) }),
    });
    mockFind.mockReset();
    mockFind.mockReturnValueOnce(chain(Array.from({ length: 6 }, (_, i) => order(`B${i}`)))).mockReturnValue(chain([]));

    const summary = await finish(small({ userId: 'u1', country: 'US', region: 'NA', accessToken: 't', awsConfig: {} }));

    expect(summary.stoppedEarly).toBe('budget');
    expect(summary.processed).toBeLessThan(6);
  });
});

describe('re-check back-off', () => {
  test('daily at first, then every 2 days, then every 3 days; old orders always 3 days', () => {
    expect(recheckHoursForIneligible(10, 0)).toBe(24);
    expect(recheckHoursForIneligible(10, 2)).toBe(24);
    expect(recheckHoursForIneligible(10, 3)).toBe(48);
    expect(recheckHoursForIneligible(10, 5)).toBe(48);
    expect(recheckHoursForIneligible(10, 6)).toBe(72);
    expect(recheckHoursForIneligible(40, 0)).toBe(72);
  });

  test('an order that keeps answering no is deferred longer', async () => {
    mockCheck.mockResolvedValue({ _embedded: { actions: [] } });
    await finish(run([order('R', { eligibilityCheckCount: 4 })]));
    const hours = Math.round((writesFor('R')[0].$set.nextEligibilityCheckAt.getTime() - Date.now()) / 3600000);
    expect(hours).toBeGreaterThanOrEqual(47);
    expect(hours).toBeLessThanOrEqual(49);
    expect(writesFor('R')[0].$inc).toEqual({ eligibilityCheckCount: 1 });
  });
});
