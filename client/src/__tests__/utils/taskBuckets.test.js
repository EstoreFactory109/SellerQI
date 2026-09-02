/**
 * Tests for selectBuckets — the High impact / Quick wins / Everything else
 * partition.
 */
import { describe, it, expect } from 'vitest';
import {
  selectBuckets,
  compareByImpact,
  formatEffort,
  groupKeyForTask,
  indexGroups,
  MAX_PER_HIGHLIGHT_BUCKET,
  MAX_PER_ERROR_TYPE
} from '../../utils/taskBuckets.js';

let seq = 0;
const task = (over = {}) => ({
  taskId: over.taskId || `t${++seq}`,
  errorCategory: 'sponsoredAds',
  errorType: 'wasted_spend_keyword',
  amount: 0,
  impactWeight: 50,
  effortMinutes: 15,
  isQuickWin: false,
  ...over
});

const quick = (over = {}) => task({ effortMinutes: 2, isQuickWin: true, ...over });

const ids = (arr) => arr.map((t) => t.taskId);

describe('selectBuckets — partition guarantees', () => {
  it('returns empty buckets for empty or invalid input', () => {
    expect(selectBuckets([])).toEqual({ highImpact: [], quickWins: [], everythingElse: [] });
    expect(selectBuckets(null)).toEqual({ highImpact: [], quickWins: [], everythingElse: [] });
  });

  it('places every task in exactly one bucket, with counts summing to the input', () => {
    const tasks = Array.from({ length: 50 }, (_, i) =>
      task({ taskId: `x${i}`, errorType: `type_${i % 7}`, amount: i, isQuickWin: i % 3 === 0, effortMinutes: i % 3 === 0 ? 2 : 30 })
    );

    const { highImpact, quickWins, everythingElse } = selectBuckets(tasks);
    const all = [...ids(highImpact), ...ids(quickWins), ...ids(everythingElse)];

    expect(all).toHaveLength(tasks.length);
    expect(new Set(all).size).toBe(tasks.length); // no duplicates
  });

  it('caps each highlighted bucket at 6', () => {
    const tasks = Array.from({ length: 40 }, (_, i) =>
      quick({ taskId: `q${i}`, errorType: `type_${i}`, amount: 100 - i })
    );
    const { highImpact, quickWins } = selectBuckets(tasks);
    expect(highImpact).toHaveLength(MAX_PER_HIGHLIGHT_BUCKET);
    expect(quickWins).toHaveLength(MAX_PER_HIGHLIGHT_BUCKET);
  });
});

describe('selectBuckets — diversity cap', () => {
  it('never shows more than 2 tasks of the same errorType in a highlighted bucket', () => {
    // The real scenario: 3,445 wasted-keyword tasks would otherwise fill the bucket.
    const tasks = Array.from({ length: 20 }, (_, i) =>
      task({ taskId: `k${i}`, errorType: 'wasted_spend_keyword', amount: 500 - i })
    );

    const { highImpact } = selectBuckets(tasks);
    expect(highImpact).toHaveLength(MAX_PER_ERROR_TYPE);
    expect(highImpact.every((t) => t.errorType === 'wasted_spend_keyword')).toBe(true);
  });

  it('fills the bucket with different problems when they are available', () => {
    const tasks = [
      ...Array.from({ length: 10 }, (_, i) => task({ taskId: `a${i}`, errorType: 'type_a', amount: 900 - i })),
      task({ taskId: 'b1', errorType: 'type_b', amount: 500 }),
      task({ taskId: 'c1', errorType: 'type_c', amount: 400 }),
      task({ taskId: 'd1', errorType: 'type_d', amount: 300 }),
      task({ taskId: 'e1', errorType: 'type_e', amount: 200 })
    ];

    const { highImpact } = selectBuckets(tasks);
    expect(highImpact).toHaveLength(6);
    expect(ids(highImpact)).toEqual(['a0', 'a1', 'b1', 'c1', 'd1', 'e1']);
  });

  it('treats SKU-suffixed replenishment tasks as one type for the cap', () => {
    const tasks = Array.from({ length: 8 }, (_, i) =>
      task({ taskId: `r${i}`, errorCategory: 'inventory', errorType: `replenishment_needed_SKU-${i}`, amount: 100 - i })
    );
    const { highImpact } = selectBuckets(tasks);
    expect(highImpact).toHaveLength(MAX_PER_ERROR_TYPE);
  });
});

describe('selectBuckets — ordering', () => {
  it('puts real money ahead of any impact weight', () => {
    const tasks = [
      task({ taskId: 'weighty', amount: 0, impactWeight: 100, errorType: 'type_a' }),
      task({ taskId: 'money', amount: 1, impactWeight: 1, errorType: 'type_b' })
    ];
    expect(ids(selectBuckets(tasks).highImpact)).toEqual(['money', 'weighty']);
  });

  it('orders by amount descending when several tasks carry money', () => {
    const tasks = [
      task({ taskId: 'small', amount: 10, errorType: 'a' }),
      task({ taskId: 'big', amount: 900, errorType: 'b' }),
      task({ taskId: 'mid', amount: 100, errorType: 'c' })
    ];
    expect(ids(selectBuckets(tasks).highImpact)).toEqual(['big', 'mid', 'small']);
  });

  it('falls back to impact weight when NO task has money — today\'s production state', () => {
    const tasks = [
      task({ taskId: 'title', amount: 0, impactWeight: 50, errorType: 'ranking_title' }),
      task({ taskId: 'suspension', amount: 0, impactWeight: 100, errorType: 'account_status' }),
      task({ taskId: 'desc', amount: 0, impactWeight: 20, errorType: 'ranking_desc' })
    ];
    expect(ids(selectBuckets(tasks).highImpact)).toEqual(['suspension', 'title', 'desc']);
  });

  it('prefers the cheaper fix when impact is equal', () => {
    const tasks = [
      task({ taskId: 'slow', impactWeight: 50, effortMinutes: 240, errorType: 'a' }),
      task({ taskId: 'fast', impactWeight: 50, effortMinutes: 2, errorType: 'b' })
    ];
    expect(ids(selectBuckets(tasks).highImpact)).toEqual(['fast', 'slow']);
  });

  it('is stable for fully-tied tasks', () => {
    const mk = () => [
      task({ taskId: 'b', errorType: 'x' }),
      task({ taskId: 'a', errorType: 'y' })
    ];
    expect(ids(selectBuckets(mk()).highImpact)).toEqual(ids(selectBuckets(mk()).highImpact));
  });

  it('compareByImpact is directly reusable and total', () => {
    const a = task({ taskId: 'a', amount: 5 });
    const b = task({ taskId: 'b', amount: 0 });
    expect(compareByImpact(a, b)).toBeLessThan(0);
    expect(compareByImpact(b, a)).toBeGreaterThan(0);
    expect(compareByImpact(a, a)).toBe(0);
  });
});

describe('selectBuckets — quick wins', () => {
  it('only admits tasks flagged as quick wins', () => {
    const tasks = [
      ...Array.from({ length: 6 }, (_, i) => task({ taskId: `slow${i}`, errorType: `s${i}`, amount: 900 - i })),
      quick({ taskId: 'q1', errorType: 'q_a', amount: 5 }),
      quick({ taskId: 'q2', errorType: 'q_b', amount: 4 }),
      task({ taskId: 'slowLeftover', errorType: 's_extra', amount: 1 })
    ];

    const { quickWins, everythingElse } = selectBuckets(tasks);
    expect(ids(quickWins)).toEqual(['q1', 'q2']);
    expect(quickWins.every((t) => t.isQuickWin)).toBe(true);
    expect(ids(everythingElse)).toContain('slowLeftover');
  });

  it('does not repeat a task already claimed by High impact', () => {
    // A big-money 2-minute task is the best kind of task: High impact claims it,
    // and Quick wins moves on to the next-best quick one. High impact is filled
    // here so the second quick task genuinely has to spill over.
    const tasks = [
      quick({ taskId: 'bestOfBoth', errorType: 'a', amount: 5000 }),
      ...Array.from({ length: 5 }, (_, i) => task({ taskId: `big${i}`, errorType: `big_${i}`, amount: 4000 - i * 100 })),
      quick({ taskId: 'nextQuick', errorType: 'b', amount: 5 })
    ];

    const { highImpact, quickWins } = selectBuckets(tasks);
    expect(highImpact).toHaveLength(6);
    expect(ids(highImpact)).toContain('bestOfBoth');
    expect(ids(quickWins)).not.toContain('bestOfBoth');
    expect(ids(quickWins)).toEqual(['nextQuick']);
  });

  it('leaves Quick wins empty when nothing is quick', () => {
    const tasks = [task({ taskId: 'a', errorType: 'x' }), task({ taskId: 'b', errorType: 'y' })];
    expect(selectBuckets(tasks).quickWins).toEqual([]);
  });
});

describe('selectBuckets — completed tasks', () => {
  it('keeps completed tasks out of the highlighted buckets', () => {
    const tasks = [
      task({ taskId: 'done', errorType: 'a', amount: 9999 }),
      task({ taskId: 'todo', errorType: 'b', amount: 10 })
    ];
    const { highImpact, everythingElse } = selectBuckets(tasks, { completedTaskIds: new Set(['done']) });

    expect(ids(highImpact)).toEqual(['todo']);
    expect(ids(everythingElse)).toContain('done');
  });

  it('accepts completedTaskIds as a plain array too', () => {
    const tasks = [task({ taskId: 'done', errorType: 'a', amount: 9999 }), task({ taskId: 'todo', errorType: 'b' })];
    expect(ids(selectBuckets(tasks, { completedTaskIds: ['done'] }).highImpact)).toEqual(['todo']);
  });
});

describe('joining a task to its dashboard group', () => {
  it('builds the same key the server uses for a group id', () => {
    expect(groupKeyForTask(task({ errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword' })))
      .toBe('sponsoredAds:wasted_spend_keyword');
  });

  it('normalizes the SKU-suffixed replenishment type so it still finds its group', () => {
    expect(groupKeyForTask(task({ errorCategory: 'inventory', errorType: 'replenishment_needed_ABC-1' })))
      .toBe('inventory:replenishment_needed');
  });

  it('resolves a task to the group carrying the figure the dashboard reports', () => {
    // Exactly the real shape: 93 keyword tasks summing to $187.41 on both surfaces.
    const groups = [{ id: 'sponsoredAds:wasted_spend_keyword', count: 93, totalAmount: 187.41, title: 'Keywords spending money with zero sales' }];
    const byId = indexGroups(groups);
    const row = task({ errorCategory: 'sponsoredAds', errorType: 'wasted_spend_keyword', amount: 26.37 });

    const group = byId.get(groupKeyForTask(row));
    expect(group.count).toBe(93);
    expect(group.totalAmount).toBe(187.41);
  });

  it('tolerates missing or malformed groups', () => {
    expect(indexGroups(undefined).size).toBe(0);
    expect(indexGroups(null).size).toBe(0);
    expect(indexGroups([]).get('anything')).toBeUndefined();
  });
});

describe('formatEffort', () => {
  it('renders minutes and hours readably', () => {
    expect(formatEffort(2)).toBe('~2 min');
    expect(formatEffort(30)).toBe('~30 min');
    expect(formatEffort(60)).toBe('~1 hr');
    expect(formatEffort(90)).toBe('~1 hr 30 min');
    expect(formatEffort(240)).toBe('~4 hr');
  });

  it('renders nothing when the effort is unknown', () => {
    expect(formatEffort(undefined)).toBe('');
    expect(formatEffort(0)).toBe('');
    expect(formatEffort(null)).toBe('');
  });
});
