/**
 * The "Fix it" packages a seller can buy from the Tasks page: ESF's team fixes N of their tasks.
 *
 * The server's copy is the one that decides what is charged — the client only sends a package
 * id. Each package is a one-time USD Price in Stripe, found by its lookup_key (created by
 * server/scripts/createFixItStripePrices.js), so no price ids live in .env.
 *
 * Keep in step with client/src/Components/Tasks/FixItPackagesModal.jsx (a test checks both).
 */
const FIX_IT_PACKAGES = [
    { id: 'trial', name: 'Trial', tasks: 2, priceUsd: 25, lookupKey: 'sqi_fixit_trial' },
    { id: 'standard', name: 'Standard', tasks: 30, priceUsd: 299, lookupKey: 'sqi_fixit_standard' },
    { id: 'accelerated', name: 'Accelerated', tasks: 60, priceUsd: 499, lookupKey: 'sqi_fixit_accelerated' },
];

const getFixItPackage = (id) => FIX_IT_PACKAGES.find((p) => p.id === id) || null;

/** The Stripe Product name, also shown on the Checkout page and the receipt. */
const productName = (pkg) => `SellerQI Fix it: ${pkg.name} (${pkg.tasks} tasks)`;

module.exports = { FIX_IT_PACKAGES, getFixItPackage, productName };
