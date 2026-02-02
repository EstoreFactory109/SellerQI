/**
 * Script: Sync user payment details from Stripe and store in database
 *
 * Given a user ID (MongoDB ObjectId), fetches the user's Stripe subscription
 * (by existing subscription record, customer id, or by finding customer by email),
 * then updates the Subscription and User collections to match Stripe.
 *
 * Usage:
 *   node server/scripts/syncUserPaymentFromStripe.js <user_id>
 *   USER_ID=507f1f77bcf86cd799439011 node server/scripts/syncUserPaymentFromStripe.js
 *
 * Example:
 *   node server/scripts/syncUserPaymentFromStripe.js 507f1f77bcf86cd799439011
 *
 * Requirements:
 *   - .env with DB_URI, DB_NAME, STRIPE_SECRET_KEY
 */

require('dotenv').config();

const path = require('path');

// Load env from project root if not already set
if (!process.env.DB_URI || !process.env.STRIPE_SECRET_KEY) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const dbConnect = require('../config/dbConn.js');
const Subscription = require('../models/user-auth/SubscriptionModel.js');
const User = require('../models/user-auth/userModel.js');
const PaymentLogs = require('../models/system/PaymentLogsModel.js');

function safeDate(timestamp) {
  if (!timestamp || typeof timestamp !== 'number' || isNaN(timestamp)) return null;
  const d = new Date(timestamp * 1000);
  return isNaN(d.getTime()) ? null : d;
}

async function getCheckoutSessionIdForSubscription(stripeClient, customerId, subscriptionId) {
  try {
    const sessions = await stripeClient.checkout.sessions.list({
      customer: customerId,
      limit: 100,
    });
    const match = sessions.data.find(
      (s) => s.subscription === subscriptionId || (s.subscription && s.subscription.id === subscriptionId)
    );
    return match ? match.id : null;
  } catch (err) {
    console.warn('Could not list checkout sessions:', err.message);
    return null;
  }
}

async function findStripeSubscriptionForUser(stripeClient, user, existingSub) {
  let stripeSubscription = null;
  let customerId = null;

  if (existingSub?.stripeSubscriptionId) {
    try {
      stripeSubscription = await stripeClient.subscriptions.retrieve(existingSub.stripeSubscriptionId, {
        expand: ['customer', 'latest_invoice', 'items.data.price'],
      });
      customerId = typeof stripeSubscription.customer === 'string'
        ? stripeSubscription.customer
        : stripeSubscription.customer?.id;
      return { stripeSubscription, customerId };
    } catch (err) {
      console.warn('Could not retrieve subscription by id:', err.message);
    }
  }

  if (existingSub?.stripeCustomerId) {
    customerId = existingSub.stripeCustomerId;
  }

  if (!customerId && user?.email) {
    try {
      const customers = await stripeClient.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length > 0) customerId = customers.data[0].id;
    } catch (err) {
      console.warn('Could not list customers by email:', err.message);
    }
  }

  if (customerId && !stripeSubscription) {
    try {
      const subs = await stripeClient.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 10,
        expand: ['data.items.data.price'],
      });
      if (subs.data.length > 0) {
        stripeSubscription = subs.data[0];
        const full = await stripeClient.subscriptions.retrieve(stripeSubscription.id, {
          expand: ['customer', 'latest_invoice', 'items.data.price'],
        });
        stripeSubscription = full;
      }
    } catch (err) {
      console.warn('Could not list subscriptions for customer:', err.message);
    }
  }

  if (stripeSubscription) {
    customerId = customerId || (typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer?.id);
  }

  return { stripeSubscription, customerId };
}

function planTypeFromSubscription(stripeSubscription) {
  const meta = stripeSubscription.metadata || {};
  if (meta.planType) return meta.planType;
  const priceId = stripeSubscription.items?.data?.[0]?.price?.id;
  if (!priceId) return 'PRO';
  if (process.env.STRIPE_AGENCY_PRICE_ID && priceId === process.env.STRIPE_AGENCY_PRICE_ID) return 'AGENCY';
  if (process.env.STRIPE_PRO_PRICE_ID && priceId === process.env.STRIPE_PRO_PRICE_ID) return 'PRO';
  return 'PRO';
}

async function main() {
  const userId = process.argv[2] || process.env.USER_ID;

  if (!userId) {
    console.error('Usage: node server/scripts/syncUserPaymentFromStripe.js <user_id>');
    console.error('   or: USER_ID=507f... node server/scripts/syncUserPaymentFromStripe.js');
    process.exit(1);
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set in .env');
    process.exit(1);
  }

  let objectId;
  try {
    objectId = new mongoose.Types.ObjectId(userId);
  } catch (e) {
    console.error('Invalid user ID (must be a valid MongoDB ObjectId):', userId);
    process.exit(1);
  }

  try {
    await dbConnect();
  } catch (err) {
    console.error('DB connection failed:', err.message);
    process.exit(1);
  }

  try {
    const user = await User.findById(objectId);
    if (!user) {
      console.error('User not found:', userId);
      process.exit(1);
    }

    const existingSub = await Subscription.findOne({ userId: objectId });
    const { stripeSubscription, customerId } = await findStripeSubscriptionForUser(stripe, user, existingSub);

    if (!stripeSubscription) {
      console.error('No Stripe subscription found for this user. Ensure the user has a Stripe customer/subscription (same Stripe account and key mode as STRIPE_SECRET_KEY).');
      process.exit(1);
    }

    const priceItem = stripeSubscription.items?.data?.[0];
    const price = priceItem?.price;
    if (!price) {
      console.error('Subscription has no price item.');
      process.exit(1);
    }

    const planType = planTypeFromSubscription(stripeSubscription);
    const isTrialing = stripeSubscription.status === 'trialing';
    const sessionId = await getCheckoutSessionIdForSubscription(stripe, customerId, stripeSubscription.id);

    const subscriptionData = {
      paymentGateway: 'stripe',
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSubscription.id,
      stripeSessionId: sessionId || existingSub?.stripeSessionId || undefined,
      stripePriceId: price.id,
      planType,
      status: stripeSubscription.status,
      paymentStatus: isTrialing ? 'no_payment_required' : 'paid',
      amount: price.unit_amount,
      currency: price.currency,
      currentPeriodStart: safeDate(stripeSubscription.current_period_start),
      currentPeriodEnd: safeDate(stripeSubscription.current_period_end),
      lastPaymentDate: isTrialing ? null : (existingSub?.lastPaymentDate || new Date()),
      nextBillingDate: safeDate(stripeSubscription.trial_end || stripeSubscription.current_period_end),
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end || false,
      hasTrial: isTrialing,
      trialEndsAt: stripeSubscription.trial_end ? safeDate(stripeSubscription.trial_end) : null,
      metadata: stripeSubscription.metadata || {},
    };

    await Subscription.findOneAndUpdate(
      { userId: objectId },
      { $set: subscriptionData },
      { upsert: true, new: true, runValidators: true }
    );

    // Sync payment history from Stripe invoices (paid invoices for this subscription)
    const existingSubscription = await Subscription.findOne({ userId: objectId });
    const existingPaymentIntentIds = new Set(
      (existingSubscription?.paymentHistory || [])
        .map((p) => p.stripePaymentIntentId)
        .filter(Boolean)
    );

    let invoices = [];
    try {
      // List paid invoices; also try without status filter to catch any paid invoices
      const list = await stripe.invoices.list({
        subscription: stripeSubscription.id,
        status: 'paid',
        limit: 100,
      });
      invoices = list.data || [];
      if (invoices.length === 0) {
        const allList = await stripe.invoices.list({
          subscription: stripeSubscription.id,
          limit: 100,
        });
        const paidFromAll = (allList.data || []).filter((inv) => inv.status === 'paid');
        if (paidFromAll.length > 0) {
          invoices = paidFromAll;
          console.warn('Paid invoices found via unfiltered list:', paidFromAll.length);
        }
      }
    } catch (invoiceErr) {
      console.warn('Could not list invoices for subscription:', invoiceErr.message);
    }

    console.warn('Stripe invoices for subscription:', invoices.length, 'paid invoice(s)');

    let paymentHistoryAdded = 0;
    for (const inv of invoices) {
      const paymentIntentId = typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id;
      // Use payment_intent for dedupe; if missing (e.g. some payment methods), use invoice id so we still record the payment
      const dedupeId = paymentIntentId || (inv.id ? `inv_${inv.id}` : null);
      if (!dedupeId) continue;
      if (existingPaymentIntentIds.has(dedupeId)) continue;

      const amount = inv.amount_paid ?? inv.amount_due ?? 0;
      const paymentEntry = {
        amount,
        currency: (inv.currency || price.currency || 'usd').toLowerCase(),
        status: 'paid',
        paymentDate: safeDate(inv.status_transitions?.paid_at || inv.created) || safeDate(inv.created) || new Date(),
        stripePaymentIntentId: dedupeId,
        paymentGateway: 'stripe',
      };
      if (sessionId) paymentEntry.sessionId = sessionId;

      await Subscription.findOneAndUpdate(
        { userId: objectId },
        { $push: { paymentHistory: paymentEntry } }
      );
      existingPaymentIntentIds.add(dedupeId);
      paymentHistoryAdded++;
    }

    const userUpdate = {
      packageType: planType,
      subscriptionStatus: stripeSubscription.status,
      isInTrialPeriod: isTrialing,
      servedTrial: isTrialing,
    };
    if (isTrialing && stripeSubscription.trial_end) {
      userUpdate.trialEndsDate = safeDate(stripeSubscription.trial_end);
    } else {
      userUpdate.isInTrialPeriod = false;
    }
    if (planType === 'AGENCY') {
      userUpdate.accessType = 'enterpriseAdmin';
    }

    await User.findByIdAndUpdate(objectId, userUpdate);

    await PaymentLogs.logEvent({
      userId: objectId,
      eventType: 'OTHER',
      paymentGateway: 'SYSTEM',
      status: 'SUCCESS',
      subscriptionId: stripeSubscription.id,
      amount: price.unit_amount ? price.unit_amount / 100 : null,
      currency: (price.currency || 'usd').toUpperCase(),
      planType,
      newStatus: stripeSubscription.status,
      message: `Payment details synced from Stripe for user ${userId}`,
      source: 'SYSTEM',
      metadata: { script: 'syncUserPaymentFromStripe.js', sessionId: sessionId || null },
    });

    console.log('Subscription and user updated successfully.');
    if (paymentHistoryAdded > 0) {
      console.log(`Payment history: ${paymentHistoryAdded} paid invoice(s) added.`);
    }
    console.log(JSON.stringify({
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSubscription.id,
      stripeSessionId: sessionId || null,
      planType,
      status: stripeSubscription.status,
      isTrialing,
      currentPeriodEnd: subscriptionData.currentPeriodEnd,
      paymentHistoryEntriesAdded: paymentHistoryAdded,
    }, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from DB.');
  }
}

main();
