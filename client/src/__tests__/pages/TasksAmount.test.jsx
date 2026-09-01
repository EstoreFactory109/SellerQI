/**
 * Tests for the recoverable-$ wiring on the Tasks page.
 *
 * Renders the real Tasks component against a mock store so the amount display,
 * per-severity aggregate, highest-first ordering, and CSV column are all
 * verified as the user actually sees them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import Tasks from '../../Pages/Tools/Tasks.jsx';

// The component dispatches a fetch thunk on mount; stub the network layer so the
// pre-seeded store state is what renders.
vi.mock('../../redux/slices/TasksSlice.js', async () => {
  const actual = await vi.importActual('../../redux/slices/TasksSlice.js');
  return {
    ...actual,
    fetchTasks: () => ({ type: 'tasks/fetchTasks/fulfilled', payload: { tasks: [], taskRenewalDate: null } }),
    updateTaskStatus: () => ({ type: 'tasks/updateTaskStatus/noop' }),
  };
});

const makeTask = (over = {}) => ({
  taskId: over.taskId,
  productName: over.productName || 'Product',
  asin: over.asin || 'B000',
  errorCategory: over.errorCategory || 'profitability',
  errorType: over.errorType || 'negative_profit',
  error: over.error || 'Some error text',
  solution: over.solution || 'Some solution text',
  status: 'pending',
  amount: over.amount ?? 0,
  amountIsEstimated: over.amountIsEstimated ?? false,
  // Server-provided (TaskPrioritizationService); values below match its real tables.
  effortMinutes: over.effortMinutes ?? 15,
  impactWeight: over.impactWeight ?? 85,
  isQuickWin: over.isQuickWin ?? false,
});

const negProfit = (over) => makeTask({ errorCategory: 'profitability', errorType: 'negative_profit', effortMinutes: 15, impactWeight: 85, ...over });
const adsQuick = (over) => makeTask({ errorCategory: 'sponsoredAds', effortMinutes: 2, impactWeight: 65, isQuickWin: true, ...over });

// Ordered by money desc, diversity cap 2 per errorType:
//   High impact (6, full) : Big 572.57, Buy box 214.55, Wasted 187.41,
//                           Small 10.50, Term 9, Term 8   => A$1,002.03
//   Quick wins (spillover): Acos 3, Acos 2                => A$5.00
//   Everything else        : Zero 0
const TASKS = [
  negProfit({ taskId: 't-small', asin: 'B001', error: 'Small loss', amount: 10.5 }),
  negProfit({ taskId: 't-big', asin: 'B002', error: 'Big loss', amount: 572.57 }),
  adsQuick({ taskId: 't-mid', asin: 'B003', errorType: 'wasted_spend_keyword', error: 'Wasted spend', amount: 187.41 }),
  negProfit({ taskId: 't-zero', asin: 'B004', error: 'No amount task', amount: 0 }),
  makeTask({ taskId: 't-est', asin: 'B005', errorCategory: 'conversion', errorType: 'no_buybox', error: 'Buy box lost', amount: 214.55, amountIsEstimated: true, effortMinutes: 15, impactWeight: 80 }),
  adsQuick({ taskId: 't-q1', asin: 'B006', errorType: 'search_term_zero_sales', error: 'Term one', amount: 9 }),
  adsQuick({ taskId: 't-q2', asin: 'B007', errorType: 'search_term_zero_sales', error: 'Term two', amount: 8 }),
  adsQuick({ taskId: 't-q3', asin: 'B008', errorType: 'high_acos', error: 'Acos one', amount: 3, effortMinutes: 5, impactWeight: 58 }),
  adsQuick({ taskId: 't-q4', asin: 'B009', errorType: 'high_acos', error: 'Acos two', amount: 2, effortMinutes: 5, impactWeight: 58 }),
];

const makeStore = (tasks, groups = []) => configureStore({
  reducer: {
    tasks: () => ({ tasks, groups, taskRenewalDate: null, loading: false, error: null, completedTasks: [], lastFetched: Date.now() }),
    currency: () => ({ currency: 'A$' }),
    Auth: () => ({ user: { _id: 'u1' } }),
    Dashboard: () => ({ DashBoardInfo: { TotalProduct: [] } }),
    pageData: () => ({}),
  },
});

// The page reads ?category=&type= for Dashboard deep-links, so it needs a Router.
const renderTasks = (tasks = TASKS, { groups = [], route = '/' } = {}) =>
  render(
    <Provider store={makeStore(tasks, groups)}>
      <MemoryRouter initialEntries={[route]}><Tasks /></MemoryRouter>
    </Provider>
  );

describe('Tasks page - recoverable amount', () => {
  it('shows each task\'s amount in the account currency, not a hardcoded $', () => {
    renderTasks();
    expect(screen.getByText('A$572.57')).toBeInTheDocument();
    expect(screen.getByText('A$187.41')).toBeInTheDocument();
    expect(screen.getByText('A$10.50')).toBeInTheDocument();
  });

  it('marks an estimated amount with an asterisk', () => {
    renderTasks();
    expect(screen.getByText('A$214.55*')).toBeInTheDocument();
  });

  it('omits the amount entirely for a task with no recoverable value (no "A$0.00" noise)', () => {
    renderTasks();
    expect(screen.queryByText('A$0.00')).not.toBeInTheDocument();
  });

  it('sums the recoverable amount per bucket', () => {
    renderTasks();
    expect(screen.getByText(/A\$1,002\.03 recoverable/)).toBeInTheDocument();
    expect(screen.getByText(/A\$5\.00 recoverable/)).toBeInTheDocument();
  });

  it('does not show a group aggregate when the group has no recoverable amount', () => {
    renderTasks([makeTask({ taskId: 't-none', asin: 'B0NONE', error: 'Nothing to reclaim here', amount: 0 })]);
    expect(screen.queryByText(/recoverable/)).not.toBeInTheDocument();
  });
});

describe('Tasks page - the three buckets', () => {
  it('renders the three buckets with their guidance subtitles', () => {
    renderTasks();
    expect(screen.getByText('High impact')).toBeInTheDocument();
    expect(screen.getByText('Do these first')).toBeInTheDocument();
    expect(screen.getByText('Quick wins')).toBeInTheDocument();
    expect(screen.getByText('Under 5 minutes each')).toBeInTheDocument();
    expect(screen.getByText('Everything else')).toBeInTheDocument();
  });

  it('no longer shows the old severity grouping', () => {
    renderTasks();
    expect(screen.queryByText('High priority')).not.toBeInTheDocument();
    expect(screen.queryByText('Medium priority')).not.toBeInTheDocument();
  });

  it('fills High impact by money first and orders it descending', () => {
    const { container } = renderTasks();
    const text = container.textContent;
    const idx = (label) => text.indexOf(label);

    expect(idx('Big loss')).toBeLessThan(idx('Buy box lost'));
    expect(idx('Buy box lost')).toBeLessThan(idx('Wasted spend'));
    expect(idx('Wasted spend')).toBeLessThan(idx('Small loss'));
  });

  it('caps High impact at 6 and spills the remaining quick tasks into Quick wins', () => {
    renderTasks();
    // 6 in High impact => the two cheapest quick tasks land in Quick wins instead.
    const highImpactHeader = screen.getByText('High impact').closest('button');
    expect(within(highImpactHeader).getByText('6')).toBeInTheDocument();

    const quickHeader = screen.getByText('Quick wins').closest('button');
    expect(within(quickHeader).getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/Acos one/)).toBeInTheDocument();
    expect(screen.getByText(/Acos two/)).toBeInTheDocument();
  });

  it('honours the per-errorType diversity cap so one problem cannot fill High impact', () => {
    // 10 wasted-keyword tasks, nothing else: only 2 may be highlighted.
    const many = Array.from({ length: 10 }, (_, i) =>
      adsQuick({ taskId: `k${i}`, asin: `B10${i}`, errorType: 'wasted_spend_keyword', error: `Keyword ${i}`, amount: 500 - i })
    );
    renderTasks(many);

    const highImpactHeader = screen.getByText('High impact').closest('button');
    expect(within(highImpactHeader).getByText('2')).toBeInTheDocument();
  });

  it('shows a human-readable effort hint per task', () => {
    renderTasks();
    expect(screen.getAllByText('~2 min').length).toBeGreaterThan(0);
    expect(screen.getAllByText('~15 min').length).toBeGreaterThan(0);
  });
});

// Mirrors what the server sends: issue-type aggregates identical to the figures
// the Dashboard's "Top things to fix" reports.
const GROUPS = [
  { id: 'sponsoredAds:wasted_spend_keyword', category: 'sponsoredAds', issueType: 'wasted_spend_keyword', title: 'Keywords spending money with zero sales', count: 93, totalAmount: 187.41 },
  { id: 'profitability:negative_profit', category: 'profitability', issueType: 'negative_profit', title: 'Products losing money on every sale', count: 9, totalAmount: 572.57 },
];

describe('Tasks page - staying consistent with the Dashboard', () => {
  it('shows a highlighted row its standing inside the dashboard figure', () => {
    renderTasks(TASKS, { groups: GROUPS });
    // A A$187.41 keyword task row must read as a slice of the dashboard's A$187.41,
    // not as a contradiction of it.
    expect(screen.getByText(/1 of 93 · Keywords spending money with zero sales · A\$187\.41 total/)).toBeInTheDocument();
  });

  it('omits the standing line when the group holds only one task', () => {
    const groups = [{ id: 'profitability:negative_profit', category: 'profitability', issueType: 'negative_profit', title: 'Solo', count: 1, totalAmount: 10 }];
    renderTasks([negProfit({ taskId: 'solo', asin: 'B1', error: 'Only one', amount: 10 })], { groups });
    expect(screen.queryByText(/1 of 1/)).not.toBeInTheDocument();
  });

  it('narrows to one issue type when arriving from a Dashboard opportunity', () => {
    renderTasks(TASKS, { groups: GROUPS, route: '/?category=profitability&type=negative_profit' });

    expect(screen.getByText(/the tasks behind that dashboard figure/)).toBeInTheDocument();
    // Profitability rows survive; ads rows are filtered out.
    expect(screen.getByText(/Big loss/)).toBeInTheDocument();
    expect(screen.queryByText(/Wasted spend/)).not.toBeInTheDocument();
  });

  it('narrows to one product when arriving from a "products to fix" row', () => {
    renderTasks(TASKS, { groups: GROUPS, route: '/?asin=B002' });

    expect(screen.getByText(/every open issue on that product/)).toBeInTheDocument();
    expect(screen.getByText(/Big loss/)).toBeInTheDocument();      // B002
    expect(screen.queryByText(/Small loss/)).not.toBeInTheDocument(); // B001
  });

  it('degrades to the unfiltered list when the linked ASIN matches nothing', () => {
    renderTasks(TASKS, { groups: GROUPS, route: '/?asin=B0NOTHERE' });

    expect(screen.queryByText(/every open issue on that product/)).not.toBeInTheDocument();
    expect(screen.getByText(/Big loss/)).toBeInTheDocument();
    expect(screen.getByText(/Small loss/)).toBeInTheDocument();
  });

  it('degrades to the unfiltered list when the linked type matches nothing (stale link)', () => {
    renderTasks(TASKS, { groups: GROUPS, route: '/?category=profitability&type=some_retired_name' });

    // No misleading banner, and the seller is not stranded on an empty page.
    expect(screen.queryByText(/the tasks behind that dashboard figure/)).not.toBeInTheDocument();
    expect(screen.getByText(/Big loss/)).toBeInTheDocument();
  });
});

describe('Tasks page - CSV export', () => {
  let capturedCsv;
  let originalBlob;
  let originalCreate;

  beforeEach(() => {
    capturedCsv = null;
    originalBlob = global.Blob;
    // Capture the CSV string handed to the Blob constructor - jsdom's Blob has no
    // reliable async text() here, and the string is what we actually want to assert.
    global.Blob = class {
      constructor(parts) { capturedCsv = parts.join(''); }
    };
    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();
    originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = originalCreate(tag);
      if (tag === 'a') el.click = vi.fn();
      return el;
    });
  });

  afterEach(() => {
    global.Blob = originalBlob;
    vi.restoreAllMocks();
  });

  it('includes Amount and Estimated columns, blank for zero-amount rows, and keeps the comma-safe quoting', () => {
    renderTasks();
    const exportBtn = screen.getByRole('button', { name: /export/i });
    exportBtn.click();

    expect(capturedCsv).toBeTruthy();
    const lines = capturedCsv.split('\n');

    expect(lines[0]).toBe('Product,ASIN,Error Category,Error,How To Solve,Amount,Estimated,Status');

    // measured amount -> quoted figure, Estimated cell blank
    const bigRow = lines.find(l => l.includes('Big loss'));
    expect(bigRow).toContain('"A$572.57"');
    expect(bigRow).toMatch(/"A\$572\.57",,Pending$/);

    // estimated amount -> Estimated cell says Yes, so the caveat survives export
    const estRow = lines.find(l => l.includes('Buy box lost'));
    expect(estRow).toMatch(/"A\$214\.55",Yes,Pending$/);

    // zero-amount row leaves both cells empty rather than printing A$0.00
    const zeroRow = lines.find(l => l.includes('No amount task'));
    expect(zeroRow).not.toContain('A$0.00');
    expect(zeroRow).toMatch(/,,,Pending$/);
  });
});
