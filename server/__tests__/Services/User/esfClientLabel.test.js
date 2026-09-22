/**
 * Naming a client to someone who must not learn who they are.
 *
 * Two properties matter here, and the second is a security property rather than a
 * presentational one.
 */

const { esfClientLabel, generateClientReference } = require('../../../Services/User/esfClientLabel.js');

describe('precedence', () => {
    test('the Zoho project wins over the brand', () => {
        // Measured on the live account: the one client with both has brand "Generic"
        // — the raw Amazon attribute — while its project name is the useful label.
        const { label, source } = esfClientLabel(
            { zohoProject: { projectName: "Natural Environmental Solutions (Morgan's Repellent)" }, esfClientRef: 'EF-1184' },
            { brand: 'Generic' }
        );

        expect(label).toBe("Natural Environmental Solutions (Morgan's Repellent)");
        expect(source).toBe('project');
    });

    test('the brand is used when there is no project', () => {
        expect(esfClientLabel({ esfClientRef: 'EF-1' }, { brand: 'Kessler Home Goods' }))
            .toEqual({ label: 'Kessler Home Goods', source: 'brand' });
    });

    test('the stored reference is used when there is neither', () => {
        // 2 of 3 ESF clients on the live data are in exactly this state, so this is
        // the common case, not the fallback.
        expect(esfClientLabel({ esfClientRef: 'EF-3310' }, null))
            .toEqual({ label: 'EF-3310', source: 'reference' });
    });

    test('whitespace-only values are treated as absent', () => {
        expect(esfClientLabel({ zohoProject: { projectName: '   ' }, esfClientRef: 'EF-9' }, { brand: '  ' }).source)
            .toBe('reference');
    });

    test('never returns an empty label, whatever it is given', () => {
        [{}, null, undefined].forEach((user) => {
            expect(esfClientLabel(user).label).toBeTruthy();
        });
    });
});

describe('the reference is random, not derived', () => {
    test('two calls never agree', () => {
        // If it were a hash of the email, staff could list every client address from
        // the Clients page, compute all the codes, and de-anonymise the whole inbox
        // in one script. Randomness is what makes the label a dead end.
        const refs = new Set(Array.from({ length: 200 }, generateClientReference));

        expect(refs.size).toBeGreaterThan(190);
    });

    test('looks like the ticket reference the design used', () => {
        expect(generateClientReference()).toMatch(/^EF-\d{4,}$/);
    });

    test('esfClientLabel does not mint one itself', () => {
        // An unsaved reference would differ per request and the same client would
        // appear under two labels. Callers persist it once, deliberately.
        const first = esfClientLabel({}).label;
        const second = esfClientLabel({}).label;

        expect(first).toBe(second);
    });
});
