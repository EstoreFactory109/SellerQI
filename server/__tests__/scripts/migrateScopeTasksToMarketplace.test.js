/**
 * Tests for the marketplace backfill's DEDUP rule — the only part of that script
 * that deletes.
 *
 * WHY THIS EXISTS
 * The migration is phased around a deploy, so the running code keeps inserting while
 * it runs. An unstamped row indexes as (userId, null, null, …), a different entry from
 * the stamped row's, so the unique index admits it; stamping it then aborts the whole
 * updateMany with E11000 and leaves the account half-migrated. The dedup clears those
 * collisions out of the way first.
 *
 * Which makes the selection rule load-bearing in both directions:
 *   - too narrow and the run still dies on a duplicate key;
 *   - too broad and it deletes real, distinct tasks, taking the seller's
 *     completed/in-progress status with them.
 *
 * The keys below are not arbitrary. They are the live unique indexes:
 *   taskitems  task_dedup_marketplace {userId, country, region, asin, errorCategory, errorType}
 *   tasks      task_meta_marketplace  {userId, country, region}
 * If either index changes, these tests must change with it or the rule is wrong again.
 */

const {
    dropClashingUnstamped,
    unstamped,
    TASK_ITEM_DEDUP,
    TASK_META_DEDUP,
} = require('../../scripts/migrateScopeTasksToMarketplace.js');

const USER = 'user-1';
const MK = { country: 'US', region: 'NA' };

/**
 * A stand-in for a Mongoose model holding rows in memory.
 *
 * `find` reads the two shapes the script actually uses — a stamped lookup by
 * {userId, country, region}, and the unstamped filter with its $or — rather than
 * implementing a query engine. Anything else throws, so a change to the caller's
 * query cannot silently pass against a matcher that ignores it.
 */
const fakeModel = (rows) => {
    const deleted = [];
    return {
        rows,
        deleted,
        find(query) {
            const matches = rows.filter((row) => {
                if (row.userId !== query.userId) return false;
                if (query.$or) return row.country === null || row.country === undefined;
                if ('country' in query) return row.country === query.country && row.region === query.region;
                throw new Error(`fakeModel.find got an unexpected query: ${JSON.stringify(query)}`);
            });
            return { lean: async () => matches.map((row) => ({ ...row })) };
        },
        async deleteMany({ _id: { $in: ids } }) {
            ids.forEach((id) => deleted.push(id));
            const before = rows.length;
            for (let i = rows.length - 1; i >= 0; i--) {
                if (ids.includes(rows[i]._id)) rows.splice(i, 1);
            }
            return { deletedCount: before - rows.length };
        },
    };
};

const task = (_id, { asin, errorCategory, errorType, country = null, region = null, status }) => ({
    _id, userId: USER, asin, errorCategory, errorType, country, region, status,
});

describe('unstamped()', () => {
    test('matches a missing field as well as an explicit null', () => {
        // Both shapes exist in production: older rows have no `country` key at all,
        // newer ones were written with it set to null.
        expect(unstamped(USER)).toEqual({
            userId: USER,
            $or: [{ country: { $exists: false } }, { country: null }],
        });
    });
});

describe('TaskItem dedup', () => {
    const run = (model, apply) => dropClashingUnstamped({
        ...TASK_ITEM_DEDUP, model, userId: USER, mk: MK, apply,
    });

    test('drops the unstamped duplicate and keeps the stamped row', async () => {
        const model = fakeModel([
            task('stamped', { asin: 'B01', errorCategory: 'listing', errorType: 'title', ...MK, status: 'completed' }),
            task('unstamped', { asin: 'B01', errorCategory: 'listing', errorType: 'title' }),
        ]);

        expect(await run(model, true)).toBe(1);
        expect(model.deleted).toEqual(['unstamped']);
        // The survivor is the one carrying the seller's work.
        expect(model.rows.map((r) => r._id)).toEqual(['stamped']);
        expect(model.rows[0].status).toBe('completed');
    });

    test('leaves an unstamped row that collides with nothing', async () => {
        const model = fakeModel([
            task('stamped', { asin: 'B01', errorCategory: 'listing', errorType: 'title', ...MK }),
            task('different-asin', { asin: 'B02', errorCategory: 'listing', errorType: 'title' }),
        ]);

        expect(await run(model, true)).toBe(0);
        expect(model.deleted).toEqual([]);
    });

    test.each([
        ['errorCategory', { asin: 'B01', errorCategory: 'ads', errorType: 'title' }],
        ['errorType', { asin: 'B01', errorCategory: 'listing', errorType: 'bullets' }],
    ])('a row differing only by %s is a distinct task, not a duplicate', async (_label, fields) => {
        // Over-deletion is the dangerous direction: these are real, separate tasks that
        // the unique index would have admitted side by side.
        const model = fakeModel([
            task('stamped', { asin: 'B01', errorCategory: 'listing', errorType: 'title', ...MK }),
            task('distinct', fields),
        ]);

        expect(await run(model, true)).toBe(0);
        expect(model.rows).toHaveLength(2);
    });

    test('does nothing when the account has no stamped rows at all', async () => {
        // The common case on a first run: nothing to collide with, so nothing to delete.
        const model = fakeModel([
            task('a', { asin: 'B01', errorCategory: 'listing', errorType: 'title' }),
            task('b', { asin: 'B02', errorCategory: 'listing', errorType: 'title' }),
        ]);

        expect(await run(model, true)).toBe(0);
        expect(model.rows).toHaveLength(2);
    });

    test('report mode counts the collision without deleting anything', async () => {
        const model = fakeModel([
            task('stamped', { asin: 'B01', errorCategory: 'listing', errorType: 'title', ...MK }),
            task('unstamped', { asin: 'B01', errorCategory: 'listing', errorType: 'title' }),
        ]);

        expect(await run(model, false)).toBe(1);
        expect(model.deleted).toEqual([]);
        expect(model.rows).toHaveLength(2);
    });

    test("ignores another user's rows entirely", async () => {
        const model = fakeModel([
            task('stamped', { asin: 'B01', errorCategory: 'listing', errorType: 'title', ...MK }),
            { _id: 'other-user', userId: 'user-2', asin: 'B01', errorCategory: 'listing', errorType: 'title', country: null, region: null },
        ]);

        expect(await run(model, true)).toBe(0);
        expect(model.rows).toHaveLength(2);
    });
});

/**
 * The half that was missing. Task metadata has no discriminator beyond the
 * marketplace, so ANY unstamped doc collides with ANY stamped one for that user —
 * and eight accounts were in exactly that state, each one an E11000 that would have
 * aborted the run partway through.
 */
describe('Task metadata dedup', () => {
    const meta = (_id, { country = null, region = null, taskRenewalDate } = {}) => ({
        _id, userId: USER, country, region, taskRenewalDate,
    });
    const run = (model, apply) => dropClashingUnstamped({
        ...TASK_META_DEDUP, model, userId: USER, mk: MK, apply,
    });

    test('drops the unstamped metadata doc when a stamped one exists', async () => {
        const model = fakeModel([
            meta('stamped', { ...MK, taskRenewalDate: '2026-10-01' }),
            meta('unstamped'),
        ]);

        expect(await run(model, true)).toBe(1);
        expect(model.rows.map((r) => r._id)).toEqual(['stamped']);
    });

    test('keeps the unstamped doc when there is nothing stamped to collide with', async () => {
        // It is about to be stamped in place — deleting it would lose the renewal date.
        const model = fakeModel([meta('only', { taskRenewalDate: '2026-10-01' })]);

        expect(await run(model, true)).toBe(0);
        expect(model.rows).toHaveLength(1);
    });

    test('report mode counts it without deleting', async () => {
        const model = fakeModel([meta('stamped', MK), meta('unstamped')]);

        expect(await run(model, false)).toBe(1);
        expect(model.deleted).toEqual([]);
    });
});
