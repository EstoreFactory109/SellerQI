/**
 * Script: Get Stripe Subscription Details
 *
 * Fetches full details for a Stripe subscription ID, including:
 * - Customer ID
 * - Checkout Session ID (if found for this subscription)
 * - Subscription status, plan, dates, and related IDs
 *
 * Usage:
 *   node server/scripts/getStripeSubscriptionDetails.js <subscription_id>
 *   SUBSCRIPTION_ID=sub_xxxx node server/scripts/getStripeSubscriptionDetails.js
 *
 * Example:
 *   node server/scripts/getStripeSubscriptionDetails.js sub_1ABC123xyz
 *
 * Requirements:
 *   - STRIPE_SECRET_KEY must be set in .env (in project root or server/)
 */

// Load .env from project root (run from repo root: node server/scripts/getStripeSubscriptionDetails.js <id>)
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function formatTimestamp(unixSeconds) {
  if (!unixSeconds) return null;
  const d = new Date(unixSeconds * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString();
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

async function main() {
  const subscriptionId =
    process.argv[2] || process.env.SUBSCRIPTION_ID;

  if (!subscriptionId) {
    console.error('Usage: node server/scripts/getStripeSubscriptionDetails.js <subscription_id>');
    console.error('   or: SUBSCRIPTION_ID=sub_xxxx node server/scripts/getStripeSubscriptionDetails.js');
    process.exit(1);
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set. Set it in .env and run again.');
    process.exit(1);
  }

  const key = process.env.STRIPE_SECRET_KEY;
  const keyMode = key.startsWith('sk_live_') ? 'LIVE' : key.startsWith('sk_test_') ? 'TEST' : 'UNKNOWN';
  console.error(`Using Stripe key: ${keyMode} mode`);

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: [
        'customer',
        'latest_invoice',
        'default_payment_method',
        'items.data.price',
      ],
    });

    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

    const sessionId = await getCheckoutSessionIdForSubscription(
      stripe,
      customerId,
      subscription.id
    );

    const firstItem = subscription.items?.data?.[0];
    const price = firstItem?.price;

    const details = {
      subscription: {
        id: subscription.id,
        object: subscription.object,
        status: subscription.status,
        current_period_start: formatTimestamp(subscription.current_period_start),
        current_period_end: formatTimestamp(subscription.current_period_end),
        trial_start: formatTimestamp(subscription.trial_start),
        trial_end: formatTimestamp(subscription.trial_end),
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: formatTimestamp(subscription.canceled_at),
        created: formatTimestamp(subscription.created),
        metadata: subscription.metadata || {},
      },
      customer: {
        id: customerId,
        email: subscription.customer?.email ?? (typeof subscription.customer === 'object' ? subscription.customer?.email : null),
        name: subscription.customer?.name ?? (typeof subscription.customer === 'object' ? subscription.customer?.name : null),
      },
      checkout_session_id: sessionId,
      plan: price
        ? {
            price_id: price.id,
            currency: price.currency,
            unit_amount: price.unit_amount,
            interval: price.recurring?.interval,
            interval_count: price.recurring?.interval_count,
          }
        : null,
      latest_invoice: subscription.latest_invoice
        ? {
            id: typeof subscription.latest_invoice === 'string'
              ? subscription.latest_invoice
              : subscription.latest_invoice?.id,
            status: subscription.latest_invoice?.status,
            invoice_pdf: subscription.latest_invoice?.invoice_pdf,
            hosted_invoice_url: subscription.latest_invoice?.hosted_invoice_url,
          }
        : null,
    };

    console.log(JSON.stringify(details, null, 2));

    console.error('\n--- Summary ---');
    console.error('Subscription ID:', details.subscription.id);
    console.error('Customer ID:    ', details.customer.id);
    console.error('Session ID:     ', details.checkout_session_id || '(not found via customer sessions)');
    console.error('Status:         ', details.subscription.status);
    if (details.plan) {
      console.error('Price ID:       ', details.plan.price_id);
      console.error('Amount:         ', details.plan.unit_amount, details.plan.currency);
    }
  } catch (err) {
    console.error('Error fetching subscription:', err.message);
    if (err.type) console.error('Stripe error type:', err.type);
    if (err.code) console.error('Stripe error code:', err.code);

    if (err.code === 'resource_missing' || (err.message && err.message.includes('No such subscription'))) {
      console.error('');
      console.error('This usually means:');
      console.error('  1. Test vs Live – Your key is in', keyMode, 'mode. Subscriptions created in');
      console.error('     Live mode only exist with sk_live_... ; Test data only with sk_test_...');
      console.error('     Use the key that matches where this subscription was created.');
      console.error('  2. Wrong Stripe account – Subscription IDs are per-account. Use the');
      console.error('     secret key from the same Stripe account (Dashboard) where the');
      console.error('     subscription exists.');
    }
    process.exit(1);
  }
}

main();
