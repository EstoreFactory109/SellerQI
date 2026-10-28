/**
 * Tests for the recoverable-$ wiring on the Tasks page.
 *
 * Renders the real Tasks component against a mock store so the amount display,
 * per-severity aggregate, highest-first ordering, and CSV column are all
 * verified as the user actually sees them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import Tasks from '../../Pages/Tools/Tasks.jsx';

// The component dispatches a fetch thunk on mount; stub the network layer so the
// pre-seeded store state is what renders.
// The Fix it packages are on by default (VITE_FIX_IT_PACKAGES=false hides them); the
// "switched off" block below flips it.
const flags = vi.hoisted(() => ({ FIX_IT_PACKAGES: true }));
vi.mock('../../utils/featureFlags.js', async (importOriginal) => ({
  ...(await importOriginal()),
  get FIX_IT_PACKAGES() { return flags.FIX_IT_PACKAGES; },
}));

const stripe = vi.hoisted(() => ({ startFixItCheckout: vi.fn(), getFixItSubscription: vi.fn(async () => null) }));
vi.mock('../../services/stripeService.js', () => ({ default: stripe }));

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

const makeStore = (tasks, groups = [], currency = 'A$') => configureStore({
  reducer: {
    tasks: () => ({ tasks, groups, taskRenewalDate: null, loading: false, error: null, completedTasks: [], lastFetched: Date.now() }),
    currency: () => ({ currency }),
    Auth: () => ({ user: { _id: 'u1' } }),
    Dashboard: () => ({ DashBoardInfo: { TotalProduct: [] } }),
    pageData: () => ({}),
  },
});

// The page reads ?category=&type= for Dashboard deep-links, so it needs a Router.
const renderTasks = (tasks = TASKS, { groups = [], route = '/', currency = 'A$' } = {}) =>
  render(
    <Provider store={makeStore(tasks, groups, currency)}>
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
    fireEvent.click(screen.getByText('Everything else').closest('button'));
    expect(screen.getByText(/No amount task/)).toBeInTheDocument();
    // The only A$0.00 allowed is the live loss counter's starting value.
    const live = screen.getByTestId('live-loss');
    screen.queryAllByText('A$0.00').forEach(el => expect(live.contains(el)).toBe(true));
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

describe('Tasks page - Fix it', () => {
  it('no longer shows the completion progress line', () => {
    renderTasks();
    expect(screen.queryByText(/You've completed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/keep going/)).not.toBeInTheDocument();
    expect(screen.queryByText(/still pending/)).not.toBeInTheDocument();
  });

  it('shows a Fix it button that opens the three packages', () => {
    renderTasks();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Fix it/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('$25')).toBeInTheDocument();
    expect(within(dialog).getByText('$299')).toBeInTheDocument();
    expect(within(dialog).getByText('$499')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Purchase' })).toBeDisabled();
  });

  it('shows the total number of tasks', () => {
    renderTasks();
    expect(screen.getByTestId('total-tasks')).toHaveTextContent(String(TASKS.length));
    expect(screen.getByText(/tasks in total/)).toBeInTheDocument();
  });

  it('uses the singular for one task, and explains an empty list', () => {
    renderTasks([makeTask({ taskId: 'only', asin: 'B1' })]);
    expect(screen.getByText(/task in total/)).toBeInTheDocument();
    expect(screen.queryByText(/tasks in total/)).not.toBeInTheDocument();
  });

  it('counts finished tasks in the total too', () => {
    renderTasks([makeTask({ taskId: 'a', asin: 'B1' }), { ...makeTask({ taskId: 'b', asin: 'B2' }), status: 'completed' }]);
    expect(screen.getByTestId('total-tasks')).toHaveTextContent('2');
  });

  // Nothing to fix means nothing to sell: no button, just the explanation.
  it('shows the total but no Fix it button when there are no tasks', () => {
    renderTasks([]);
    expect(screen.queryByRole('button', { name: /Fix it/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('total-tasks')).toHaveTextContent('0');
    expect(screen.getByText(/No tasks yet/)).toBeInTheDocument();
  });

  it('closes the packages again', () => {
    renderTasks();
    fireEvent.click(screen.getByRole('button', { name: /Fix it/ }));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Purchase goes to Stripe checkout with the package and what the seller is looking at', async () => {
    stripe.startFixItCheckout.mockReturnValue(new Promise(() => {})); // the page is left for Stripe
    renderTasks();
    fireEvent.click(screen.getByRole('button', { name: /Fix it/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Standard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe for $299/month' }));
    expect(stripe.startFixItCheckout).toHaveBeenCalledWith({
      packageId: 'standard', openTasks: 9, monthlyRecoverable: 1007.03, atStakeCurrency: 'A$',
    });
    expect(await screen.findByRole('button', { name: 'Redirecting to secure checkout…' })).toBeDisabled();
  });

  it('says so when checkout cannot start, and lets the seller try again', async () => {
    stripe.startFixItCheckout.mockRejectedValue({ response: { data: { message: 'Fix it packages cannot be bought right now. Please contact support.' } } });
    renderTasks();
    fireEvent.click(screen.getByRole('button', { name: /Fix it/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Trial/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Purchase for $25' }));
    expect(await screen.findByText(/cannot be bought right now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Purchase for $25' })).toBeEnabled();
  });

  it('back from Stripe without paying: says nothing was charged', () => {
    renderTasks(TASKS, { route: '/?fixit=cancelled' });
    expect(screen.getByText(/Payment cancelled — nothing was charged/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Payment cancelled/)).not.toBeInTheDocument();
  });
});

describe('Tasks page - urgency card', () => {
  // TASKS: A$1,007.03 of open recoverable money over 9 tasks.
  //   profitability:negative_profit 583.07, conversion:no_buybox 214.55 (est.),
  //   sponsoredAds:wasted_spend_keyword 187.41, search_term_zero_sales 17, high_acos 5
  afterEach(() => { vi.useRealTimers(); });

  it('leads with the monthly loss in large type', () => {
    renderTasks(TASKS, { groups: GROUPS });
    const headline = screen.getByTestId('urgency-headline');
    expect(headline).toHaveTextContent('A$1,007every month');
    expect(headline).not.toHaveTextContent('(est.)');
    expect(screen.getByText(/across/)).toHaveTextContent('across 9 open tasks');
  });

  it('projects the same rate per day, over the rest of the month, and per year', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 14)); // Oct 14 -> 18 days left including today
    renderTasks();
    expect(screen.getByText('Every day').previousSibling).toHaveTextContent('A$34');
    expect(screen.getByText('Rest of this month (18d)').previousSibling).toHaveTextContent('A$604');
    expect(screen.getByText('Over a year').previousSibling).toHaveTextContent('A$12,084');
  });

  it('runs a live counter of money lost while the page is open', () => {
    vi.useFakeTimers();
    renderTasks();
    const counter = screen.getByTestId('live-loss');
    expect(counter).toHaveTextContent('A$0.00 lost since you opened this page');
    // A$1,007.03 / 30 / 86400 per second -> A$1.40 after an hour.
    act(() => { vi.advanceTimersByTime(3600 * 1000); });
    expect(counter).toHaveTextContent('A$1.40');
  });

  it('hides the live counter when the rate is too small to move', () => {
    renderTasks([makeTask({ taskId: 's', asin: 'B1', amount: 300 })]); // ~A$0.42/hour
    expect(screen.queryByTestId('live-loss')).not.toBeInTheDocument();
  });

  it('lists the top leaks with their monthly amounts, biggest first', () => {
    renderTasks(TASKS, { groups: GROUPS });
    const leaking = screen.getByText(/Where it.s leaking/).parentElement;
    const text = leaking.textContent;
    expect(text).toContain('Products losing money on every sale');
    expect(text).toContain('A$583/mo');
    expect(text).toContain('Keywords spending money with zero sales');
    expect(text.indexOf('Products losing')).toBeLessThan(text.indexOf('Keywords spending'));
  });

  it('marks the headline (est.) when most of the money is estimated', () => {
    renderTasks([makeTask({ taskId: 'e', asin: 'B1', amount: 100, amountIsEstimated: true })]);
    expect(screen.getByTestId('urgency-headline')).toHaveTextContent('(est.)');
  });

  it('says the figures are estimates from the last 30 days, not guarantees', () => {
    renderTasks();
    expect(screen.getByText(/last 30 days of your data.*not guarantees/)).toBeInTheDocument();
  });

  it('shows capital stuck in stock separately, never inside the monthly figure', () => {
    renderTasks([
      makeTask({ taskId: 'm', asin: 'B1', amount: 300 }),
      { ...makeTask({ taskId: 'c', asin: 'B2', errorCategory: 'inventory', errorType: 'stranded_inventory' }), capitalAmount: 5000 },
    ]);
    expect(screen.getByTestId('urgency-headline')).toHaveTextContent('A$300every month');
    expect(screen.getByText(/of capital stuck in unsellable stock/)).toHaveTextContent('A$5,000');
  });

  it('falls back to a task count when no open task carries money', () => {
    renderTasks([makeTask({ taskId: 'r', asin: 'B1', errorCategory: 'ranking', errorType: 'titleresult_char_limit', amount: 0 })]);
    expect(screen.getByTestId('urgency-headline')).toHaveTextContent('1 open task is holding back your listings');
    expect(screen.queryByText(/every month/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fix it/ })).toBeInTheDocument();
  });

  it('has no separate risk banner: account risk lives inside the one card', () => {
    renderTasks([
      ...TASKS,
      makeTask({ taskId: 'acct', asin: 'ACCOUNT', errorCategory: 'account', errorType: 'PolicyViolations', impactWeight: 90 }),
    ]);
    const card = screen.getByRole('region', { name: 'What your open tasks are costing you' });
    const risk = within(card).getByRole('alert');
    expect(risk).toHaveTextContent('1 issue puts your selling account at risk');
    expect(risk).toHaveTextContent('Policy Violations');
    expect(within(card).getByText(/account at risk/i, { selector: 'span' })).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows no account risk when no account issue is open', () => {
    renderTasks();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // Prices are USD; the anchor compares them with recovered money.
  it('anchors the trial price against what the top tasks are worth (USD only)', () => {
    renderTasks([makeTask({ taskId: 'u1', asin: 'B1', amount: 900 }), makeTask({ taskId: 'u2', asin: 'B2', amount: 600 })], { currency: '$' });
    const anchor = screen.getByTestId('price-anchor');
    expect(anchor).toHaveTextContent(`Your top 2 tasks are worth ~$1,500/mo. Our team will fix them for $25 — less than one day of what you're losing.`);
  });

  it('uses a plain price line for non-USD marketplaces', () => {
    renderTasks();
    expect(screen.getByTestId('price-anchor')).toHaveTextContent('Plans start at $25 for 2 tasks.');
  });

  it('offers "Have us fix these" on the High impact bucket', () => {
    renderTasks();
    const header = screen.getByText('High impact').closest('div');
    fireEvent.click(within(header).getByRole('button', { name: 'Have us fix these' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('passes the open tasks to the packages, so each shows its value', () => {
    renderTasks();
    fireEvent.click(screen.getByRole('button', { name: /Fix it now/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Recommended for your 9 tasks')).toBeInTheDocument();
    expect(within(dialog).getByText('$25').closest('button')).toHaveTextContent('Covers your top 2 tasks, worth ~A$787/mo');
  });

  it('records where the packages were opened from', () => {
    window.gtag = vi.fn();
    renderTasks();
    fireEvent.click(screen.getByRole('button', { name: /Fix it now/ }));
    expect(window.gtag).toHaveBeenCalledWith('event', 'fixit_open', {
      source: 'hero', open_tasks: 9, monthly_recoverable: 1007.03,
    });
    delete window.gtag;
  });
});

describe('Tasks page - Fix it switched off (VITE_FIX_IT_PACKAGES=false)', () => {
  beforeEach(() => { flags.FIX_IT_PACKAGES = false; });
  afterEach(() => { flags.FIX_IT_PACKAGES = true; });

  it('shows no Fix it buttons and no price line, but keeps what the tasks cost', () => {
    renderTasks();
    expect(screen.queryByRole('button', { name: /Fix it now/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Have us fix these' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('price-anchor')).not.toBeInTheDocument();
    expect(screen.getByTestId('urgency-headline')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Tasks page - Fix it subtasks in Zoho', () => {
  it('marks the tasks the ESF team has, and the ones it finished', () => {
    renderTasks([
      { ...negProfit({ taskId: 'mine', asin: 'B1', error: 'Team has this', amount: 500 }), fixIt: { state: 'with_team' } },
      { ...negProfit({ taskId: 'done', asin: 'B2', error: 'Team did this', amount: 400 }), status: 'completed', fixIt: { state: 'done_by_team' } },
      negProfit({ taskId: 'plain', asin: 'B3', error: 'Nobody has this', amount: 300 }),
    ]);
    expect(screen.getByText('ESF team is on it')).toBeInTheDocument();
    expect(screen.getAllByText('ESF team is on it')).toHaveLength(1);
  });
});
