/**
 * TaskReconcilePlanner — the rules that decide each stored task's fate.
 *
 * The legacy path never closed a fixed issue mid-week, froze amounts at first
 * sight, and at renewal wiped the seller's completed/in-progress work. Each
 * describe block below pins one rule of the replacement.
 */
const {
    planReconcile,
    coverageSourceFor,
    RAIL_MIN_TASKS,
    RAIL_MAX_CONSECUTIVE
} = require('../../../Services/Calculations/TaskReconcilePlanner.js');

const NOW = new Date('2026-10-14T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const hoursAgo = (n) => new Date(NOW.getTime() - n * 60 * 60 * 1000);
const SCOPE = { userId: 'u1', country: 'US', region: 'NA' };

// Every source covered, unless a test says otherwise.
const ALL_COVERED = {
    ranking: true, 'ranking.backend': true, conversion: true,
    'conversion.aplus': true, 'conversion.brandStory': true, 'conversion.images': true,
    'conversion.video': true, 'conversion.rating': true, 'conversion.buybox': true,
    inventory: true, profitability: true, sponsoredAds: true,
    'sponsoredAds.campaigns': true, 'sponsoredAds.keywords': true,
    'sponsoredAds.searchTerms': true, 'sponsoredAds.autoMigration': true, account: true
};

let seq = 0;
const desiredTask = (over = {}) => ({
    taskId: `task_${++seq}`,
    productName: 'Widget',
    asin: 'B000000001',
    errorCategory: 'profitability',
    errorType: 'negative_profit',
    renderData: { netProfit: -10, sales: 100, profitMargin: -10 },
    amount: 10,
    status: 'pending',
    ...over
});

// A stored row matching desiredTask's content, last seen recently.
const storedTask = (over = {}) => ({
    _id: `id_${++seq}`,
    productName: 'Widget',
    asin: 'B000000001',
    errorCategory: 'profitability',
    errorType: 'negative_profit',
    renderData: { netProfit: -10, sales: 100, profitMargin: -10 },
    amount: 10,
    amountIsEstimated: false,
    capitalAmount: 0,
    status: 'pending',
    firstSeenAt: daysAgo(3),
    lastSeenAt: hoursAgo(1),
    createdAt: daysAgo(3),
    updatedAt: hoursAgo(1),
    ...over
});

const plan = (args) => planReconcile({ scope: SCOPE, now: NOW, coverage: ALL_COVERED, ...args });
const updates = (ops) => ops.filter(o => o.updateOne);
const inserts = (ops) => ops.filter(o => o.insertOne);
const deletes = (ops) => ops.filter(o => o.deleteOne);

describe('TaskReconcilePlanner', () => {
    describe('new issues', () => {
        it('inserts a detected issue that is not stored, as pending with first/last seen', () => {
            const { ops, summary } = plan({ existing: [], desired: [desiredTask()] });

            expect(inserts(ops)).toHaveLength(1);
            const doc = ops[0].insertOne.document;
            expect(doc).toMatchObject({
                userId: 'u1', country: 'US', region: 'NA',
                status: 'pending', amount: 10, reopenCount: 0, stillDetected: false
            });
            expect(doc.firstSeenAt).toBe(NOW);
            expect(doc.lastSeenAt).toBe(NOW);
            expect(summary.inserted).toBe(1);
        });

        it('does not write undefined fields onto an inserted document', () => {
            const { ops } = plan({ existing: [], desired: [desiredTask()] });
            const doc = ops[0].insertOne.document;
            expect('error' in doc).toBe(false);
            expect('solution' in doc).toBe(false);
        });

        // The legacy unique index kept the first of two same-key tasks in one batch.
        it('keeps the first of two detected tasks with the same identity', () => {
            const { ops } = plan({
                existing: [],
                desired: [desiredTask({ amount: 5 }), desiredTask({ amount: 99 })]
            });
            expect(inserts(ops)).toHaveLength(1);
            expect(ops[0].insertOne.document.amount).toBe(5);
        });
    });

    describe('issues still detected', () => {
        it('refreshes a changed amount but leaves the status alone', () => {
            const { ops, summary } = plan({
                existing: [storedTask({ status: 'in_progress', amount: 10 })],
                desired: [desiredTask({ amount: 42 })]
            });

            const [op] = updates(ops);
            expect(op.updateOne.update.$set.amount).toBe(42);
            expect(op.updateOne.update.$set.status).toBeUndefined();
            expect(summary.contentUpdated).toBe(1);
        });

        it('filters the update on the status it read, so a concurrent seller change wins', () => {
            const { ops } = plan({
                existing: [storedTask({ amount: 10 })],
                desired: [desiredTask({ amount: 42 })]
            });
            expect(updates(ops)[0].updateOne.filter).toMatchObject({ status: 'pending' });
        });

        it('writes nothing when nothing changed and lastSeenAt is recent', () => {
            const { ops, summary } = plan({ existing: [storedTask()], desired: [desiredTask()] });
            expect(ops).toHaveLength(0);
            expect(summary.changed).toBe(false);
            expect(summary.material).toBe(false);
        });

        // Mongo stores an undefined Mixed field as null; that must not read as a change.
        it('treats null and absent renderData fields as equal', () => {
            const { ops } = plan({
                existing: [storedTask({ renderData: { netProfit: -10, sales: 100, profitMargin: -10, campaignId: null } })],
                desired: [desiredTask({ renderData: { profitMargin: -10, sales: 100, netProfit: -10, campaignId: undefined } })]
            });
            expect(ops).toHaveLength(0);
        });

        it('touches lastSeenAt once it is stale, without counting a content change', () => {
            const { ops, summary } = plan({
                existing: [storedTask({ lastSeenAt: hoursAgo(30) })],
                desired: [desiredTask()]
            });
            expect(updates(ops)).toHaveLength(1);
            expect(updates(ops)[0].updateOne.update.$set.lastSeenAt).toBe(NOW);
            expect(summary.touched).toBe(1);
            expect(summary.contentUpdated).toBe(0);
        });

        // A legacy profitability row with baked-in text would otherwise keep
        // rendering that stale text forever, since baked text wins at read time.
        it('unsets stale baked-in text when the fresh task renders from renderData', () => {
            const { ops } = plan({
                existing: [storedTask({ error: 'old text', solution: 'old fix' })],
                desired: [desiredTask()]
            });
            expect(updates(ops)[0].updateOne.update.$unset).toMatchObject({ error: '', solution: '' });
        });

        it('backfills firstSeenAt from createdAt for rows written before it existed', () => {
            const { ops } = plan({
                existing: [storedTask({ firstSeenAt: undefined, amount: 1 })],
                desired: [desiredTask()]
            });
            expect(updates(ops)[0].updateOne.update.$set.firstSeenAt).toEqual(daysAgo(3));
        });
    });

    describe('reopening', () => {
        it('reopens a resolved task whose issue came back', () => {
            const { ops, summary } = plan({
                existing: [storedTask({ status: 'resolved', resolvedAt: daysAgo(2) })],
                desired: [desiredTask()]
            });
            const { update } = updates(ops)[0].updateOne;
            expect(update.$set.status).toBe('pending');
            expect(update.$set.reopenedAt).toBe(NOW);
            expect(update.$unset.resolvedAt).toBe('');
            expect(update.$inc).toEqual({ reopenCount: 1 });
            expect(summary.reopened).toBe(1);
        });

        it('keeps a completed task completed inside the 7-day grace period', () => {
            const { ops } = plan({
                existing: [storedTask({ status: 'completed', completedAt: daysAgo(6) })],
                desired: [desiredTask()]
            });
            expect(ops).toHaveLength(0);
        });

        it('reopens a completed task still detected after the grace period, flagged stillDetected', () => {
            const { ops, summary } = plan({
                // Loss-making's cooldown is 30 days (tasks-logics.xlsx).
                existing: [storedTask({ status: 'completed', completedAt: daysAgo(31) })],
                desired: [desiredTask()]
            });
            const { update } = updates(ops)[0].updateOne;
            expect(update.$set).toMatchObject({ status: 'pending', stillDetected: true });
            expect(update.$unset.completedAt).toBe('');
            expect(update.$inc).toEqual({ reopenCount: 1 });
            expect(summary.stillDetected).toBe(1);
        });

        it('waits each check\'s own cooldown before raising a done task again', () => {
            const reopened = (over, days) => {
                const { ops } = plan({
                    existing: [storedTask({ ...over, status: 'completed', completedAt: daysAgo(days) })],
                    desired: [desiredTask(over)]
                });
                return updates(ops)[0]?.updateOne.update.$set.status === 'pending';
            };
            // Loss-making: 30 days. Listing suppressed: 3. Account status: until resolved (1).
            expect(reopened({}, 8)).toBe(false);
            expect(reopened({ errorCategory: 'inventory', errorType: 'listing_suppressed' }, 4)).toBe(true);
            expect(reopened({ errorCategory: 'account', errorType: 'accountStatus', asin: 'ACCOUNT' }, 2)).toBe(true);
            expect(reopened({ errorCategory: 'conversion', errorType: 'missing_video' }, 60)).toBe(false);
        });

        it('falls back to updatedAt for a completed row with no completedAt', () => {
            const recent = plan({
                existing: [storedTask({ status: 'completed', completedAt: undefined, updatedAt: daysAgo(2) })],
                desired: [desiredTask()]
            });
            // Still inside the grace period: status kept, and the fallback is pinned
            // as completedAt, since this very write is about to bump updatedAt.
            const { update } = updates(recent.ops)[0].updateOne;
            expect(update.$set.status).toBeUndefined();
            expect(update.$set.completedAt).toEqual(daysAgo(2));

            const old = plan({
                existing: [storedTask({ status: 'completed', completedAt: undefined, updatedAt: daysAgo(31) })],
                desired: [desiredTask()]
            });
            expect(updates(old.ops)[0].updateOne.update.$set.status).toBe('pending');
        });
    });

    describe('issues no longer detected', () => {
        it('resolves an open task whose issue vanished', () => {
            const { ops, summary } = plan({ existing: [storedTask()], desired: [] });
            const { filter, update } = updates(ops)[0].updateOne;
            expect(update.$set).toMatchObject({ status: 'resolved', resolvedAt: NOW });
            expect(filter.status).toBe('pending');
            expect(summary.resolved).toBe(1);
        });

        it('resolves in-progress tasks too', () => {
            const { summary } = plan({ existing: [storedTask({ status: 'in_progress' })], desired: [] });
            expect(summary.resolved).toBe(1);
        });

        it('leaves a completed task completed when its issue vanished', () => {
            const { ops } = plan({ existing: [storedTask({ status: 'completed', completedAt: daysAgo(1) })], desired: [] });
            expect(ops).toHaveLength(0);
        });

        it('does not resolve when the task\'s data source was not covered', () => {
            const { ops, summary } = plan({
                existing: [storedTask()],
                desired: [],
                coverage: { ...ALL_COVERED, profitability: false }
            });
            expect(ops).toHaveLength(0);
            expect(summary.uncoveredSources).toEqual(['profitability']);
        });

        it('treats a missing coverage key as not covered (fail safe)', () => {
            const { ops } = plan({ existing: [storedTask()], desired: [], coverage: {} });
            expect(ops).toHaveLength(0);
        });

        it('judges coverage per source, not per category', () => {
            const keyword = storedTask({ errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword', asin: 'kw1' });
            const campaign = storedTask({ errorCategory: 'sponsoredAds', errorType: 'high_acos', asin: 'c1' });
            const { summary } = plan({
                existing: [keyword, campaign],
                desired: [],
                coverage: { ...ALL_COVERED, 'sponsoredAds.keywords': false }
            });
            expect(summary.resolved).toBe(1);
            expect(summary.uncoveredSources).toEqual(['sponsoredAds.keywords']);
        });

        it('holds back product-level tasks for an active product the calculation never visited', () => {
            const visited = storedTask({ errorCategory: 'ranking', errorType: 'titleresult_char_limit', asin: 'A1' });
            const unvisited = storedTask({ errorCategory: 'ranking', errorType: 'titleresult_char_limit', asin: 'A2' });
            const { summary } = plan({
                existing: [visited, unvisited],
                desired: [],
                coverage: { ...ALL_COVERED, uncoveredProductAsins: ['A2'] }
            });
            expect(summary.resolved).toBe(1);
            expect(summary.heldUnvisitedProduct).toBe(1);
        });
    });

    describe('mass-resolve rail', () => {
        const many = (n) => Array.from({ length: n }, (_, i) =>
            storedTask({ errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword', asin: `kw${i}` }));

        it('holds back resolving most of a source at once, and records the trip', () => {
            const { ops, summary, railTrips } = plan({ existing: many(RAIL_MIN_TASKS), desired: [] });
            expect(ops).toHaveLength(0);
            expect(summary.railHeld['sponsoredAds.keywords']).toMatchObject({ wouldResolve: RAIL_MIN_TASKS, consecutive: 1 });
            expect(railTrips).toEqual({ 'sponsoredAds.keywords': 1 });
        });

        it('lets small drops through', () => {
            const { summary } = plan({ existing: many(RAIL_MIN_TASKS - 1), desired: [] });
            expect(summary.resolved).toBe(RAIL_MIN_TASKS - 1);
        });

        it('lets a drop through once it has persisted for the maximum consecutive runs', () => {
            const { summary, railTrips } = plan({
                existing: many(RAIL_MIN_TASKS),
                desired: [],
                priorRailTrips: { 'sponsoredAds.keywords': RAIL_MAX_CONSECUTIVE - 1 }
            });
            expect(summary.resolved).toBe(RAIL_MIN_TASKS);
            expect(railTrips).toEqual({});
        });
    });

    describe('retention', () => {
        it('purges resolved tasks older than 30 days', () => {
            const { ops, summary } = plan({
                existing: [storedTask({ status: 'resolved', resolvedAt: daysAgo(31) })],
                desired: []
            });
            expect(deletes(ops)).toHaveLength(1);
            expect(summary.purged).toBe(1);
        });

        it('purges completed tasks older than 30 days', () => {
            const { summary } = plan({
                existing: [storedTask({ status: 'completed', completedAt: daysAgo(40) })],
                desired: []
            });
            expect(summary.purged).toBe(1);
        });

        it('keeps recent finished tasks', () => {
            const { ops } = plan({
                existing: [storedTask({ status: 'resolved', resolvedAt: daysAgo(29) })],
                desired: []
            });
            expect(ops).toHaveLength(0);
        });
    });

    describe('idempotence', () => {
        it('produces no status or content change when the same issues are planned twice', () => {
            const first = plan({ existing: [], desired: [desiredTask({ asin: 'A' }), desiredTask({ asin: 'B', amount: 3 })] });
            // Simulate what the inserts stored.
            const stored = inserts(first.ops).map((o, i) => ({ _id: `s${i}`, createdAt: NOW, updatedAt: NOW, ...o.insertOne.document }));
            const second = plan({
                existing: stored,
                desired: [desiredTask({ asin: 'A' }), desiredTask({ asin: 'B', amount: 3 })]
            });
            expect(second.ops).toHaveLength(0);
            expect(second.summary.changed).toBe(false);
        });
    });

    describe('materiality (drives the AI view refresh)', () => {
        const openRows = (n) => Array.from({ length: n }, (_, i) =>
            storedTask({ errorCategory: 'ranking', errorType: 'titleresult_char_limit', asin: `A${i}`, amount: 0 }));

        it('one new task on a large list is not material', () => {
            const existing = openRows(50);
            const desired = existing.map(t => desiredTask({ ...t, renderData: t.renderData }));
            desired.push(desiredTask({ errorCategory: 'ranking', errorType: 'titleresult_char_limit', asin: 'NEW', amount: 0 }));
            const { summary } = plan({ existing, desired });
            expect(summary.inserted).toBe(1);
            expect(summary.material).toBe(false);
        });

        it('a large share of the list turning over is material', () => {
            const existing = openRows(10);
            const desired = existing.slice(0, 8).map(t => desiredTask({ ...t }));
            const { summary } = plan({ existing, desired });
            expect(summary.resolved).toBe(2);
            expect(summary.material).toBe(true);
        });

        it('open recoverable $ moving more than 10% is material', () => {
            const { summary } = plan({ existing: [storedTask({ amount: 100 })], desired: [desiredTask({ amount: 150 })] });
            expect(summary.material).toBe(true);
        });

        it('the first build of an account is material', () => {
            const { summary } = plan({ existing: [], desired: [desiredTask()] });
            expect(summary.material).toBe(true);
        });
    });

    describe('coverageSourceFor', () => {
        it('maps known types to their specific source', () => {
            expect(coverageSourceFor('conversion', 'no_buybox')).toBe('conversion.buybox');
            expect(coverageSourceFor('sponsoredAds', 'search_term_zero_sales')).toBe('sponsoredAds.searchTerms');
            expect(coverageSourceFor('ranking', 'backend_keywords_char_limit')).toBe('ranking.backend');
        });

        it('falls back to the category, including retired and SKU-suffixed types', () => {
            expect(coverageSourceFor('conversion', 'insufficient_reviews')).toBe('conversion');
            expect(coverageSourceFor('inventory', 'replenishment_needed_SKU-1')).toBe('inventory');
        });
    });
});
