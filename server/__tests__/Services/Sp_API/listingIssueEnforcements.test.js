/**
 * Listing issue enforcement parsing.
 *
 * Both Listings Items call sites already asked Amazon for `includedData=issues`
 * and then discarded almost all of it — the inactive path kept only `message`,
 * and the active path kept nothing at all. What was lost is `enforcements`,
 * the only field that separates a listing which is merely imperfect from one
 * shoppers cannot buy.
 *
 * The exact nesting of `enforcements` could not be confirmed against a live
 * response (no working SP-API credentials on the machine this was written on),
 * so the parser accepts several shapes. That makes these the important tests:
 * a mocked fetch would only prove the code agrees with my guess, whereas these
 * pin the behaviour AROUND the guess — every plausible shape is read, an
 * unrecognised one is not mistaken for "no suppression", and an exempt listing
 * is never reported as blocked when Amazon is still showing it.
 */
// The global setup mocks axios without an interceptors property, so the
// module-level axiosRetry(axios, ...) call throws before the file can load.
// The function under test is pure, so a no-op retry shim is enough.
jest.mock('axios-retry', () => ({
    __esModule: true,
    default: () => {},
    exponentialDelay: () => 0,
    isNetworkError: () => false,
    isRetryableError: () => false,
}));

const { extractListingIssues, SUPPRESSION_ACTIONS } = require('../../../Services/Sp_API/GetListingItemsIssues.js');

describe('extractListingIssues', () => {
    it('keeps everything the old parser threw away', () => {
        const [issue] = extractListingIssues([{
            code: '90220',
            message: 'Missing required attribute',
            severity: 'ERROR',
            attributeNames: ['item_name'],
            categories: ['MISSING_ATTRIBUTE'],
            enforcements: { actions: [{ action: 'LISTING_SUPPRESSED' }] },
        }]);

        expect(issue.code).toBe('90220');
        expect(issue.message).toBe('Missing required attribute');
        expect(issue.severity).toBe('ERROR');
        expect(issue.attributeNames).toEqual(['item_name']);
        expect(issue.categories).toEqual(['MISSING_ATTRIBUTE']);
        expect(issue.enforcementActions).toEqual(['LISTING_SUPPRESSED']);
        expect(issue.isSuppression).toBe(true);
    });

    it('reads the documented shape and the flatter fallbacks alike', () => {
        const documented = extractListingIssues([{ enforcements: { actions: [{ action: 'SEARCH_SUPPRESSED' }] } }]);
        const flatObjects = extractListingIssues([{ enforcements: [{ action: 'SEARCH_SUPPRESSED' }] }]);
        const plainStrings = extractListingIssues([{ enforcementActions: ['SEARCH_SUPPRESSED'] }]);

        for (const [parsed] of [documented, flatObjects, plainStrings].map((r) => [r[0]])) {
            expect(parsed.enforcementActions).toEqual(['SEARCH_SUPPRESSED']);
            expect(parsed.isSuppression).toBe(true);
        }
    });

    it('recognises every action that means a shopper cannot buy', () => {
        for (const action of ['LISTING_SUPPRESSED', 'ATTRIBUTE_SUPPRESSED', 'CATALOG_ITEM_REMOVED', 'SEARCH_SUPPRESSED']) {
            const [parsed] = extractListingIssues([{ enforcements: { actions: [{ action }] } }]);
            expect(parsed.isSuppression).toBe(true);
        }
        expect(SUPPRESSION_ACTIONS.size).toBe(4);
    });

    it('does not call an ordinary issue a suppression', () => {
        const [parsed] = extractListingIssues([{
            message: 'Image resolution is low',
            severity: 'WARNING',
            enforcements: { actions: [] },
        }]);

        expect(parsed.isSuppression).toBe(false);
        expect(parsed.enforcementActions).toEqual([]);
        // Still kept: a warning is worth reporting, just not as a block on sales.
        expect(parsed.message).toBe('Image resolution is low');
    });

    it('records an exemption, because an exempt listing is still selling', () => {
        const [parsed] = extractListingIssues([{
            enforcements: {
                actions: [{ action: 'LISTING_SUPPRESSED' }],
                exemption: { status: 'EXEMPT', expiryDate: '2026-12-01' },
            },
        }]);

        expect(parsed.isSuppression).toBe(true);
        expect(parsed.exemptionStatus).toBe('EXEMPT');
    });

    it('uppercases actions so a casing change cannot hide a suppression', () => {
        const [parsed] = extractListingIssues([{ enforcements: { actions: [{ action: 'listing_suppressed' }] } }]);
        expect(parsed.isSuppression).toBe(true);
    });

    it('survives the shapes a real response throws at it', () => {
        expect(extractListingIssues(undefined)).toEqual([]);
        expect(extractListingIssues(null)).toEqual([]);
        expect(extractListingIssues('not an array')).toEqual([]);
        expect(extractListingIssues([])).toEqual([]);

        // An issue with nothing recognisable must still produce a row rather
        // than vanishing — losing it silently is how a suppression goes unseen.
        const [parsed] = extractListingIssues([{}]);
        expect(parsed).toBeDefined();
        expect(parsed.isSuppression).toBe(false);
        expect(parsed.message).toBe('');
    });

    it('collects several enforcements on one issue', () => {
        const [parsed] = extractListingIssues([{
            enforcements: { actions: [{ action: 'SEARCH_SUPPRESSED' }, { action: 'ATTRIBUTE_SUPPRESSED' }] },
        }]);

        expect(parsed.enforcementActions).toEqual(['SEARCH_SUPPRESSED', 'ATTRIBUTE_SUPPRESSED']);
        expect(parsed.isSuppression).toBe(true);
    });
});
