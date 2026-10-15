/**
 * Account Health page: statuses Amazon keeps flipping are shown as "Unstable"
 * (amber) with the daily report strip; metrics with no report are "no data",
 * not healthy.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import Account from '../../Components/Issues_pages/Account.jsx';

const DAYS = ['2026-10-14', '2026-10-13', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08'];

const ACCOUNT_ERRORS = {
  accountStatus: {
    status: 'Error', level: 'warning',
    Message: 'Amazon flagged your account At Risk on 2 of the last 6 daily reports (Oct 10, Oct 13).',
    HowTOSolve: 'Check your Account Health Dashboard.',
    days: DAYS, badDays: ['2026-10-13', '2026-10-10'], daysJudged: 6,
  },
  PolicyViolations: {
    status: 'Error', level: 'error',
    Message: 'Amazon has issued a listing policy violation notification.',
    HowTOSolve: 'Fix the listings.',
  },
  // No V2 report carried these:
  // validTrackingRateStatus, orderWithDefectsStatus, lateShipmentRateStatus, CancellationRate
  negativeFeedbacks: {}, NCX: {}, a_z_claims: {}, responseUnder24HoursCount: {},
  TotalErrors: 2,
};

const renderPage = () => render(
  <Provider store={configureStore({
    reducer: {
      Dashboard: () => ({ DashBoardInfo: {} }),
      pageData: () => ({
        issuesPaginated: {
          account: {
            data: { AccountErrors: ACCOUNT_ERRORS, accountHealthPercentage: { Percentage: 80, status: 'Healthy' } },
            loading: false, error: null, lastFetched: Date.now(),
          },
        },
      }),
    },
  })}>
    <Account />
  </Provider>
);

const cardFor = (name) => screen.getByText(name, { selector: 'span.text-base' }).closest('.rounded-2xl');

describe('Account Health page - unstable statuses', () => {
  it('labels a flip-flopping status Unstable, not Issue', () => {
    renderPage();
    const card = cardFor('Account Status');
    expect(within(card).getByText('Unstable')).toBeInTheDocument();
    expect(within(card).queryByText('Issue')).not.toBeInTheDocument();
  });

  it('shows the daily report strip with the bad days marked', () => {
    renderPage();
    const strip = within(cardFor('Account Status')).getByTestId('report-history-strip');
    expect(strip).toHaveTextContent('Last 6 daily reports');
    const dots = within(strip).getAllByRole('listitem');
    expect(dots).toHaveLength(6);
    expect(dots.filter(d => d.getAttribute('aria-label').endsWith('problem reported')).map(d => d.getAttribute('aria-label')))
      .toEqual(['Oct 10: problem reported', 'Oct 13: problem reported']);
  });

  it('keeps a sustained problem as Issue, listed before the unstable one', () => {
    renderPage();
    expect(within(cardFor('Policy Violations')).getByText('Issue')).toBeInTheDocument();
    const text = document.body.textContent;
    expect(text.indexOf('Policy Violations')).toBeLessThan(text.indexOf('Amazon flagged your account'));
  });

  it('marks metrics with no report as "no data yet", not healthy', () => {
    renderPage();
    fireEvent.click(screen.getByText(/healthy — nothing to do there/));
    const row = screen.getByText('Valid Tracking Rate').closest('div');
    expect(within(row).getByText('no data yet')).toBeInTheDocument();
    const v1Row = screen.getByText('Negative Seller Feedback').closest('div');
    expect(within(v1Row).queryByText('no data yet')).not.toBeInTheDocument();
  });
});
