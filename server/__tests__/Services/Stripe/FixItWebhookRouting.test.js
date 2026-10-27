/**
 * Stripe webhooks for a "Fix it" package must go to FixItCheckoutService and never reach the
 * subscription code: a package session has no planType (the subscription branch would drop it),
 * and a PRO seller's package shares their Stripe customer (a refund would mark the subscription
 * refunded).
 */
jest.mock('stripe', () => () => ({}));
jest.mock('../../../models/user-auth/SubscriptionModel', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../../../models/user-auth/userModel', () => ({}));
jest.mock('../../../models/system/PaymentLogsModel', () => ({ isWebhookProcessed: jest.fn(), logWebhookEvent: jest.fn() }));
jest.mock('../../../Services/Email/SendTrialToProSupportEmail', () => ({ sendTrialToProSupportEmail: jest.fn() }));
jest.mock('../../../Services/Stripe/FixItCheckoutService', () => ({
  PURCHASE_TYPE: 'fixit',
  completeFixItPurchase: jest.fn(),
  expireFixItCheckout: jest.fn(),
  handleFixItRefund: jest.fn(),
}));

const Subscription = require('../../../models/user-auth/SubscriptionModel');
const PaymentLogs = require('../../../models/system/PaymentLogsModel');
const FixIt = require('../../../Services/Stripe/FixItCheckoutService');
const webhooks = require('../../../Services/Stripe/StripeWebhookService');

const fixitSession = { id: 'cs_1', mode: 'payment', payment_status: 'paid', metadata: { userId: 'u1', purchaseType: 'fixit', packageId: 'trial' } };

beforeEach(() => {
  PaymentLogs.isWebhookProcessed.mockResolvedValue(false);
  FixIt.expireFixItCheckout.mockResolvedValue(true);
  FixIt.handleFixItRefund.mockResolvedValue(true);
});

it('a completed package checkout is recorded by the Fix it service with the event id', async () => {
  await webhooks.handleWebhookEvent({ id: 'evt_1', type: 'checkout.session.completed', data: { object: fixitSession } });
  expect(FixIt.completeFixItPurchase).toHaveBeenCalledWith(fixitSession, { source: 'WEBHOOK', webhookEventId: 'evt_1' });
  expect(Subscription.findOneAndUpdate).not.toHaveBeenCalled();
});

it('an expired package checkout never touches the subscription', async () => {
  await webhooks.handleWebhookEvent({ id: 'evt_2', type: 'checkout.session.expired', data: { object: fixitSession } });
  expect(FixIt.expireFixItCheckout).toHaveBeenCalledWith(fixitSession);
  expect(Subscription.findOne).not.toHaveBeenCalled();
});

it('a refunded package charge never marks the subscription refunded', async () => {
  const charge = { id: 'ch_1', customer: 'cus_1', payment_intent: 'pi_1', amount: 2500, amount_refunded: 2500 };
  await webhooks.handleWebhookEvent({ id: 'evt_3', type: 'charge.refunded', data: { object: charge } });
  expect(FixIt.handleFixItRefund).toHaveBeenCalledWith(charge, 'evt_3');
  expect(Subscription.findOne).not.toHaveBeenCalled();
  expect(Subscription.findOneAndUpdate).not.toHaveBeenCalled();
});

it('a subscription refund still goes to the subscription code', async () => {
  FixIt.handleFixItRefund.mockResolvedValue(false);
  Subscription.findOne.mockResolvedValue(null);
  await webhooks.handleWebhookEvent({ id: 'evt_4', type: 'charge.refunded', data: { object: { id: 'ch_2', customer: 'cus_2', amount: 100, amount_refunded: 100 } } });
  expect(Subscription.findOne).toHaveBeenCalledWith({ stripeCustomerId: 'cus_2' });
});
