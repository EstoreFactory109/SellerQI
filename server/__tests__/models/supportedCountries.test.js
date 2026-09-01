/**
 * Tests that the country enums cannot drift away from the SP-API marketplace table.
 *
 * WHY THIS EXISTS
 * Both models hard-listed 15 countries while `marketplaceConfig` — the table the fetch
 * layer actually onboards sellers against — lists 23. Every country in the gap could be
 * connected by a seller and then fail to be stored.
 *
 * This is not hypothetical. Production logs carry 63
 *   `BuyBoxData validation failed: country: 'BR' is not a valid enum value for path 'country'`
 * errors, each a fetched-then-discarded day of BuyBox data for a Brazilian seller. The ZA
 * marketplace bug fixed earlier was the same shape, and it DID hit a live account.
 *
 * DataFetchTracking is the dangerous one. `createTrackingEntry` uses `new this({...})` +
 * `.save()`, so validation is enforced, and it runs in `sched_init` — the FIRST phase.
 * A country outside the enum throws there, the pipeline never starts, and since no
 * tracking document is written there is nothing for `sweepStalledPipelines` to find. The
 * account goes silent with no signal anywhere.
 */

const { marketplaceConfig } = require('../../controllers/config/config.js');
const DataFetchTracking = require('../../models/system/DataFetchTrackingModel.js');
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');

// The literal both models used to carry. Kept here so the test proves the change was
// purely ADDITIVE — no previously-storable country may be dropped.
const PREVIOUS_LITERAL = ['US', 'CA', 'MX', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP', 'AU', 'IN', 'SG', 'SA', 'ZA', 'BE'];

const countryEnum = (model) => model.schema.path('country').enumValues;

describe('country enums track the SP-API marketplace table', () => {
    test.each([
        ['DataFetchTracking', DataFetchTracking],
        ['BuyBoxData', BuyBoxData],
    ])('%s accepts exactly the marketplace countries', (_name, model) => {
        expect([...countryEnum(model)].sort()).toEqual(Object.keys(marketplaceConfig).sort());
    });

    // The specific countries that were missing, with live seller accounts behind them:
    // BR (4 accounts), TR (2), EG (1).
    test.each([
        ['DataFetchTracking', DataFetchTracking],
        ['BuyBoxData', BuyBoxData],
    ])('%s accepts BR, TR and EG', (_name, model) => {
        const values = countryEnum(model);
        expect(values).toEqual(expect.arrayContaining(['BR', 'TR', 'EG']));
    });

    // Guards against a "cleanup" that swaps the derivation back for a shorter literal.
    test.each([
        ['DataFetchTracking', DataFetchTracking],
        ['BuyBoxData', BuyBoxData],
    ])('%s keeps every country it previously accepted', (_name, model) => {
        expect(countryEnum(model)).toEqual(expect.arrayContaining(PREVIOUS_LITERAL));
    });

    test('the two models stay in lockstep', () => {
        expect([...countryEnum(DataFetchTracking)].sort()).toEqual([...countryEnum(BuyBoxData)].sort());
    });

    // ZA is the regression marker: it was already in the literal, and the marketplace-map
    // half of that bug was fixed separately. If it ever falls out of either list, the same
    // failure returns.
    test('ZA is present in the marketplace table and both enums', () => {
        expect(marketplaceConfig.ZA).toBeTruthy();
        expect(countryEnum(DataFetchTracking)).toContain('ZA');
        expect(countryEnum(BuyBoxData)).toContain('ZA');
    });
});
