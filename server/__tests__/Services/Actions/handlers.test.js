/**
 * The change handlers' own checks and previews (nothing here calls Amazon).
 */
jest.mock('../../../utils/ppcSnapshotLoader.js', () => ({
    loadKeywordSnapshot: async () => ({ keywordData: [{ keywordId: 'K1', keywordText: 'garlic press', matchType: 'EXACT' }] })
}));
const registry = require('../../../Services/Actions/registry.js');
const ctx = { userId: 'U1', country: 'US', region: 'NA' };

describe('ads.pause_keywords', () => {
    const h = registry.get('ads.pause_keywords');
    it('needs keywords and a known ad type, and removes duplicates', () => {
        expect(() => h.validate({ keywordIds: [] })).toThrow('Choose at least one keyword');
        expect(() => h.validate({ keywordIds: ['K1'], adType: 'XX' })).toThrow('Ad type');
        expect(h.validate({ keywordIds: ['K1', 'K1', 2] })).toEqual({ keywordIds: ['K1', '2'], adType: 'SP' });
    });
    it('shows each keyword by name where the snapshot knows it', async () => {
        const p = await h.preview({ keywordIds: ['K1', 'K9'], adType: 'SP' }, ctx);
        expect(p.lines.map((l) => [l.label, l.before, l.after])).toEqual([['"garlic press" (exact)', 'Enabled', 'Paused'], ['Keyword K9', 'Enabled', 'Paused']]);
        expect(p.payload).toEqual({ keywordIds: ['K1', 'K9'], adType: 'SP' });
    });
});

describe('ads.add_negative_keywords', () => {
    const h = registry.get('ads.add_negative_keywords');
    it('needs the ad group for ad-group negatives, and keeps display names out of the payload', async () => {
        expect(() => h.validate({ level: 'adGroup', keywords: [{ campaignId: 'C1', keywordText: 'cheap' }] })).toThrow('ad group');
        const clean = h.validate({ level: 'adGroup', keywords: [{ campaignId: 'C1', adGroupId: 'G1', keywordText: ' cheap ', campaignName: 'Garlic' }] });
        const p = await h.preview(clean, ctx);
        expect(p.payload).toEqual({ level: 'adGroup', keywords: [{ campaignId: 'C1', adGroupId: 'G1', keywordText: 'cheap', matchType: 'negativeExact', state: 'enabled' }] });
        expect(p.lines[0].after).toContain('campaign "Garlic"');
    });
});

describe('ads.pause_and_negate', () => {
    it('needs every id', () => {
        expect(() => registry.get('ads.pause_and_negate').validate({ items: [{ keywordId: 'K1', keywordText: 'x' }] })).toThrow('campaign and ad group');
    });
});

describe('listings.update_content', () => {
    const h = registry.get('listings.update_content');
    it('accepts only the listing text fields, and bullets as a list or one bullet', () => {
        expect(() => h.validate({ sku: 'S', field: 'price', value: 1 })).toThrow('field must be one of');
        expect(() => h.validate({ sku: 'S', field: 'title', value: '  ' })).toThrow('Enter the new text');
        expect(() => h.validate({ sku: 'S', field: 'bulletpoints', value: 'one' })).toThrow('Bullet points');
        expect(h.validate({ sku: 'S', field: 'BulletPoints', value: { index: 0, value: 'x' } })).toMatchObject({ field: 'bulletpoints', autoFixConflicts: true });
    });
});

describe('the registry', () => {
    it('has one handler per action type, each with an executor', () => {
        const all = registry.all();
        expect(new Set(all.map((h) => h.actionType)).size).toBe(all.length);
        for (const h of all) expect(typeof h.execute).toBe('function');
    });
});
