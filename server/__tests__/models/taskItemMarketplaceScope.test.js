/**
 * TaskItem marketplace scoping.
 *
 * The model is the place this has to be right: every read, delete and insert in
 * the task pipeline goes through these statics, and the dedup index decides
 * whether a second marketplace's task survives at all.
 */
const TaskItem = require('../../models/MCP/TaskItemModel.js');

describe('TaskItem marketplace scope', () => {
    describe('scopeFilter', () => {
        it('narrows to one marketplace when both parts are given', () => {
            expect(TaskItem.scopeFilter('u1', 'US', 'NA')).toEqual({ userId: 'u1', country: 'US', region: 'NA' });
        });

        // Filtering on `country: undefined` would match nothing and silently empty
        // a seller's task list — worse than the mixing this replaces.
        it('stays user-wide when the marketplace is absent', () => {
            expect(TaskItem.scopeFilter('u1')).toEqual({ userId: 'u1' });
            expect(TaskItem.scopeFilter('u1', null, null)).toEqual({ userId: 'u1' });
        });

        it('ignores a half-supplied marketplace rather than building a broken filter', () => {
            expect(TaskItem.scopeFilter('u1', 'US', null)).toEqual({ userId: 'u1', country: 'US' });
            expect(TaskItem.scopeFilter('u1', null, 'NA')).toEqual({ userId: 'u1', region: 'NA' });
        });
    });

    describe('dedup index', () => {
        const indexes = TaskItem.schema.indexes();
        const dedup = indexes.find(([, opts]) => opts && opts.name === 'task_dedup_marketplace');

        it('exists and is unique', () => {
            expect(dedup).toBeDefined();
            expect(dedup[1].unique).toBe(true);
        });

        // Without country/region in the key, the same ASIN failing the same way in
        // two marketplaces collides and the second insert is rejected.
        it('includes the marketplace, so the same ASIN can fail in two marketplaces', () => {
            expect(Object.keys(dedup[0])).toEqual(
                expect.arrayContaining(['userId', 'country', 'region', 'asin', 'errorCategory', 'errorType'])
            );
        });

        it('no longer carries the old user-only dedup key', () => {
            const old = indexes.find(([keys]) =>
                JSON.stringify(Object.keys(keys)) === JSON.stringify(['userId', 'asin', 'errorCategory', 'errorType'])
            );
            expect(old).toBeUndefined();
        });
    });

    describe('schema', () => {
        it('carries country and region', () => {
            expect(TaskItem.schema.path('country')).toBeDefined();
            expect(TaskItem.schema.path('region')).toBeDefined();
        });

        // Required fields would invalidate every row written before the backfill.
        it('leaves them optional so pre-migration rows stay readable', () => {
            expect(TaskItem.schema.path('country').isRequired).toBeFalsy();
            expect(TaskItem.schema.path('region').isRequired).toBeFalsy();
        });
    });
});
