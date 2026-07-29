/**
 * Tests for the streaming refactor of Services/review/orders.js.
 *
 * fetchOrders was reduced to a thin buffering wrapper over fetchOrdersStreaming. That edit
 * changes shared code used by callers OUTSIDE the new feature flag, so the equivalence tests
 * below are the guard for the accounts that already ingest successfully.
 */

const {
  fetchOrders,
  fetchOrdersStreaming,
  getDateRange,
  enumerateSlices,
  isWithinReviewWindow,
  ORDER_CONFIG,
} = require('../../../Services/review/orders.js');

const AWS_CONFIG = {
  marketplaceId: 'ATVPDKIKX0DER',
  endpoint: 'https://sellingpartnerapi-na.amazon.com',
  awsAccessKeyId: 'AK',
  awsSecretAccessKey: 'SK',
  awsRegion: 'us-east-1',
  awsSessionToken: 'ST',
};

function page(orders, nextToken = null) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ payload: { Orders: orders, NextToken: nextToken } }),
  };
}

function order(id) {
  return { AmazonOrderId: id, OrderStatus: 'Shipped', PurchaseDate: '2026-07-10T00:00:00Z' };
}

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete global.fetch;
});

describe('fetchOrders — unchanged contract (regression guard)', () => {
  test('returns a plain array of every order across pages', async () => {
    // Pagination sleeps 3s between pages, so drive it with fake timers.
    jest.useFakeTimers();
    try {
      global.fetch
        .mockResolvedValueOnce(page([order('1'), order('2')], 'TOK'))
        .mockResolvedValueOnce(page([order('3')], null));

      const promise = fetchOrders('tok', AWS_CONFIG);
      await jest.advanceTimersByTimeAsync(ORDER_CONFIG.delayBetweenOrderPagesMs + 100);
      const result = await promise;

      expect(Array.isArray(result)).toBe(true);
      expect(result.map((o) => o.AmazonOrderId)).toEqual(['1', '2', '3']);
    } finally {
      jest.useRealTimers();
    }
  });

  test('single page needs no pacing delay and returns immediately', async () => {
    global.fetch.mockResolvedValueOnce(page([order('1')], null));

    const result = await fetchOrders('tok', AWS_CONFIG);

    expect(result).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('empty result is an empty array, not null', async () => {
    global.fetch.mockResolvedValueOnce(page([], null));

    await expect(fetchOrders('tok', AWS_CONFIG)).resolves.toEqual([]);
  });

  test('still uses the default 15-day window', async () => {
    global.fetch.mockResolvedValueOnce(page([], null));

    await fetchOrders('tok', AWS_CONFIG);

    const url = global.fetch.mock.calls[0][0];
    const { createdAfter, createdBefore } = getDateRange();
    expect(url).toContain(`CreatedAfter=${encodeURIComponent(createdAfter)}`);
    expect(url).toContain(`CreatedBefore=${encodeURIComponent(createdBefore)}`);
  });

  test('missing endpoint still throws', async () => {
    await expect(fetchOrders('tok', { ...AWS_CONFIG, endpoint: null }))
      .rejects.toThrow('endpoint is required');
  });

  test('a failure mid-walk still rejects (no partial array returned)', async () => {
    global.fetch
      .mockResolvedValueOnce(page([order('1')], 'TOK'))
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => null },
        json: async () => ({ errors: [{ code: 'Unauthorized' }] }),
      });

    jest.useFakeTimers();
    try {
      const promise = fetchOrders('tok', AWS_CONFIG);
      const assertion = expect(promise).rejects.toThrow('Orders API failed: 403');
      await jest.advanceTimersByTimeAsync(ORDER_CONFIG.delayBetweenOrderPagesMs + 100);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('fetchOrdersStreaming', () => {
  test('hands each page to onPage instead of buffering', async () => {
    jest.useFakeTimers();
    try {
      global.fetch
        .mockResolvedValueOnce(page([order('1'), order('2')], 'TOK'))
        .mockResolvedValueOnce(page([order('3')], null));

      const seen = [];
      const promise = fetchOrdersStreaming('tok', AWS_CONFIG, {
        createdAfter: '2026-07-01T00:00:00.000Z',
        createdBefore: '2026-07-16T00:00:00.000Z',
        onPage: (orders, meta) => {
          seen.push({ count: orders.length, page: meta.page });
        },
        quiet: true,
      });
      await jest.advanceTimersByTimeAsync(ORDER_CONFIG.delayBetweenOrderPagesMs + 100);
      const summary = await promise;

      expect(seen).toEqual([{ count: 2, page: 1 }, { count: 1, page: 2 }]);
      expect(summary).toEqual({
        pages: 2,
        totalOrders: 3,
        completed: true,
        stopReason: null,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('onPage is awaited before the pacing delay (writes ride the rate-limit gap)', async () => {
    jest.useFakeTimers();
    try {
      global.fetch
        .mockResolvedValueOnce(page([order('1')], 'TOK'))
        .mockResolvedValueOnce(page([order('2')], null));

      const events = [];
      const promise = fetchOrdersStreaming('tok', AWS_CONFIG, {
        createdAfter: '2026-07-01T00:00:00.000Z',
        createdBefore: '2026-07-16T00:00:00.000Z',
        onPage: async () => {
          events.push('write-start');
          await Promise.resolve();
          events.push('write-end');
        },
        quiet: true,
      });
      await jest.advanceTimersByTimeAsync(ORDER_CONFIG.delayBetweenOrderPagesMs + 100);
      await promise;

      // Both writes complete; the second fetch cannot precede the first write finishing.
      expect(events).toEqual(['write-start', 'write-end', 'write-start', 'write-end']);
    } finally {
      jest.useRealTimers();
    }
  });

  test('maxPages stops the walk and reports the reason', async () => {
    global.fetch.mockResolvedValue(page([order('x')], 'MORE'));

    const summary = await fetchOrdersStreaming('tok', AWS_CONFIG, {
      createdAfter: '2026-07-01T00:00:00.000Z',
      createdBefore: '2026-07-16T00:00:00.000Z',
      maxPages: 1,
      quiet: true,
    });

    expect(summary.pages).toBe(1);
    expect(summary.completed).toBe(false);
    expect(summary.stopReason).toBe('maxPages');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('shouldStop halts the walk with a custom reason', async () => {
    global.fetch.mockResolvedValue(page([order('x')], 'MORE'));

    const summary = await fetchOrdersStreaming('tok', AWS_CONFIG, {
      createdAfter: '2026-07-01T00:00:00.000Z',
      createdBefore: '2026-07-16T00:00:00.000Z',
      shouldStop: () => 'budget',
      quiet: true,
    });

    expect(summary.stopReason).toBe('budget');
    expect(summary.completed).toBe(false);
  });

  test('a walk that ends naturally is `completed` even with a cap set', async () => {
    global.fetch.mockResolvedValueOnce(page([order('1')], null));

    const summary = await fetchOrdersStreaming('tok', AWS_CONFIG, {
      createdAfter: '2026-07-01T00:00:00.000Z',
      createdBefore: '2026-07-16T00:00:00.000Z',
      maxPages: 5,
      quiet: true,
    });

    expect(summary).toEqual({ pages: 1, totalOrders: 1, completed: true, stopReason: null });
  });

  test('requires an explicit date range', async () => {
    await expect(
      fetchOrdersStreaming('tok', AWS_CONFIG, { createdAfter: '2026-07-01T00:00:00.000Z' })
    ).rejects.toThrow('createdAfter and createdBefore are required');
  });

  test('uses the supplied range rather than the default window', async () => {
    global.fetch.mockResolvedValueOnce(page([], null));

    await fetchOrdersStreaming('tok', AWS_CONFIG, {
      createdAfter: '2026-07-05T00:00:00.000Z',
      createdBefore: '2026-07-06T00:00:00.000Z',
      quiet: true,
    });

    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain(encodeURIComponent('2026-07-05T00:00:00.000Z'));
    expect(url).toContain(encodeURIComponent('2026-07-06T00:00:00.000Z'));
  });
});

describe('getDateRange', () => {
  test('defaults to a 15-day window ending yesterday', () => {
    const { createdAfter, createdBefore } = getDateRange();
    const days = (new Date(createdBefore) - new Date(createdAfter)) / 86400000;
    expect(days).toBeGreaterThan(14.9);
    expect(days).toBeLessThan(16.1);
  });

  test('honours a custom window', () => {
    const { createdAfter, createdBefore } = getDateRange(3);
    const days = (new Date(createdBefore) - new Date(createdAfter)) / 86400000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(4.1);
  });
});

describe('enumerateSlices', () => {
  const after = '2026-07-01T00:00:00.000Z';
  const before = '2026-07-04T00:00:00.000Z';

  test('splits a range into contiguous day slices, oldest first', () => {
    const slices = enumerateSlices(after, before, 24);

    expect(slices).toHaveLength(3);
    expect(slices[0].createdAfter).toBe('2026-07-01T00:00:00.000Z');
    expect(slices[0].createdBefore).toBe('2026-07-02T00:00:00.000Z');
    expect(slices[2].createdBefore).toBe('2026-07-04T00:00:00.000Z');
  });

  test('slices are contiguous with no gaps or overlaps', () => {
    const slices = enumerateSlices(after, before, 6);

    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].createdAfter).toBe(slices[i - 1].createdBefore);
    }
    expect(slices[0].createdAfter).toBe(after);
    expect(slices[slices.length - 1].createdBefore).toBe(before);
  });

  test('the final slice is clamped to the range end, never past it', () => {
    // 3 days at 48h granularity → 48h + a 24h remainder.
    const slices = enumerateSlices(after, before, 48);

    expect(slices).toHaveLength(2);
    expect(slices[1].createdBefore).toBe(before);
    expect(new Date(slices[1].createdBefore) <= new Date(before)).toBe(true);
  });

  test('sliceKey has hour resolution so granularity changes cannot collide', () => {
    const daily = enumerateSlices(after, before, 24);
    const sixHourly = enumerateSlices(after, before, 6);

    expect(daily[0].sliceKey).toBe('2026-07-01T00');
    expect(sixHourly[1].sliceKey).toBe('2026-07-01T06');
    expect(new Set(sixHourly.map((s) => s.sliceKey)).size).toBe(sixHourly.length);
  });

  test('an empty or inverted range yields no slices', () => {
    expect(enumerateSlices(before, after, 24)).toEqual([]);
    expect(enumerateSlices(after, after, 24)).toEqual([]);
  });

  test('slices cover the whole 15-day default window', () => {
    const { createdAfter, createdBefore } = getDateRange();
    const slices = enumerateSlices(createdAfter, createdBefore, 24);

    expect(slices[0].createdAfter).toBe(createdAfter);
    expect(slices[slices.length - 1].createdBefore).toBe(createdBefore);
    expect(slices.length).toBeGreaterThanOrEqual(15);
  });
});

describe('isWithinReviewWindow', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');

  test('accepts an order inside the 5-30 day window', () => {
    expect(isWithinReviewWindow(new Date('2026-07-18T12:00:00.000Z'), now)).toBe(true);
  });

  test('rejects an order that is too new to solicit', () => {
    expect(isWithinReviewWindow(new Date('2026-07-26T12:00:00.000Z'), now)).toBe(false);
  });

  test('rejects an order past the 30-day deadline', () => {
    expect(isWithinReviewWindow(new Date('2026-06-20T12:00:00.000Z'), now)).toBe(false);
  });

  test('matches ORDER_CONFIG exactly at both boundaries', () => {
    const minEdge = new Date(now.getTime() - ORDER_CONFIG.minOrderAgeDays * 86400000);
    const maxEdge = new Date(now.getTime() - ORDER_CONFIG.maxOrderAgeDays * 86400000);

    expect(isWithinReviewWindow(minEdge, now)).toBe(true);
    expect(isWithinReviewWindow(maxEdge, now)).toBe(true);
  });

  test('handles ISO strings and rejects junk', () => {
    expect(isWithinReviewWindow('2026-07-18T12:00:00.000Z', now)).toBe(true);
    expect(isWithinReviewWindow(null, now)).toBe(false);
    expect(isWithinReviewWindow('not-a-date', now)).toBe(false);
  });
});
