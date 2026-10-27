import { describe, it, expect } from 'vitest';
import { reviewSummaryBoxes } from '../../utils/reviewSummary.js';

describe('reviewSummaryBoxes', () => {
  it('shows the four numbers with their notes', () => {
    const boxes = reviewSummaryBoxes({
      monthStart: '2026-10-01T00:00:00.000Z', eligibleNow: 3, inWindowUnchecked: 2159,
      requestedThisMonth: 87, windowClosedThisMonth: 12, ratingsThisMonth: { count: 77 },
    });
    expect(boxes.map((b) => b.value)).toEqual([3, 87, 77, 12]);
    expect(boxes[0].note).toContain('+2,159 more');
    expect(boxes[2].note).toBe('New ratings on your products this month');
  });

  it('shows dashes before the numbers arrive, and when ratings are not checked yet', () => {
    expect(reviewSummaryBoxes(null).every((b) => b.value === null && b.note === 'Not available yet')).toBe(true);
    const [, , ratings] = reviewSummaryBoxes({ monthStart: '2026-10-01T00:00:00.000Z', eligibleNow: 0, requestedThisMonth: 0, windowClosedThisMonth: 0, ratingsThisMonth: null });
    expect(ratings.value).toBeNull();
    expect(ratings.note).toContain("this month's ratings check");
  });
});
