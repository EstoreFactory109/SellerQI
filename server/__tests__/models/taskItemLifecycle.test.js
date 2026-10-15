/**
 * TaskItem lifecycle fields and write-error handling.
 *
 * bulkInsertTasks used to treat ANY error carrying `writeErrors` as a harmless
 * duplicate, so a validation failure was logged as a normal insert.
 */
const TaskItem = require('../../models/MCP/TaskItemModel.js');

const dupError = () => Object.assign(new Error('E11000'), {
    code: 11000,
    writeErrors: [{ code: 11000 }],
    result: { insertedCount: 2, modifiedCount: 1, deletedCount: 0 }
});
const mixedError = () => Object.assign(new Error('bulk failed'), {
    writeErrors: [{ code: 11000 }, { code: 121 }],
    result: {}
});

describe('TaskItem lifecycle schema', () => {
    it('accepts the system-only resolved status', () => {
        expect(TaskItem.schema.path('status').enumValues).toEqual(
            expect.arrayContaining(['pending', 'in_progress', 'completed', 'resolved'])
        );
    });

    it('carries the lifecycle dates and flags', () => {
        for (const f of ['firstSeenAt', 'lastSeenAt', 'completedAt', 'resolvedAt', 'reopenedAt', 'reopenCount', 'stillDetected']) {
            expect(TaskItem.schema.path(f)).toBeDefined();
        }
    });

    it('treats pending and in_progress as the open statuses', () => {
        expect(TaskItem.OPEN_STATUSES).toEqual(['pending', 'in_progress']);
    });

    it('indexes open-work reads by marketplace and status', () => {
        const keys = TaskItem.schema.indexes().map(([k]) => Object.keys(k).join(','));
        expect(keys).toContain('userId,country,region,status');
    });
});

describe('isOnlyDuplicateKeyErrors', () => {
    it('accepts a pure duplicate-key failure', () => {
        expect(TaskItem.isOnlyDuplicateKeyErrors(dupError())).toBe(true);
    });

    it('rejects a failure that mixes duplicates with a real error', () => {
        expect(TaskItem.isOnlyDuplicateKeyErrors(mixedError())).toBe(false);
    });

    it('rejects a non-write error', () => {
        expect(TaskItem.isOnlyDuplicateKeyErrors(new Error('network'))).toBe(false);
    });
});

describe('bulkInsertTasks', () => {
    const task = { taskId: 't', productName: 'p', asin: 'a', errorCategory: 'ranking', errorType: 'x' };

    it('tolerates duplicates', async () => {
        jest.spyOn(TaskItem, 'insertMany').mockRejectedValue(dupError());
        await expect(TaskItem.bulkInsertTasks('6a57b823571ceb9266953c30', [task])).resolves.toEqual({ insertedCount: 2 });
    });

    it('rethrows a real write error instead of reporting success', async () => {
        jest.spyOn(TaskItem, 'insertMany').mockRejectedValue(mixedError());
        await expect(TaskItem.bulkInsertTasks('6a57b823571ceb9266953c30', [task])).rejects.toThrow('bulk failed');
    });
});

describe('reconcileWrite', () => {
    it('is a no-op for an empty plan', async () => {
        const spy = jest.spyOn(TaskItem, 'bulkWrite');
        await expect(TaskItem.reconcileWrite([])).resolves.toEqual({ inserted: 0, modified: 0, deleted: 0, duplicates: 0 });
        expect(spy).not.toHaveBeenCalled();
    });

    it('writes unordered, so one bad op cannot stop the rest', async () => {
        const spy = jest.spyOn(TaskItem, 'bulkWrite').mockResolvedValue({ insertedCount: 1, modifiedCount: 2, deletedCount: 3 });
        const result = await TaskItem.reconcileWrite([{ insertOne: { document: {} } }]);
        expect(spy).toHaveBeenCalledWith(expect.any(Array), { ordered: false });
        expect(result).toEqual({ inserted: 1, modified: 2, deleted: 3, duplicates: 0 });
    });

    // A duplicate means a concurrent writer already created the task: same end state.
    it('tolerates duplicate inserts and still reports what was written', async () => {
        jest.spyOn(TaskItem, 'bulkWrite').mockRejectedValue(dupError());
        await expect(TaskItem.reconcileWrite([{ insertOne: { document: {} } }])).resolves.toEqual({
            inserted: 2, modified: 1, deleted: 0, duplicates: 1
        });
    });

    it('rethrows any non-duplicate write error', async () => {
        jest.spyOn(TaskItem, 'bulkWrite').mockRejectedValue(mixedError());
        await expect(TaskItem.reconcileWrite([{ insertOne: { document: {} } }])).rejects.toThrow('bulk failed');
    });
});
