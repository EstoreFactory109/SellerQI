/**
 * Changes on Amazon from screens: preview first, sent once and only after approval,
 * the stored payload is what goes out, and every outcome is recorded.
 */
// Plain functions: the jest config resets jest.fn implementations between tests.
const mockDocs = [];
let mockSeq = 0;
const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => {
    const val = doc[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('$ne' in v) return String(val) !== String(v.$ne);
        if ('$gt' in v) return val instanceof Date && val > v.$gt;
        if ('$gte' in v) return val instanceof Date && val >= v.$gte;
        return false;
    }
    return String(val) === String(v);
});
const lean = (value) => ({ lean: async () => value, select: () => ({ lean: async () => value }) });
jest.mock('../../../models/MCP/AmazonChangeRequestModel.js', () => ({
    create: async (doc) => { const d = { _id: `id${++mockSeq}`, createdAt: new Date(), ...doc }; mockDocs.push(d); return d; },
    findOneAndUpdate: (filter, update) => {
        const doc = mockDocs.find((d) => matches(d, filter));
        if (doc) Object.assign(doc, update.$set);
        return lean(doc ? { ...doc } : null);
    },
    findOne: (filter) => lean(mockDocs.find((d) => matches(d, filter)) || null),
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [...mockDocs] }) }) })
}));

const mockSent = [];
let mockStale = false;
let mockExecuteError = null;
const fakeHandler = (over = {}) => ({
    actionType: 'ads.fake', feature: 'ads', idempotent: true,
    validate: (input) => ({ ids: input.ids }),
    preview: async (input) => ({ title: 'Fake', target: 'Amazon Ads', lines: [{ label: 'x', before: 'a', after: 'b' }], payload: { ids: input.ids }, expected: { state: 'ENABLED' } }),
    staleCheck: async () => { if (mockStale) throw Object.assign(new Error('changed'), { isStale: true }); },
    execute: async (payload) => { if (mockExecuteError) throw mockExecuteError; mockSent.push(payload); return { ok: true }; },
    ...over
});
let mockHandler = fakeHandler();
jest.mock('../../../Services/Actions/registry.js', () => ({
    get: (t) => (t === mockHandler.actionType ? mockHandler : null),
    all: () => [mockHandler],
    previewable: (h) => !!(h && h.preview)
}));

const S = require('../../../Services/Actions/ChangeRequestService.js');
const base = { userId: 'U1', country: 'US', region: 'NA' };
const draft = () => S.createPreview({ ...base, feature: 'ads', actionType: 'ads.fake', input: { ids: ['K1'] }, createdBy: { userId: 'U1' } });

beforeEach(() => {
    mockDocs.length = 0; mockSent.length = 0; mockStale = false; mockExecuteError = null; mockHandler = fakeHandler();
    delete process.env.AMAZON_WRITES_DISABLED; delete process.env.TASK_ACTIONS_DISABLED;
    delete process.env.AMAZON_ACTIONS_FAKE_ENABLED; delete process.env.AMAZON_ACTIONS_FAKE_USER_IDS;
});

describe('ChangeRequestService', () => {
    it('previews without sending anything, and hides the payload from the browser', async () => {
        const d = await draft();
        expect(d.status).toBe('draft');
        expect(d.preview.lines).toHaveLength(1);
        expect(d).not.toHaveProperty('payload');
        expect(mockSent).toHaveLength(0);
    });

    it('sends the stored payload once; a second approve is refused', async () => {
        const d = await draft();
        mockDocs[0].payload = { ids: ['STORED'] }; // whatever the server stored is what goes out
        const r = await S.approve({ ...base, id: d.id, feature: 'ads', approvedBy: { userId: 'U1', esfUserId: 'E9' } });
        expect(r.status).toBe('succeeded');
        expect(mockSent).toEqual([{ ids: ['STORED'] }]);
        expect(mockDocs[0].approvedBy).toMatchObject({ userId: 'U1', esfUserId: 'E9' });
        await expect(S.approve({ ...base, id: d.id, feature: 'ads' })).rejects.toMatchObject({ statusCode: 409 });
        expect(mockSent).toHaveLength(1);
    });

    it('refuses an expired preview', async () => {
        const d = await draft();
        mockDocs[0].expiresAt = new Date(Date.now() - 1000);
        await expect(S.approve({ ...base, id: d.id, feature: 'ads' })).rejects.toMatchObject({ statusCode: 409 });
        expect(mockSent).toHaveLength(0);
    });

    it('sends nothing when changes are switched off', async () => {
        const d = await draft();
        process.env.TASK_ACTIONS_DISABLED = 'true';
        await expect(S.approve({ ...base, id: d.id, feature: 'ads' })).rejects.toMatchObject({ statusCode: 503 });
        expect(mockSent).toHaveLength(0);
    });

    it('keeps a flagged kind of change off until it is switched on for the account', async () => {
        mockHandler = fakeHandler({ flag: 'AMAZON_ACTIONS_FAKE' });
        await expect(draft()).rejects.toMatchObject({ statusCode: 403 });
        process.env.AMAZON_ACTIONS_FAKE_ENABLED = 'true';
        process.env.AMAZON_ACTIONS_FAKE_USER_IDS = '0123456789abcdef01234567';
        await expect(draft()).rejects.toMatchObject({ statusCode: 403 }); // U1 is not on the list
        process.env.AMAZON_ACTIONS_FAKE_USER_IDS = '';
        expect((await draft()).status).toBe('draft');
    });

    it('marks a change stale, and sends nothing, when Amazon changed since the preview', async () => {
        const d = await draft();
        mockStale = true;
        const r = await S.approve({ ...base, id: d.id, feature: 'ads' });
        expect(r.status).toBe('stale');
        expect(mockSent).toHaveLength(0);
    });

    it('records a timeout on a change that is not safe to repeat as unknown, never resending it', async () => {
        mockHandler = fakeHandler({ idempotent: false });
        const d = await draft();
        mockExecuteError = Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
        const r = await S.approve({ ...base, id: d.id, feature: 'ads' });
        expect(r.status).toBe('unknown');
        expect(r.message).toContain('will not be sent again');
    });

    it('records Amazon\'s refusal as failed, with its message', async () => {
        const d = await draft();
        mockExecuteError = Object.assign(new Error('Amazon rejected it: duplicate'), { response: { e: 1 } });
        const r = await S.approve({ ...base, id: d.id, feature: 'ads' });
        expect(r.status).toBe('failed');
        expect(r.error).toContain('duplicate');
        expect(mockDocs[0].response).toEqual({ e: 1 });
    });

    it('does not resend the same change made a moment ago', async () => {
        const first = await draft();
        await S.approve({ ...base, id: first.id, feature: 'ads' });
        const second = await draft();
        const r = await S.approve({ ...base, id: second.id, feature: 'ads' });
        expect(r.status).toBe('cancelled');
        expect(mockSent).toHaveLength(1);
    });

    it('will not approve a change under another feature\'s path', async () => {
        const d = await draft();
        await expect(S.approve({ ...base, id: d.id, feature: 'listings' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('gives the same change the same key regardless of key order', () => {
        const k1 = S.idempotencyKeyFor({ ...base, actionType: 'a', payload: { x: 1, y: [1, { b: 2, a: 1 }] } });
        const k2 = S.idempotencyKeyFor({ ...base, actionType: 'a', payload: { y: [1, { a: 1, b: 2 }], x: 1 } });
        expect(k1).toBe(k2);
    });
});
