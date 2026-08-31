/**
 * Script: Backfill renewal dates (currentPeriodEnd/nextBillingDate) for all PRO
 * and PRO Trial users directly from Stripe.
 *
 * One-time remediation for the bug where handleInvoicePaymentSucceeded never wrote
 * currentPeriodEnd/nextBillingDate, so those fields could be stuck at whatever was
 * set at initial checkout/trial-start. This script re-derives them for every
 * existing PRO user the same way the fixed webhook handler now does: retrieve the
 * subscription from Stripe, cross-check current_period_end against the matching
 * invoice line item's period.end, and write the confirmed value.
 *
 * Defaults to DRY RUN (no writes) so the diff can be reviewed first.
 *
 * Usage:
 *   node server/scripts/backfillRenewalDatesFromStripe.js            # dry run
 *   node server/scripts/backfillRenewalDatesFromStripe.js --apply    # write changes
 *
 * Requirements:
 *   - .env with DB_URI, DB_NAME, STRIPE_SECRET_KEY
 */

require('dotenv').config();

const path = require('path');
if (!process.env.DB_URI || !process.env.STRIPE_SECRET_KEY) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const dbConnect = require('../config/dbConn.js');
const Subscription = require('../models/user-auth/SubscriptionModel.js');
const User = require('../models/user-auth/userModel.js');

const APPLY = process.argv.includes('--apply');

function safeDate(timestamp) {
  if (!timestamp || typeof timestamp !== 'number' || isNaN(timestamp)) return null;
  const d = new Date(timestamp * 1000);
  return isNaN(d.getTime()) ? null : d;
}

function fmt(d) {
  return d ? new Date(d).toISOString() : 'null';
}

// Same confirmation logic added to StripeWebhookService.handleInvoicePaymentSucceeded:
// prefer the period.end of the invoice line tied to this subscription, cross-checked
// against the subscription object's own current_period_end.
// As of API 2025-03-31.basil, current_period_start/end moved from the Subscription
// object onto its items. stripe-node 18.x pins 2025-08-27.basil, so anything retrieved
// here has them ONLY on items - reading the top level alone yields undefined.
function getSubscriptionPeriod(subscription) {
  if (!subscription) return { start: null, end: null };
  const itemPeriods = (subscription.items?.data || [])
    .map((item) => ({ start: item.current_period_start, end: item.current_period_end }))
    .filter((p) => typeof p.end === 'number');
  if (itemPeriods.length) {
    const furthest = itemPeriods.reduce((a, b) => (b.end > a.end ? b : a));
    return { start: furthest.start ?? null, end: furthest.end ?? null };
  }
  return {
    start: typeof subscription.current_period_start === 'number' ? subscription.current_period_start : null,
    end: typeof subscription.current_period_end === 'number' ? subscription.current_period_end : null,
  };
}

async function resolveConfirmedPeriodEnd(stripeSubscription) {
  const { start: subscriptionPeriodStart, end: subscriptionPeriodEnd } =
    getSubscriptionPeriod(stripeSubscription);

  let invoicePeriodEnd = null;
  if (stripeSubscription.latest_invoice) {
    try {
      const invoiceId = typeof stripeSubscription.latest_invoice === 'string'
        ? stripeSubscription.latest_invoice
        : stripeSubscription.latest_invoice.id;
      const invoice = await stripe.invoices.retrieve(invoiceId);
      // Furthest-out period.end among this subscription's lines - proration lines
      // (mid-cycle plan changes) cover short past-to-now spans, not the next renewal.
      const matchingLines = (invoice.lines?.data || []).filter(
        (line) => line.subscription === stripeSubscription.id
          || line.parent?.subscription_item_details?.subscription === stripeSubscription.id
      );
      invoicePeriodEnd = matchingLines.length
        ? Math.max(...matchingLines.map((line) => line.period?.end || 0)) || null
        : null;
    } catch (err) {
      console.warn(`  Could not retrieve latest_invoice for subscription ${stripeSubscription.id}: ${err.message}`);
    }
  }

  let mismatch = false;
  if (invoicePeriodEnd && subscriptionPeriodEnd && invoicePeriodEnd !== subscriptionPeriodEnd) {
    mismatch = true;
  }

  return {
    // subscription.current_period_end is Stripe's authoritative next-renewal date;
    // the invoice line is only a cross-check, never used to override it (see note above).
    confirmedPeriodEnd: subscriptionPeriodEnd || invoicePeriodEnd,
    confirmedPeriodStart: subscriptionPeriodStart,
    subscriptionPeriodEnd,
    invoicePeriodEnd,
    mismatch,
  };
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set in .env');
    process.exit(1);
  }

  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no writes)'}`);
  console.log('Using DB:', process.env.DB_NAME);
  console.log('Using Stripe key mode:', process.env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'LIVE' : 'TEST');
  console.log('');

  await dbConnect();

  const proUsers = await User.find({ packageType: 'PRO' })
    .select('_id email packageType isInTrialPeriod')
    .lean();

  console.log(`Found ${proUsers.length} PRO/PRO-trial users.\n`);

  const summary = {
    total: proUsers.length,
    noSubscriptionDoc: 0,
    noStripeSubscriptionId: 0,
    notStripeGateway: 0,
    stripeRetrieveFailed: 0,
    noConfirmedDate: 0,
    unchanged: 0,
    updated: 0,
    mismatchesFound: 0,
  };

  for (const user of proUsers) {
    const label = `${user.email} (${user._id}) [${user.isInTrialPeriod ? 'trial' : 'paid'}]`;

    const sub = await Subscription.findOne({ userId: user._id });
    if (!sub) {
      console.log(`SKIP  ${label}: no Subscription document`);
      summary.noSubscriptionDoc++;
      continue;
    }
    if (sub.paymentGateway !== 'stripe') {
      console.log(`SKIP  ${label}: paymentGateway=${sub.paymentGateway}, not stripe`);
      summary.notStripeGateway++;
      continue;
    }
    if (!sub.stripeSubscriptionId) {
      console.log(`SKIP  ${label}: no stripeSubscriptionId on record`);
      summary.noStripeSubscriptionId++;
      continue;
    }

    let stripeSubscription;
    try {
      stripeSubscription = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
        expand: ['latest_invoice'],
      });
    } catch (err) {
      console.log(`ERROR ${label}: could not retrieve subscription ${sub.stripeSubscriptionId} from Stripe: ${err.message}`);
      summary.stripeRetrieveFailed++;
      continue;
    }

    const { confirmedPeriodEnd, confirmedPeriodStart, subscriptionPeriodEnd, invoicePeriodEnd, mismatch } =
      await resolveConfirmedPeriodEnd(stripeSubscription);

    if (mismatch) {
      console.log(`  MISMATCH ${label}: invoice.period.end=${invoicePeriodEnd} vs subscription.current_period_end=${subscriptionPeriodEnd} (using subscription.current_period_end, the authoritative next-renewal date)`);
      summary.mismatchesFound++;
    }

    if (!confirmedPeriodEnd) {
      console.log(`SKIP  ${label}: could not confirm a period end from Stripe for subscription ${sub.stripeSubscriptionId}`);
      summary.noConfirmedDate++;
      continue;
    }

    const newCurrentPeriodStart = safeDate(confirmedPeriodStart);
    const newCurrentPeriodEnd = safeDate(confirmedPeriodEnd);
    // trial_end never clears back to null once a trial has occurred, so it must not be
    // used as a fallback here - confirmedPeriodEnd alone is correct in both the trial and
    // paid case (Stripe sets current_period_end == trial_end while actually trialing).
    const newNextBillingDate = safeDate(confirmedPeriodEnd);

    const oldCurrentPeriodEnd = sub.currentPeriodEnd;
    const oldNextBillingDate = sub.nextBillingDate;
    const oldCurrentPeriodStart = sub.currentPeriodStart;

    const changed =
      fmt(oldCurrentPeriodEnd) !== fmt(newCurrentPeriodEnd) ||
      fmt(oldNextBillingDate) !== fmt(newNextBillingDate) ||
      (newCurrentPeriodStart && fmt(oldCurrentPeriodStart) !== fmt(newCurrentPeriodStart));

    if (!changed) {
      summary.unchanged++;
      continue;
    }

    console.log(`${APPLY ? 'UPDATE' : 'WOULD UPDATE'} ${label}:`);
    console.log(`    currentPeriodEnd:   ${fmt(oldCurrentPeriodEnd)} -> ${fmt(newCurrentPeriodEnd)}`);
    console.log(`    nextBillingDate:    ${fmt(oldNextBillingDate)} -> ${fmt(newNextBillingDate)}`);
    if (newCurrentPeriodStart) {
      console.log(`    currentPeriodStart: ${fmt(oldCurrentPeriodStart)} -> ${fmt(newCurrentPeriodStart)}`);
    }

    if (APPLY) {
      const $set = {
        currentPeriodEnd: newCurrentPeriodEnd,
        nextBillingDate: newNextBillingDate,
      };
      // Only write the start when Stripe actually gave us one - never blank a stored value.
      if (newCurrentPeriodStart) $set.currentPeriodStart = newCurrentPeriodStart;

      await Subscription.findOneAndUpdate(
        { userId: user._id },
        { $set },
        { runValidators: true }
      );
    }
    summary.updated++;
  }

  console.log('\n--- Summary ---');
  console.log(JSON.stringify(summary, null, 2));
  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these changes.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await mongoose.disconnect();
  process.exit(1);
});
