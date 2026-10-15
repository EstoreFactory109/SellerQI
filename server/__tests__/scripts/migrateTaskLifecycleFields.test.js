/**
 * migrateTaskLifecycleFields — backfills only what is missing, never writes in
 * report mode, and creates the open-work index once.
 */
const mongoose = require('mongoose');
const { run, STEPS } = require('../../scripts/migrateTaskLifecycleFields.js');

const fakeCollection = ({ missing = 5, indexes = [] } = {}) => ({
    countDocuments: jest.fn().mockResolvedValue(missing),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: missing }),
    indexes: jest.fn().mockResolvedValue(indexes),
    createIndex: jest.fn().mockResolvedValue('userId_1_country_1_region_1_status_1')
});

const withCollection = (col) => {
    Object.defineProperty(mongoose.connection, 'db', {
        configurable: true,
        get: () => ({ collection: () => col })
    });
};

describe('migrateTaskLifecycleFields', () => {
    it('only ever targets rows missing the field, so it is safe to re-run', () => {
        for (const step of STEPS) {
            const missingClauses = Object.values(step.filter).filter(v => v && v.$exists === false);
            expect(missingClauses).toHaveLength(1);
        }
    });

    it('backfills completedAt only for completed tasks', () => {
        const step = STEPS.find(s => s.name.startsWith('completedAt'));
        expect(step.filter.status).toBe('completed');
        expect(step.update).toEqual([{ $set: { completedAt: '$updatedAt' } }]);
    });

    it('writes nothing in report mode', async () => {
        const col = fakeCollection();
        withCollection(col);

        const report = await run({ apply: false });

        expect(col.updateMany).not.toHaveBeenCalled();
        expect(col.createIndex).not.toHaveBeenCalled();
        expect(report.index).toBe('missing (would create)');
        expect(report.steps.every(s => s.missing === 5 && s.modified === 0)).toBe(true);
    });

    it('applies every step and creates the index with --apply', async () => {
        const col = fakeCollection();
        withCollection(col);

        const report = await run({ apply: true });

        expect(col.updateMany).toHaveBeenCalledTimes(STEPS.length);
        expect(col.createIndex).toHaveBeenCalledWith({ userId: 1, country: 1, region: 1, status: 1 });
        expect(report.steps.every(s => s.modified === 5)).toBe(true);
    });

    it('skips work that is already done', async () => {
        const col = fakeCollection({
            missing: 0,
            indexes: [{ key: { userId: 1, country: 1, region: 1, status: 1 } }]
        });
        withCollection(col);

        const report = await run({ apply: true });

        expect(col.updateMany).not.toHaveBeenCalled();
        expect(col.createIndex).not.toHaveBeenCalled();
        expect(report.index).toBe('already present');
    });
});
