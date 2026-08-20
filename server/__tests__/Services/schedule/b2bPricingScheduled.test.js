/**
 * Tests for `has_b2b_pricing` on the SCHEDULED path.
 *
 * WHY THIS EXISTS
 * `has_b2b_pricing` is written by exactly two SP-API calls — GetListingItem (active SKUs)
 * and GetListingItemIssuesForInactive (inactive/incomplete SKUs). On the scheduled path
 * the first was a dead stub and the second fetched the value and threw it away, so the
 * field only ever refreshed on a MANUAL reconnect and was `false` fleet-wide.
 *
 * That is not cosmetic. QMateProductsService feeds withB2BPricingCount /
 * withoutB2BPricingCount straight into the AI context and QMateService instructs the model
 * to answer "how many of my products have B2B pricing" from that number directly — so the
 * assistant told every seller that ZERO of their products had B2B pricing, as a statement
 * of fact.
 *
 * The two behaviours these tests pin are the ones that would silently regress:
 *   1. the inactive path persists the value it already has (no new API calls);
 *   2. a SKU absent from the response is NOT forced to false — the whole point of the
 *      earlier carry-forward fix was to stop stale-but-real values being wiped.
 */

// The global setup mocks `axios` with an object that has no `interceptors`, which makes
// axios-retry throw at import time somewhere in ScheduledIntegration's require graph.
// Same shim as adsAsyncPhase.test.js.
jest.mock('axios-retry', () => {
    const fn = () => {};
    fn.exponentialDelay = () => 0;
    fn.isNetworkError = () => false;
    fn.isRetryableError = () => false;
    fn.isIdempotentRequestError = () => false;
    fn.isNetworkOrIdempotentRequestError = () => false;
    fn.default = fn;
    return fn;
});

const mockFindOne = jest.fn();
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: (...a) => mockFindOne(...a) }));

const { ScheduledIntegration } = require('../../../Services/schedule/ScheduledIntegration.js');
const { SUNDAY_FUNCTIONS, DAILY_FUNCTIONS, MON_WED_FRI_FUNCTIONS, SATURDAY_FUNCTIONS, OTHER_DAYS_FUNCTIONS, getFunctionsForDay } =
    require('../../../Services/schedule/ScheduleConfig.js');

/** Minimal stand-in for the seller document: products plus a save() that records the call. */
function makeSeller(products, { country = 'US', region = 'NA' } = {}) {
    const save = jest.fn().mockResolvedValue(undefined);
    return {
        save,
        sellerAccount: [{ country, region, products }],
    };
}

describe('inactive listing items persist has_b2b_pricing', () => {
    beforeEach(() => { mockFindOne.mockReset(); });

    test('writes the value for matching SKUs, keyed on SKU alone', async () => {
        const products = [
            { sku: 'SKU-A', status: 'Inactive', has_b2b_pricing: false },
            { sku: 'SKU-B', status: 'Active', has_b2b_pricing: false },
        ];
        const seller = makeSeller(products);
        mockFindOne.mockResolvedValue(seller);

        await ScheduledIntegration.updateSellerProductIssues('u1', 'US', 'NA', [
            { sku: 'SKU-A', issues: ['inactive offer'], has_b2b_pricing: true },
            // Active SKUs never appear in the inactive response, but if one did, B2B is
            // not status-dependent — Integration.updateSellerProductB2BPricing keys purely
            // on SKU and this must match it.
            { sku: 'SKU-B', has_b2b_pricing: true },
        ]);

        expect(products[0].has_b2b_pricing).toBe(true);
        expect(products[1].has_b2b_pricing).toBe(true);
        expect(seller.save).toHaveBeenCalledTimes(1);
    });

    test('issues are still applied only to Inactive/Incomplete products', async () => {
        const products = [
            { sku: 'SKU-A', status: 'Inactive', issues: [] },
            { sku: 'SKU-B', status: 'Active', issues: ['pre-existing'] },
        ];
        mockFindOne.mockResolvedValue(makeSeller(products));

        await ScheduledIntegration.updateSellerProductIssues('u1', 'US', 'NA', [
            { sku: 'SKU-A', issues: ['inactive offer'], has_b2b_pricing: false },
            { sku: 'SKU-B', issues: ['should not land'], has_b2b_pricing: false },
        ]);

        expect(products[0].issues).toEqual(['inactive offer']);
        expect(products[1].issues).toEqual(['pre-existing']);
    });

    // THE regression test. A SKU the response didn't mention must keep whatever it had —
    // the carry-forward fix exists precisely because a blanket overwrite wiped real values.
    test('a SKU absent from the response is not forced to false', async () => {
        const products = [
            { sku: 'SKU-A', status: 'Inactive', has_b2b_pricing: true },
            { sku: 'SKU-B', status: 'Inactive', has_b2b_pricing: true },
        ];
        mockFindOne.mockResolvedValue(makeSeller(products));

        await ScheduledIntegration.updateSellerProductIssues('u1', 'US', 'NA', [
            { sku: 'SKU-A', issues: [], has_b2b_pricing: false },
        ]);

        expect(products[0].has_b2b_pricing).toBe(false);  // present in response -> updated
        expect(products[1].has_b2b_pricing).toBe(true);   // absent -> untouched
    });

    // A response entry with issues but no B2B key must not blank the field either.
    test('an entry with has_b2b_pricing undefined leaves the field alone', async () => {
        const products = [{ sku: 'SKU-A', status: 'Inactive', has_b2b_pricing: true }];
        mockFindOne.mockResolvedValue(makeSeller(products));

        await ScheduledIntegration.updateSellerProductIssues('u1', 'US', 'NA', [
            { sku: 'SKU-A', issues: ['inactive offer'] },
        ]);

        expect(products[0].has_b2b_pricing).toBe(true);
        expect(products[0].issues).toEqual(['inactive offer']);
    });

    // One document load and one save per batch. The seller document can be multi-MB, and
    // the earlier design called a second method that re-loaded and re-saved it.
    test('loads and saves the seller document exactly once', async () => {
        const seller = makeSeller([{ sku: 'SKU-A', status: 'Inactive' }]);
        mockFindOne.mockResolvedValue(seller);

        await ScheduledIntegration.updateSellerProductIssues('u1', 'US', 'NA', [
            { sku: 'SKU-A', issues: ['x'], has_b2b_pricing: true },
        ]);

        expect(mockFindOne).toHaveBeenCalledTimes(1);
        expect(seller.save).toHaveBeenCalledTimes(1);
    });
});

describe('GetListingItem registration', () => {
    // Weekly, not daily: one SP-API GET per active SKU per account. Fleet-wide that is
    // ~45k calls/day if run daily, for listing configuration that rarely changes.
    test('is registered on Sunday only', () => {
        expect(SUNDAY_FUNCTIONS.GetListingItem).toBeDefined();
        expect(DAILY_FUNCTIONS.GetListingItem).toBeUndefined();
        expect(getFunctionsForDay(0).GetListingItem).toBeDefined();
        for (const day of [1, 2, 3, 4, 5, 6]) {
            expect(getFunctionsForDay(day).GetListingItem).toBeUndefined();
        }
    });

    test('resolves to a real function', () => {
        const cfg = SUNDAY_FUNCTIONS.GetListingItem;
        expect(typeof cfg.service[cfg.functionName]).toBe('function');
        expect(cfg.requiresAccessToken).toBe(true);
    });

    // `description` is the JOIN KEY used to map Promise.allSettled results back to
    // services. A duplicate does not throw — it silently attributes one service's result
    // to another.
    test('every scheduled function has a unique description', () => {
        const bags = {
            SUNDAY: SUNDAY_FUNCTIONS,
            MON_WED_FRI: MON_WED_FRI_FUNCTIONS,
            SATURDAY: SATURDAY_FUNCTIONS,
            DAILY: DAILY_FUNCTIONS,
            OTHER: OTHER_DAYS_FUNCTIONS,
        };
        const seen = new Map();
        const duplicates = [];
        for (const [bag, fns] of Object.entries(bags)) {
            for (const [key, cfg] of Object.entries(fns)) {
                expect(typeof cfg.description).toBe('string');
                expect(cfg.description.length).toBeGreaterThan(0);
                if (seen.has(cfg.description)) {
                    duplicates.push(`${cfg.description}: ${seen.get(cfg.description)} vs ${bag}.${key}`);
                } else {
                    seen.set(cfg.description, `${bag}.${key}`);
                }
            }
        }
        expect(duplicates).toEqual([]);
    });
});
