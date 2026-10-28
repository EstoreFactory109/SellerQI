/**
 * Creating the Fix it Products/Prices in Stripe: creates only what is missing, never re-prices
 * an existing one (reports it instead), and a dry run creates nothing.
 * Also: the server's package list matches the prices the Tasks page shows.
 */
const fs = require('fs');
const path = require('path');
const { run } = require('../../scripts/createFixItStripePrices.js');
const { FIX_IT_PACKAGES } = require('../../Services/Stripe/fixItPackages.js');

const fakeStripe = (existing = {}) => ({
  prices: {
    list: jest.fn(async ({ lookup_keys: [key] }) => ({ data: existing[key] ? [existing[key]] : [] })),
    create: jest.fn(async (p) => ({ id: `price_${p.lookup_key}`, ...p })),
  },
  products: { create: jest.fn(async (p) => ({ id: `prod_${p.metadata.packageId}`, ...p })) },
});
const quiet = () => {};

it('creates what is missing: the Trial one-time, Standard and Accelerated monthly', async () => {
  const stripe = fakeStripe({ sqi_fixit_trial: { id: 'price_t', active: true, unit_amount: 2500, currency: 'usd', type: 'one_time', product: { name: 'x' } } });
  const out = await run({ stripe, log: quiet });
  expect(out.problems).toBe(0);
  expect(stripe.prices.create).toHaveBeenCalledTimes(2);
  expect(stripe.prices.create).toHaveBeenCalledWith(expect.objectContaining({
    currency: 'usd', unit_amount: 29900, lookup_key: 'sqi_fixit_standard_monthly', product: 'prod_standard', recurring: { interval: 'month' },
  }));
  expect(stripe.products.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'SellerQI Fix it: Accelerated (60 tasks per month)' }));
});

it('a dry run creates nothing', async () => {
  const stripe = fakeStripe();
  await run({ stripe, dryRun: true, log: quiet });
  expect(stripe.products.create).not.toHaveBeenCalled();
  expect(stripe.prices.create).not.toHaveBeenCalled();
});

it('reports, and does not change, a price with the wrong amount', async () => {
  const stripe = fakeStripe({ sqi_fixit_standard_monthly: { id: 'price_s', active: true, unit_amount: 19900, currency: 'usd', type: 'recurring', recurring: { interval: 'month' }, product: { name: 'x' } } });
  const out = await run({ stripe, log: quiet });
  expect(out.problems).toBe(1);
  expect(stripe.prices.create).not.toHaveBeenCalledWith(expect.objectContaining({ lookup_key: 'sqi_fixit_standard_monthly' }));
});

it('a one-time price under a monthly lookup key is a problem, not a match', async () => {
  const stripe = fakeStripe({ sqi_fixit_accelerated_monthly: { id: 'price_a', active: true, unit_amount: 49900, currency: 'usd', type: 'one_time', product: { name: 'x' } } });
  expect((await run({ stripe, log: quiet })).problems).toBe(1);
});

it('the server packages match what the Tasks page shows', () => {
  const modal = fs.readFileSync(path.join(__dirname, '../../../client/src/Components/Tasks/FixItPackagesModal.jsx'), 'utf8');
  for (const pkg of FIX_IT_PACKAGES) {
    const block = modal.match(new RegExp(`id: '${pkg.id}'[\\s\\S]*?\\}`))?.[0] || '';
    expect(block).toMatch(new RegExp(`price: ${pkg.priceUsd}\\b`));
    expect(block).toMatch(new RegExp(`tasks: ${pkg.tasks}\\b`));
  }
});
