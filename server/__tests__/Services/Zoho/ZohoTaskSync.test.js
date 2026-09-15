/**
 * The nightly Zoho task sync and the In progress / Coming Up / Completed split.
 *
 * The classification rules are the thing worth pinning: Zoho has no
 * "not started" state and every portal names its own statuses (the live one
 * uses Open/Content/Design), so the split is derived rather than read, and a
 * wrong derivation would silently file real work under the wrong heading.
 */

jest.mock('../../../Services/Zoho/ZohoProjectsService.js', () => ({
    getProjectTaskUpdates: jest.fn(),
    // ZohoTaskSync destructures this to bound summariser concurrency; a simple
    // sequential stand-in keeps the test deterministic.
    mapWithConcurrency: async (items, _limit, fn) => {
        const out = [];
        for (let i = 0; i < items.length; i += 1) out.push(await fn(items[i], i));
        return out;
    },
}));
jest.mock('../../../Services/Zoho/ZohoAuth.js', () => ({
    getConnection: jest.fn(),
}));
jest.mock('../../../models/user-auth/userModel.js', () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock('../../../models/system/ZohoProjectTaskModel.js', () => ({
    find: jest.fn(),
    bulkWrite: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
}));
// Matching audit findings against open tasks is its own service with its own tests.
// Stubbed to "nothing linked" so getTaskBoard and syncProject stay focused on tasks;
// without these the models would reach for a real database and the suite would hang.
jest.mock('../../../models/system/EsfSuggestedWorkModel.js', () => ({
    findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    updateOne: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../models/system/TopOpportunitiesModel.js', () => ({
    findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    }),
}));
jest.mock('../../../Services/AI/ZohoOpportunityMatchService.js', () => ({
    matchOpportunities: jest.fn().mockResolvedValue({ matches: [], generatedBy: 'fallback' }),
}));

// Summarising is its own service with its own tests; here it only needs to not
// make a network call.
jest.mock('../../../Services/AI/ZohoTaskSummaryService.js', () => ({
    summariseTask: jest.fn().mockResolvedValue({
        text: 'A summary.', generatedBy: 'ai', model: 'gpt-4o-mini',
        sourceHash: 'hash', commentCount: 1, reused: false,
    }),
}));

const ZohoProjectsService = require('../../../Services/Zoho/ZohoProjectsService.js');
const ZohoAuth = require('../../../Services/Zoho/ZohoAuth.js');
const UserModel = require('../../../models/user-auth/userModel.js');
const ZohoProjectTask = require('../../../models/system/ZohoProjectTaskModel.js');
const EsfSuggestedWork = require('../../../models/system/EsfSuggestedWorkModel.js');
const TopOpportunities = require('../../../models/system/TopOpportunitiesModel.js');
const Sync = require('../../../Services/Zoho/ZohoTaskSync.js');

const NOW = new Date('2026-09-11T12:00:00.000Z');
const mockClients = (docs) => UserModel.find.mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(docs) }),
});
// getTaskBoard calls .find().lean(); syncProject calls .find().select().lean()
// to read prior summaries. One mock serves both shapes.
const mockRows = (rows) => ZohoProjectTask.find.mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) }),
});

beforeEach(() => {
    ZohoAuth.getConnection.mockResolvedValue({ portalId: '851273093', portalName: 'estorefactory' });
    ZohoProjectTask.deleteMany.mockResolvedValue({ deletedCount: 0 });
    ZohoProjectTask.bulkWrite.mockResolvedValue({});
    // jest.config sets resetMocks, which strips the return values declared in the
    // module factories above — so the query chains have to be rebuilt each test.
    EsfSuggestedWork.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    EsfSuggestedWork.updateOne.mockResolvedValue({});
    EsfSuggestedWork.deleteOne.mockResolvedValue({});
    UserModel.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
    TopOpportunities.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });
    mockClients([]);
    mockRows([]);
});

describe('classifyTask', () => {
    test('a completed task is Completed however its status is named', () => {
        // This portal's statuses are Open/Content/Design — none of which mean
        // "done" by name, so only the booleans can decide.
        expect(Sync.classifyTask({ isCompleted: true, status: 'Design' }, NOW)).toBe('completed');
        expect(Sync.classifyTask({ statusIsClosed: true, status: 'Content' }, NOW)).toBe('completed');
    });

    test('a future start date is Coming Up', () => {
        expect(Sync.classifyTask({ startDate: '2026-10-02T00:00:00.000Z' }, NOW)).toBe('coming_up');
    });

    test('a start date today or in the past is In progress', () => {
        expect(Sync.classifyTask({ startDate: '2026-09-11T04:30:00.000Z' }, NOW)).toBe('in_progress');
        expect(Sync.classifyTask({ startDate: '2026-09-08T00:00:00.000Z' }, NOW)).toBe('in_progress');
    });

    test('NO start date means In progress, not Coming Up', () => {
        // The deciding real case: "SOW" in the live portal carries no dates but
        // has comments and attachments. Filing that under "not started" would be
        // plainly wrong, so absence of a date is treated as started.
        expect(Sync.classifyTask({ name: 'SOW', startDate: null }, NOW)).toBe('in_progress');
    });

    test('completion wins over a future start date', () => {
        expect(Sync.classifyTask({ isCompleted: true, startDate: '2026-12-01T00:00:00.000Z' }, NOW)).toBe('completed');
    });
});

describe('getTaskBoard', () => {
    const row = (over = {}) => ({
        taskId: 't', name: 'Task', isCompleted: false, statusIsClosed: false,
        startDate: null, taskUpdatedAt: NOW, comments: [], ...over,
    });

    test('splits rows into the three lists', async () => {
        mockRows([
            row({ taskId: 'a', name: 'Active' }),
            row({ taskId: 'b', name: 'Later', startDate: '2026-10-02T00:00:00.000Z' }),
            row({ taskId: 'c', name: 'Done', isCompleted: true }),
        ]);
        const board = await Sync.getTaskBoard('p1', { now: NOW });

        expect(board.inProgress.map((t) => t.name)).toEqual(['Active']);
        expect(board.comingUp.map((t) => t.name)).toEqual(['Later']);
        expect(board.completed.map((t) => t.name)).toEqual(['Done']);
        expect(board.totalTasks).toBe(3);
    });

    test('drops work completed more than 30 days ago', async () => {
        mockRows([
            row({ taskId: 'recent', name: 'Recent', isCompleted: true, taskUpdatedAt: new Date('2026-09-01T00:00:00.000Z') }),
            row({ taskId: 'old', name: 'Ancient', isCompleted: true, taskUpdatedAt: new Date('2026-05-01T00:00:00.000Z') }),
        ]);
        const board = await Sync.getTaskBoard('p1', { now: NOW });

        // The live project has 76 tasks but only 11 completed inside 30 days —
        // without the cutoff this list grows forever.
        expect(board.completed.map((t) => t.name)).toEqual(['Recent']);
    });

    test('orders active work newest-first and upcoming work by start date', async () => {
        mockRows([
            row({ taskId: '1', name: 'Older', taskUpdatedAt: new Date('2026-09-01T00:00:00.000Z') }),
            row({ taskId: '2', name: 'Newer', taskUpdatedAt: new Date('2026-09-10T00:00:00.000Z') }),
            row({ taskId: '3', name: 'Oct', startDate: '2026-10-02T00:00:00.000Z' }),
            row({ taskId: '4', name: 'Sep 14', startDate: '2026-09-14T00:00:00.000Z' }),
        ]);
        const board = await Sync.getTaskBoard('p1', { now: NOW });

        expect(board.inProgress.map((t) => t.name)).toEqual(['Newer', 'Older']);
        expect(board.comingUp.map((t) => t.name)).toEqual(['Sep 14', 'Oct']);
    });

    test('reports the freshest sync stamp, so the page can admit its age', async () => {
        mockRows([
            row({ taskId: '1', syncedAt: new Date('2026-09-10T02:00:00.000Z') }),
            row({ taskId: '2', syncedAt: new Date('2026-09-11T02:00:00.000Z') }),
        ]);
        const board = await Sync.getTaskBoard('p1', { now: NOW });
        expect(board.syncedAt).toEqual(new Date('2026-09-11T02:00:00.000Z'));
    });
});

describe('linkedProjects', () => {
    test('deduplicates a project two clients share, and counts them', async () => {
        mockClients([
            { zohoProject: { projectId: 'p1', projectName: 'Shared', portalId: 'x' } },
            { zohoProject: { projectId: 'p1', projectName: 'Shared', portalId: 'x' } },
            { zohoProject: { projectId: 'p2', projectName: 'Other', portalId: 'x' } },
        ]);
        const projects = await Sync.linkedProjects();

        // Syncing the same project twice in one tick would double the API calls
        // for no gain.
        expect(projects).toHaveLength(2);
        expect(projects.find((p) => p.projectId === 'p1').clientCount).toBe(2);
    });
});

describe('syncAllProjects', () => {
    beforeEach(() => {
        mockClients([{ zohoProject: { projectId: 'p1', projectName: 'One', portalId: 'x' } }]);
        ZohoProjectsService.getProjectTaskUpdates.mockResolvedValue({
            portalId: 'x', truncated: false,
            tasks: [{ id: 't1', name: 'A', comments: [{ id: 'c1', content: 'hi' }] }],
        });
    });

    test('upserts by (projectId, taskId) so a re-run cannot duplicate', async () => {
        await Sync.syncAllProjects();
        const op = ZohoProjectTask.bulkWrite.mock.calls[0][0][0].updateOne;
        expect(op.filter).toEqual({ projectId: 'p1', taskId: 't1' });
        expect(op.upsert).toBe(true);
    });

    test('one failing project does not end the sweep', async () => {
        mockClients([
            { zohoProject: { projectId: 'bad', projectName: 'Bad', portalId: 'x' } },
            { zohoProject: { projectId: 'good', projectName: 'Good', portalId: 'x' } },
        ]);
        ZohoProjectsService.getProjectTaskUpdates
            .mockRejectedValueOnce(new Error('deleted in Zoho'))
            .mockResolvedValueOnce({ portalId: 'x', tasks: [] });

        const summary = await Sync.syncAllProjects();

        expect(summary.failed).toBe(1);
        expect(summary.succeeded).toBe(1);
    });

    test('refuses to run when Zoho is not connected', async () => {
        ZohoAuth.getConnection.mockResolvedValue(null);
        await expect(Sync.syncAllProjects()).rejects.toMatchObject({ statusCode: 428 });
    });

    test('does NOT prune when the tick budget cut the run short', async () => {
        mockClients([
            { zohoProject: { projectId: 'p1', portalId: 'x' } },
            { zohoProject: { projectId: 'p2', portalId: 'x' } },
        ]);
        // Deadline already passed: every project is skipped.
        const summary = await Sync.syncAllProjects({ deadlineAt: Date.now() - 1000 });

        expect(summary.skippedForTime).toBe(2);
        expect(summary.pruned).toBe(0);
        // Pruning against a partial list would delete rows for projects that
        // merely ran out of time — the whole collection, in this case.
        const prunedByProject = ZohoProjectTask.deleteMany.mock.calls
            .filter(([q]) => q && q.projectId === undefined);
        expect(prunedByProject).toHaveLength(0);
    });
});

describe('pruneUnlinkedProjects', () => {
    test('removes rows for projects nobody is linked to any more', async () => {
        ZohoProjectTask.deleteMany.mockResolvedValue({ deletedCount: 20 });
        const removed = await Sync.pruneUnlinkedProjects(['p1', 'p2']);

        expect(ZohoProjectTask.deleteMany).toHaveBeenCalledWith({ projectId: { $nin: ['p1', 'p2'] } });
        expect(removed).toBe(20);
    });

    test('clears everything when no project is linked at all', async () => {
        await Sync.pruneUnlinkedProjects([]);
        expect(ZohoProjectTask.deleteMany).toHaveBeenCalledWith({});
    });
});
