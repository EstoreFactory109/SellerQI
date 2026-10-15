/**
 * cleanupOrphanTasks — only owners missing from `users` are touched, report mode
 * writes nothing, and a second run is a no-op.
 */
const { run } = require('../../scripts/cleanupOrphanTasks.js');

const LIVE = 'live-user';
const GONE = 'gone-user';

// Minimal in-memory stand-in for the three collections the script reads.
function fakeDb({ taskitems, tasks, users }) {
    const state = { taskitems: [...taskitems], tasks: [...tasks], users: [...users] };
    const collection = (name) => ({
        aggregate: (pipeline) => ({
            toArray: async () => {
                const match = pipeline.find((s) => s.$match)?.$match;
                let rows = state[name];
                if (match?.userId?.$in) rows = rows.filter((r) => match.userId.$in.map(String).includes(String(r.userId)));
                const groups = new Map();
                for (const r of rows) {
                    const g = groups.get(r.userId) || { _id: r.userId, taskItems: 0, open: 0, newestTask: null, n: 0 };
                    g.taskItems++; g.n++;
                    if (['pending', 'in_progress'].includes(r.status)) g.open++;
                    if (r.createdAt && (!g.newestTask || r.createdAt > g.newestTask)) g.newestTask = r.createdAt;
                    groups.set(r.userId, g);
                }
                return [...groups.values()];
            },
        }),
        distinct: async (field) => [...new Set(state[name].map((r) => r[field]))],
        find: (q) => ({ project: () => ({ toArray: async () => state[name].filter((r) => q._id.$in.includes(r._id)) }) }),
        deleteMany: async (q) => {
            const before = state[name].length;
            state[name] = state[name].filter((r) => !q.userId.$in.includes(r.userId));
            return { deletedCount: before - state[name].length };
        },
    });
    return { db: { collection }, state };
}

const fixture = () => fakeDb({
    taskitems: [
        { userId: LIVE, status: 'pending', createdAt: new Date('2026-10-01') },
        { userId: GONE, status: 'pending', createdAt: new Date('2026-06-17') },
        { userId: GONE, status: 'completed', createdAt: new Date('2026-06-10') },
    ],
    tasks: [{ userId: LIVE }, { userId: GONE }],
    users: [{ _id: LIVE }],
});

describe('cleanupOrphanTasks', () => {
    it('reports orphan owners without deleting anything', async () => {
        const { db, state } = fixture();
        const { summary } = await run(db, { apply: false });
        expect(summary).toMatchObject({ orphanOwners: 1, taskItems: 2, openTaskItems: 1, metaDocs: 1, ownersWithTasksAfterPurgeExisted: 1 });
        expect(state.taskitems).toHaveLength(3);
        expect(state.tasks).toHaveLength(2);
    });

    it('deletes only the orphan owner\'s tasks and metadata with --apply', async () => {
        const { db, state } = fixture();
        const { summary } = await run(db, { apply: true });
        expect(summary.deleted).toEqual({ taskItems: 2, metaDocs: 1 });
        expect(state.taskitems.map((t) => t.userId)).toEqual([LIVE]);
        expect(state.tasks.map((t) => t.userId)).toEqual([LIVE]);
    });

    it('is a no-op on a second run', async () => {
        const { db } = fixture();
        await run(db, { apply: true });
        const { summary } = await run(db, { apply: true });
        expect(summary.orphanOwners).toBe(0);
        expect(summary.deleted).toEqual({ taskItems: 0, metaDocs: 0 });
    });
});
