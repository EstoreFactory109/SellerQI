/**
 * The task identity migration, planning only (pure).
 * Pinned: rows that are one problem merge into the one carrying the seller's decision,
 * which keeps its taskId, earliest firstSeenAt and summed reopenCount; unrelated rows only
 * get their identity; grouped listing rows are re-keyed to Amazon's issue code when the
 * seller's stored issues still have the message; a second run has nothing left to do.
 */
const { planScope, identityOfRow } = require('../../scripts/migrateTaskIdentity.js');
const { identityKeyOf, listingIssueGroupKey, listingGroupEntity } = require('../../Services/Calculations/TaskIdentity.js');

const d = (s) => new Date(s);
const row = (over) => ({ _id: over.taskId, reopenCount: 0, createdAt: d('2026-10-01'), updatedAt: d('2026-10-20'), ...over });

it('merges one problem\'s rows into the completed one, keeping its taskId and history', () => {
    const done = row({ taskId: 't_done', asin: 'ACCOUNT', errorCategory: 'account', errorType: 'orderWithDefectsStatus', status: 'completed', completedAt: d('2026-10-25'), firstSeenAt: d('2026-10-05'), reopenCount: 1 });
    const open = row({ taskId: 't_open', asin: 'ACCOUNT', errorCategory: 'account', errorType: 'orderWithDefectsStatus_unstable', status: 'pending', firstSeenAt: d('2026-10-02'), reopenCount: 2 });
    const other = row({ taskId: 't_other', asin: 'B01', errorCategory: 'conversion', errorType: 'missing_aplus_content', status: 'pending' });

    const { setIdentity, merges } = planScope([open, done, other]);

    expect(merges).toHaveLength(1);
    expect(merges[0].keep.taskId).toBe('t_done');
    expect(merges[0].drop.map((r) => r.taskId)).toEqual(['t_open']);
    const patch = setIdentity.find((p) => p._id === 't_done');
    expect(patch).toMatchObject({ identityKey: identityKeyOf(done), firstSeenAt: d('2026-10-02'), reopenCount: 3 });
    expect(setIdentity.find((p) => p._id === 't_other')).toEqual({ _id: 't_other', identityKey: identityKeyOf(other) });
});

it('merges a SKU\'s old restock rows into the product\'s stock task', () => {
    const rows = [
        row({ taskId: 'a', asin: 'B01', errorCategory: 'inventory', errorType: 'replenishment_needed_SKU1', status: 'pending' }),
        row({ taskId: 'b', asin: 'B01', errorCategory: 'inventory', errorType: 'replenishment_needed_SKU2', status: 'in_progress' }),
        row({ taskId: 'c', asin: 'B01', errorCategory: 'inventory', errorType: 'out_of_stock', status: 'resolved' }),
    ];
    const { merges } = planScope(rows);
    expect(merges[0].keep.taskId).toBe('b'); // the seller is working on it
    expect(merges[0].drop.map((r) => r.taskId).sort()).toEqual(['a', 'c']);
});

it('re-keys a grouped listing warning to Amazon\'s code when its message is still stored', () => {
    const issue = { code: '90220', attributeNames: ['brand'], message: 'Brand is required', severity: 'WARNING' };
    const old = row({ taskId: 'g', asin: 'WARNING:abcdef0123456789', errorCategory: 'inventory', errorType: 'listing_warnings', renderData: { messages: ['Brand is required'] }, status: 'completed' });
    const lookup = (severity, message) => (severity === 'WARNING' && message === issue.message ? listingIssueGroupKey(issue) : null);
    expect(identityOfRow(old, lookup)).toBe(identityKeyOf({ asin: listingGroupEntity('WARNING', listingIssueGroupKey(issue)), errorCategory: 'inventory', errorType: 'listing_warnings' }));
    // Message no longer stored anywhere: keeps the identity it has.
    expect(identityOfRow(old, () => null)).toBe(identityKeyOf(old));
});

it('a second run has nothing to do', () => {
    const rows = [row({ taskId: 'x', asin: 'B01', errorCategory: 'ranking', errorType: 'titleresult_too_short', status: 'pending' })];
    const first = planScope(rows);
    rows[0].identityKey = first.setIdentity[0].identityKey;
    const second = planScope(rows);
    expect(second.setIdentity).toEqual([]);
    expect(second.merges).toEqual([]);
});
