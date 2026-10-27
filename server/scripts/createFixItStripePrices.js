/**
 * Script: create the "Fix it" package Products and Prices in Stripe.
 *
 * One Product + one one-time USD Price per package in server/Services/Stripe/fixItPackages.js.
 * The code finds each Price by its lookup_key (sqi_fixit_trial / _standard / _accelerated),
 * so nothing needs to go in .env afterwards.
 *
 * Idempotent: a package whose lookup_key already resolves to a matching active Price is left
 * alone. A Price with the right lookup_key but the wrong amount is NOT changed — it is reported
 * and the script exits non-zero, because silently re-pricing a live product is not a script's call.
 * Creating Products/Prices charges nobody.
 *
 * Usage (from the repo root; uses STRIPE_SECRET_KEY from .env — live or test):
 *   node server/scripts/createFixItStripePrices.js --dry-run   # show what exists / would be created
 *   node server/scripts/createFixItStripePrices.js             # create what is missing
 */
require('dotenv').config();

const { FIX_IT_PACKAGES, productName } = require('../Services/Stripe/fixItPackages.js');

const run = async ({ stripe, dryRun = false, log = console.log } = {}) => {
    const mode = String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? 'LIVE' : 'TEST';
    log(`Stripe ${mode} mode${dryRun ? ' — dry run, nothing will be created' : ''}`);
    const results = [];
    let problems = 0;

    for (const pkg of FIX_IT_PACKAGES) {
        const amount = pkg.priceUsd * 100;
        const { data } = await stripe.prices.list({ lookup_keys: [pkg.lookupKey], limit: 1, expand: ['data.product'] });
        const existing = data?.[0];

        if (existing) {
            const ok = existing.active && existing.unit_amount === amount && existing.currency === 'usd' && existing.type === 'one_time';
            if (!ok) problems += 1;
            log(`${ok ? 'OK     ' : 'PROBLEM'} ${pkg.lookupKey}: ${existing.id} ${existing.currency} ${existing.unit_amount / 100} ${existing.type}${existing.active ? '' : ' (inactive)'} — "${existing.product?.name || existing.product}"`);
            results.push({ packageId: pkg.id, priceId: existing.id, created: false, ok });
            continue;
        }

        if (dryRun) {
            log(`MISSING ${pkg.lookupKey}: would create "${productName(pkg)}" at $${pkg.priceUsd} (one-time)`);
            results.push({ packageId: pkg.id, priceId: null, created: false, ok: false });
            continue;
        }

        const product = await stripe.products.create({
            name: productName(pkg),
            description: `ESF's team fixes ${pkg.tasks} of your SellerQI tasks.`,
            metadata: { purchaseType: 'fixit', packageId: pkg.id, tasks: String(pkg.tasks) },
        });
        const price = await stripe.prices.create({
            product: product.id,
            currency: 'usd',
            unit_amount: amount,
            lookup_key: pkg.lookupKey,
            nickname: `Fix it ${pkg.name}`,
            metadata: { purchaseType: 'fixit', packageId: pkg.id },
        });
        log(`CREATED ${pkg.lookupKey}: product ${product.id}, price ${price.id} ($${pkg.priceUsd})`);
        results.push({ packageId: pkg.id, priceId: price.id, created: true, ok: true });
    }

    return { mode, results, problems };
};

if (require.main === module) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    if (!process.env.STRIPE_SECRET_KEY) {
        console.error('STRIPE_SECRET_KEY is not set');
        process.exit(1);
    }
    run({ stripe, dryRun: process.argv.includes('--dry-run') })
        .then(({ problems }) => process.exit(problems ? 2 : 0))
        .catch((err) => {
            console.error('FAILED:', err.message);
            process.exit(1);
        });
}

module.exports = { run };
