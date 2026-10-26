/**
 * Changes on Amazon only after the seller approves: proposals per task, the
 * approve step (re-derived from the stored task, logged, never sent twice), and
 * Amazon's partial-failure answers treated as failures.
 */
// Plain functions: the jest config resets jest.fn implementations between tests.
const mockTasks = [];
const mockLogs = [];
const mockTaskUpdates = [];
jest.mock('../../../models/MCP/TaskItemModel.js', () => ({
    find: () => ({ lean: async () => mockTasks }),
    updateOne: async (...args) => { mockTaskUpdates.push(args); return {}; }
}));
jest.mock('../../../models/MCP/TaskActionLogModel.js', () => ({
    findOne: (q) => ({ lean: async () => mockLogs.find(l => l.taskId === q.taskId && l.status === 'succeeded') || null }),
    find: () => ({ select: () => ({ lean: async () => mockLogs.filter(l => l.status === 'succeeded') }) }),
    create: async (doc) => { const l = { _id: String(mockLogs.length), ...doc, status: 'running' }; mockLogs.push(l); return l; },
    updateOne: async ({ _id }, { $set }) => { Object.assign(mockLogs.find(l => l._id === _id), $set); }
}));
jest.mock('../../../Services/AmazonAds/resolveAdsCredentials.js', () => ({
    resolveAdsCredentials: async () => ({ accessToken: 't', profileId: 'p', region: 'NA' })
}));
const mockAddToNegative = jest.fn();
jest.mock('../../../Services/AmazonAds/addToNegetive.js', () => ({
    getConfig: (c) => c,
    addToNegative: (...args) => mockAddToNegative(...args)
}));
const mockPause = jest.fn();
const mockBids = jest.fn();
jest.mock('../../../Services/AmazonAds/Pause-ArchiveKeywords.js', () => ({
    pauseKeywords: (...args) => mockPause(...args),
    updateKeywordBids: (...args) => mockBids(...args)
}));
let mockSnapshot = null;
let mockProductAds = [];
const mockPauseAds = jest.fn();
jest.mock('../../../Services/AmazonAds/ProductAds.js', () => ({
    listEnabledProductAdsForAsin: async () => mockProductAds,
    pauseProductAds: (...a) => mockPauseAds(...a)
}));
const mockTargetBids = jest.fn();
let mockLiveTargets = new Map();
let mockLiveCampaigns = [];
const mockBudget = jest.fn();
jest.mock('../../../Services/AmazonAds/AdsTargets.js', () => ({
    listTargetBids: async () => mockLiveTargets,
    updateTargetBids: (...a) => mockTargetBids(...a),
    listCampaignBudgets: async () => mockLiveCampaigns,
    updateCampaignBudget: (...a) => mockBudget(...a)
}));
const mockUpdateContent = jest.fn();
const mockFixed = [];
jest.mock('../../../Services/Sp_API/UpdateProductContentService.js', () => ({
    updateProductContent: (...a) => mockUpdateContent(...a),
    FIX_STATUS: { SUCCESS: 'SUCCESS', PARTIAL_SUCCESS: 'PARTIAL_SUCCESS', CONFLICT_RESOLVED: 'CONFLICT_RESOLVED' }
}));
const mockFeedbackRequest = jest.fn();
jest.mock('../../../Services/Sp_API/FeedbackRequest.js', () => ({ requestFeedbackUpdate: (...a) => mockFeedbackRequest(...a) }));
jest.mock('../../../models/system/ListingFixStatusModel.js', () => ({ markAsFixed: async (p) => { mockFixed.push(p); } }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
    findOne: () => ({ select: () => ({ lean: async () => ({ brand: 'Acme', sellerAccount: [{ country: 'US', region: 'NA', products: [{ asin: 'B01', sku: 'OLD', status: 'Inactive' }, { asin: 'B01', sku: 'SKU-1', status: 'Active' }] }] }) }) })
}));
jest.mock('../../../utils/ppcSnapshotLoader.js', () => ({ loadKeywordSnapshot: async () => mockSnapshot }));

const S = require('../../../Services/Calculations/TaskActionService.js');

const term = (over = {}) => ({ taskId: 'T1', errorCategory: 'sponsoredAds', errorType: 'search_term_zero_sales',
    renderData: { searchTerm: 'cheap widget', campaignId: 'C1', adGroupId: 'G1', campaignName: 'Widgets', ...over } });
const kw = { taskId: 'T2', errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword',
    renderData: { keyword: 'blue widget', keywordId: 'K9', campaignName: 'Widgets' } };
const run = (taskIds) => S.approveTaskActions({ userId: 'U', country: 'US', region: 'NA', taskIds, approvedBy: { userId: 'U', adminId: 'A' } });

beforeEach(() => {
    mockTasks.length = 0; mockLogs.length = 0;
    mockTaskUpdates.length = 0;
    mockAddToNegative.mockReset(); mockPause.mockReset(); mockBids.mockReset(); mockSnapshot = null;
    mockUpdateContent.mockReset(); mockFixed.length = 0; mockTargetBids.mockReset(); mockLiveTargets = new Map(); mockProductAds = []; mockPauseAds.mockReset(); mockLiveCampaigns = []; mockBudget.mockReset();
    process.env.AMAZON_ADS_CLIENT_ID = 'cid';
    delete process.env.TASK_ACTIONS_DISABLED;
});

describe('proposedActionFor', () => {
    it('proposes a negative exact keyword for a zero-sale search term', () => {
        const a = S.proposedActionFor(term());
        expect(a.type).toBe('add_negative_keyword');
        expect(a.payload).toEqual({ level: 'adGroup', keyword: { campaignId: 'C1', adGroupId: 'G1', keywordText: 'cheap widget', matchType: 'negativeExact', state: 'enabled' } });
        expect(a.summary).toContain('"cheap widget" as a negative exact keyword in the campaign "Widgets"');
        expect(S.proposedActionFor(term({ adGroupId: undefined })).payload.level).toBe('campaign');
    });

    it('proposes pausing a wasted keyword, and nothing without the IDs or for ASIN targets', () => {
        expect(S.proposedActionFor(kw)).toMatchObject({ type: 'pause_keyword', payload: { keywordId: 'K9', adType: 'SP' } });
        expect(S.proposedActionFor({ ...kw, renderData: { keyword: 'x' } })).toBeNull();
        expect(S.proposedActionFor(term({ searchTerm: 'b07fmhwfwt' }))).toBeNull();
        expect(S.proposedActionFor(term({ campaignId: undefined }))).toBeNull();
        expect(S.proposedActionFor({ errorCategory: 'conversion', errorType: 'no_buybox' })).toBeNull();
    });
});

describe('approveTaskActions', () => {
    it('makes the change, logs who approved it, and marks the task done', async () => {
        mockTasks.push(term());
        mockAddToNegative.mockResolvedValue({ negativeKeywords: { success: [{ index: 0 }], error: [] } });
        const [r] = await run(['T1']);
        expect(r.status).toBe('succeeded');
        expect(mockAddToNegative).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 't' }), [expect.objectContaining({ keywordText: 'cheap widget' })], { level: 'adGroup' });
        expect(mockLogs[0]).toMatchObject({ status: 'succeeded', actionType: 'add_negative_keyword', approvedBy: { userId: 'U', adminId: 'A', memberId: null, superAdminId: null } });
        expect(mockTaskUpdates).toEqual([[expect.objectContaining({ taskId: 'T1' }), expect.objectContaining({ $set: expect.objectContaining({ status: 'completed' }) })]]);
    });

    it('never sends the same change twice', async () => {
        mockTasks.push(term());
        mockAddToNegative.mockResolvedValue({ negativeKeywords: { success: [{}], error: [] } });
        await run(['T1']);
        const [again] = await run(['T1']);
        expect(again.status).toBe('skipped');
        expect(mockAddToNegative).toHaveBeenCalledTimes(1);
    });

    it('treats Amazon errors as failures and leaves the task open', async () => {
        mockTasks.push(term(), kw);
        mockAddToNegative.mockResolvedValue({ negativeKeywords: { success: [], error: [{ errors: [{ errorType: 'duplicateValueError' }] }] } });
        mockPause.mockResolvedValue({ SP: { success: false, error: 'not found' } });
        const results = await run(['T1', 'T2']);
        expect(results.map(r => r.status)).toEqual(['failed', 'failed']);
        expect(mockLogs.map(l => l.status)).toEqual(['failed', 'failed']);
        expect(mockTaskUpdates).toEqual([]);
    });

    it('skips a task id it cannot find or that has no change', async () => {
        mockTasks.push({ taskId: 'T3', errorCategory: 'conversion', errorType: 'no_buybox' });
        expect((await run(['T3', 'nope'])).map(r => r.status)).toEqual(['skipped', 'skipped']);
    });

    it('does nothing when switched off', async () => {
        process.env.TASK_ACTIONS_DISABLED = 'true';
        await expect(run(['T1'])).rejects.toThrow('switched off');
    });
});

describe('annotateProposedActions', () => {
    it('adds the proposal without the raw payload, and marks one already made', async () => {
        mockLogs.push({ taskId: 'T2', status: 'succeeded' });
        const out = await S.annotateProposedActions('U', [term(), kw, { taskId: 'T3', errorCategory: 'conversion' }]);
        expect(out[0].proposedAction).toEqual({ type: 'add_negative_keyword', label: 'Add as negative keyword', summary: expect.any(String), done: false });
        expect(out[1].proposedAction.done).toBe(true);
        expect(out[2].proposedAction).toBeUndefined();
    });
});

describe('lower_bids', () => {
    const acosTask = { taskId: 'T5', errorCategory: 'sponsoredAds', errorType: 'product_acos_above_breakeven',
        renderData: { bidChanges: [
            { keywordId: 'K1', keyword: 'garlic press', currentBid: 1, newBid: 0.8, sharedAdGroup: false },
            { keywordId: 'K2', keyword: 'press', currentBid: 0.8, newBid: 0.56, sharedAdGroup: true }
        ] } };

    it('proposes the listed cuts, naming shared ad groups', () => {
        const a = S.proposedActionFor(acosTask);
        expect(a).toMatchObject({ type: 'lower_bids', label: 'Lower 2 bids' });
        expect(a.summary).toContain('"garlic press" 1.00 → 0.80; "press" 0.80 → 0.56');
        expect(a.summary).toContain('also advertise other products');
        expect(S.proposedActionFor({ ...acosTask, renderData: {} })).toBeNull();
    });

    it('sends only bids that have not changed since the proposal', async () => {
        mockTasks.push(acosTask);
        mockSnapshot = { keywordData: [{ keywordId: 'K1', bid: 1 }, { keywordId: 'K2', bid: 0.65 }] };
        mockBids.mockResolvedValue({ keywords: { success: [{ index: 0 }], error: [] } });
        const [r] = await run(['T5']);
        expect(r.status).toBe('succeeded');
        expect(mockBids).toHaveBeenCalledWith(expect.objectContaining({ bids: [{ keywordId: 'K1', bid: 0.8 }] }));
        expect(mockLogs[0].response).toMatchObject({ sent: 1, skippedChanged: 1 });
    });

    it('sends nothing when every bid changed', async () => {
        mockTasks.push(acosTask);
        mockSnapshot = { keywordData: [{ keywordId: 'K1', bid: 2 }, { keywordId: 'K2', bid: 2 }] };
        const [r] = await run(['T5']);
        expect(r.status).toBe('failed');
        expect(r.message).toContain('changed since the suggestion');
        expect(mockBids).not.toHaveBeenCalled();
    });
});

describe('update_listing_content (Fix It from the Tasks page)', () => {
    const titleTask = { taskId: 'T7', asin: 'B01', errorCategory: 'ranking', errorType: 'titleresult_restricted_words' };
    const approve = (content) => S.approveTaskActions({ userId: 'U', country: 'US', region: 'NA', taskIds: ['T7'], content, approvedBy: { userId: 'U' } });
    const GOOD = 'Acme Stainless Steel Garlic Press with Silicone Peeler, Dishwasher Safe Mincer for Garlic and Ginger, 2 Piece Set';

    it('proposes an editable fix for listing text tasks only', () => {
        expect(S.proposedActionFor(titleTask)).toMatchObject({ type: 'update_listing_content', editable: true, field: 'title', label: 'Fix the title' });
        expect(S.proposedActionFor({ ...titleTask, errorType: 'bulletpoints_char_limit' }).field).toBe('bulletpoints');
        expect(S.proposedActionFor({ ...titleTask, errorType: 'backend_keywords_underused' }).field).toBe('generic_keyword');
        expect(S.proposedActionFor({ ...titleTask, errorType: 'listing_errors' })).toBeNull();
        expect(S.proposedActionFor({ ...titleTask, asin: 'ERROR:abc' })).toBeNull();
    });

    it('refuses text that still breaks a listing rule, sending nothing', async () => {
        mockTasks.push(titleTask);
        const [r] = await approve({ T7: 'Best garlic press ever!!! 100% guaranteed #1' });
        expect(r.status).toBe('failed');
        expect(r.message).toBeTruthy();
        expect(mockUpdateContent).not.toHaveBeenCalled();
        expect(mockLogs).toHaveLength(0);
    });

    it('sends approved text to the active SKU and records it as our change', async () => {
        mockTasks.push(titleTask);
        mockUpdateContent.mockResolvedValue({ status: 'SUCCESS', message: 'ok' });
        const [r] = await approve({ T7: GOOD });
        expect(r.status).toBe('succeeded');
        expect(mockUpdateContent).toHaveBeenCalledWith(expect.objectContaining({ sku: 'SKU-1', dataToBeUpdated: 'title', valueToBeUpdated: GOOD }));
        expect(mockFixed).toEqual([expect.objectContaining({ asin: 'B01', sku: 'SKU-1', attribute: 'title', valueApplied: GOOD })]);
        expect(mockLogs[0].summary).toContain(GOOD);
    });

    it('checks backend keyword bytes and splits bullets by line', () => {
        expect(S.validateListingContent('generic_keyword', 'x'.repeat(251)).ok).toBe(false);
        expect(S.validateListingContent('bulletpoints', 'One\nTwo\n\n').value).toEqual(['One', 'Two']);
    });
});

describe('lower_bids on targets', () => {
    const task = { taskId: 'T9', errorCategory: 'sponsoredAds', errorType: 'product_acos_above_breakeven',
        renderData: { bidChanges: [
            { keywordId: 'K1', keyword: 'garlic press', currentBid: 1, newBid: 0.8 },
            { kind: 'target', targetId: 'X1', keyword: 'close-match', currentBid: 1.2, newBid: 0.84 }
        ] } };

    it('names targets in the summary and sends each kind to its own call, checked live', async () => {
        expect(S.proposedActionFor(task).summary).toContain('target "close-match" 1.20 → 0.84');
        expect(S.proposedActionFor(task).summary).not.toContain('are not changed');
        mockTasks.push(task);
        mockSnapshot = { keywordData: [{ keywordId: 'K1', bid: 1 }] };
        mockLiveTargets = new Map([['X1', { bid: 1.2, state: 'ENABLED' }]]);
        mockBids.mockResolvedValue({ keywords: { success: [{}], error: [] } });
        mockTargetBids.mockResolvedValue({ targetingClauses: { success: [{}], error: [] } });
        const [r] = await run(['T9']);
        expect(r.status).toBe('succeeded');
        expect(mockTargetBids).toHaveBeenCalledWith(expect.objectContaining({ bids: [{ targetId: 'X1', bid: 0.84 }] }));
        expect(mockLogs[0].response).toMatchObject({ sent: 2, skippedChanged: 0 });
    });

    it('skips a target whose live bid changed', async () => {
        mockTasks.push(task);
        mockSnapshot = { keywordData: [{ keywordId: 'K1', bid: 1 }] };
        mockLiveTargets = new Map([['X1', { bid: 0.9, state: 'ENABLED' }]]);
        mockBids.mockResolvedValue({ keywords: { success: [{}], error: [] } });
        const [r] = await run(['T9']);
        expect(r.status).toBe('succeeded');
        expect(mockTargetBids).not.toHaveBeenCalled();
        expect(mockLogs[0].response).toMatchObject({ sent: 1, skippedChanged: 1 });
    });
});

describe('pause_product_ads', () => {
    const task = { taskId: 'T11', asin: 'B0CTGKRCPN', errorCategory: 'sponsoredAds', errorType: 'ads_on_unbuyable', renderData: { reason: 'it is out of stock' } };

    it('proposes pausing the product\'s ads, naming why', () => {
        expect(S.proposedActionFor(task)).toMatchObject({ type: 'pause_product_ads', payload: { asin: 'B0CTGKRCPN' } });
        expect(S.proposedActionFor(task).summary).toContain('while it is out of stock');
    });

    it('pauses the enabled ads found live, and fails cleanly when there are none', async () => {
        mockTasks.push(task);
        mockProductAds = [{ adId: 'A1' }, { adId: 'A2' }];
        mockPauseAds.mockResolvedValue({ productAds: { success: [{}, {}], error: [] } });
        const [r] = await run(['T11']);
        expect(r.status).toBe('succeeded');
        expect(mockPauseAds).toHaveBeenCalledWith(expect.objectContaining({ adIds: ['A1', 'A2'] }));
        mockLogs.length = 0; mockProductAds = [];
        const [none] = await run(['T11']);
        expect(none.status).toBe('failed');
        expect(none.message).toContain('no enabled Sponsored Products ads');
    });
});

describe('raise_budget', () => {
    const task = { taskId: 'T12', asin: 'CAMPAIGN:C1', errorCategory: 'sponsoredAds', errorType: 'budget_limited_profitable',
        renderData: { campaignId: 'C1', campaignName: 'Garlic exact', budget: 5, suggestedBudget: 10 } };

    it('proposes Amazon\'s suggested budget', () => {
        expect(S.proposedActionFor(task)).toMatchObject({ type: 'raise_budget', payload: { campaignId: 'C1', budget: 10, expectedCurrentBudget: 5 } });
        expect(S.proposedActionFor({ ...task, renderData: { ...task.renderData, suggestedBudget: 5 } })).toBeNull();
    });

    it('raises it only when the live budget is unchanged', async () => {
        mockTasks.push(task);
        mockLiveCampaigns = [{ campaignId: 'C1', budget: 5 }];
        mockBudget.mockResolvedValue({ campaigns: { success: [{}], error: [] } });
        expect((await run(['T12']))[0].status).toBe('succeeded');
        expect(mockBudget).toHaveBeenCalledWith(expect.objectContaining({ campaignId: 'C1', budget: 10 }));
        mockLogs.length = 0; mockLiveCampaigns = [{ campaignId: 'C1', budget: 8 }]; mockBudget.mockReset();
        const [changed] = await run(['T12']);
        expect(changed.status).toBe('failed');
        expect(changed.message).toContain('changed since the suggestion');
        expect(mockBudget).not.toHaveBeenCalled();
    });
});

describe('request_feedback_update', () => {
    const task = { taskId: 'T13', asin: 'ORDER:114-1', errorCategory: 'account', errorType: 'negative_feedback_order', renderData: { orderId: '114-1', rating: 1 } };

    it('proposes Amazon\'s standard message for the order', () => {
        expect(S.proposedActionFor(task)).toMatchObject({ type: 'request_feedback_update', payload: { orderId: '114-1' } });
        expect(S.proposedActionFor({ ...task, renderData: {} })).toBeNull();
    });

    it('sends it once, and never twice', async () => {
        mockTasks.push(task);
        mockFeedbackRequest.mockResolvedValue({ orderId: '114-1', sent: true });
        expect((await run(['T13']))[0].status).toBe('succeeded');
        expect(mockFeedbackRequest).toHaveBeenCalledWith(expect.objectContaining({ orderId: '114-1', country: 'US', region: 'NA' }));
        expect((await run(['T13']))[0].status).toBe('skipped');
        expect(mockFeedbackRequest).toHaveBeenCalledTimes(1);
    });
});
