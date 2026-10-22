/**
 * "Where your money goes" must not show $0.00 for an account with no finance
 * data. /api/finance-dashboard reports that as `totals: null` +
 * `metadata.hasFinanceData: false` (older servers: zero-filled totals with
 * `metadata.totalDays: 0`). Real totals — including a real 0 — still render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockAxiosGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...a) => mockAxiosGet(...a), create: () => ({ get: vi.fn(), post: vi.fn() }) },
}));
vi.mock('../../config/axios.config', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const state = {
  Dashboard: { DashBoardInfo: { calendarMode: 'default', startDate: '2026-09-01', endDate: '2026-09-30' } },
  currency: { currency: '$' },
  cogs: { cogsValues: {} },
  ppcMetrics: { latestMetrics: { loading: false, lastFetched: Date.now(), data: null } },
};
vi.mock('react-redux', () => ({
  useSelector: (fn) => {
    try { return fn(state); } catch { return undefined; }
  },
  useDispatch: () => vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import TotalSales from '../../Components/Dashboard/SamePageComponents/TotalSales.jsx';

const ZERO_TOTALS = {
  productSales: 0, units: 0, fbaFulfillmentFee: 0, referralCommission: 0,
  refundedAmount: 0, adsSpend: 0, otherExpenses: 0, otherExpensesBreakdown: [],
};

const respondWith = (financeData) => {
  mockAxiosGet.mockImplementation((rawUrl) => {
    const url = String(rawUrl || '');
    if (url.includes('/api/finance-dashboard/date-range')) {
      return Promise.resolve({ data: { data: { startDate: '2026-09-01', endDate: '2026-09-30' } } });
    }
    if (url.includes('/api/finance-dashboard')) {
      return Promise.resolve({ data: { data: financeData } });
    }
    return Promise.resolve({ data: {} });
  });
};

const renderAndSettle = async (financeData) => {
  respondWith(financeData);
  const onGrossProfitChange = vi.fn();
  render(<TotalSales onGrossProfitChange={onGrossProfitChange} />);
  await waitFor(() => {
    const last = onGrossProfitChange.mock.calls.at(-1)?.[0];
    expect(last?.loading).toBe(false);
    expect(mockAxiosGet.mock.calls.some(([u]) => /finance-dashboard\?/.test(String(u)))).toBe(true);
  });
  // let the response land
  await waitFor(() => expect(screen.queryByText(/Loading your sales/)).toBeNull());
  return onGrossProfitChange;
};

describe('TotalSales with no finance data', () => {
  beforeEach(() => mockAxiosGet.mockReset());

  it('totals: null + hasFinanceData false renders the empty state, never $0.00', async () => {
    const cb = await renderAndSettle({
      totals: null, asinWise: [], overhead: [],
      metadata: { hasFinanceData: false, totalDays: 0, startDate: '2026-09-01', endDate: '2026-09-30' },
    });
    expect(screen.getByText(/No finance data available for this period/)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
    expect(screen.queryByText(/You keep/)).toBeNull();
    const last = cb.mock.calls.at(-1)[0];
    expect(last.hasFinanceData).toBe(false);
    expect(last.totalSales).toBeNull();
    expect(last.grossProfitRaw).toBeNull();
  });

  it('zero-filled totals with metadata.totalDays 0 (older server) is also no data', async () => {
    const cb = await renderAndSettle({
      totals: ZERO_TOTALS, asinWise: [], overhead: [],
      metadata: { totalDays: 0, startDate: '2026-09-01', endDate: '2026-09-30' },
    });
    expect(screen.getByText(/No finance data available for this period/)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
    expect(cb.mock.calls.at(-1)[0].hasFinanceData).toBe(false);
  });

  it('real totals render the amounts', async () => {
    const cb = await renderAndSettle({
      totals: { ...ZERO_TOTALS, productSales: 1000, fbaFulfillmentFee: -200 },
      asinWise: [], overhead: [],
      metadata: { hasFinanceData: true, totalDays: 30 },
    });
    expect(screen.queryByText(/No finance data available/)).toBeNull();
    expect(screen.getByText(/Every dollar of the \$1,000\.00/)).toBeInTheDocument();
    expect(screen.getByText('You keep')).toBeInTheDocument();
    expect(screen.getAllByText('$800.00').length).toBeGreaterThan(0);
    expect(cb.mock.calls.at(-1)[0]).toMatchObject({ hasFinanceData: true, totalSales: 1000, grossProfitRaw: 800 });
  });

  it('a real $0 period with finance rows still shows $0.00', async () => {
    await renderAndSettle({
      totals: ZERO_TOTALS, asinWise: [], overhead: [],
      metadata: { hasFinanceData: true, totalDays: 30 },
    });
    expect(screen.getByText(/Every dollar of the \$0\.00/)).toBeInTheDocument();
    expect(screen.getByText('You keep')).toBeInTheDocument();
  });
});
