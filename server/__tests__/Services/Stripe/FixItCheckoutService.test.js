/**
 * Buying a "Fix it" package through Stripe Checkout.
 *
 * Pinned: the server picks the price (the client only names a package) and refuses a Stripe
 * price that does not match; the session is a one-time payment that carries purchaseType for
 * the webhook; the subscription is never touched; completing from the webhook AND the success
 * page records one purchase and sends the support email once, retrying if the email failed;
 * the success page only confirms the caller's own paid session; a refund of a package is
 * handled here and never reaches the subscription.
 */
jest.mock('../../../Services/Stripe/StripeService.js', () => ({ stripe: {}, createOrGetCustomer: jest.fn() }));
jest.mock('../../../Services/Email/SendFixItPurchaseEmail.js', () => ({ sendFixItPurchaseEmail: jest.fn() }));
jest.mock('../../../models/user-auth/userModel.js', () => ({ findById: jest.fn() }));
jest.mock('../../../models/user-auth/SubscriptionModel.js', () => ({ exists: jest.fn() }));
jest.mock('../../../models/system/PaymentLogsModel.js', () => ({ logEvent: jest.fn(), logWebhookEvent: jest.fn() }));
jest.mock('../../../models/system/FixItPurchaseModel.js', () => {
  // A tiny in-memory stand-in for the few queries the service makes.
  const rows = [];
  const matches = (row, filter) => Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(row[k]);
    if (v && typeof v === 'object' && '$ne' in v) return row[k] !== v.$ne;
    return String(row[k]) === String(v) || (v === null && row[k] == null);
  });
  const wrap = (row) => row && { ...row, toObject: () => ({ ...row }) };
  const query = (value) => ({ sort: () => query(value), select: () => query(value), lean: async () => value, then: (r, j) => Promise.resolve(wrap(value)).then(r, j) });
  return {
    _rows: rows,
    create: async (doc) => { const row = { _id: `p${rows.length + 1}`, status: 'pending', supportNotifiedAt: null, paidAt: null, ...doc }; rows.push(row); return wrap(row); },
    findOne: (filter) => query(rows.filter((r) => matches(r, filter)).slice(-1)[0] || null),
    findById: async (id) => wrap(rows.find((r) => r._id === id)),
    updateOne: async (filter, update) => { const row = rows.find((r) => matches(r, filter)); if (row) Object.assign(row, update.$set); return {}; },
    findOneAndUpdate: (filter, update, opts = {}) => {
      let row = rows.find((r) => matches(r, filter));
      if (!row && opts.upsert) { row = { _id: `p${rows.length + 1}`, status: 'pending', supportNotifiedAt: null, ...update.$setOnInsert }; rows.push(row); }
      else if (row && update.$set) Object.assign(row, update.$set);
      return query(row || null);
    },
  };
});

const StripeService = require('../../../Services/Stripe/StripeService.js');
const FixItPurchase = require('../../../models/system/FixItPurchaseModel.js');
const User = require('../../../models/user-auth/userModel.js');
const Subscription = require('../../../models/user-auth/SubscriptionModel.js');
const PaymentLogs = require('../../../models/system/PaymentLogsModel.js');
const { sendFixItPurchaseEmail } = require('../../../Services/Email/SendFixItPurchaseEmail.js');
const svc = require('../../../Services/Stripe/FixItCheckoutService.js');

const USER = '64b000000000000000000001';
const price = (overrides = {}) => ({ id: 'price_std', unit_amount: 29900, currency: 'usd', type: 'one_time', active: true, ...overrides });
const PRICES = {
  sqi_fixit_trial: price({ id: 'price_trial', unit_amount: 2500 }),
  sqi_fixit_standard: price(),
  sqi_fixit_accelerated: price({ id: 'price_acc', unit_amount: 49900 }),
};
const paidSession = (overrides = {}) => ({
  id: 'cs_test_1', payment_status: 'paid', payment_intent: 'pi_1', customer: 'cus_1', amount_total: 29900, currency: 'usd',
  metadata: { userId: USER, purchaseType: 'fixit', packageId: 'standard' }, ...overrides,
});

beforeEach(() => {
  FixItPurchase._rows.length = 0;
  svc._priceCache.clear();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.FRONTEND_URL = 'members.sellerqi.com';
  StripeService.stripe = {
    prices: { list: jest.fn(async ({ lookup_keys: [key] }) => ({ data: [PRICES[key]] })) },
    customers: { retrieve: jest.fn() },
    checkout: { sessions: { create: jest.fn(async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })), retrieve: jest.fn() } },
  };
  StripeService.createOrGetCustomer.mockResolvedValue({ id: 'cus_1' });
  User.findById.mockReturnValue({ select: () => ({ lean: async () => ({ _id: USER, firstName: 'Ann', lastName: 'Lee', email: 'ann@acme.com' }) }) });
  Subscription.exists.mockResolvedValue(null);
  sendFixItPurchaseEmail.mockResolvedValue('msg-1');
  PaymentLogs.logEvent.mockResolvedValue({});
  PaymentLogs.logWebhookEvent.mockResolvedValue({ isNew: true });
});

describe('starting checkout', () => {
  it('opens a one-time payment for the server\'s price, tagged for the webhook', async () => {
    const out = await svc.createFixItCheckout(USER, { packageId: 'standard', openTasks: 9, monthlyRecoverable: 1007.03, atStakeCurrency: 'A$' });
    expect(out.url).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(StripeService.stripe.prices.list).toHaveBeenCalledWith({ lookup_keys: ['sqi_fixit_standard'], active: true, limit: 1 });
    const params = StripeService.stripe.checkout.sessions.create.mock.calls[0][0];
    expect(params).toMatchObject({
      mode: 'payment',
      customer: 'cus_1',
      line_items: [{ price: 'price_std', quantity: 1 }],
      metadata: { userId: USER, purchaseType: 'fixit', packageId: 'standard' },
      payment_intent_data: { metadata: { userId: USER, purchaseType: 'fixit', packageId: 'standard' }, receipt_email: 'ann@acme.com' },
      success_url: 'https://members.sellerqi.com/fix-it/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://members.sellerqi.com/seller-central-checker/tasks?fixit=cancelled',
    });
    expect(FixItPurchase._rows[0]).toMatchObject({ packageId: 'standard', tasks: 30, amount: 299, status: 'pending', stripeSessionId: 'cs_test_1', openTasks: 9, atStakeCurrency: 'A$' });
  });

  it('refuses an unknown package without calling Stripe', async () => {
    await expect(svc.createFixItCheckout(USER, { packageId: 'free' })).rejects.toMatchObject({ statusCode: 400 });
    expect(StripeService.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('refuses to sell when the Stripe price is missing or not what the package costs', async () => {
    StripeService.stripe.prices.list.mockResolvedValueOnce({ data: [] });
    await expect(svc.createFixItCheckout(USER, { packageId: 'standard' })).rejects.toMatchObject({ statusCode: 503 });
    StripeService.stripe.prices.list.mockResolvedValueOnce({ data: [price({ unit_amount: 100 })] });
    await expect(svc.createFixItCheckout(USER, { packageId: 'standard' })).rejects.toMatchObject({ statusCode: 503 });
    expect(StripeService.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('a LITE seller buying again reuses the Stripe customer from their earlier package', async () => {
    FixItPurchase._rows.push({ _id: 'old', userId: USER, stripeCustomerId: 'cus_old', stripeSessionId: 'cs_old', status: 'paid' });
    StripeService.stripe.customers.retrieve.mockResolvedValue({ id: 'cus_old' });
    await svc.createFixItCheckout(USER, { packageId: 'trial' });
    expect(StripeService.stripe.checkout.sessions.create.mock.calls[0][0].customer).toBe('cus_old');
    expect(StripeService.createOrGetCustomer).not.toHaveBeenCalled();
  });
});

describe('completing the purchase', () => {
  beforeEach(async () => { await svc.createFixItCheckout(USER, { packageId: 'standard' }); });

  it('webhook and success page together: one paid purchase, one email', async () => {
    await svc.completeFixItPurchase(paidSession(), { source: 'WEBHOOK', webhookEventId: 'evt_1' });
    await svc.completeFixItPurchase(paidSession(), { source: 'API' });
    expect(FixItPurchase._rows).toHaveLength(1);
    expect(FixItPurchase._rows[0]).toMatchObject({ status: 'paid', amount: 299, stripePaymentIntentId: 'pi_1' });
    expect(sendFixItPurchaseEmail).toHaveBeenCalledTimes(1);
    expect(PaymentLogs.logWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({ webhookEventId: 'evt_1', eventType: 'STRIPE_PAYMENT_SUCCESS' }));
  });

  it('a failed email is retried by the next path', async () => {
    sendFixItPurchaseEmail.mockResolvedValueOnce(false);
    await svc.completeFixItPurchase(paidSession(), { source: 'WEBHOOK', webhookEventId: 'evt_1' });
    expect(FixItPurchase._rows[0].supportNotifiedAt).toBeNull();
    await svc.completeFixItPurchase(paidSession(), { source: 'API' });
    expect(sendFixItPurchaseEmail).toHaveBeenCalledTimes(2);
    expect(FixItPurchase._rows[0].supportNotifiedAt).toBeInstanceOf(Date);
  });

  it('records what was really paid after a promo code', async () => {
    await svc.completeFixItPurchase(paidSession({ amount_total: 14950 }), { source: 'API' });
    expect(FixItPurchase._rows[0].amount).toBe(149.5);
  });

  it('does nothing until the payment is complete', async () => {
    expect(await svc.completeFixItPurchase(paidSession({ payment_status: 'unpaid' }))).toBeNull();
    expect(FixItPurchase._rows[0].status).toBe('pending');
    expect(sendFixItPurchaseEmail).not.toHaveBeenCalled();
  });

  it('ignores sessions that are not Fix it purchases', async () => {
    expect(await svc.completeFixItPurchase(paidSession({ metadata: { userId: USER, planType: 'PRO' } }))).toBeNull();
  });
});

describe('the success page', () => {
  it('confirms the caller\'s own paid session', async () => {
    await svc.createFixItCheckout(USER, { packageId: 'standard' });
    StripeService.stripe.checkout.sessions.retrieve.mockResolvedValue(paidSession());
    const out = await svc.confirmFixItPurchase('cs_test_1', USER);
    expect(out).toMatchObject({ status: 'paid', purchase: { packageId: 'standard', packageName: 'Standard', tasks: 30, amount: 299 } });
  });

  it('refuses someone else\'s session', async () => {
    StripeService.stripe.checkout.sessions.retrieve.mockResolvedValue(paidSession({ metadata: { userId: 'someone-else', purchaseType: 'fixit', packageId: 'standard' } }));
    await expect(svc.confirmFixItPurchase('cs_test_1', USER)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('says processing while unpaid, and rejects a malformed id', async () => {
    StripeService.stripe.checkout.sessions.retrieve.mockResolvedValue(paidSession({ payment_status: 'unpaid' }));
    expect(await svc.confirmFixItPurchase('cs_test_1', USER)).toEqual({ status: 'processing' });
    await expect(svc.confirmFixItPurchase('../x', USER)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('refunds and abandoned checkouts', () => {
  beforeEach(async () => {
    await svc.createFixItCheckout(USER, { packageId: 'standard' });
    await svc.completeFixItPurchase(paidSession(), { source: 'API' });
  });

  it('a full refund marks the purchase and is reported as handled', async () => {
    const handled = await svc.handleFixItRefund({ id: 'ch_1', payment_intent: 'pi_1', amount: 29900, amount_refunded: 29900, currency: 'usd' }, 'evt_r');
    expect(handled).toBe(true);
    expect(FixItPurchase._rows[0]).toMatchObject({ status: 'refunded', amountRefunded: 299 });
  });

  it('a subscription charge is not ours', async () => {
    expect(await svc.handleFixItRefund({ id: 'ch_2', payment_intent: 'pi_sub', amount: 100, amount_refunded: 100, metadata: {} })).toBe(false);
  });

  it('an expired checkout marks only a pending purchase', async () => {
    await svc.createFixItCheckout(USER, { packageId: 'trial' });
    StripeService.stripe.checkout.sessions.create.mockResolvedValueOnce({ id: 'cs_test_2', url: 'x' });
    FixItPurchase._rows[1].stripeSessionId = 'cs_test_2';
    expect(await svc.expireFixItCheckout({ id: 'cs_test_2', metadata: { purchaseType: 'fixit' } })).toBe(true);
    expect(FixItPurchase._rows[1].status).toBe('expired');
    expect(await svc.expireFixItCheckout({ id: 'cs_sub', metadata: { planType: 'PRO' } })).toBe(false);
  });
});
