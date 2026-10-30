/**
 * Campaign changes: what each preview shows, the stale checks, and that a failed
 * step of a new campaign reports what was already created.
 */
process.env.AMAZON_ADS_CLIENT_ID = 'client';
// Plain functions: the jest config resets jest.fn implementations between tests.
const mock = { campaigns: [], adGroups: [], keywords: [], calls: [], fail: null };
jest.mock('../../../Services/AmazonAds/resolveAdsCredentials.js', () => ({
    resolveAdsCredentials: async () => ({ accessToken: 't', profileId: 'p', region: 'NA' })
}));
const ok = (key, idField, n = 1) => ({ [key]: { success: Array.from({ length: n }, (_, i) => ({ index: i, [idField]: `${idField}-${i + 1}` })), error: [] } });
const bad = (key) => ({ [key]: { success: [], error: [{ index: 0, errors: [{ errorType: 'x', errorValue: { x: { message: 'SKU not eligible for advertising' } } }] }] } });
jest.mock('../../../Services/AmazonAds/SpWrites.js', () => ({
    ALL_STATES: ['ENABLED', 'PAUSED', 'ARCHIVED'],
    listCampaigns: async (creds, f = {}) => mock.campaigns.filter((c) => (!f.campaignIds || f.campaignIds.includes(c.campaignId)) && (!f.names || f.names.includes(c.name)) && (!f.states || f.states.includes(c.state))),
    listAdGroups: async (creds, f = {}) => mock.adGroups.filter((g) => (!f.adGroupIds || f.adGroupIds.includes(g.adGroupId)) && (!f.campaignIds || f.campaignIds.includes(g.campaignId))),
    listKeywords: async () => mock.keywords,
    updateCampaignStates: async (creds, items) => { mock.calls.push(['campaignStates', items]); return { campaigns: { success: items.map((_, index) => ({ index })), error: [] } }; },
    updateAdGroupStates: async (creds, items) => { mock.calls.push(['adGroupStates', items]); return { adGroups: { success: [], error: [] } }; },
    createCampaigns: async (creds, items) => { mock.calls.push(['campaigns', items]); return mock.fail === 'campaigns' ? bad('campaigns') : ok('campaigns', 'campaignId'); },
    createAdGroups: async (creds, items) => { mock.calls.push(['adGroups', items]); return mock.fail === 'adGroups' ? bad('adGroups') : ok('adGroups', 'adGroupId'); },
    createProductAds: async (creds, items) => { mock.calls.push(['productAds', items]); return mock.fail === 'productAds' ? bad('productAds') : ok('productAds', 'adId'); },
    createKeywords: async (creds, items) => { mock.calls.push(['keywords', items]); return ok('keywords', 'keywordId', items.length); }
}));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
    findOne: () => ({ select: () => ({ lean: async () => ({ sellerAccount: [{ country: 'US', region: 'NA', products: [{ sku: 'SKU-1', asin: 'B01', status: 'Active', itemName: 'Garlic press' }] }] }) }) })
}));

const registry = require('../../../Services/Actions/registry.js');
const ctx = () => ({ userId: 'U1', country: 'US', region: 'NA' });

beforeEach(() => {
    mock.campaigns = [
        { campaignId: 'C1', name: 'Garlic exact', state: 'PAUSED', targetingType: 'MANUAL', budget: { budget: 15 } },
        { campaignId: 'C2', name: 'Garlic auto', state: 'ENABLED', targetingType: 'AUTO', budget: { budget: 5 } }
    ];
    mock.adGroups = [{ adGroupId: 'G1', campaignId: 'C1', name: 'Main', state: 'ENABLED' }];
    mock.keywords = [{ keywordText: 'garlic press', matchType: 'EXACT' }];
    mock.calls = [];
    mock.fail = null;
});

describe('ads.set_campaign_state', () => {
    const h = registry.get('ads.set_campaign_state');

    it('is a new kind of change, behind its own switch', () => {
        expect(h.flag).toBe('AMAZON_ACTIONS_ADS');
    });

    it('needs archiving confirmed, because it cannot be undone', () => {
        expect(() => h.validate({ ids: ['C1'], state: 'ARCHIVED' })).toThrow('cannot be undone');
        expect(h.validate({ ids: ['C1'], state: 'archived', confirmArchive: true })).toEqual({ ids: ['C1'], state: 'ARCHIVED' });
    });

    it('shows each campaign by name and what enabling can spend; skips ones already there', async () => {
        const p = await h.preview(h.validate({ ids: ['C1', 'C2'], state: 'ENABLED' }), ctx());
        expect(p.lines).toEqual([{ label: 'Garlic exact', before: 'Paused', after: 'Enabled' }]);
        expect(p.warnings[0]).toContain('15.00 a day');
        expect(p.payload).toEqual({ items: [{ campaignId: 'C1', state: 'ENABLED' }] });
        await expect(h.preview(h.validate({ ids: ['C2'], state: 'ENABLED' }), ctx())).rejects.toThrow('Already enabled');
    });

    it('sends nothing when the campaign was changed in Amazon Ads since the preview', async () => {
        const p = await h.preview(h.validate({ ids: ['C1'], state: 'ENABLED' }), ctx());
        mock.campaigns[0].state = 'ENABLED';
        await expect(h.staleCheck({ payload: p.payload, expected: p.expected }, ctx())).rejects.toMatchObject({ isStale: true });
        mock.campaigns[0].state = 'PAUSED';
        await expect(h.staleCheck({ payload: p.payload, expected: p.expected }, ctx())).resolves.toBeUndefined();
        await h.execute(p.payload, ctx());
        expect(mock.calls).toEqual([['campaignStates', [{ campaignId: 'C1', state: 'ENABLED' }]]]);
    });
});

describe('ads.add_keywords', () => {
    const h = registry.get('ads.add_keywords');

    it('leaves out keywords already in the ad group, and refuses when nothing is new', async () => {
        const input = h.validate({ campaignId: 'C1', adGroupId: 'G1', defaultBid: 0.75, keywords: [{ keywordText: 'Garlic  Press', matchType: 'exact' }, { keywordText: 'garlic crusher', matchType: 'PHRASE', bid: 0.5 }] }, ctx());
        const p = await h.preview(input, ctx());
        expect(p.payload.keywords).toEqual([{ campaignId: 'C1', adGroupId: 'G1', keywordText: 'garlic crusher', matchType: 'PHRASE', bid: 0.5, state: 'ENABLED' }]);
        expect(p.warnings[0]).toContain('1 keyword is already');
        await expect(h.preview(h.validate({ campaignId: 'C1', adGroupId: 'G1', defaultBid: 1, keywords: [{ keywordText: 'garlic press' }] }, ctx()), ctx())).rejects.toThrow('already in this ad group');
    });

    it('refuses a bid under the marketplace minimum', () => {
        expect(() => h.validate({ campaignId: 'C1', adGroupId: 'G1', keywords: [{ keywordText: 'x', bid: 0.01 }] }, ctx())).toThrow('at least 0.02');
    });
});

describe('ads.create_campaign', () => {
    const h = registry.get('ads.create_campaign');
    const input = (over = {}) => h.validate({ name: 'Garlic new', targetingType: 'MANUAL', sku: 'SKU-1', dailyBudget: 100, defaultBid: 0.8, keywords: [{ keywordText: 'garlic mincer' }], ...over }, ctx());

    it('starts paused unless the seller chooses otherwise, and warns about an unusual budget', async () => {
        const p = await h.preview(input(), ctx());
        expect(p.payload.startEnabled).toBe(false);
        expect(p.warnings.join(' ')).toContain('more than 3 times your usual campaign budget (5.00 a day)');
        expect(p.warnings.join(' ')).toContain('created paused');
        expect(p.lines.map((l) => l.label)).toEqual(['Campaign', 'Ad group', 'Product', 'Keywords (1)']);
    });

    it('needs keywords for a manual campaign and refuses a name that exists', async () => {
        expect(() => input({ keywords: [] })).toThrow('at least one keyword');
        await expect(h.preview(input({ name: 'Garlic exact' }), ctx())).rejects.toThrow('already exists');
    });

    it('creates campaign, ad group, product ad and keywords in order', async () => {
        const p = await h.preview(input(), ctx());
        const r = await h.execute(p.payload, ctx());
        expect(mock.calls.map((c) => c[0])).toEqual(['campaigns', 'adGroups', 'productAds', 'keywords']);
        expect(mock.calls[0][1][0]).toMatchObject({ name: 'Garlic new', state: 'PAUSED', budget: { budgetType: 'DAILY', budget: 100 } });
        expect(r.createdIds).toEqual({ campaignId: 'campaignId-1', adGroupId: 'adGroupId-1', productAdId: 'adId-1', keywordIds: ['keywordId-1'] });
    });

    it('reports what was already created when a later step fails', async () => {
        const p = await h.preview(input(), ctx());
        mock.fail = 'productAds';
        const err = await h.execute(p.payload, ctx()).catch((e) => e);
        expect(err.message).toContain('SKU not eligible for advertising');
        expect(err.message).toMatch(/^Created the campaign and ad group, but adding the product failed/);
        expect(err.amazon.createdIds).toEqual({ campaignId: 'campaignId-1', adGroupId: 'adGroupId-1' });
    });

    it('is not resent after a timeout', () => {
        expect(h.idempotent).toBe(false);
    });
});

describe('ads.create_ad_group', () => {
    const h = registry.get('ads.create_ad_group');
    it('needs a product, and refuses keywords on an automatic campaign', async () => {
        expect(() => h.validate({ campaignId: 'C2', name: 'New', defaultBid: 1 }, ctx())).toThrow('never shows');
        await expect(h.preview(h.validate({ campaignId: 'C2', name: 'New', sku: 'SKU-1', defaultBid: 1, keywords: [{ keywordText: 'x' }] }, ctx()), ctx())).rejects.toThrow('automatic campaign');
    });
});
