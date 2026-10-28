/**
 * Monthly Fix it subscriptions after the first payment.
 *
 * Pinned: a Stripe subscription is mirrored (status, period end, cancel at period end) and
 * only ours (purchaseType 'fixit'); support hears once per cancellation, again after a resume
 * and a new cancel; each renewal invoice is one paid month (2, 3, ...) that runs the
 * after-payment work, while the first invoice is left to checkout; a duplicate webhook adds
 * nothing; cancel and resume flip cancel_at_period_end on the live subscription; the card
 * portal fails politely when Stripe's portal is not set up.
 */
const mockStore = { subs: [], purchases: [] };
const makeFake = (rows) => {
  const matches = (row, filter) => Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(row[k]);
    return String(row[k]) === String(v) || (v === null && row[k] == null);
  });
  const query = (value) => ({ sort: () => query(value), select: () => query(value), lean: async () => value, then: (r, j) => Promise.resolve(value).then(r, j) });
  return {
    findOne: (filter) => query(rows().filter((r) => matches(r, filter)).slice(-1)[0] || null),
    countDocuments: async (filter) => rows().filter((r) => matches(r, filter)).length,
    updateOne: async (filter, update) => { const row = rows().find((r) => matches(r, filter)); if (row) Object.assign(row, update.$set); return {}; },
    findOneAndUpdate: (filter, update, opts = {}) => {
      let row = rows().find((r) => matches(r, filter));
      if (!row && opts.upsert) {
        // Like Mongo, an upsert starts from the filter's equality fields.
        const fromFilter = Object.fromEntries(Object.entries(filter).filter(([, v]) => v === null || typeof v !== 'object'));
        row = { _id: `r${rows().length + 1}`, cancelNotifiedAt: null, ...fromFilter, ...update.$setOnInsert };
        rows().push(row);
        if (update.$set) Object.assign(row, update.$set);
      }
      else if (row && update.$set) Object.assign(row, update.$set);
      return query(row ? { ...row } : null);
    },
  };
};
jest.mock('../../../models/system/FixItSubscriptionModel.js', () => ({ ...makeFake(() => mockStore.subs), LIVE_STATUSES: ['active', 'trialing', 'past_due', 'unpaid'] }));
jest.mock('../../../models/system/FixItPurchaseModel.js', () => makeFake(() => mockStore.purchases));
jest.mock('../../../models/system/PaymentLogsModel.js', () => ({ logWebhookEvent: jest.fn() }));
jest.mock('../../../Services/Email/SendFixItPurchaseEmail.js', () => ({ sendFixItCancellationEmail: jest.fn() }));
jest.mock('../../../Services/Stripe/StripeService.js', () => ({
  stripe: {},
  getSubscriptionPeriod: (sub) => ({ start: null, end: sub.items?.data?.[0]?.current_period_end ?? null }),
}));
jest.mock('../../../Services/Stripe/FixItCheckoutService.js', () => ({ runInBackground: jest.fn(), frontendBase: () => 'https://members.sellerqi.com' }));

const StripeService = require('../../../Services/Stripe/StripeService.js');
const { sendFixItCancellationEmail } = require('../../../Services/Email/SendFixItPurchaseEmail.js');
const Checkout = require('../../../Services/Stripe/FixItCheckoutService.js');
const svc = require('../../../Services/Stripe/FixItSubscriptionService.js');

const NOV_27 = Date.UTC(2026, 10, 27) / 1000;
const sub = (over = {}) => ({
  id: 'sub_1', status: 'active', customer: 'cus_1', cancel_at_period_end: false, start_date: Date.UTC(2026, 9, 27) / 1000,
  items: { data: [{ current_period_end: NOV_27 }] },
  metadata: { userId: 'u1', purchaseType: 'fixit', packageId: 'standard' }, ...over,
});
const invoice = (over = {}) => ({ id: 'in_2', billing_reason: 'subscription_cycle', amount_paid: 29900, currency: 'usd', customer: 'cus_1', lines: { data: [{ period: { end: NOV_27 } }] }, ...over });

beforeEach(() => {
  mockStore.subs.length = 0;
  mockStore.purchases.length = 0;
  sendFixItCancellationEmail.mockResolvedValue('m1');
  StripeService.stripe = {
    subscriptions: { retrieve: jest.fn(async () => sub()), update: jest.fn() },
    invoices: { retrieve: jest.fn(async () => ({ payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_2' } }] } })) },
    billingPortal: { sessions: { create: jest.fn() } },
  };
});

describe('mirroring the subscription', () => {
  it('stores ours with its package, status and period end; ignores the SellerQI plan', async () => {
    const doc = await svc.upsertFromStripe(sub());
    expect(doc).toMatchObject({ stripeSubscriptionId: 'sub_1', userId: 'u1', packageId: 'standard', tasks: 30, priceUsd: 299, status: 'active', cancelAtPeriodEnd: false });
    expect(doc.currentPeriodEnd.toISOString()).toBe('2026-11-27T00:00:00.000Z');
    expect(await svc.upsertFromStripe(sub({ id: 'sub_plan', metadata: { userId: 'u1', planType: 'PRO' } }))).toBeNull();
    expect(mockStore.subs).toHaveLength(1);
  });

  it('tells support once per cancellation, and again after a resume and a new cancel', async () => {
    await svc.upsertFromStripe(sub({ cancel_at_period_end: true }));
    await svc.upsertFromStripe(sub({ cancel_at_period_end: true }));
    expect(sendFixItCancellationEmail).toHaveBeenCalledTimes(1);
    await svc.upsertFromStripe(sub({ cancel_at_period_end: false }));
    await svc.upsertFromStripe(sub({ status: 'canceled', ended_at: NOV_27 }));
    expect(sendFixItCancellationEmail).toHaveBeenCalledTimes(2);
  });
});

describe('renewals', () => {
  beforeEach(() => {
    // Month 1, recorded by checkout.
    mockStore.purchases.push({ _id: 'p1', stripeSubscriptionId: 'sub_1', status: 'paid', period: 1 });
  });

  it('each paid renewal is the next month, with its own after-payment work', async () => {
    const month2 = await svc.recordRenewal(invoice(), sub(), 'evt_2');
    expect(month2).toMatchObject({ period: 2, status: 'paid', billing: 'monthly', amount: 299, stripeInvoiceId: 'in_2', stripeSessionId: 'inv:in_2', stripePaymentIntentId: 'pi_2', packageName: 'Standard', tasks: 30 });
    expect(Checkout.runInBackground).toHaveBeenCalledWith(month2._id);
    const month3 = await svc.recordRenewal(invoice({ id: 'in_3' }), sub());
    expect(month3.period).toBe(3);
  });

  it('the first invoice belongs to checkout; a repeated webhook adds nothing', async () => {
    expect(await svc.recordRenewal(invoice({ id: 'in_1', billing_reason: 'subscription_create' }), sub())).toBeNull();
    await svc.recordRenewal(invoice(), sub());
    await svc.recordRenewal(invoice(), sub());
    expect(mockStore.purchases.filter((p) => p.stripeInvoiceId === 'in_2')).toHaveLength(1);
  });

  it('ignores invoices of the SellerQI plan', async () => {
    expect(await svc.recordRenewal(invoice(), sub({ metadata: { userId: 'u1', planType: 'PRO' } }))).toBeNull();
  });
});

describe('what the seller does', () => {
  beforeEach(async () => { await svc.upsertFromStripe(sub()); });

  it('cancel = at the end of the paid month; resume undoes it', async () => {
    StripeService.stripe.subscriptions.update.mockImplementation(async (id, { cancel_at_period_end }) => sub({ cancel_at_period_end }));
    const cancelled = await svc.cancel('u1');
    expect(StripeService.stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
    expect(cancelled).toMatchObject({ packageName: 'Standard', live: true, cancelAtPeriodEnd: true });
    const resumed = await svc.resume('u1');
    expect(resumed.cancelAtPeriodEnd).toBe(false);
  });

  it('cannot cancel what is not there', async () => {
    await expect(svc.cancel('someone-else')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('the card portal returns Stripe\'s link, or a polite error when the portal is not set up', async () => {
    StripeService.stripe.billingPortal.sessions.create.mockResolvedValueOnce({ url: 'https://billing.stripe.com/p/x' });
    expect(await svc.portalUrl('u1')).toBe('https://billing.stripe.com/p/x');
    expect(StripeService.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'https://members.sellerqi.com/seller-central-checker/tasks' });
    StripeService.stripe.billingPortal.sessions.create.mockRejectedValueOnce(new Error('No configuration provided'));
    await expect(svc.portalUrl('u1')).rejects.toMatchObject({ statusCode: 503 });
  });
});
