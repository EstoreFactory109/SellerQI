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
