/**
 * ProfitTable used to fire /api/pagewise/asin-wise-sales on every mount, even in
 * finance-only mode where it renders /api/finance-dashboard rows and never reads
 * the result. These tests pin that the request only happens in legacy mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const mockGet = vi.fn();
vi.mock('../../config/axios.config', () => ({
  default: { get: (...a) => mockGet(...a), post: vi.fn(), put: vi.fn() },
}));

const state = {
  Dashboard: { DashBoardInfo: { profitibilityData: [], TotalProduct: [], economicsMetrics: null } },
  cogs: { cogsValues: {}, savedCogsValues: {}, saving: false, loading: false },
  currency: { currency: '$', country: 'US' },
};
vi.mock('react-redux', () => ({
  useSelector: (fn) => {
    try { return fn(state); } catch { return undefined; }
  },
  useDispatch: () => vi.fn(),
}));

import ProfitTable from '../../Components/ProfitibilityDashboard/ProfitTable.jsx';

const asinWiseCalls = () => mockGet.mock.calls.filter(([url]) => url === '/api/pagewise/asin-wise-sales');

describe('ProfitTable /asin-wise-sales request', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue({ data: { statusCode: 200, data: { asinWiseSales: [] } } });
  });

  it('does not request asin-wise-sales in finance-only mode', async () => {
    render(<ProfitTable useFinanceTableOnly financeDashAsinWise={[]} />);
    // Give effects a turn to run.
    await new Promise((r) => setTimeout(r, 20));
    expect(asinWiseCalls()).toHaveLength(0);
  });

  it('still requests it in legacy mode (control)', async () => {
    render(<ProfitTable />);
    await waitFor(() => expect(asinWiseCalls().length).toBeGreaterThan(0));
  });
});
