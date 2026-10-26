/**
 * Activity views shared by the super admin and the ESF portal.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import axiosInstance from '../../config/axios.config.js';
import ActivityOverview from '../../Components/Activity/ActivityOverview.jsx';
import UserActivityDrawer from '../../Components/Activity/UserActivityDrawer.jsx';

vi.mock('../../config/axios.config.js', () => ({ default: { get: vi.fn() } }));
afterEach(() => vi.clearAllMocks());

const now = new Date();
const minutesAgo = (m) => new Date(now.getTime() - m * 60000).toISOString();

const timeline = {
  user: { userId: 'u1', name: 'Ann Lee', email: 'ann@x.com', lastActiveAt: minutesAgo(0.5) },
  isActiveNow: true,
  days: 7,
  totals: { last24hSeconds: 1500, last7dSeconds: 5400 },
  sittings: [
    {
      activityId: 's2', actor: { kind: 'esf_staff', name: 'Priya' }, startedAt: minutesAgo(30), endedAt: minutesAgo(28), seconds: 120,
      pages: [{ label: 'Tasks', path: '/seller-central-checker/tasks', startedAt: minutesAgo(30), seconds: 120 }],
    },
    {
      activityId: 's1', actor: { kind: 'owner', name: null }, startedAt: minutesAgo(10), endedAt: minutesAgo(0.5), seconds: 570,
      pages: [
        { label: 'Dashboard', path: '/seller-central-checker/dashboard', startedAt: minutesAgo(10), seconds: 200 },
        { label: 'Campaign Audit', path: '/seller-central-checker/ppc-dashboard', startedAt: minutesAgo(6), seconds: 370 },
      ],
    },
  ],
};

describe('UserActivityDrawer', () => {
  it('shows status, totals, pages with time on each, and labels staff visits', async () => {
    axiosInstance.get.mockResolvedValue({ data: { data: timeline } });
    render(<UserActivityDrawer open onClose={() => {}} timelineUrl="/app/x" />);
    expect(await screen.findByText('Ann Lee')).toBeInTheDocument();
    expect(screen.getByText('Active now')).toBeInTheDocument();
    expect(screen.getByText('25m')).toBeInTheDocument();          // last 24 hours
    expect(screen.getByText('1h 30m')).toBeInTheDocument();       // last 7 days
    expect(screen.getAllByText('Campaign Audit').length).toBeGreaterThan(0);
    expect(screen.getByText('Viewed by ESF staff · Priya')).toBeInTheDocument();
    expect(axiosInstance.get).toHaveBeenCalledWith('/app/x', { params: { days: 7 } });
  });

  it('switches the period', async () => {
    axiosInstance.get.mockResolvedValue({ data: { data: { ...timeline, sittings: [] } } });
    render(<UserActivityDrawer open onClose={() => {}} timelineUrl="/app/x" />);
    await screen.findByText('No pages viewed in the last 7 days.');
    await userEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(axiosInstance.get).toHaveBeenLastCalledWith('/app/x', { params: { days: 30 } });
  });
});

describe('ActivityOverview', () => {
  it('lists who is active now (with their page) and who was recently, and opens their activity', async () => {
    axiosInstance.get.mockImplementation(async (url) => (url === '/app/overview'
      ? { data: { data: {
        activeNow: [{ userId: 'u1', name: 'Ann Lee', isActiveNow: true, currentPage: { label: 'Campaign Audit', seconds: 95 } }],
        recent: [{ userId: 'u2', name: 'Bob Kay', email: 'bob@x.com', brand: 'Acme', lastActiveAt: minutesAgo(42), currentPage: { label: 'Tasks' } }],
      } } }
      : { data: { data: timeline } }));

    render(<ActivityOverview overviewUrl="/app/overview" timelineUrlFor={(id) => `/app/timeline/${id}`} />);
    const card = (await screen.findByText('Ann Lee')).closest('button');
    expect(within(card).getByText('Campaign Audit')).toBeInTheDocument();
    expect(within(card).getByText(/1m 35s/)).toBeInTheDocument();
    expect(screen.getByText('Bob Kay')).toBeInTheDocument();
    expect(screen.getByText('42m ago')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Bob Kay'));
    expect(axiosInstance.get).toHaveBeenCalledWith('/app/timeline/u2', { params: { days: 7 } });
  });

  it('asks the server for the chosen period', async () => {
    axiosInstance.get.mockResolvedValue({ data: { data: { activeNow: [], recent: [] } } });
    render(<ActivityOverview overviewUrl="/app/overview" timelineUrlFor={() => ''} />);
    await screen.findByText(/No sellers are using SellerQI right now/);
    await userEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(axiosInstance.get).toHaveBeenLastCalledWith('/app/overview', { params: { since: '7d', search: undefined } });
  });
});
