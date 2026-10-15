/**
 * CreateTasksService — how task writes are routed between the legacy path and
 * reconcile, and the guards around reconcile (throttle, lock, stable ids).
 * The reconcile RULES themselves are covered in TaskReconcilePlanner.test.js.
 */

jest.mock('../../../models/MCP/TaskModel.js', () => {
    const Task = jest.fn();
    Task.findOne = jest.fn();
    return Task;
});
jest.mock('../../../models/MCP/TaskItemModel.js', () => ({
    OPEN_STATUSES: ['pending', 'in_progress'],
    scopeFilter: (userId, country, region) => ({ userId, country, region }),
    find: jest.fn(),
    findByUserId: jest.fn(),
    findOneAndUpdate: jest.fn(),
    countByStatus: jest.fn(),
    deleteByUserId: jest.fn(),
    bulkInsertTasks: jest.fn(),
    reconcileWrite: jest.fn()
}));
jest.mock('../../../utils/mongoLock.js', () => ({ acquireLock: jest.fn() }));

const Task = require('../../../models/MCP/TaskModel.js');
const TaskItem = require('../../../models/MCP/TaskItemModel.js');
const { acquireLock } = require('../../../utils/mongoLock.js');
const CreateTaskService = require('../../../Services/Calculations/CreateTasksService.js');

const USER = '6a57b823571ceb9266953c30';

// A mongoose-query stand-in: chainable select/lean, and awaitable directly.
const query = (value) => {
    const q = {
        select: () => q,
        lean: () => Promise.resolve(value),
        then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
    };
    return q;
};

const PROFIT_ERRORS = [
    { asin: 'B001', productName: 'Widget', netProfit: -10, sales: 100, profitMargin: -10, errorType: 'negative_profit', amount: 10 }
];

const input = (over = {}) => ({
    userId: USER,
    country: 'US',
    region: 'NA',
    profitabilityErrorDetails: PROFIT_ERRORS,
    coverage: { profitability: true },
    ...over
});

let release;
const originalEnv = { ...process.env };

beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TASK_RECONCILE_MODE;
    delete process.env.TASK_RECONCILE_USER_IDS;

    Task.mockImplementation(function (doc) {
        Object.assign(this, doc);
        this.save = jest.fn().mockResolvedValue(this);
    });
    Task.findOne.mockReturnValue(query(null));
    TaskItem.find.mockReturnValue(query([]));
    TaskItem.countByStatus.mockResolvedValue({ pending: 1, completed: 0, in_progress: 0, resolved: 0, total: 1 });
    TaskItem.bulkInsertTasks.mockResolvedValue({ insertedCount: 1 });
    TaskItem.deleteByUserId.mockResolvedValue({ deletedCount: 0 });
    TaskItem.reconcileWrite.mockResolvedValue({ inserted: 1, modified: 0, deleted: 0, duplicates: 0 });
    release = jest.fn().mockResolvedValue();
    acquireLock.mockResolvedValue(release);
});

afterAll(() => { process.env = originalEnv; });

describe('stable task ids', () => {
    it('gives the same issue the same id on every run', async () => {
        await CreateTaskService.createTasksFromErrors(input());
        await CreateTaskService.createTasksFromErrors(input());

        const [first] = TaskItem.bulkInsertTasks.mock.calls[0][1];
        const [second] = TaskItem.bulkInsertTasks.mock.calls[1][1];
        expect(first.taskId).toMatch(/^task_[0-9a-f]{24}$/);
        expect(second.taskId).toBe(first.taskId);
    });

    it('gives the same issue in two marketplaces different ids', async () => {
        await CreateTaskService.createTasksFromErrors(input());
        await CreateTaskService.createTasksFromErrors(input({ country: 'UK', region: 'EU' }));

        const [us] = TaskItem.bulkInsertTasks.mock.calls[0][1];
        const [uk] = TaskItem.bulkInsertTasks.mock.calls[1][1];
        expect(uk.taskId).not.toBe(us.taskId);
    });
});

describe('mode routing', () => {
    it('off (default): legacy path writes, reconcile does not', async () => {
        await CreateTaskService.createTasksFromErrors(input());
        expect(TaskItem.bulkInsertTasks).toHaveBeenCalled();
        expect(TaskItem.reconcileWrite).not.toHaveBeenCalled();
    });

    it('dry_run: legacy path still writes, reconcile only plans', async () => {
        process.env.TASK_RECONCILE_MODE = 'dry_run';
        await CreateTaskService.createTasksFromErrors(input({ forceReconcile: true }));
        expect(TaskItem.bulkInsertTasks).toHaveBeenCalled();
        expect(TaskItem.reconcileWrite).not.toHaveBeenCalled();
        expect(acquireLock).not.toHaveBeenCalled();
    });

    it('on: reconcile writes, legacy does not', async () => {
        process.env.TASK_RECONCILE_MODE = 'on';
        const result = await CreateTaskService.createTasksFromErrors(input({ forceReconcile: true }));

        expect(TaskItem.bulkInsertTasks).not.toHaveBeenCalled();
        expect(TaskItem.deleteByUserId).not.toHaveBeenCalled();
        const ops = TaskItem.reconcileWrite.mock.calls[0][0];
        expect(ops).toHaveLength(1);
        expect(ops[0].insertOne.document).toMatchObject({ asin: 'B001', status: 'pending', country: 'US', region: 'NA' });

        // First build: the AI views regenerate immediately.
        expect(result.tasksRebuilt).toBe(true);
        expect(result.aiRefreshMinIntervalHours).toBe(0);
    });

    it('on, but no marketplace: stays on the legacy path rather than reconciling user-wide', async () => {
        process.env.TASK_RECONCILE_MODE = 'on';
        await CreateTaskService.createTasksFromErrors(input({ country: null, region: null, forceReconcile: true }));
        expect(TaskItem.reconcileWrite).not.toHaveBeenCalled();
        expect(TaskItem.bulkInsertTasks).toHaveBeenCalled();
    });

    it('on, for an account not on the allowlist: legacy path', async () => {
        process.env.TASK_RECONCILE_MODE = 'on';
        process.env.TASK_RECONCILE_USER_IDS = '6a57b823571ceb9266953c99';
        await CreateTaskService.createTasksFromErrors(input({ forceReconcile: true }));
        expect(TaskItem.reconcileWrite).not.toHaveBeenCalled();
    });
});

describe('reconcile guards', () => {
    beforeEach(() => { process.env.TASK_RECONCILE_MODE = 'on'; });

    it('records the reconcile on the marketplace metadata document', async () => {
        const meta = { taskRenewalDate: new Date(), lastReconciledAt: null, save: jest.fn().mockResolvedValue() };
        Task.findOne.mockReturnValue(query(meta));

        const result = await CreateTaskService.createTasksFromErrors(input({ forceReconcile: true }));

        expect(meta.save).toHaveBeenCalled();
        expect(meta.lastReconciledAt).toBeInstanceOf(Date);
        expect(meta.resolveRailTrips).toEqual({});
        // Not the first build: a material change waits for the AI views to be a day old.
        expect(result.aiRefreshMinIntervalHours).toBe(24);
    });

    it('skips a non-forced reconcile when the last one is recent', async () => {
        Task.findOne.mockReturnValue(query({ lastReconciledAt: new Date(Date.now() - 60 * 60 * 1000) }));

        const result = await CreateTaskService.createTasksFromErrors(input());

        expect(result.skipped).toBe('recently reconciled');
        expect(result.tasksRebuilt).toBe(false);
        expect(acquireLock).not.toHaveBeenCalled();
        expect(TaskItem.reconcileWrite).not.toHaveBeenCalled();
    });

    it('runs a non-forced reconcile when the last one is stale', async () => {
        const meta = { lastReconciledAt: new Date(Date.now() - 7 * 60 * 60 * 1000), taskRenewalDate: new Date(), save: jest.fn() };
        Task.findOne.mockReturnValue(query(meta));

        await CreateTaskService.createTasksFromErrors(input());
        expect(TaskItem.reconcileWrite).toHaveBeenCalled();
    });

    it('a forced reconcile ignores how recent the last one was', async () => {
        const meta = { lastReconciledAt: new Date(), taskRenewalDate: new Date(), save: jest.fn() };
        Task.findOne.mockReturnValue(query(meta));

        await CreateTaskService.createTasksFromErrors(input({ forceReconcile: true }));
        expect(TaskItem.reconcileWrite).toHaveBeenCalled();
    });

    it('takes a per-marketplace lock, and skips when another run holds it', async () => {
        acquireLock.mockResolvedValue(null);

        const result = await CreateTaskService.createTasksFromErrors(input({ forceReconcile: true }));

        expect(acquireLock).toHaveBeenCalledWith(`tasks:${USER}:US:NA`, expect.any(Number), 'task-reconcile');
        expect(result.skipped).toBe('locked');
        expect(TaskItem.reconcileWrite).not.toHaveBeenCalled();
    });

    it('releases the lock even when the write fails, and surfaces the failure', async () => {
        TaskItem.reconcileWrite.mockRejectedValue(new Error('disk full'));

        await expect(CreateTaskService.createTasksFromErrors(input({ forceReconcile: true }))).rejects.toThrow();
        expect(release).toHaveBeenCalled();
    });

    it('does not resolve anything when the caller passed no coverage', async () => {
        TaskItem.find.mockReturnValue(query([{
            _id: 'x1', asin: 'GONE', errorCategory: 'profitability', errorType: 'negative_profit',
            status: 'pending', amount: 5, lastSeenAt: new Date()
        }]));

        await CreateTaskService.createTasksFromErrors(input({ coverage: undefined, forceReconcile: true }));

        const ops = TaskItem.reconcileWrite.mock.calls[0][0];
        expect(ops.some(o => o.updateOne?.update?.$set?.status === 'resolved')).toBe(false);
    });
});

describe('updateTaskStatus', () => {
    it('stamps completedAt and clears stillDetected when the seller completes a task', async () => {
        TaskItem.findOneAndUpdate.mockReturnValue(query({ taskId: 't1', status: 'completed' }));

        await CreateTaskService.updateTaskStatus(USER, 't1', 'completed');

        const update = TaskItem.findOneAndUpdate.mock.calls[0][1];
        expect(update.$set.status).toBe('completed');
        expect(update.$set.completedAt).toBeInstanceOf(Date);
        expect(update.$set.stillDetected).toBe(false);
    });

    it('clears completedAt when the seller reopens a task', async () => {
        TaskItem.findOneAndUpdate.mockReturnValue(query({ taskId: 't1', status: 'pending' }));

        await CreateTaskService.updateTaskStatus(USER, 't1', 'pending');

        const update = TaskItem.findOneAndUpdate.mock.calls[0][1];
        expect(update.$set.status).toBe('pending');
        expect(update.$unset).toEqual({ completedAt: '' });
    });
});

describe('getUserTasks groups', () => {
    it('builds the dashboard-aligned groups from open tasks only', async () => {
        Task.findOne.mockReturnValue(query({ taskRenewalDate: new Date() }));
        TaskItem.findByUserId.mockResolvedValue([
            { taskId: 'a', asin: 'K1', errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword', status: 'pending', amount: 10, renderData: {} },
            { taskId: 'b', asin: 'K2', errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword', status: 'completed', amount: 20, renderData: {} },
            { taskId: 'c', asin: 'K3', errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword', status: 'resolved', amount: 40, renderData: {} }
        ]);
        TaskItem.countByStatus.mockResolvedValue({ pending: 1, completed: 1, in_progress: 0, resolved: 1, total: 3 });

        const result = await CreateTaskService.getUserTasks(USER, { country: 'US', region: 'NA' });

        expect(result.tasks).toHaveLength(3);
        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]).toMatchObject({ count: 1, totalAmount: 10 });
        expect(result.resolvedCount).toBe(1);
    });
});
