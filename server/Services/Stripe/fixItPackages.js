/**
 * The "Fix it" packages a seller can buy from the Tasks page: ESF's team fixes N of their tasks.
 *
 * The server's copy is the one that decides what is charged — the client only sends a package
 * id. Each package is a USD Price in Stripe, found by its lookup_key (created by
 * server/scripts/createFixItStripePrices.js), so no price ids live in .env.
 *
 *   trial        one-time    — a taster, bought once
 *   standard     monthly     — a subscription: N tasks every month until cancelled
 *   accelerated  monthly
 *
 * The monthly packages use their own lookup keys: a Stripe Price cannot change from one-time
 * to recurring, so the original one-time Standard/Accelerated prices stay in Stripe, unused.
 *
 * Keep in step with client/src/Components/Tasks/FixItPackagesModal.jsx (a test checks both).
 */
const FIX_IT_PACKAGES = [
    { id: 'trial', name: 'Trial', tasks: 2, priceUsd: 25, billing: 'one_time', lookupKey: 'sqi_fixit_trial' },
    { id: 'standard', name: 'Standard', tasks: 30, priceUsd: 299, billing: 'monthly', lookupKey: 'sqi_fixit_standard_monthly' },
    { id: 'accelerated', name: 'Accelerated', tasks: 60, priceUsd: 499, billing: 'monthly', lookupKey: 'sqi_fixit_accelerated_monthly' },
];

const getFixItPackage = (id) => FIX_IT_PACKAGES.find((p) => p.id === id) || null;
const isMonthly = (pkg) => pkg?.billing === 'monthly';

/** The Stripe Product name, also shown on the Checkout page, the receipt and the invoice. */
const productName = (pkg) => (isMonthly(pkg)
    ? `SellerQI Fix it: ${pkg.name} (${pkg.tasks} tasks per month)`
    : `SellerQI Fix it: ${pkg.name} (${pkg.tasks} tasks)`);

/** Whether a Stripe Price is exactly what this package charges (amount, currency, billing). */
const priceMatches = (price, pkg) => Boolean(price) && price.active !== false
    && price.unit_amount === pkg.priceUsd * 100
    && price.currency === 'usd'
    && (isMonthly(pkg)
        ? price.type === 'recurring' && price.recurring?.interval === 'month' && (price.recurring?.interval_count || 1) === 1
        : price.type === 'one_time');

module.exports = { FIX_IT_PACKAGES, getFixItPackage, productName, isMonthly, priceMatches };
